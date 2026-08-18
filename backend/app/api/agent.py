"""Agent session API; actual LLM providers plug into this stable contract later."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from app.deps import CurrentUser, DbSession
from app.schemas.agent import AgentEvent, AgentEventCreate, AgentSession, AgentSessionCreate
from app.services.agent_service import (
    append_agent_event,
    cancel_agent_session,
    create_agent_session,
    get_agent_session,
    list_agent_events,
)
from app.services.factory_service import get_factory_by_id

router = APIRouter(prefix="/agent", tags=["agent"])


async def _owned_session(session_id: str, user_id: str) -> AgentSession:
    session = await get_agent_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent 会话不存在或已过期。")
    if session.owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该 Agent 会话。")
    return session


@router.post("/sessions", response_model=AgentSession, status_code=status.HTTP_201_CREATED)
async def create(payload: AgentSessionCreate, user: CurrentUser, db: DbSession) -> AgentSession:
    factory = await get_factory_by_id(payload.factory_id, db)
    if factory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂不存在。")
    if factory.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权分析该工厂。")
    return await create_agent_session(user.id, payload)


@router.get("/sessions/{session_id}", response_model=AgentSession)
async def get(session_id: str, user: CurrentUser) -> AgentSession:
    return await _owned_session(session_id, user.id)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(session_id: str, user: CurrentUser) -> None:
    session = await _owned_session(session_id, user.id)
    await cancel_agent_session(session)


@router.get("/sessions/{session_id}/events", response_model=list[AgentEvent])
async def events(session_id: str, user: CurrentUser) -> list[AgentEvent]:
    await _owned_session(session_id, user.id)
    return await list_agent_events(session_id)


@router.post("/sessions/{session_id}/events", response_model=AgentEvent, status_code=status.HTTP_201_CREATED)
async def append_event(session_id: str, payload: AgentEventCreate, user: CurrentUser) -> AgentEvent:
    session = await _owned_session(session_id, user.id)
    try:
        return await append_agent_event(session, payload)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=exc.errors()) from exc
