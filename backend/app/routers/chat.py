"""Chat routes — multi-turn sessions with SSE streaming."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.chat import (
    ChatMessageResponse,
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionUpdate,
    ChatSessionWithMessagesResponse,
    ChatTurnRequest,
)
from app.services import chat_service

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    return await chat_service.list_sessions(db)


@router.post("/sessions", response_model=ChatSessionResponse, status_code=201)
async def create_session(data: ChatSessionCreate, db: AsyncSession = Depends(get_db)):
    return await chat_service.create_session(
        db,
        name=data.name,
        model_config_id=data.model_config_id,
        system_prompt=data.system_prompt,
    )


@router.get("/sessions/{session_id}", response_model=ChatSessionWithMessagesResponse)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    s = await chat_service.get_session(db, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Chat session not found")
    msgs = await chat_service.list_messages(db, session_id)
    return ChatSessionWithMessagesResponse(
        **ChatSessionResponse.model_validate(s).model_dump(),
        messages=[ChatMessageResponse.model_validate(m) for m in msgs],
    )


@router.put("/sessions/{session_id}", response_model=ChatSessionResponse)
async def update_session(
    session_id: str,
    data: ChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
):
    s = await chat_service.update_session(
        db,
        session_id,
        name=data.name,
        model_config_id=data.model_config_id,
        system_prompt=data.system_prompt,
    )
    if not s:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return s


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    if not await chat_service.delete_session(db, session_id):
        raise HTTPException(status_code=404, detail="Chat session not found")


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    data: ChatTurnRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """SSE endpoint: streams the assistant's reply token-by-token.

    Each line is an SSE `data:` event with JSON payload:
      - {"meta": {"user_id": ..., "assistant_id": ...}}  → first event
      - {"text": "chunk"}                                 → streaming delta
      - {"error": "..."}                                  → terminal error
    """
    try:
        ctx, chunks = await chat_service.create_turn_stream(db, session_id, data.content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Finalize assistant row AFTER the stream closes
    async def _finalize():
        await chat_service.finalize_turn(ctx)

    async def event_source():
        try:
            async for chunk in chunks:
                yield chunk
        finally:
            await _finalize()

    return StreamingResponse(event_source(), media_type="text/event-stream")
