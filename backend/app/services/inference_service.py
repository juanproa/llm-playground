import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.document import Document
from app.models.inference import InferenceRun
from app.models.knowledge_base import KnowledgeBase
from app.models.model_config import ModelConfig
from app.models.prompt import PromptVersion
from app.providers.registry import get_provider
from app.schemas.inference import InferenceRequest
from app.services import rag_service
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)

import re

DEFAULT_MAX_TOKENS = 16384

# Strips other misc junk tokens (pad, unk, etc.) — NOT unused tags (handled by StreamCleaner)
_MISC_JUNK_RE = re.compile(r"</?(?:pad|unk|extra_id_\d+)\s*/?>", re.IGNORECASE)

# Matches the FULL thinking block: <unusedN>thought\n...content...</unusedN>
_THINK_OPEN_RE = re.compile(r"<unused\d+>\s*thought\s*\n", re.IGNORECASE)
_THINK_CLOSE_RE = re.compile(r"</unused\d+>", re.IGNORECASE)

# Also handle <think>/<thinking>/<reasoning> tags from other models
_OPEN_THINK_TAG_RE = re.compile(r"<(think|thinking|reasoning)>", re.IGNORECASE)
_CLOSE_THINK_TAG_RE = re.compile(r"</(think|thinking|reasoning)>", re.IGNORECASE)


def _strip_misc_junk(text: str) -> str:
    """Strip misc junk tokens that don't need block-level handling."""
    return _MISC_JUNK_RE.sub("", text)


def _final_cleanup(text: str) -> str:
    """Nuclear cleanup applied to the fully-accumulated output before saving.

    Strips any remaining thinking artifacts that slipped through streaming.
    """
    # Strip complete <unusedN>...<unusedN> blocks (whole reasoning section)
    text = re.sub(
        r"<unused\d+>\s*thought\s*\n[\s\S]*?</unused\d+>\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Strip <think>/<thinking>/<reasoning> blocks
    text = re.sub(
        r"<(think|thinking|reasoning)>[\s\S]*?</\1>",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Strip any orphan tags
    text = re.sub(r"</?unused\d+>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?(?:think|thinking|reasoning)>", "", text, flags=re.IGNORECASE)
    # Strip misc junk
    text = _strip_misc_junk(text)
    # Strip bare "thought\n" prefix if it still leads the output
    text = re.sub(r"^\s*thought\s*\n", "", text, flags=re.IGNORECASE)
    return text.strip()


class StreamCleaner:
    """Stateful cleaner that fully suppresses thinking blocks split across chunks.

    MedGemma format:  <unused94>thought\\n[reasoning]</unused94>[answer]
    Other models:     <think>[reasoning]</think>[answer]
    Bare prefix:      thought\\n[reasoning]\\n\\n[answer]

    The entire content between open and close tags is SUPPRESSED (not just the tags).
    The bare thought\\n prefix is stripped, and subsequent content flows through.
    """

    def __init__(self) -> None:
        self._buf = ""
        self._in_block = False      # currently inside a suppressed thinking block
        self._block_close_re: re.Pattern | None = None  # pattern to find closing tag
        self._emitted_any = False   # True once we've yielded real content

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        out, self._buf = self._drain(final=False)
        return out

    def flush(self) -> str:
        out, _ = self._drain(final=True)
        self._buf = ""
        return out

    # ------------------------------------------------------------------ #
    #  Internal drain loop                                                  #
    # ------------------------------------------------------------------ #

    def _drain(self, final: bool) -> tuple[str, str]:
        """Process buffer, return (text_to_emit, leftover_buffer)."""
        buf = self._buf
        parts: list[str] = []

        while True:
            if self._in_block:
                # We are inside a suppressed block — look for the closing tag
                assert self._block_close_re is not None
                m = self._block_close_re.search(buf)
                if m:
                    # Found closing tag: discard everything up to & including it
                    buf = buf[m.end():]
                    self._in_block = False
                    self._block_close_re = None
                    self._emitted_any = True
                    continue  # keep draining
                else:
                    # No closing tag yet
                    if final:
                        # Discard remaining suppressed content
                        buf = ""
                    return "".join(parts), buf

            else:
                # Normal mode — look for an opening thinking tag

                # 1) MedGemma: <unusedN>thought\n
                m_open = _THINK_OPEN_RE.search(buf)
                # 2) Generic: <think> / <thinking> / <reasoning>
                m_generic = _OPEN_THINK_TAG_RE.search(buf)

                # Pick whichever comes first
                best_match: re.Match | None = None
                close_re: re.Pattern | None = None
                if m_open and (m_generic is None or m_open.start() <= m_generic.start()):
                    best_match = m_open
                    close_re = _THINK_CLOSE_RE
                elif m_generic:
                    best_match = m_generic
                    tag = m_generic.group(1)
                    close_re = re.compile(rf"</{re.escape(tag)}>", re.IGNORECASE)

                if best_match is not None:
                    # Emit everything before the opening tag
                    before = buf[: best_match.start()]
                    if before:
                        emittable = self._handle_prefix(before)
                        if emittable:
                            parts.append(emittable)
                    # Enter suppression mode
                    buf = buf[best_match.end():]
                    self._in_block = True
                    self._block_close_re = close_re
                    continue

                # No opening tag found.
                # If not final, hold back any partial "<..." at the tail
                if not final and "<" in buf:
                    lt = buf.rfind("<")
                    if ">" not in buf[lt:]:
                        safe, tail = buf[:lt], buf[lt:]
                        if safe:
                            emittable = self._handle_prefix(safe)
                            if emittable:
                                parts.append(emittable)
                        return "".join(parts), tail

                # Nothing special — emit the whole buffer
                if buf:
                    emittable = self._handle_prefix(buf)
                    if emittable:
                        parts.append(emittable)
                return "".join(parts), ""

    def _handle_prefix(self, text: str) -> str:
        """Strip misc junk and, before first emission, strip bare thought\\n prefix."""
        text = _strip_misc_junk(text)
        if not text:
            return text
        if not self._emitted_any:
            # Strip bare "thought\n" prefix (no wrapper tags)
            stripped = re.sub(r"^\s*thought\s*\n", "", text, count=1, flags=re.IGNORECASE)
            if stripped != text:
                text = stripped.lstrip("\n")
            self._emitted_any = bool(text)
        return text


def _resolve_max_tokens(value: int) -> int:
    return value if value > 0 else DEFAULT_MAX_TOKENS


def _build_messages(
    prompt_version: PromptVersion,
    input_text: str,
    document: Document | None,
    rag_context: str = "",
) -> list[dict]:
    messages = []
    system_parts: list[str] = []
    if prompt_version.system_message:
        system_parts.append(prompt_version.system_message)
    if rag_context:
        system_parts.append(rag_context)
    if system_parts:
        messages.append({"role": "system", "content": "\n\n".join(system_parts)})

    user_content = prompt_version.content
    if document and document.raw_text:
        user_content += f"\n\n--- Document Content ---\n{document.raw_text}"
    if input_text:
        user_content += f"\n\n--- User Input ---\n{input_text}"

    messages.append({"role": "user", "content": user_content})
    return messages


async def _resolve_rag_binding(
    request: InferenceRequest, prompt_version: PromptVersion
) -> tuple[str | None, int]:
    """Resolve which KB and top-k to use for this call.

    Precedence:
      1. request.rag_override_none=True → RAG disabled
      2. request.kb_id set → use that (+ request.kb_top_k or prompt default)
      3. prompt version's kb_id → use that (+ prompt's kb_top_k)
      4. Nothing → RAG disabled
    """
    if request.rag_override_none:
        return None, 0
    kb_id = request.kb_id or prompt_version.kb_id
    top_k = request.kb_top_k or prompt_version.kb_top_k or 5
    return kb_id, top_k


async def _build_rag_context(
    db: AsyncSession, request: InferenceRequest, prompt_version: PromptVersion
) -> str:
    """Resolve retrieval for the request's attached KB (if any).

    Uses `input_text` as the retrieval query. Returns an empty string when no
    KB is attached or when retrieval yields nothing. Errors are swallowed with
    a warning so RAG failure doesn't kill the inference run.
    """
    kb_id, top_k = await _resolve_rag_binding(request, prompt_version)
    if not kb_id:
        return ""
    kb = await db.get(KnowledgeBase, kb_id)
    if not kb:
        logger.warning("Inference requested KB %s which was not found — skipping RAG", kb_id)
        return ""
    query = (request.input_text or "").strip()
    if not query:
        # Without a user query we only have the dictionary to share (if any)
        if kb.dictionary_content:
            return rag_service.format_chunks_for_prompt([], kb.dictionary_content)
        return ""
    try:
        hits = await rag_service.query_kb(db, kb, query, top_k=top_k)
    except Exception as e:
        logger.warning("KB retrieval failed for kb_id=%s: %s", kb_id, e)
        return ""
    return rag_service.format_chunks_for_prompt(hits, kb.dictionary_content)


async def run_inference(db: AsyncSession, project_id: str, request: InferenceRequest) -> InferenceRun:
    prompt_version = await db.get(PromptVersion, request.prompt_version_id)
    model_config = await db.get(ModelConfig, request.model_config_id)
    document = await db.get(Document, request.document_id) if request.document_id else None

    if not prompt_version or not model_config:
        raise ValueError("Invalid prompt version or model config")

    rag_context = await _build_rag_context(db, request, prompt_version)
    messages = _build_messages(prompt_version, request.input_text, document, rag_context)

    run = InferenceRun(
        project_id=project_id,
        prompt_version_id=request.prompt_version_id,
        model_config_id=request.model_config_id,
        document_id=request.document_id,
        input_text=request.input_text,
        status="running",
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    await db.flush()

    api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
    provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)

    start = time.monotonic()
    extra_params = dict(model_config.extra_params or {})
    if model_config.adapter_path:
        extra_params.setdefault("adapter_path", model_config.adapter_path)
    # Registry toggle overrides JSON-set enable_thinking. Legacy NULL → True.
    extra_params["enable_thinking"] = (
        bool(model_config.enable_thinking)
        if getattr(model_config, "enable_thinking", None) is not None
        else True
    )
    try:
        response = await provider.generate(
            messages=messages,
            model_id=model_config.model_id,
            max_tokens=_resolve_max_tokens(model_config.max_tokens),
            temperature=model_config.temperature,
            **extra_params,
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        run.output_text = _final_cleanup(response.content)
        run.status = "completed"
        run.latency_ms = elapsed_ms
        run.token_usage_input = response.input_tokens
        run.token_usage_output = response.output_tokens
        run.completed_at = datetime.now(timezone.utc)
    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)
        run.completed_at = datetime.now(timezone.utc)

    await db.flush()
    return run


@dataclass
class StreamContext:
    """Mutable state shared between the stream generator and the caller."""
    run_id: str = ""
    full_text: list[str] = field(default_factory=list)
    error: str | None = None
    start_time: float = 0.0


async def create_stream_run(
    db: AsyncSession, project_id: str, request: InferenceRequest
) -> tuple[StreamContext, AsyncIterator[str]]:
    """Create a run record and return a (context, generator) pair.

    The caller is responsible for calling save_stream_run(ctx) after
    the generator is exhausted.
    """
    prompt_version = await db.get(PromptVersion, request.prompt_version_id)
    model_config = await db.get(ModelConfig, request.model_config_id)
    document = await db.get(Document, request.document_id) if request.document_id else None

    if not prompt_version or not model_config:
        raise ValueError("Invalid prompt version or model config")

    rag_context = await _build_rag_context(db, request, prompt_version)
    messages = _build_messages(prompt_version, request.input_text, document, rag_context)

    # Create run in its own committed session so it's visible to save later
    async with async_session() as create_db:
        run = InferenceRun(
            project_id=project_id,
            prompt_version_id=request.prompt_version_id,
            model_config_id=request.model_config_id,
            document_id=request.document_id,
            input_text=request.input_text,
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        create_db.add(run)
        await create_db.commit()
        run_id = run.id

    api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
    provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)

    ctx = StreamContext(run_id=run_id, start_time=time.monotonic())

    stream_extra = dict(model_config.extra_params or {})
    if model_config.adapter_path:
        stream_extra.setdefault("adapter_path", model_config.adapter_path)
    # Registry toggle overrides JSON-set enable_thinking. Legacy NULL → True.
    stream_extra["enable_thinking"] = (
        bool(model_config.enable_thinking)
        if getattr(model_config, "enable_thinking", None) is not None
        else True
    )

    async def generate_chunks() -> AsyncIterator[str]:
        cleaner = StreamCleaner()
        try:
            async for chunk in provider.stream(
                messages=messages,
                model_id=model_config.model_id,
                max_tokens=_resolve_max_tokens(model_config.max_tokens),
                temperature=model_config.temperature,
                **stream_extra,
            ):
                cleaned = cleaner.feed(chunk)
                if cleaned:
                    ctx.full_text.append(cleaned)
                    yield f"data: {json.dumps({'text': cleaned})}\n\n"
            # Flush any remaining buffered text
            remaining = cleaner.flush()
            if remaining:
                ctx.full_text.append(remaining)
                yield f"data: {json.dumps({'text': remaining})}\n\n"
        except Exception as e:
            ctx.error = str(e)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return ctx, generate_chunks()


async def save_stream_run(ctx: StreamContext) -> None:
    """Save the final state of a streaming run. Call after the stream is done."""
    elapsed_ms = int((time.monotonic() - ctx.start_time) * 1000)
    try:
        async with async_session() as db:
            run = await db.get(InferenceRun, ctx.run_id)
            if not run:
                logger.error("Could not find run %s to save", ctx.run_id)
                return
            if ctx.error:
                run.status = "failed"
                run.error_message = ctx.error
            else:
                # Apply final nuclear cleanup as a safety net for anything
                # that slipped through the streaming StreamCleaner
                run.output_text = _final_cleanup("".join(ctx.full_text))
                run.status = "completed"
            run.latency_ms = elapsed_ms
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info(
                "Saved run %s: %s (%d chars, %dms)",
                ctx.run_id, run.status, len(run.output_text or ""), elapsed_ms,
            )
    except Exception as e:
        logger.error("Failed to save run %s: %s", ctx.run_id, e)
