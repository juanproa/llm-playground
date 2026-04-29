"""Chain executor: topological run of an inference DAG.

Layout of a run:
- Pre-create one ChainNodeRun per node (status=pending) so the UI can render
  the full graph state immediately.
- Topologically sort the nodes; if there's a cycle, fail the run.
- For each node in order:
    * If it has incoming edges, decide if any "fires" (assertion null, or
      assertion matches the source node's output). If none fire, mark skipped.
    * Otherwise resolve `{{node_name.output}}` template references in the
      prompt content using outputs collected so far.
    * Run inference via the configured provider, capture output + latency.
- The final ChainRun status is `completed` if no node failed, `failed` otherwise.

The executor runs as a background task with its own DB session because the
HTTP request's session closes when the endpoint returns.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import async_session
from app.models.chain import Chain, ChainEdge, ChainNode, ChainNodeRun, ChainRun
from app.models.document import Document
from app.models.knowledge_base import KnowledgeBase
from app.models.model_config import ModelConfig
from app.models.prompt import PromptVersion
from app.providers.registry import get_provider
from app.services import rag_service
from app.services.inference_service import _final_cleanup
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)


_TEMPLATE_RE = re.compile(r"\{\{\s*([A-Za-z0-9_\- ]+?)\.output\s*\}\}")
# Magic token resolved to the chain's root input (run.input_override or root
# node's input_text). Lets downstream nodes reference the original case text
# in prompts and `kb_query_template` without daisy-chaining it through outputs.
_INPUT_TOKEN_RE = re.compile(r"\{\{\s*input\s*\}\}")


def evaluate_assertion(output: str, assertion: dict) -> bool:
    """Return True if `output` matches the assertion. `negate` flips the result."""
    op = assertion.get("op", "")
    value = assertion.get("value", "")
    case_sensitive = bool(assertion.get("case_sensitive", False))
    negate = bool(assertion.get("negate", False))

    text = output if case_sensitive else output.lower()
    val_cmp = value if case_sensitive else value.lower()

    if op == "contains":
        result = val_cmp in text
    elif op == "equals":
        result = text == val_cmp
    elif op == "startswith":
        result = text.startswith(val_cmp)
    elif op == "endswith":
        result = text.endswith(val_cmp)
    elif op == "regex":
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            result = re.search(value, output, flags) is not None
        except re.error:
            result = False
    else:
        result = False

    return (not result) if negate else result


def resolve_template(
    content: str,
    outputs_by_name: dict[str, str],
    chain_input: str = "",
) -> str:
    """Replace `{{ node_name.output }}` with upstream outputs and `{{ input }}`
    with the chain's root input.

    Unresolved node references are left in place so failures surface as obvious
    `{{node.output}}` tokens in the prompt sent to the model.
    """
    def repl(m: re.Match) -> str:
        name = m.group(1).strip()
        return outputs_by_name.get(name, m.group(0))

    content = _INPUT_TOKEN_RE.sub(lambda _: chain_input, content)
    return _TEMPLATE_RE.sub(repl, content)


def topological_order(nodes: list[ChainNode], edges: list[ChainEdge]) -> list[str]:
    """Kahn's algorithm. Raises ValueError if the graph has a cycle."""
    incoming: dict[str, int] = {n.id: 0 for n in nodes}
    outgoing: dict[str, list[str]] = {n.id: [] for n in nodes}
    for e in edges:
        if e.target_node_id in incoming:
            incoming[e.target_node_id] += 1
        if e.source_node_id in outgoing:
            outgoing[e.source_node_id].append(e.target_node_id)

    queue = [nid for nid, deg in incoming.items() if deg == 0]
    order: list[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for tgt in outgoing.get(nid, []):
            incoming[tgt] -= 1
            if incoming[tgt] == 0:
                queue.append(tgt)

    if len(order) < len(nodes):
        raise ValueError("Chain has a cycle — cannot execute")
    return order


async def _run_node_inference(
    db: AsyncSession,
    *,
    prompt_version: PromptVersion,
    resolved_prompt_content: str,
    input_text: str,
    document: Document | None,
    model_config: ModelConfig,
    kb_id_override: str | None,
    kb_top_k_override: int | None,
    kb_query_resolved: str | None = None,
) -> tuple[str, int, int | None, int | None]:
    """Run one node's inference. Returns (output, latency_ms, tokens_in, tokens_out).

    `kb_query_resolved`, when provided, is used verbatim as the RAG retrieval
    query (after template substitution by the caller). It overrides the
    legacy `input_text or prompt_content` heuristic — letting a node use an
    upstream-generated "sharp query" without contaminating it with the
    user-message body.
    """
    # Resolve RAG binding (node override → prompt-version default → none).
    kb_id = kb_id_override or prompt_version.kb_id
    top_k = kb_top_k_override or prompt_version.kb_top_k or 5

    rag_context = ""
    if kb_id:
        kb = await db.get(KnowledgeBase, kb_id)
        if kb:
            # Explicit per-node template wins. Otherwise fall back to the
            # legacy heuristic: input_text first, then the resolved prompt head.
            if kb_query_resolved is not None and kb_query_resolved.strip():
                query = kb_query_resolved[:1000].strip()
            else:
                query = (input_text or resolved_prompt_content)[:1000].strip()
            try:
                hits = await rag_service.query_kb(db, kb, query, top_k=top_k)
                rag_context = rag_service.format_chunks_for_prompt(hits, kb.dictionary_content)
            except Exception as e:
                logger.warning("KB retrieval failed during chain run (kb=%s): %s", kb_id, e)

    # Build messages — same shape as inference_service._build_messages but with
    # the resolved (templated) prompt content instead of the stored content.
    messages: list[dict] = []
    system_parts: list[str] = []
    if prompt_version.system_message:
        system_parts.append(prompt_version.system_message)
    if rag_context:
        system_parts.append(rag_context)
    if system_parts:
        messages.append({"role": "system", "content": "\n\n".join(system_parts)})

    user_content = resolved_prompt_content
    if document and document.raw_text:
        user_content += f"\n\n--- Document Content ---\n{document.raw_text}"
    if input_text:
        user_content += f"\n\n--- User Input ---\n{input_text}"
    messages.append({"role": "user", "content": user_content})

    api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
    provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)

    extra_params = dict(model_config.extra_params or {})
    if model_config.adapter_path:
        extra_params.setdefault("adapter_path", model_config.adapter_path)

    start = time.monotonic()
    response = await provider.generate(
        messages=messages,
        model_id=model_config.model_id,
        max_tokens=model_config.max_tokens if model_config.max_tokens and model_config.max_tokens > 0 else 16384,
        temperature=model_config.temperature,
        **extra_params,
    )
    elapsed_ms = int((time.monotonic() - start) * 1000)
    output = _final_cleanup(response.content or "")
    return output, elapsed_ms, response.input_tokens, response.output_tokens


async def start_chain_run(
    db: AsyncSession,
    chain_id: str,
    *,
    wipe_prior: bool = True,
    input_override: str | None = None,
) -> ChainRun | None:
    """Create a ChainRun + ChainNodeRun rows in pending state. Caller is
    responsible for scheduling `execute_chain_run(run_id)` as a background task.

    By default chains keep only the latest run — any prior runs for this chain
    (and their node_runs) are wiped before the new one is created. Pass
    `wipe_prior=False` when the caller is managing run history externally
    (e.g. Batch Compare creates one ChainRun per test case and tracks them on
    its own BacktestResult rows; wiping would clobber sibling cells).

    `input_override`, when set, replaces the root node's `input_text` for
    *this* run only, without mutating the saved chain. Used by Batch Compare
    to drive a chain with a TestCase's input.
    """
    chain = await db.get(
        Chain,
        chain_id,
        options=[selectinload(Chain.nodes), selectinload(Chain.edges)],
    )
    if not chain:
        return None

    if wipe_prior:
        # Use core SQL deletes (not ORM cascade) because the relationship
        # cascade would require async lazy-loading the `node_runs` collection.
        prior_ids_result = await db.execute(
            select(ChainRun.id).where(ChainRun.chain_id == chain_id)
        )
        prior_ids = [r[0] for r in prior_ids_result.all()]
        if prior_ids:
            await db.execute(delete(ChainNodeRun).where(ChainNodeRun.run_id.in_(prior_ids)))
            await db.execute(delete(ChainRun).where(ChainRun.id.in_(prior_ids)))
            await db.flush()

    run = ChainRun(chain_id=chain_id, status="pending", input_override=input_override)
    db.add(run)
    await db.flush()

    for node in chain.nodes:
        db.add(ChainNodeRun(run_id=run.id, node_id=node.id, status="pending"))
    await db.flush()

    # Re-select with eager-loaded node_runs so the response is complete.
    result = await db.execute(
        select(ChainRun).where(ChainRun.id == run.id).options(selectinload(ChainRun.node_runs))
    )
    return result.scalar_one()


async def execute_chain_run(run_id: str) -> None:
    """Background task. Opens its own DB session.

    Defensive: any uncaught exception flips the run to `failed` so it doesn't
    sit in `running` forever.
    """
    async with async_session() as db:
        try:
            await _execute_chain_run_inner(db, run_id)
            await db.commit()
        except Exception as e:
            logger.exception("Chain run %s blew up: %s", run_id, e)
            await db.rollback()
            try:
                async with async_session() as db2:
                    run = await db2.get(ChainRun, run_id)
                    if run and run.status not in ("completed", "failed", "cancelled"):
                        run.status = "failed"
                        run.error_message = f"Internal error: {e}"
                        run.completed_at = datetime.now(timezone.utc)
                        await db2.commit()
            except Exception:
                logger.exception("Failed to record chain run failure")


async def _execute_chain_run_inner(db: AsyncSession, run_id: str) -> None:
    run_result = await db.execute(
        select(ChainRun).where(ChainRun.id == run_id).options(selectinload(ChainRun.node_runs))
    )
    run = run_result.scalar_one_or_none()
    if not run:
        return

    chain_result = await db.execute(
        select(Chain)
        .where(Chain.id == run.chain_id)
        .options(selectinload(Chain.nodes), selectinload(Chain.edges))
    )
    chain = chain_result.scalar_one_or_none()
    if not chain:
        run.status = "failed"
        run.error_message = "Chain not found"
        run.completed_at = datetime.now(timezone.utc)
        return

    try:
        order = topological_order(list(chain.nodes), list(chain.edges))
    except ValueError as e:
        run.status = "failed"
        run.error_message = str(e)
        run.completed_at = datetime.now(timezone.utc)
        return

    # Race guard: the user may have hit Stop in the gap between the API route
    # returning 'pending' and this bg task picking up the row. The earlier
    # SELECT cached status='pending'; refresh so a parallel cancel commit is
    # visible. Without this, we'd stomp 'cancelling' with 'running' and force
    # the user to wait until node 1's inference finishes.
    await db.refresh(run, attribute_names=["status"])
    if run.status == "cancelling":
        for nid in order:
            nr = next((nr for nr in run.node_runs if nr.node_id == nid), None)
            if nr and nr.status in ("pending", "running"):
                nr.status = "skipped"
                nr.skip_reason = "Run cancelled before any node started"
                nr.completed_at = datetime.now(timezone.utc)
        run.final_output = json.dumps({}, ensure_ascii=False)
        run.status = "cancelled"
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        return

    run.status = "running"
    run.started_at = datetime.now(timezone.utc)
    await db.commit()

    node_by_id: dict[str, ChainNode] = {n.id: n for n in chain.nodes}
    edges_by_target: dict[str, list[ChainEdge]] = {}
    for e in chain.edges:
        edges_by_target.setdefault(e.target_node_id, []).append(e)

    nr_by_node: dict[str, ChainNodeRun] = {nr.node_id: nr for nr in run.node_runs}

    # Resolve the chain's root input once — used by `{{input}}` everywhere.
    # Priority: per-run override → first root node's input_text → empty string.
    chain_input = run.input_override or ""
    if not chain_input:
        for n in chain.nodes:
            if not edges_by_target.get(n.id) and n.input_text:
                chain_input = n.input_text
                break

    outputs_by_name: dict[str, str] = {}
    node_status: dict[str, str] = {}  # "completed" | "skipped" | "failed"
    # Tracks which upstream's output should default-pipe into a downstream node
    # when its prompt has no `{{node.output}}` reference of its own. Keyed by
    # downstream node_id; value is the firing upstream's output text.
    fired_upstream_output: dict[str, str] = {}
    any_failed = False

    for nid in order:
        # Cancellation check: another session may have flipped status to
        # 'cancelling'. We can't abort an in-flight provider call cleanly, but
        # we can stop between nodes — which is what the user means by "Stop."
        await db.refresh(run, attribute_names=["status"])
        if run.status == "cancelling":
            for remaining_nid in order:
                if node_status.get(remaining_nid):
                    continue  # already finalized (completed/skipped/failed)
                rnr = nr_by_node.get(remaining_nid)
                if rnr and rnr.status in ("pending", "running"):
                    rnr.status = "skipped"
                    rnr.skip_reason = "Run cancelled"
                    rnr.completed_at = datetime.now(timezone.utc)
            # Persist whatever outputs we did manage to collect — the user can
            # still inspect the partial chain result from the UI.
            run.final_output = json.dumps(outputs_by_name, ensure_ascii=False)
            run.status = "cancelled"
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return
        node = node_by_id.get(nid)
        nr = nr_by_node.get(nid)
        if not node or not nr:
            continue

        # Decide fire/skip for non-root nodes.
        incoming = edges_by_target.get(nid, [])
        if incoming:
            fired = False
            for edge in incoming:
                if node_status.get(edge.source_node_id) != "completed":
                    continue
                src_name = node_by_id[edge.source_node_id].name
                src_output = outputs_by_name.get(src_name, "")
                if edge.assertion_json is None:
                    fired = True
                    fired_upstream_output[nid] = src_output
                    break
                try:
                    a = json.loads(edge.assertion_json)
                    if evaluate_assertion(src_output, a):
                        fired = True
                        fired_upstream_output[nid] = src_output
                        break
                except Exception:
                    continue
            if not fired:
                nr.status = "skipped"
                nr.skip_reason = "no incoming edge fired"
                nr.completed_at = datetime.now(timezone.utc)
                node_status[nid] = "skipped"
                await db.commit()
                continue

        if not node.prompt_version_id or not node.model_config_id:
            nr.status = "failed"
            nr.error_message = "Node is missing a prompt version or model config"
            nr.completed_at = datetime.now(timezone.utc)
            node_status[nid] = "failed"
            any_failed = True
            await db.commit()
            continue

        prompt_version = await db.get(PromptVersion, node.prompt_version_id)
        model_config = await db.get(ModelConfig, node.model_config_id)
        if not prompt_version or not model_config:
            nr.status = "failed"
            nr.error_message = "Prompt version or model config not found"
            nr.completed_at = datetime.now(timezone.utc)
            node_status[nid] = "failed"
            any_failed = True
            await db.commit()
            continue

        document = await db.get(Document, node.input_document_id) if node.input_document_id else None

        nr.status = "running"
        nr.started_at = datetime.now(timezone.utc)
        resolved_content = resolve_template(prompt_version.content, outputs_by_name, chain_input)
        nr.resolved_input = resolved_content
        await db.commit()

        # Last-chance cancellation check: between marking the node as running
        # and actually firing the (uninterruptible) provider call. Tightens
        # the race window from "before each node iteration" down to "the
        # microseconds between commit and provider.generate()."
        await db.refresh(run, attribute_names=["status"])
        if run.status == "cancelling":
            nr.status = "skipped"
            nr.skip_reason = "Run cancelled"
            nr.completed_at = datetime.now(timezone.utc)
            node_status[nid] = "skipped"
            for remaining_nid in order:
                if node_status.get(remaining_nid):
                    continue
                rnr = nr_by_node.get(remaining_nid)
                if rnr and rnr.status in ("pending", "running"):
                    rnr.status = "skipped"
                    rnr.skip_reason = "Run cancelled"
                    rnr.completed_at = datetime.now(timezone.utc)
            run.final_output = json.dumps(outputs_by_name, ensure_ascii=False)
            run.status = "cancelled"
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        # Effective input for this node:
        #  - root nodes (no incoming edges) use the run-level `input_override`
        #    if set — that's how Batch Compare drives a chain with a TestCase's
        #    input without mutating the saved chain;
        #  - otherwise the node's own `input_text` if set (workspace runs, or
        #    a node-level explicit override);
        #  - else, if the prompt already references `{{...}}` upstream outputs,
        #    pass empty so we don't duplicate them in the user message;
        #  - else, default-pipe the firing upstream's output as the user input
        #    (the common case: classifier → sub-classifier with case text flowing).
        is_root = not edges_by_target.get(nid)
        if is_root and run.input_override is not None:
            effective_input = run.input_override
        elif node.input_text:
            effective_input = node.input_text
        elif _TEMPLATE_RE.search(prompt_version.content):
            effective_input = ""
        else:
            effective_input = fired_upstream_output.get(nid, "")

        # Resolve the explicit RAG query template (if set) against upstream
        # outputs. We do this here — not inside `_run_node_inference` — so the
        # executor remains the single owner of template substitution.
        kb_query_resolved = (
            resolve_template(node.kb_query_template, outputs_by_name, chain_input)
            if node.kb_query_template
            else None
        )

        try:
            output, latency_ms, _ti, _to = await _run_node_inference(
                db,
                prompt_version=prompt_version,
                resolved_prompt_content=resolved_content,
                input_text=effective_input,
                document=document,
                model_config=model_config,
                kb_id_override=node.kb_id,
                kb_top_k_override=node.kb_top_k,
                kb_query_resolved=kb_query_resolved,
            )
            nr.output_text = output
            nr.latency_ms = latency_ms
            nr.status = "completed"
            nr.completed_at = datetime.now(timezone.utc)
            outputs_by_name[node.name] = output
            node_status[nid] = "completed"
        except Exception as e:
            logger.exception("Node %s failed in chain run %s", node.id, run_id)
            nr.status = "failed"
            nr.error_message = str(e)
            nr.completed_at = datetime.now(timezone.utc)
            node_status[nid] = "failed"
            any_failed = True
        await db.commit()

    # Snapshot every node's output as a JSON map keyed by node name. This is the
    # "single result" of the chain — what Batch Compare will consume when a chain
    # is plugged in as a model. We use node names (not IDs) so the JSON stays
    # readable and stable across re-runs even if internal IDs change.
    run.final_output = json.dumps(outputs_by_name, ensure_ascii=False)
    run.status = "failed" if any_failed else "completed"
    run.completed_at = datetime.now(timezone.utc)


def schedule_chain_run(run_id: str) -> None:
    """Fire-and-forget background execution. Uses a top-level task so the
    coroutine survives the lifetime of the originating request."""
    asyncio.create_task(execute_chain_run(run_id))


async def get_run(db: AsyncSession, run_id: str) -> ChainRun | None:
    result = await db.execute(
        select(ChainRun).where(ChainRun.id == run_id).options(selectinload(ChainRun.node_runs))
    )
    return result.scalar_one_or_none()


async def list_runs(db: AsyncSession, chain_id: str) -> list[ChainRun]:
    result = await db.execute(
        select(ChainRun).where(ChainRun.chain_id == chain_id).order_by(ChainRun.created_at.desc())
    )
    return list(result.scalars().all())


async def delete_run(db: AsyncSession, run_id: str) -> bool:
    run = await db.get(ChainRun, run_id)
    if not run:
        return False
    await db.delete(run)
    await db.flush()
    return True


async def cancel_run(db: AsyncSession, run_id: str) -> ChainRun | None:
    """Mark a run as cancelling. The background executor checks this between
    nodes and finalizes the run as 'cancelled' (preserving any partial outputs).
    No-op for already-terminal runs.
    """
    run = await db.get(ChainRun, run_id)
    if not run:
        return None
    if run.status in ("completed", "failed", "cancelled"):
        return run  # nothing to do; idempotent
    run.status = "cancelling"
    await db.commit()
    return run
