"""Chat service — persistent multi-turn sessions streamed via SSE.

A chat session is tied to a registered ModelConfig.  Messages are kept in
order and fed back to the model on every turn (so the model sees the full
history).  Streams assistant responses token-by-token through the same
provider interface already used by single-inference + backtest code paths.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.chat import ChatMessage, ChatSession
from app.models.model_config import ModelConfig
from app.providers.registry import get_provider
from app.services.model_config_service import decrypt_api_key

logger = logging.getLogger(__name__)

DEFAULT_MAX_TOKENS = 4096


# ─── CRUD ───────────────────────────────────────────────────────────────────

async def list_sessions(db: AsyncSession) -> list[ChatSession]:
    r = await db.execute(
        select(ChatSession).order_by(ChatSession.updated_at.desc())
    )
    return list(r.scalars().all())


async def get_session(db: AsyncSession, session_id: str) -> ChatSession | None:
    return await db.get(ChatSession, session_id)


async def create_session(
    db: AsyncSession,
    name: str,
    model_config_id: str,
    system_prompt: str | None = None,
) -> ChatSession:
    s = ChatSession(
        name=name,
        model_config_id=model_config_id,
        system_prompt=system_prompt,
    )
    db.add(s)
    await db.flush()
    return s


async def update_session(
    db: AsyncSession,
    session_id: str,
    *,
    name: str | None = None,
    model_config_id: str | None = None,
    system_prompt: str | None = None,
) -> ChatSession | None:
    s = await db.get(ChatSession, session_id)
    if not s:
        return None
    if name is not None:
        s.name = name
    if model_config_id is not None:
        s.model_config_id = model_config_id
    if system_prompt is not None:
        s.system_prompt = system_prompt
    await db.flush()
    return s


async def delete_session(db: AsyncSession, session_id: str) -> bool:
    s = await db.get(ChatSession, session_id)
    if not s:
        return False
    await db.delete(s)  # cascade deletes messages
    await db.flush()
    return True


async def list_messages(db: AsyncSession, session_id: str) -> list[ChatMessage]:
    r = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    return list(r.scalars().all())


# ─── Streaming a new turn ───────────────────────────────────────────────────

@dataclass
class ChatTurnContext:
    session_id: str
    user_message_id: str
    assistant_message_id: str
    full_text: list[str] = field(default_factory=list)
    error: str | None = None
    start_time: float = 0.0


def _build_messages_for_model(
    system_prompt: str | None,
    history: list[ChatMessage],
    new_user_content: str,
) -> list[dict]:
    """Assemble a provider-compatible `messages` list from the session history."""
    msgs: list[dict] = []
    if system_prompt and system_prompt.strip():
        msgs.append({"role": "system", "content": system_prompt})
    for m in history:
        if m.role in ("user", "assistant"):
            msgs.append({"role": m.role, "content": m.content})
    msgs.append({"role": "user", "content": new_user_content})
    return msgs


async def create_turn_stream(
    db: AsyncSession,
    session_id: str,
    user_content: str,
) -> tuple[ChatTurnContext, AsyncIterator[str]]:
    """Persist the user message, then return a (ctx, SSE generator) pair.

    The caller iterates the generator (for FastAPI StreamingResponse) and then
    must call `finalize_turn(ctx)` so the assistant message is saved with its
    usage stats and total text.
    """
    s = await db.get(ChatSession, session_id)
    if not s:
        raise ValueError(f"Chat session {session_id} not found")

    model_config = await db.get(ModelConfig, s.model_config_id)
    if not model_config:
        raise ValueError("Session's model is not available")

    # Load history BEFORE writing the new user message to avoid duplicating
    history = await list_messages(db, session_id)

    # Persist the user message in its own session so the stream generator's
    # fresh session doesn't block while the inference call is running.
    async with async_session() as write_db:
        user_row = ChatMessage(
            session_id=session_id,
            role="user",
            content=user_content,
        )
        write_db.add(user_row)
        # Bump session updated_at so the list re-sorts
        s_row = await write_db.get(ChatSession, session_id)
        if s_row:
            s_row.updated_at = datetime.now(timezone.utc)
        await write_db.commit()
        await write_db.refresh(user_row)
        user_msg_id = user_row.id

    # Build messages for the model from history + new user turn
    messages = _build_messages_for_model(s.system_prompt, history, user_content)

    # Pre-create the assistant message row so the frontend can reference its id
    async with async_session() as write_db:
        assistant_row = ChatMessage(
            session_id=session_id,
            role="assistant",
            content="",  # filled in during finalize_turn
        )
        write_db.add(assistant_row)
        await write_db.commit()
        await write_db.refresh(assistant_row)
        assistant_msg_id = assistant_row.id

    # Prepare provider
    api_key = decrypt_api_key(model_config.api_key_encrypted) if model_config.api_key_encrypted else None
    provider = get_provider(model_config.provider, api_key=api_key, base_url=model_config.base_url)

    extra_params = dict(model_config.extra_params or {})
    if model_config.adapter_path:
        extra_params.setdefault("adapter_path", model_config.adapter_path)

    ctx = ChatTurnContext(
        session_id=session_id,
        user_message_id=user_msg_id,
        assistant_message_id=assistant_msg_id,
        start_time=time.monotonic(),
    )

    async def generate_chunks() -> AsyncIterator[str]:
        # First event: metadata so the frontend knows the message ids
        yield f"data: {json.dumps({'meta': {'user_id': user_msg_id, 'assistant_id': assistant_msg_id}})}\n\n"
        try:
            async for chunk in provider.stream(
                messages=messages,
                model_id=model_config.model_id,
                max_tokens=model_config.max_tokens or DEFAULT_MAX_TOKENS,
                temperature=model_config.temperature,
                **extra_params,
            ):
                if chunk:
                    ctx.full_text.append(chunk)
                    yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as e:
            ctx.error = str(e)
            logger.exception("Chat stream failed for session %s", session_id)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return ctx, generate_chunks()


async def finalize_turn(ctx: ChatTurnContext) -> None:
    """Persist the assistant message's final text + usage stats after the stream ends."""
    elapsed_ms = int((time.monotonic() - ctx.start_time) * 1000)
    full_text = "".join(ctx.full_text)
    async with async_session() as db:
        row = await db.get(ChatMessage, ctx.assistant_message_id)
        if not row:
            logger.error("Assistant message row %s missing on finalize", ctx.assistant_message_id)
            return
        row.content = full_text
        row.latency_ms = elapsed_ms
        # Simple token estimate (providers that return real counts could override)
        row.tokens_out = max(1, len(full_text) // 4) if full_text else 0
        if ctx.error:
            row.error_message = ctx.error
        # Bump the session updated_at
        s = await db.get(ChatSession, ctx.session_id)
        if s:
            s.updated_at = datetime.now(timezone.utc)
        await db.commit()
