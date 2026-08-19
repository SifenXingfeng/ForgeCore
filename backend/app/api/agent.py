"""Agent session API; actual LLM providers plug into this stable contract later."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import ValidationError

from app.deps import CurrentUser, DbSession
from app.models.agent import AgentPatch, AgentRun
from app.schemas.agent import (
    AgentApprovalDecision,
    AgentEvent,
    AgentEventCreate,
    AgentPatchSchema,
    AgentRunCreate,
    AgentRunDetail,
    AgentSession,
    AgentSessionCreate,
)
from app.services.agent_run_service import (
    analyze_agent_run,
    apply_agent_patch,
    approve_agent_patch,
    cancel_agent_run,
    create_agent_run,
    list_agent_runs,
    list_run_patches,
    load_agent_patch,
    load_agent_run,
    reject_agent_patch,
    rollback_agent_patch,
)
from app.services.agent_service import (
    append_agent_event,
    cancel_agent_session,
    create_agent_session,
    get_agent_session,
    list_agent_events,
)
from app.services.agent_tool_registry import public_tool_catalog
from app.services.factory_service import get_factory_by_id

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/tools", response_model=list[dict[str, object]])
async def tools(user: CurrentUser) -> list[dict[str, object]]:
    del user
    return public_tool_catalog()


async def _owned_run(run_id: str, user_id: str, db: DbSession) -> AgentRun:
    run = await load_agent_run(run_id, db)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent run 不存在")
    if run.owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该 Agent run")
    return run


async def _owned_patch(patch_id: str, user_id: str, db: DbSession) -> AgentPatch:
    patch = await load_agent_patch(patch_id, db)
    if patch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent patch 不存在")
    if patch.owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该 Agent patch")
    return patch


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


@router.post("/runs", response_model=AgentRunDetail, status_code=status.HTTP_201_CREATED)
async def create_run(payload: AgentRunCreate, user: CurrentUser, db: DbSession) -> AgentRun:
    factory = await get_factory_by_id(payload.factory_id, db)
    if factory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂不存在")
    if factory.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权分析该工厂")
    return await create_agent_run(user.id, factory, payload, db)


@router.get("/runs", response_model=list[AgentRunDetail])
async def runs(
    user: CurrentUser,
    db: DbSession,
    factory_id: str | None = Query(default=None),
) -> list[AgentRun]:
    if factory_id:
        factory = await get_factory_by_id(factory_id, db)
        if factory is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂不存在")
        if factory.owner_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看该工厂")
    return await list_agent_runs(user.id, db, factory_id)


@router.get("/runs/{run_id}", response_model=AgentRunDetail)
async def get_run(run_id: str, user: CurrentUser, db: DbSession) -> AgentRun:
    return await _owned_run(run_id, user.id, db)


@router.post("/runs/{run_id}/analyze", response_model=AgentRunDetail)
async def analyze(run_id: str, user: CurrentUser, db: DbSession) -> AgentRun:
    run = await _owned_run(run_id, user.id, db)
    try:
        return await analyze_agent_run(run, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/{run_id}/cancel", response_model=AgentRunDetail)
async def cancel_run(run_id: str, user: CurrentUser, db: DbSession) -> AgentRun:
    run = await _owned_run(run_id, user.id, db)
    return await cancel_agent_run(run, db)


@router.get("/runs/{run_id}/patches", response_model=list[AgentPatchSchema])
async def run_patches(run_id: str, user: CurrentUser, db: DbSession) -> list[AgentPatch]:
    await _owned_run(run_id, user.id, db)
    return await list_run_patches(run_id, db)


@router.get("/patches/{patch_id}", response_model=AgentPatchSchema)
async def get_patch(patch_id: str, user: CurrentUser, db: DbSession) -> AgentPatch:
    return await _owned_patch(patch_id, user.id, db)


@router.post("/patches/{patch_id}/approve", response_model=AgentPatchSchema)
async def approve_patch(
    patch_id: str,
    user: CurrentUser,
    db: DbSession,
    payload: AgentApprovalDecision | None = None,
) -> AgentPatch:
    patch = await _owned_patch(patch_id, user.id, db)
    try:
        return await approve_agent_patch(patch, db, note=payload.note if payload else None)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/patches/{patch_id}/reject", response_model=AgentPatchSchema)
async def reject_patch(
    patch_id: str,
    user: CurrentUser,
    db: DbSession,
    payload: AgentApprovalDecision | None = None,
) -> AgentPatch:
    patch = await _owned_patch(patch_id, user.id, db)
    try:
        return await reject_agent_patch(patch, db, note=payload.note if payload else None)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/patches/{patch_id}/apply", response_model=AgentPatchSchema)
async def apply_patch(patch_id: str, user: CurrentUser, db: DbSession) -> AgentPatch:
    patch = await _owned_patch(patch_id, user.id, db)
    try:
        return await apply_agent_patch(patch, db)
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_409_CONFLICT if "已变更" in detail or "失效" in detail else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=detail) from exc


@router.post("/patches/{patch_id}/rollback", response_model=AgentPatchSchema)
async def rollback_patch(patch_id: str, user: CurrentUser, db: DbSession) -> AgentPatch:
    patch = await _owned_patch(patch_id, user.id, db)
    try:
        return await rollback_agent_patch(patch, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
