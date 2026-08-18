"""Redis-backed Agent session state and event history."""

from __future__ import annotations

from datetime import UTC, datetime

from app.config import get_settings
from app.core.utils import new_id
from app.realtime.event_bus import agent_channel, publish_event
from app.redis_client import get_redis
from app.schemas.agent import AgentEvent, AgentEventCreate, AgentSession, AgentSessionCreate, AgentSuggestion

SESSION_PREFIX = "agent:session:"
EVENTS_PREFIX = "agent:events:"


def _session_key(session_id: str) -> str:
    return f"{SESSION_PREFIX}{session_id}"


def _events_key(session_id: str) -> str:
    return f"{EVENTS_PREFIX}{session_id}"


async def create_agent_session(owner_id: str, payload: AgentSessionCreate) -> AgentSession:
    now = datetime.now(UTC)
    settings = get_settings()
    session = AgentSession(
        id=new_id("agent"),
        owner_id=owner_id,
        factory_id=payload.factory_id,
        objective=payload.objective.strip(),
        status="ready",
        llm_configured=bool(settings.llm_provider and settings.openai_api_key),
        created_at=now,
        updated_at=now,
    )
    redis = get_redis()
    await redis.set(
        _session_key(session.id),
        session.model_dump_json(),
        ex=settings.agent_session_ttl_seconds,
    )
    await append_agent_event(
        session,
        AgentEventCreate(
            event="agent_progress",
            data={
                "step": "ready",
                "message": "Agent 会话已建立，等待分析编排器提交工具进度或结构化建议。",
                "llm_configured": session.llm_configured,
            },
        ),
    )
    return session


async def get_agent_session(session_id: str) -> AgentSession | None:
    raw = await get_redis().get(_session_key(session_id))
    if not isinstance(raw, str):
        return None
    return AgentSession.model_validate_json(raw)


async def save_agent_session(session: AgentSession) -> None:
    settings = get_settings()
    session.updated_at = datetime.now(UTC)
    await get_redis().set(
        _session_key(session.id),
        session.model_dump_json(),
        ex=settings.agent_session_ttl_seconds,
    )


async def cancel_agent_session(session: AgentSession) -> None:
    session.status = "cancelled"
    await save_agent_session(session)
    await append_agent_event(
        session,
        AgentEventCreate(event="agent_progress", data={"step": "cancelled", "message": "Agent 会话已取消。"}),
    )


async def append_agent_event(session: AgentSession, payload: AgentEventCreate) -> AgentEvent:
    if payload.event == "agent_suggestion":
        AgentSuggestion.model_validate(payload.data)
    event = AgentEvent(
        id=new_id("event"),
        session_id=session.id,
        event=payload.event,
        data=payload.data,
        created_at=datetime.now(UTC),
    )
    settings = get_settings()
    redis = get_redis()
    key = _events_key(session.id)
    await redis.rpush(key, event.model_dump_json())
    await redis.ltrim(key, -200, -1)
    await redis.expire(key, settings.agent_session_ttl_seconds)
    await publish_event(agent_channel(session.id), event.event, event.model_dump(mode="json"))
    return event


async def list_agent_events(session_id: str) -> list[AgentEvent]:
    rows = await get_redis().lrange(_events_key(session_id), 0, -1)
    return [AgentEvent.model_validate_json(row) for row in rows if isinstance(row, str)]
