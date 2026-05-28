"""Backtesting service: runs test cases against a prompt+model and scores results."""
from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
import time
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.document import Document
from app.models.model_config import ModelConfig
from app.models.post_training import BacktestResult, BacktestRun, InferenceCache, TestCase
from app.models.prompt import PromptVersion
from app.providers.base import LLMResponse
from app.providers.registry import get_provider
from app.services import assertion_engine, test_case_pii_service
from app.services.inference_service import _final_cleanup
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)

MAX_CONCURRENT = 1
# Fallback when the user sets max_tokens=0 ("No limit") in Model Registry.
# Capped at 4096 — enough for any realistic answer while preventing reasoning
# models from burning through 100k+ tokens of chain-of-thought and making
# each backtest case take 10+ minutes.
DEFAULT_MAX_TOKENS = 4096


async def _stream_to_response(provider, **kwargs) -> LLMResponse:
    """Run the provider's streaming API but accumulate into an LLMResponse.

    Streaming keeps the connection alive against proxies (e.g. Cloudflare's
    120s timeout on RunPod), even when generation itself takes minutes —
    which it can with reasoning models on long prompts.

    On stream failure (e.g. Gemini "incomplete chunked read"), fall back to
    a single non-streaming call so a transient stream error doesn't fail
    the whole backtest case.
    """
    try:
        parts: list[str] = []
        async for chunk in provider.stream(**kwargs):
            parts.append(chunk)
        if parts:
            return LLMResponse(
                content="".join(parts),
                input_tokens=0,
                output_tokens=0,
                model=kwargs.get("model_id", ""),
            )
        # Empty stream: treat as failure and fall through to generate()
        logger.warning("Streaming returned no content; falling back to generate()")
    except Exception as e:
        logger.warning("Streaming failed (%s); falling back to generate()", e)

    return await provider.generate(**kwargs)


def _strip_think(text: str | None) -> str:
    """Reasoning models (Qwen3, DeepSeek-R1, MedGemma, etc.) emit <think>…</think>
    blocks of private chain-of-thought before the real answer. Strip at storage
    so every consumer (Batch Compare, dataset add, downstream eval) sees the
    clean answer without per-page filtering. Reuses inference_service's canonical
    cleanup so the same model-variant rules (<unusedN>, <reasoning>, …) apply.
    """
    if not text:
        return ""
    return _final_cleanup(text)


def _find_all_json_objects(text: str) -> list[str]:
    """Find all top-level balanced `{…}` blocks that parse as valid JSON.
    Handles strings/escapes correctly so braces inside string literals don't
    confuse the depth counter. Returns them in order found (last is final answer).
    """
    results: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        # Walk forward from i, tracking brace depth and string state.
        depth = 0
        in_string = False
        escape = False
        end = -1
        for j in range(i, n):
            c = text[j]
            if escape:
                escape = False
                continue
            if c == "\\":
                escape = True
                continue
            if c == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = j
                    break
        if end == -1:
            # Unbalanced from i onward; no more top-level objects to find.
            break
        candidate = text[i:end + 1]
        try:
            json.loads(candidate)
            results.append(candidate)
        except (json.JSONDecodeError, ValueError):
            pass
        i = end + 1
    return results


def _find_last_top_level_json(text: str) -> str | None:
    """Scan `text` for top-level balanced `{…}` blocks and return the LAST
    one that parses as valid JSON. Handles strings/escapes correctly so braces
    inside string literals don't confuse the depth counter.

    Returns None if no valid JSON object is found.
    """
    all_json = _find_all_json_objects(text)
    return all_json[-1] if all_json else None


def _extract_clean_output(text: str | None, expected: str | None = None) -> str:
    """Aggressive cleanup for backtest comparison.

    When the test's `expected` is JSON, this returns ONLY the final JSON object
    found in the model's output — or a clear marker if no JSON was produced.
    This prevents reasoning prose (with or without <think> tags) from leaking
    into the actual_output and breaking assertions.

    When `expected` is not JSON, returns the canonical cleaned text (think tags
    removed) so non-JSON tests aren't accidentally mangled.
    """
    if not text:
        return ""
    cleaned = _strip_think(text)

    # Detect whether expected output is JSON-shaped. If not, don't try to
    # extract a JSON sub-object — the test isn't comparing JSON structure.
    exp = (expected or "").strip()
    if exp.startswith("```"):
        exp = re.sub(r"^```(?:json)?\s*|\s*```\s*$", "", exp).strip()
    expected_is_json = exp.startswith("{") and exp.endswith("}")
    if not expected_is_json:
        return cleaned

    # Strict JSON mode: walk the ORIGINAL response (not just `cleaned`) so we
    # catch JSON even inside untagged reasoning prose. Strip markdown fences
    # first so ```json … ``` wrappers don't block the brace scanner.
    body = re.sub(r"```(?:json|JSON)?\s*", "", text)
    body = re.sub(r"\s*```\s*", "", body).strip()

    # Already pure JSON?
    if body.startswith("{") and body.endswith("}"):
        try:
            json.loads(body)
            return body
        except (json.JSONDecodeError, ValueError):
            pass

    # Find the LAST top-level balanced JSON object via bracket counting.
    # Reasoning prose can mention small `{…}` examples; the actual answer is
    # the final, largest object that parses cleanly.
    extracted = _find_last_top_level_json(body)
    if extracted is not None:
        return extracted

    # Strict mode: expected is JSON but the model produced none. Return a clear
    # marker rather than dumping the full reasoning prose into actual_output.
    # This usually means the model ran out of max_tokens during chain-of-thought
    # before reaching the final JSON answer — surface that explicitly.
    return "[NO JSON OUTPUT: model produced only reasoning text. Likely ran out of max_tokens during thinking — increase max_tokens or disable reasoning.]"

# Serializes all DB writes coming out of concurrent run_single coroutines.
# aiosqlite's threading model + SQLAlchemy async sessions don't always honor
# SQLite's busy_timeout reliably across concurrent commits; a Python-level
# lock is the simplest guaranteed serialization.  Inference calls (the slow
# part) still run concurrently — only the brief commit step serializes.
_DB_WRITE_LOCK = asyncio.Lock()

# ─── Scoring strategies per expected_type ─────────────────────────────────────

_WORD_RE = re.compile(r"\b\w+\b")
_STOP_WORDS = frozenset(
    "a an the is are was were be been being have has had do does did will would "
    "shall should may might can could of in to for on with at by from as into "
    "through during before after above below between and but or nor not so yet "
    "this that these those it its he she they them their his her".split()
)


def _tokenize(text: str) -> list[str]:
    """Lowercase word tokens, stripping stop-words and very short tokens."""
    words = _WORD_RE.findall(text.lower())
    return [w for w in words if w not in _STOP_WORDS and len(w) > 1]


def _score_generative(expected: str, actual: str) -> float:
    """Keyword/concept overlap score for generative text.

    Combines:
    - Weighted keyword overlap (key concepts present in both)
    - Sequence similarity (structural similarity)
    """
    expected_tokens = _tokenize(expected)
    actual_tokens = _tokenize(actual)

    if not expected_tokens:
        # If the expected output has no meaningful tokens, fall back to sequence match
        return difflib.SequenceMatcher(None, expected.lower().strip(), actual.lower().strip()).ratio()

    expected_counts = Counter(expected_tokens)
    actual_counts = Counter(actual_tokens)

    # How many expected keywords appear in actual output
    matched = sum(min(expected_counts[w], actual_counts[w]) for w in expected_counts)
    keyword_recall = matched / sum(expected_counts.values())

    # Structural similarity (lighter weight)
    seq_ratio = difflib.SequenceMatcher(
        None, expected.lower().strip(), actual.lower().strip()
    ).ratio()

    # Blend: 70% keyword recall + 30% structural similarity
    return 0.7 * keyword_recall + 0.3 * seq_ratio


def _score_classification(expected: str, actual: str) -> float:
    """Exact/near-exact match for classification labels."""
    e = expected.strip().lower()
    a = actual.strip().lower()

    # Exact match
    if e == a:
        return 1.0

    # Check if the expected label appears anywhere in the actual output
    # (model may add explanation around the label)
    if e in a:
        return 0.9

    # Fuzzy match for minor differences
    return difflib.SequenceMatcher(None, e, a).ratio()


def _score_extraction(expected: str, actual: str) -> float:
    """Key-phrase extraction scoring: checks that expected fragments are present."""
    e_lower = expected.strip().lower()
    a_lower = actual.strip().lower()

    # Split expected into lines/phrases (each is a key fragment to find)
    expected_fragments = [f.strip() for f in e_lower.split("\n") if f.strip()]

    if not expected_fragments:
        return difflib.SequenceMatcher(None, e_lower, a_lower).ratio()

    found = 0
    for fragment in expected_fragments:
        if fragment in a_lower:
            found += 1
        else:
            # Fuzzy match for each fragment
            best = difflib.SequenceMatcher(None, fragment, a_lower).ratio()
            if best >= 0.7:
                found += 0.7

    return found / len(expected_fragments)


def _score_structured(expected: str, actual: str) -> float:
    """Structural comparison — tighter sequence matching for JSON/structured output."""
    # Normalize whitespace
    e = " ".join(expected.split()).lower()
    a = " ".join(actual.split()).lower()
    return difflib.SequenceMatcher(None, e, a).ratio()


def compute_score(expected: str, actual: str, expected_type: str) -> float:
    """Route to the right scoring function based on test case type."""
    scorers = {
        "generative": _score_generative,
        "classification": _score_classification,
        "extraction": _score_extraction,
        "structured": _score_structured,
    }
    scorer = scorers.get(expected_type, _score_generative)
    return scorer(expected, actual)


# ─── LLM-as-judge scoring ───────────────────────────────────────────────────

_JUDGE_PROMPT = """You are an expert evaluator grading a model's response against the expected answer.

TASK TYPE: {task_type}
INPUT (what was asked):
{input_text}

EXPECTED ANSWER:
{expected}

MODEL'S ACTUAL ANSWER:
{actual}

Grade the actual answer on a scale of 0.0 to 1.0:
- 1.0 = Semantically equivalent to the expected answer; all key facts match, minor wording differences OK
- 0.8 = Mostly correct; captures the main idea with some minor omissions or inaccuracies
- 0.5 = Partially correct; some key information is right, some is wrong or missing
- 0.2 = Mostly wrong; only tangentially related to the expected answer
- 0.0 = Completely wrong, off-topic, refuses to answer, or hallucinates

Rules:
- For classification tasks, focus on whether the final category matches.
- For extraction tasks, check that extracted fields match by meaning, not exact string.
- For structured output (JSON), check that the structure + values are equivalent.
- For generative tasks, judge semantic equivalence, not surface form.

Respond in strict JSON with this exact shape:
{{"score": <float 0.0-1.0>, "reasoning": "<one-sentence explanation>"}}
"""


async def _score_with_judge(
    judge_model: ModelConfig,
    input_text: str,
    expected: str,
    actual: str,
    expected_type: str,
) -> tuple[float, str]:
    """Score an actual vs expected output via an LLM grader.

    Returns (score, reasoning).  Falls back to (0.0, error_reason) if the judge
    fails to respond or returns invalid JSON.
    """
    api_key = decrypt_api_key(judge_model.api_key_encrypted) if judge_model.api_key_encrypted else None
    provider = get_provider(judge_model.provider, api_key=api_key, base_url=judge_model.base_url)

    prompt = _JUDGE_PROMPT.format(
        task_type=expected_type,
        input_text=input_text[:4000],
        expected=expected[:4000],
        actual=actual[:4000],
    )

    # Pass the judge's adapter through so a fine-tuned mlx judge actually runs
    # its adapter — was silently dropped before, scoring with the base model.
    judge_extra = dict(judge_model.extra_params or {})
    if judge_model.adapter_path:
        judge_extra.setdefault("adapter_path", judge_model.adapter_path)

    try:
        response = await _stream_to_response(
            provider,
            messages=[{"role": "user", "content": prompt}],
            model_id=judge_model.model_id,
            max_tokens=400,
            temperature=0.0,  # deterministic grading
            **judge_extra,
        )
        # Reasoning judges may emit <think>…</think> before the JSON. Strip it
        # so the markdown-fence + JSON regexes below can find the real answer.
        raw = _strip_think(response.content)
        # Strip markdown fences if any
        raw = re.sub(r"^```json\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
        # Find the JSON object in the response
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return 0.0, f"Judge returned no JSON: {raw[:100]}"
        data = json.loads(m.group(0))
        score = float(data.get("score", 0.0))
        reasoning = str(data.get("reasoning", ""))[:500]
        # Clamp to valid range
        score = max(0.0, min(1.0, score))
        return score, reasoning
    except Exception as e:
        logger.warning("Judge scoring failed: %s", e)
        return 0.0, f"Judge error: {e}"


# ─── Backtest execution ──────────────────────────────────────────────────────

async def run_backtest(backtest_run_id: str, db: AsyncSession | None = None) -> None:
    """Execute a backtest run asynchronously.

    This function loads all test cases, runs inference concurrently (max 5),
    scores results, and persists aggregated metrics. Designed to be called as
    a background task. Always creates its own DB session.
    """
    async with async_session() as session:
        await _execute_backtest(session, backtest_run_id)


async def _is_run_cancelling(run_id: str) -> bool:
    """Quick read-only check: did someone flip this run to 'cancelling'/'cancelled'?

    Each concurrent run_single coroutine peeks this between read and inference
    to short-circuit. Uses its own session so it doesn't fight the write lock.
    """
    async with async_session() as peek_db:
        row = await peek_db.get(BacktestRun, run_id)
        return bool(row and row.status in ("cancelling", "cancelled"))


async def _execute_backtest(db: AsyncSession, backtest_run_id: str) -> None:
    run = await db.get(BacktestRun, backtest_run_id)
    if not run:
        logger.error("BacktestRun %s not found", backtest_run_id)
        return

    # If the run was cancelled before it ever started, finalize and bail.
    # (Paused runs will re-enter here on resume and are treated as normal start.)
    if run.status in ("cancelling", "cancelled"):
        run.status = "cancelled"
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        return

    # Mark as running
    run.status = "running"
    run.started_at = datetime.now(timezone.utc)
    await db.commit()

    pass_threshold = run.pass_threshold if run.pass_threshold is not None else 0.5

    try:
        prompt_version = await db.get(PromptVersion, run.prompt_version_id)
        model_config = await db.get(ModelConfig, run.model_config_id)

        if not prompt_version or not model_config:
            run.status = "failed"
            run.error_message = "Invalid prompt version or model config"
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        # Load test case result stubs (already created by router).
        # Filter to only pending results so resumed runs skip already-completed cases.
        result_rows = await db.execute(
            select(BacktestResult).where(
                BacktestResult.backtest_run_id == backtest_run_id,
                BacktestResult.status == "pending",
            )
        )
        result_list = list(result_rows.scalars().all())

        if not result_list:
            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
        provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)

        # Optional LLM-as-judge (for both legacy whole-output grading and llm_judge assertions)
        judge_model = None
        judge_provider = None
        if run.judge_model_config_id:
            judge_model = await db.get(ModelConfig, run.judge_model_config_id)
            if judge_model:
                logger.info("Using judge model %s for grading", judge_model.name)
                judge_api_key = decrypt_api_key(judge_model.api_key_encrypted) if judge_model.api_key_encrypted else None
                judge_provider = get_provider(
                    judge_model.provider,
                    api_key=judge_api_key,
                    base_url=judge_model.base_url,
                )

        # Snapshot everything run_single needs as plain Python data — no
        # ORM objects leak across sessions.  This is what fixes the
        # PendingRollbackError storms we were seeing: each concurrent
        # run_single opens its own AsyncSession so a failure in one doesn't
        # poison another's session.
        run_snapshot = {
            "prompt_version_id": run.prompt_version_id,
            "model_config_id": run.model_config_id,
            "judge_model_config_id": run.judge_model_config_id,
        }
        model_cfg_snapshot = {
            "id": model_config.id,
            "name": model_config.name,
            "provider": model_config.provider,
            "model_id": model_config.model_id,
            "temperature": model_config.temperature,
            # Honor the model's configured cap. Treat 0 as "No limit" (per the
            # Model Registry toggle) → fall back to DEFAULT_MAX_TOKENS so
            # reasoning models have enough room for chain-of-thought + answer.
            "max_tokens": model_config.max_tokens if (model_config.max_tokens or 0) > 0 else DEFAULT_MAX_TOKENS,
            "extra_params": dict(model_config.extra_params or {}),
            "adapter_path": model_config.adapter_path,
            # Column wins over any extra_params["enable_thinking"] the user
            # may have hand-set in JSON — the toggle is the single source of
            # truth. Legacy rows (NULL after migration) default to True.
            "enable_thinking": bool(model_config.enable_thinking) if model_config.enable_thinking is not None else True,
            "api_key_encrypted": model_config.api_key_encrypted,
            "base_url": model_config.base_url,
        }
        prompt_snapshot = {
            "system_message": prompt_version.system_message,
            "content": prompt_version.content,
        }
        judge_snapshot = None
        if judge_model:
            judge_snapshot = {
                "id": judge_model.id,
                "provider": judge_model.provider,
                "model_id": judge_model.model_id,
                "api_key_encrypted": judge_model.api_key_encrypted,
                "base_url": judge_model.base_url,
                "extra_params": dict(judge_model.extra_params or {}),
                # Pass adapter_path through so a fine-tuned mlx judge actually
                # runs its adapter (assertion_engine reads this off judge_model
                # to build its provider call).
                "adapter_path": judge_model.adapter_path,
            }
        result_ids = [r.id for r in result_list]

        semaphore = asyncio.Semaphore(MAX_CONCURRENT)

        async def run_single(result_id: str) -> dict:
            """Inference under the semaphore; DB write serialized by _DB_WRITE_LOCK."""
            async with semaphore:
                # Skip the (potentially slow) inference if the user hit Stop
                # while earlier cases were still in flight.
                if await _is_run_cancelling(backtest_run_id):
                    outcome = {
                        "result_id": result_id,
                        "status": "cancelled",
                        "error_message": None,
                        "pass_score": None,
                        "assertion_results_json": None,
                        "actual_output": None,
                        "latency_ms": 0,
                        "cache_hit": False,
                    }
                else:
                    try:
                        outcome = await _run_single_case(
                            result_id,
                            run_snapshot,
                            prompt_snapshot,
                            model_cfg_snapshot,
                            judge_snapshot,
                            pass_threshold,
                        )
                    except Exception as e:
                        logger.exception("run_single crashed for result %s", result_id)
                        outcome = {
                            "result_id": result_id,
                            "status": "error",
                            "error_message": f"run_single crashed: {e}"[:500],
                            "pass_score": None,
                            "assertion_results_json": None,
                            "actual_output": None,
                            "latency_ms": 0,
                            "cache_hit": False,
                        }

            # Serialized write-back — only one session commits at a time across
            # all concurrent run_single coroutines.
            async with _DB_WRITE_LOCK:
                async with async_session() as write_db:
                    row = await write_db.get(BacktestResult, result_id)
                    if row is None:
                        logger.error("BacktestResult %s disappeared before write", result_id)
                        return outcome
                    row.status = outcome["status"]
                    row.pass_score = outcome["pass_score"]
                    row.assertion_results = outcome["assertion_results_json"]
                    row.actual_output = outcome["actual_output"]
                    row.latency_ms = outcome["latency_ms"]
                    row.cache_hit = outcome["cache_hit"]
                    if outcome.get("error_message"):
                        row.error_message = outcome["error_message"]

                    # Incremental aggregation: update the parent BacktestRun's
                    # counters NOW (not just at the end) so the UI polling sees
                    # live progress — pass_rate, passed/failed counts tick up as
                    # each case lands. Done in the same transaction as the
                    # result write so polling never sees an inconsistent snapshot.
                    agg_q = await write_db.execute(
                        select(BacktestResult.status).where(
                            BacktestResult.backtest_run_id == backtest_run_id
                        )
                    )
                    statuses = [s for (s,) in agg_q.all()]
                    passed_now = sum(1 for s in statuses if s == "passed")
                    failed_now = sum(1 for s in statuses if s in ("failed", "error"))
                    scored_now = passed_now + failed_now

                    run_row = await write_db.get(BacktestRun, backtest_run_id)
                    if run_row is not None:
                        run_row.passed_cases = passed_now
                        run_row.failed_cases = failed_now
                        run_row.pass_rate = (passed_now / scored_now) if scored_now > 0 else None

                    await write_db.commit()
            return outcome

        await asyncio.gather(*[run_single(rid) for rid in result_ids])

        # Reload results in this session to aggregate — each child committed in its own session
        await db.commit()  # release any locks on our side first
        # Each child commit happened on its own AsyncSession, so the rows in
        # this session's identity map are stale (still showing the initial
        # status="pending"). expire_all() forces the next access to refetch
        # from the DB; without it the SELECT below returns the cached stale
        # objects and pass/fail counts always come out as 0.
        db.expire_all()
        await db.refresh(run)
        agg_rows = await db.execute(
            select(BacktestResult).where(BacktestResult.backtest_run_id == backtest_run_id)
        )
        fresh_results = list(agg_rows.scalars().all())
        passed = sum(1 for r in fresh_results if r.status == "passed")
        failed = sum(1 for r in fresh_results if r.status in ("failed", "error"))
        scored = passed + failed
        total = len(fresh_results)

        run.passed_cases = passed
        run.failed_cases = failed
        run.total_cases = total
        run.pass_rate = (passed / scored) if scored > 0 else None
        # Honor pause/cancellation:
        # - "paused" → user clicked stop, keep as "paused" (ready to resume), don't set completed_at
        # - "cancelling" → intermediate state, finalize as "cancelled"
        # - else → mark as "completed"
        if run.status == "paused":
            pass  # Keep paused, don't set completed_at (run may resume)
        elif run.status in ("cancelling", "cancelled"):
            run.status = "cancelled"
            run.completed_at = datetime.now(timezone.utc)
        else:
            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        no_judge = total - scored
        logger.info(
            "Backtest %s completed: %d/%d passed (%s%%) — %d no-judgment cases [threshold=%.0f%%]",
            backtest_run_id, passed, scored,
            f"{(run.pass_rate or 0) * 100:.1f}" if scored else "n/a",
            no_judge, pass_threshold * 100,
        )

    except Exception as e:
        logger.exception("Backtest run %s failed unexpectedly", backtest_run_id)
        try:
            run.status = "failed"
            run.error_message = str(e)
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception:
            pass


# ─── Per-case inference + scoring (runs in its own session) ─────────────────

async def _run_single_case(
    result_id: str,
    run_snap: dict,
    prompt_snap: dict,
    model_snap: dict,
    judge_snap: dict | None,
    run_threshold: float,
) -> dict:
    """Execute one test case end-to-end.  Returns a dict describing the outcome.

    Inference + scoring happen WITHOUT holding any DB session.  Only the two
    bracketing DB operations take sessions:
      • read phase: load test_case + document (fast, short-lived session)
      • write phase: update BacktestResult (held under _DB_WRITE_LOCK in caller)
    """
    # ── Read phase: load test case + document, then release session ────
    async with async_session() as read_db:
        res = await read_db.get(BacktestResult, result_id)
        if not res:
            return {"result_id": result_id, "status": "error",
                    "error_message": "BacktestResult disappeared"}
        test_case = await read_db.get(TestCase, res.test_case_id)
        if not test_case:
            return {"result_id": result_id, "status": "error",
                    "error_message": "Test case not found"}
        tc_id = test_case.id
        # PII guarantee: when the test case was materialized from an InputDatasetItem
        # that has been PII-masked, the masked content is the only version that
        # may be sent to the model or the judge. See test_case_pii_service.
        tc_input = await test_case_pii_service.get_safe_input_text(read_db, test_case)
        # Hash the safe input — the InferenceCache key includes this so that
        # re-running after the source has been masked produces a cache miss
        # (different text → different hash) instead of a stale raw-data hit.
        import hashlib as _hashlib
        tc_input_hash = _hashlib.sha256((tc_input or "").encode("utf-8")).hexdigest()
        tc_expected = test_case.expected_output or ""
        tc_expected_type = test_case.expected_type
        tc_document_id = test_case.document_id
        tc_assertions_json = test_case.assertions
        tc_pass_threshold = test_case.pass_threshold
        tc_name = test_case.name
        document_raw = None
        if tc_document_id:
            doc = await read_db.get(Document, tc_document_id)
            if doc:
                document_raw = doc.raw_text

    # ── Inference phase (no DB session) ────────────────────────────────
    messages: list[dict] = []
    if prompt_snap["system_message"]:
        messages.append({"role": "system", "content": prompt_snap["system_message"]})
    user_content = prompt_snap["content"]
    if document_raw:
        user_content += f"\n\n--- Document Content ---\n{document_raw}"
    if tc_input:
        user_content += f"\n\n--- User Input ---\n{tc_input}"
    messages.append({"role": "user", "content": user_content})

    api_key = decrypt_api_key(model_snap["api_key_encrypted"]) if model_snap["api_key_encrypted"] else None
    provider = get_provider(model_snap["provider"], api_key=api_key, base_url=model_snap["base_url"])

    judge_model_obj = None
    judge_provider = None
    if judge_snap:
        class _JudgeShim:
            pass
        judge_model_obj = _JudgeShim()
        for k, v in judge_snap.items():
            setattr(judge_model_obj, k, v)
        judge_api_key = decrypt_api_key(judge_snap["api_key_encrypted"]) if judge_snap["api_key_encrypted"] else None
        judge_provider = get_provider(judge_snap["provider"], api_key=judge_api_key, base_url=judge_snap["base_url"])

    extra_params = dict(model_snap["extra_params"] or {})
    if model_snap.get("adapter_path"):
        extra_params.setdefault("adapter_path", model_snap["adapter_path"])
    # Column overrides any user-set enable_thinking in extra_params JSON —
    # the Registry toggle is the single source of truth.
    extra_params["enable_thinking"] = model_snap["enable_thinking"]

    start = time.monotonic()
    cache_hit = False  # always False now — kept for column compat
    actual = None
    elapsed_ms = 0
    error_message = None
    pass_score: float | None = None
    assertion_results_json: str | None = None
    status = "pending"

    try:
        max_tokens = model_snap["max_tokens"]
        # InferenceCache lookup is intentionally disabled. "Run Backtest" must
        # always call the model — replaying a cached output is not a re-run,
        # and the user has explicitly asked for fresh model calls every time.
        # The pt_inference_cache table is left in place for analytics / future
        # opt-in caching, but no row is ever read or written here.
        # Streaming so reasoning-model long generations don't trip Cloudflare's
        # 120s proxy timeout on RunPod.
        response = await _stream_to_response(
            provider,
            messages=messages,
            model_id=model_snap["model_id"],
            max_tokens=max_tokens,
            temperature=model_snap["temperature"],
            **extra_params,
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)
        # Aggressive cleanup: <think> tags AND prose preamble around the JSON
        # answer (reasoning models without --reasoning-parser emit prose
        # chain-of-thought outside of any <think> wrapper).
        actual = _extract_clean_output(response.content, tc_expected)

        # ── Score the output (no DB needed — pure compute) ──
        tc_threshold = tc_pass_threshold if tc_pass_threshold is not None else run_threshold
        assertion_specs: list[dict] = []
        if tc_assertions_json:
            try:
                assertion_specs = json.loads(tc_assertions_json) or []
            except Exception:
                assertion_specs = []
        has_expected = bool(tc_expected.strip())

        if assertion_specs:
            results_list, overall_score, _ = await assertion_engine.run_assertions(
                assertion_specs, actual, tc_expected,
                judge_provider=judge_provider, judge_model=judge_model_obj,
            )
            assertion_results_json = json.dumps(results_list)
            pass_score = overall_score
            status = "passed" if overall_score >= tc_threshold else "failed"
        elif has_expected and judge_model_obj is not None:
            score, reasoning = await _score_with_judge(
                judge_model_obj, tc_input, tc_expected, actual, tc_expected_type,
            )
            if reasoning:
                error_message = f"[judge] {reasoning}"
            pass_score = score
            status = "passed" if score >= tc_threshold else "failed"
        elif has_expected:
            score = compute_score(tc_expected, actual, tc_expected_type)
            pass_score = score
            status = "passed" if score >= tc_threshold else "failed"
        else:
            status = "no_judgment"

        logger.debug("Test case %s: status=%s score=%s (cache=%s)",
                     tc_name, status, pass_score, cache_hit)
    except Exception as e:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        status = "error"
        error_message = str(e)[:500]
        logger.warning("Backtest case %s failed: %s", result_id, e)

    return {
        "result_id": result_id,
        "status": status,
        "pass_score": pass_score,
        "assertion_results_json": assertion_results_json,
        "actual_output": actual,
        "latency_ms": elapsed_ms,
        "cache_hit": cache_hit,
        "error_message": error_message,
    }




# ─── Inference cache helpers ────────────────────────────────────────────────


async def _lookup_cache(
    db: AsyncSession,
    *,
    prompt_version_id: str,
    model_config_id: str,
    test_case_id: str,
    document_id: str | None,
    max_tokens: int,
    temperature: float,
    input_hash: str,
) -> InferenceCache | None:
    """Return the cached InferenceCache row for this key, or None.

    `input_hash` MUST match exactly. Old cache rows from before the column
    existed have `input_hash IS NULL`, which never equals a non-null hash —
    so they don't accidentally serve stale outputs after a source is masked.
    """
    from sqlalchemy import and_
    q = select(InferenceCache).where(and_(
        InferenceCache.prompt_version_id == prompt_version_id,
        InferenceCache.model_config_id == model_config_id,
        InferenceCache.test_case_id == test_case_id,
        InferenceCache.max_tokens == max_tokens,
        InferenceCache.temperature == temperature,
        InferenceCache.input_hash == input_hash,
    ))
    if document_id is None:
        q = q.where(InferenceCache.document_id.is_(None))
    else:
        q = q.where(InferenceCache.document_id == document_id)
    r = await db.execute(q)
    return r.scalars().first()


async def _store_cache(
    db: AsyncSession,
    *,
    prompt_version_id: str,
    model_config_id: str,
    test_case_id: str,
    document_id: str | None,
    max_tokens: int,
    temperature: float,
    input_hash: str,
    output: str,
    latency_ms: int,
) -> None:
    """Upsert a cache entry.  Silently ignores on race conditions."""
    try:
        entry = InferenceCache(
            prompt_version_id=prompt_version_id,
            model_config_id=model_config_id,
            test_case_id=test_case_id,
            document_id=document_id,
            max_tokens=max_tokens,
            temperature=temperature,
            input_hash=input_hash,
            output=output,
            latency_ms=latency_ms,
        )
        db.add(entry)
        await db.flush()
    except Exception as e:
        logger.debug("Cache store skipped: %s", e)
