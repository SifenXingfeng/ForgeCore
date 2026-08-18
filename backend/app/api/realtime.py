"""Authenticated Server-Sent Event endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from app.deps import CurrentUser, DbSession
from app.realtime.event_bus import agent_channel, event_stream, factory_channel
from app.services.agent_service import get_agent_session
from app.services.factory_service import get_factory_by_id

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.get("/factory/{factory_id}/events", response_class=EventSourceResponse)
async def stream_factory_events(
    factory_id: str,
    user: CurrentUser,
    db: DbSession,
) -> EventSourceResponse:
    factory = await get_factory_by_id(factory_id, db)
    if factory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂不存在。")
    if factory.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权订阅该工厂。")
    return EventSourceResponse(event_stream(factory_channel(factory_id)), ping=None)


@router.get("/agent/{session_id}/stream", response_class=EventSourceResponse)
async def stream_agent_events(session_id: str, user: CurrentUser) -> EventSourceResponse:
    session = await get_agent_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent 会话不存在或已过期。")
    if session.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权订阅该 Agent 会话。")
    return EventSourceResponse(event_stream(agent_channel(session_id)), ping=None)
