"""Assertion engine for fine-grained per-field scoring of model outputs.

An assertion is a spec describing *one* correctness check on a model's output,
such as "the value at JSONPath $.classification equals 'Grievance'" or
"the summary at $.summary is semantically equivalent to the expected one".

Each test case carries a list of assertions (stored as JSON on TestCase.assertions).
At eval time, the engine runs each assertion against the model's output, producing
per-assertion (passed, score, actual_value, expected_value, reasoning) tuples,
then aggregates them into a weighted-average overall score.

Supported types (v1):
  - json_path_exact     : extract via JSONPath, exact string match (with optional case_insensitive)
  - json_path_numeric   : extract via JSONPath, numeric |actual - expected| <= tolerance
  - json_path_contains  : extract via JSONPath, substring present (keyword list possible)
  - llm_judge           : send the specified slice (or whole output) to a judge model

The assertion spec schema (JSON dict):
  {
    "name": str              # display label
    "type": str              # one of the types above
    "path": str | None       # JSONPath for slice types (required for json_path_*, optional for llm_judge)
    "expected": any | None   # explicit expected value; if null, extract from test_case.expected_output via `path`
    "weight": float          # aggregation weight (default 1.0)
    "options": dict          # type-specific options, e.g. {"case_insensitive": true, "tolerance": 0.05}
  }
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


# ─── JSONPath ───────────────────────────────────────────────────────────────
# We implement a tiny subset sufficient for our needs: "$.a.b.c" and "$.a.b[0].c".
# This keeps us dependency-free. If users need full JSONPath, we can swap in
# `jsonpath-ng` later without changing the assertion-spec schema.

_PATH_TOKEN_RE = re.compile(r"\.([a-zA-Z_][\w-]*)|\[(\d+)\]")


def parse_json_path(path: str) -> list[str | int]:
    """Split "$.a.b[0].c" → ["a", "b", 0, "c"].  Raises ValueError on bad syntax."""
    if not path or not path.startswith("$"):
        raise ValueError(f"Invalid JSONPath {path!r}: must start with '$'")
    rest = path[1:]
    tokens: list[str | int] = []
    pos = 0
    while pos < len(rest):
        m = _PATH_TOKEN_RE.match(rest, pos)
        if not m:
            raise ValueError(f"Invalid JSONPath {path!r} at char {pos}")
        if m.group(1) is not None:
            tokens.append(m.group(1))
        else:
            tokens.append(int(m.group(2)))
        pos = m.end()
    return tokens


def extract_by_path(obj: Any, tokens: list[str | int]) -> Any:
    """Walk obj according to tokens.  Returns None on any missing step."""
    cur = obj
    for tok in tokens:
        if cur is None:
            return None
        try:
            if isinstance(tok, int):
                if isinstance(cur, list) and 0 <= tok < len(cur):
                    cur = cur[tok]
                else:
                    return None
            else:
                if isinstance(cur, dict):
                    cur = cur.get(tok)
                else:
                    return None
        except Exception:
            return None
    return cur


def _try_parse_json(text: str) -> Any | None:
    """Parse JSON, including JSON embedded in markdown code fences."""
    if not text:
        return None
    t = text.strip()
    # Strip ```json ... ``` fences
    fence = re.search(r"```(?:json)?\s*\n(.*?)\n```", t, re.DOTALL | re.IGNORECASE)
    if fence:
        t = fence.group(1)
    # Or find first { … last }
    first = t.find("{")
    last = t.rfind("}")
    if first >= 0 and last > first:
        t = t[first:last + 1]
    try:
        return json.loads(t)
    except Exception:
        return None


# ─── Assertion result container ──────────────────────────────────────────────


def _make_result(
    spec: dict,
    passed: bool,
    score: float,
    actual_value: Any = None,
    expected_value: Any = None,
    reasoning: str | None = None,
) -> dict:
    """Build a JSON-serializable assertion result row."""
    # Clamp score to [0.0, 1.0]
    score = max(0.0, min(1.0, float(score)))
    return {
        "name": spec.get("name", spec.get("type", "assertion")),
        "type": spec.get("type"),
        "path": spec.get("path"),
        "weight": float(spec.get("weight", 1.0)),
        "passed": bool(passed),
        "score": score,
        "actual_value": _json_safe(actual_value),
        "expected_value": _json_safe(expected_value),
        "reasoning": reasoning,
    }


def _json_safe(v: Any) -> Any:
    """Trim to a JSON-serializable display-safe value (avoid giant blobs)."""
    if v is None:
        return None
    if isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, str):
        return v[:500]
    try:
        s = json.dumps(v)
        if len(s) > 500:
            return s[:500] + "..."
        return json.loads(s)
    except Exception:
        return str(v)[:500]


# ─── Assertion type implementations ─────────────────────────────────────────


def _assert_json_path_exact(
    spec: dict, actual_text: str, expected_text: str,
) -> dict:
    path = spec.get("path")
    opts = spec.get("options") or {}
    ci = bool(opts.get("case_insensitive", False))

    if not path:
        return _make_result(spec, False, 0.0, reasoning="Missing `path` for json_path_exact")

    try:
        tokens = parse_json_path(path)
    except ValueError as e:
        return _make_result(spec, False, 0.0, reasoning=str(e))

    actual_obj = _try_parse_json(actual_text)
    expected_obj = _try_parse_json(expected_text)

    actual_val = extract_by_path(actual_obj, tokens) if actual_obj is not None else None
    if "expected" in spec and spec["expected"] is not None:
        expected_val = spec["expected"]
    else:
        expected_val = extract_by_path(expected_obj, tokens) if expected_obj is not None else None

    if actual_val is None and expected_val is None:
        return _make_result(
            spec, False, 0.0, None, None,
            reasoning="Neither actual nor expected output has a value at this path.",
        )

    # Normalize to strings for comparison
    a = "" if actual_val is None else str(actual_val)
    b = "" if expected_val is None else str(expected_val)
    if ci:
        passed = a.strip().lower() == b.strip().lower()
    else:
        passed = a.strip() == b.strip()

    return _make_result(
        spec, passed, 1.0 if passed else 0.0, actual_val, expected_val,
        reasoning=None if passed else f"Expected {b!r}, got {a!r}",
    )


def _assert_json_path_numeric(
    spec: dict, actual_text: str, expected_text: str,
) -> dict:
    path = spec.get("path")
    opts = spec.get("options") or {}
    tolerance = float(opts.get("tolerance", 0.0))

    if not path:
        return _make_result(spec, False, 0.0, reasoning="Missing `path` for json_path_numeric")

    try:
        tokens = parse_json_path(path)
    except ValueError as e:
        return _make_result(spec, False, 0.0, reasoning=str(e))

    actual_obj = _try_parse_json(actual_text)
    expected_obj = _try_parse_json(expected_text)
    actual_raw = extract_by_path(actual_obj, tokens) if actual_obj is not None else None
    if "expected" in spec and spec["expected"] is not None:
        expected_raw = spec["expected"]
    else:
        expected_raw = extract_by_path(expected_obj, tokens) if expected_obj is not None else None

    try:
        a = float(actual_raw) if actual_raw is not None else None
    except (TypeError, ValueError):
        a = None
    try:
        b = float(expected_raw) if expected_raw is not None else None
    except (TypeError, ValueError):
        b = None

    if a is None or b is None:
        return _make_result(
            spec, False, 0.0, actual_raw, expected_raw,
            reasoning=f"Could not parse as numbers: actual={actual_raw!r}, expected={expected_raw!r}",
        )

    delta = abs(a - b)
    passed = delta <= tolerance
    # Partial credit: 1.0 when delta == 0, linearly down to 0 when delta == 2x tolerance
    if tolerance > 0:
        score = max(0.0, 1.0 - (delta / (2.0 * tolerance)))
    else:
        score = 1.0 if passed else 0.0
    reasoning = None if passed else f"|{a} - {b}| = {delta} > tolerance {tolerance}"
    return _make_result(spec, passed, score, a, b, reasoning)


def _assert_json_path_contains(
    spec: dict, actual_text: str, expected_text: str,
) -> dict:
    path = spec.get("path")
    opts = spec.get("options") or {}
    ci = bool(opts.get("case_insensitive", True))
    keywords_opt = opts.get("keywords")  # optional override: list of strings

    if not path:
        return _make_result(spec, False, 0.0, reasoning="Missing `path` for json_path_contains")

    try:
        tokens = parse_json_path(path)
    except ValueError as e:
        return _make_result(spec, False, 0.0, reasoning=str(e))

    actual_obj = _try_parse_json(actual_text)
    expected_obj = _try_parse_json(expected_text)
    actual_val = extract_by_path(actual_obj, tokens) if actual_obj is not None else None

    # Determine keywords to check:
    #   1. explicit `keywords` option (list)
    #   2. or `expected` from spec (string → split on commas) OR (list)
    #   3. or extracted from expected_output via path (string → use as single keyword)
    if keywords_opt:
        keywords = [str(k) for k in keywords_opt]
    elif spec.get("expected"):
        e = spec["expected"]
        keywords = [str(x) for x in e] if isinstance(e, list) else [str(e)]
    else:
        exp_val = extract_by_path(expected_obj, tokens) if expected_obj is not None else None
        if isinstance(exp_val, list):
            keywords = [str(x) for x in exp_val]
        elif exp_val is not None:
            keywords = [str(exp_val)]
        else:
            keywords = []

    if not keywords:
        return _make_result(
            spec, False, 0.0, actual_val, None,
            reasoning="No keywords to check (expected value missing or empty).",
        )

    haystack = ("" if actual_val is None else str(actual_val))
    if ci:
        haystack = haystack.lower()
        keywords_cmp = [k.lower() for k in keywords]
    else:
        keywords_cmp = keywords

    found = sum(1 for k in keywords_cmp if k in haystack)
    score = found / len(keywords_cmp)
    passed = found == len(keywords_cmp)

    reasoning = None if passed else f"{found}/{len(keywords_cmp)} keywords found"
    return _make_result(spec, passed, score, actual_val, keywords, reasoning)


# ─── LLM-as-judge assertion ─────────────────────────────────────────────────

_JUDGE_SLICE_PROMPT = """You are an expert evaluator comparing one specific field of a model's output against the expected value.

FIELD DESCRIPTION: {name}
{path_note}

EXPECTED VALUE FOR THIS FIELD:
{expected}

MODEL'S ACTUAL VALUE FOR THIS FIELD:
{actual}

Grade the actual value on a scale of 0.0 to 1.0 based on semantic equivalence to the expected value:
- 1.0 = Equivalent in meaning; minor wording differences OK
- 0.7 = Mostly correct; captures the main idea with some minor issues
- 0.5 = Partially correct
- 0.2 = Mostly wrong
- 0.0 = Completely wrong or missing

Respond in strict JSON: {{"score": <0.0-1.0>, "reasoning": "<one sentence>"}}
"""


async def _assert_llm_judge(
    spec: dict, actual_text: str, expected_text: str,
    judge_provider=None, judge_model=None,
) -> dict:
    """Run an LLM judge on the full output or a specific JSONPath slice."""
    if judge_provider is None or judge_model is None:
        return _make_result(
            spec, False, 0.0,
            reasoning="LLM judge assertion requires a judge model to be configured on the comparison/backtest run.",
        )

    path = spec.get("path")
    if path:
        try:
            tokens = parse_json_path(path)
        except ValueError as e:
            return _make_result(spec, False, 0.0, reasoning=str(e))
        actual_obj = _try_parse_json(actual_text)
        expected_obj = _try_parse_json(expected_text)
        actual_slice = extract_by_path(actual_obj, tokens) if actual_obj is not None else None
        if "expected" in spec and spec["expected"] is not None:
            expected_slice = spec["expected"]
        else:
            expected_slice = extract_by_path(expected_obj, tokens) if expected_obj is not None else None
        path_note = f"Slice path: {path}"
    else:
        actual_slice = actual_text
        expected_slice = spec.get("expected") if spec.get("expected") else expected_text
        path_note = "Evaluating whole output."

    # Format the slice as JSON string for consistent display
    def _fmt(v: Any) -> str:
        if isinstance(v, str):
            return v
        try:
            return json.dumps(v, indent=2)
        except Exception:
            return str(v)

    prompt = _JUDGE_SLICE_PROMPT.format(
        name=spec.get("name", "this field"),
        path_note=path_note,
        expected=_fmt(expected_slice)[:3000],
        actual=_fmt(actual_slice)[:3000],
    )

    try:
        resp = await judge_provider.generate(
            messages=[{"role": "user", "content": prompt}],
            model_id=judge_model.model_id,
            max_tokens=300,
            temperature=0.0,
            **(judge_model.extra_params or {}),
        )
        raw = resp.content.strip()
        raw = re.sub(r"^```json\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return _make_result(spec, False, 0.0, actual_slice, expected_slice,
                                reasoning=f"Judge returned no JSON: {raw[:200]}")
        data = json.loads(m.group(0))
        score = float(data.get("score", 0.0))
        score = max(0.0, min(1.0, score))
        reasoning = str(data.get("reasoning", ""))[:500]
        passed = score >= float(spec.get("options", {}).get("threshold", 0.7))
        return _make_result(spec, passed, score, actual_slice, expected_slice, reasoning)
    except Exception as e:
        logger.warning("llm_judge assertion failed: %s", e)
        return _make_result(spec, False, 0.0, actual_slice, expected_slice,
                            reasoning=f"Judge error: {e}")


# ─── Top-level dispatcher ───────────────────────────────────────────────────


SYNC_ASSERTION_TYPES = {
    "json_path_exact": _assert_json_path_exact,
    "json_path_numeric": _assert_json_path_numeric,
    "json_path_contains": _assert_json_path_contains,
}


async def run_assertions(
    assertions: list[dict],
    actual_text: str,
    expected_text: str,
    judge_provider=None,
    judge_model=None,
) -> tuple[list[dict], float, bool]:
    """Run every assertion, return (results, overall_score, overall_passed).

    - overall_score = weighted average of per-assertion scores
    - overall_passed will be computed by the caller using the test-case threshold
      (we just return the aggregate here)
    """
    results: list[dict] = []
    for spec in assertions:
        try:
            typ = spec.get("type")
            if typ in SYNC_ASSERTION_TYPES:
                res = SYNC_ASSERTION_TYPES[typ](spec, actual_text, expected_text)
            elif typ == "llm_judge":
                res = await _assert_llm_judge(spec, actual_text, expected_text,
                                              judge_provider=judge_provider,
                                              judge_model=judge_model)
            else:
                res = _make_result(
                    spec, False, 0.0,
                    reasoning=f"Unknown assertion type: {typ!r}",
                )
        except Exception as e:
            logger.exception("Assertion crashed")
            res = _make_result(spec, False, 0.0, reasoning=f"Assertion crashed: {e}")
        results.append(res)

    # Aggregate: weighted average
    total_w = sum(r["weight"] for r in results) or 1.0
    overall = sum(r["score"] * r["weight"] for r in results) / total_w
    all_passed = all(r["passed"] for r in results) if results else False
    return results, overall, all_passed
