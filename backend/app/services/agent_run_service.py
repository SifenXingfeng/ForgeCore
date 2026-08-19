"""Durable read-only Agent orchestration and deterministic factory tools."""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from math import hypot
from time import perf_counter
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.agent import AgentApproval, AgentPatch, AgentRun, AgentRunEvent, AgentStep, AgentToolCall
from app.models.factory import Factory
from app.realtime.event_bus import agent_channel, publish_event
from app.schemas.agent import AgentRunCreate
from app.services.agent_provider import create_agent_provider, select_tools_with_fallback
from app.services.agent_tool_registry import TOOL_DEFINITION_BY_NAME
from app.services.factory_goal_service import compile_factory_goal
from app.services.factory_graph_service import build_factory_graph
from app.services.factory_patch_service import (
    apply_ops_in_memory,
    build_diff_summary,
    build_patch_package,
    design_from_factory,
    design_to_sync_request,
    validate_design,
    version_token,
    versions_match,
)
from app.services.factory_service import load_full_snapshot, sync_factory_snapshot

logger = logging.getLogger(__name__)

STEP_DEFINITIONS = (
    (1, "goal", "编译目标与约束"),
    (2, "context", "读取工厂上下文"),
    (3, "metrics", "检查运行指标"),
    (4, "diagnostics", "诊断生产与物流"),
    (5, "summary", "整理证据"),
)
PLAN_STEP = (6, "plan", "生成并校验方案")
TERMINAL_STATUSES = frozenset({"completed", "failed", "cancelled", "rejected"})


class AgentRunCancelledError(Exception):
    """Raised inside orchestration when another request cancels the run."""


def _run_load_options() -> tuple[Any, ...]:
    return (
        selectinload(AgentRun.steps),
        selectinload(AgentRun.tool_calls),
        selectinload(AgentRun.events),
        selectinload(AgentRun.patches).selectinload(AgentPatch.approvals),
        selectinload(AgentRun.approvals),
    )


def _goal_hard_constraints(goal: dict[str, object] | None) -> list[dict[str, Any]]:
    raw = (goal or {}).get("hard_constraints") or []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


async def load_agent_run(run_id: str, db: AsyncSession) -> AgentRun | None:
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.id == run_id)
        .options(*_run_load_options())
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def list_agent_runs(owner_id: str, db: AsyncSession, factory_id: str | None = None) -> list[AgentRun]:
    statement = (
        select(AgentRun)
        .where(AgentRun.owner_id == owner_id)
        .options(*_run_load_options())
        .order_by(AgentRun.created_at.desc())
        .limit(25)
    )
    if factory_id:
        statement = statement.where(AgentRun.factory_id == factory_id)
    result = await db.execute(statement)
    return list(result.scalars().unique().all())


async def load_agent_patch(patch_id: str, db: AsyncSession) -> AgentPatch | None:
    result = await db.execute(
        select(AgentPatch)
        .where(AgentPatch.id == patch_id)
        .options(selectinload(AgentPatch.approvals))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def list_run_patches(run_id: str, db: AsyncSession) -> list[AgentPatch]:
    result = await db.execute(
        select(AgentPatch)
        .where(AgentPatch.run_id == run_id)
        .options(selectinload(AgentPatch.approvals))
        .order_by(AgentPatch.created_at.desc())
    )
    return list(result.scalars().unique().all())


async def create_agent_run(owner_id: str, factory: Factory, payload: AgentRunCreate, db: AsyncSession) -> AgentRun:
    settings = get_settings()
    full_factory = await load_full_snapshot(factory.id, db)
    if full_factory is None:
        raise ValueError("工厂不存在")
    run = AgentRun(
        owner_id=owner_id,
        factory_id=factory.id,
        objective=payload.objective.strip(),
        mode=payload.mode,
        provider="deterministic",
        llm_configured=bool(settings.llm_provider and settings.openai_api_key),
        compiled_goal=compile_factory_goal(payload.objective, full_factory, mode=payload.mode),
    )
    db.add(run)
    await db.flush()
    steps = list(STEP_DEFINITIONS)
    if payload.mode == "plan_design":
        steps.append(PLAN_STEP)
    for position, key, title in steps:
        db.add(AgentStep(run_id=run.id, position=position, key=key, title=title))
    await db.commit()
    created = await load_agent_run(run.id, db)
    assert created is not None
    await _emit(created.id, "run_created", {"run_id": created.id, "status": created.status}, db)
    return created


async def cancel_agent_run(run: AgentRun, db: AsyncSession) -> AgentRun:
    if run.status in TERMINAL_STATUSES:
        return run
    now = datetime.now(UTC)
    run.status = "cancelled"
    run.completed_at = now
    for step in run.steps:
        if step.status in {"pending", "running"}:
            step.status = "cancelled"
            step.completed_at = now
    await db.commit()
    await _emit(run.id, "run_cancelled", {"run_id": run.id, "status": run.status}, db)
    refreshed = await load_agent_run(run.id, db)
    assert refreshed is not None
    return refreshed


async def analyze_agent_run(run: AgentRun, db: AsyncSession) -> AgentRun:
    if run.status in TERMINAL_STATUSES | {"awaiting_approval"}:
        return run
    if run.status not in {"created", "failed"}:
        raise ValueError("Agent run 正在执行")

    try:
        await db.refresh(run, with_for_update=True)
        if run.status == "completed":
            completed = await load_agent_run(run.id, db)
            assert completed is not None
            return completed
        if run.status not in {"created", "failed"}:
            raise ValueError("Agent run 正在执行")
        run.status = "planning"
        run.error = None
        await db.commit()
        await _publish_progress(run, "goal", "正在固定目标、约束和允许动作", db)

        factory = await load_full_snapshot(run.factory_id, db)
        if factory is None:
            raise RuntimeError("工厂不存在")
        run.base_factory_updated_at = factory.updated_at
        run.compiled_goal = compile_factory_goal(run.objective, factory, mode=run.mode)
        provider = create_agent_provider(get_settings())
        provider_name, selected_tools, provider_error = await select_tools_with_fallback(
            provider, run.objective, run.compiled_goal
        )
        run.provider = provider_name
        await db.commit()
        await _emit(
            run.id,
            "tools_selected",
            {
                "run_id": run.id,
                "provider": provider_name,
                "tools": selected_tools,
                "fallback_reason": provider_error,
            },
            db,
        )

        await _set_step(run, "goal", "running", "编译目标指标、约束和评估窗口", db)
        await _record_tool(
            run,
            "goal",
            "explain_constraint",
            {"factory_id": run.factory_id, "objective": run.objective},
            lambda: dict(run.compiled_goal),
            db,
        )
        goal_status = str(run.compiled_goal.get("status", "ready"))
        await _set_step(run, "goal", "completed", f"目标结构化完成，状态 {goal_status}", db)
        await _raise_if_cancelled(run, db)

        run.status = "contextualizing"
        await db.commit()
        await _publish_progress(run, "context", "正在读取工厂版本和依赖图", db)

        await _set_step(run, "context", "running", "读取楼层、设备、配方和仿真状态", db)
        snapshot = await _record_tool(
            run,
            "context",
            "get_factory_snapshot",
            {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
            lambda: _factory_snapshot(factory),
            db,
        )
        graph = await _record_tool(
            run,
            "context",
            "get_factory_graph",
            {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
            lambda: build_factory_graph(factory),
            db,
        )
        await _set_step(run, "context", "completed", "工厂上下文已固定到当前版本", db)
        await _raise_if_cancelled(run, db)

        run.status = "executing_tools"
        await db.commit()
        await _set_step(run, "metrics", "running", "读取指标序列和运行时状态", db)
        metrics = await _record_tool(
            run,
            "metrics",
            "get_simulation_metrics",
            {
                "factory_id": run.factory_id,
                "factory_version": factory.updated_at.isoformat(),
            },
            lambda: _simulation_metrics(factory),
            db,
        )
        if "query_event_timeline" in selected_tools:
            await _record_tool(
                run,
                "metrics",
                "query_event_timeline",
                {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
                lambda: _event_timeline(factory),
                db,
            )
        await _set_step(run, "metrics", "completed", "运行证据已完成结构化", db)
        await _raise_if_cancelled(run, db)

        await _set_step(run, "diagnostics", "running", "检查配方、库存、输送和载具", db)
        inventory = await _record_tool(
            run,
            "diagnostics",
            "inspect_inventory",
            {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
            lambda: _inventory_context(factory),
            db,
        )
        if "inspect_machine" in selected_tools:
            await _record_tool(
                run,
                "diagnostics",
                "inspect_machine",
                {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
                lambda: _machine_context(factory),
                db,
            )
        if "inspect_recipe_chain" in selected_tools:
            await _record_tool(
                run,
                "diagnostics",
                "inspect_recipe_chain",
                {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
                lambda: _recipe_chain_context(factory, graph),
                db,
            )
        if "inspect_conveyors" in selected_tools:
            await _record_tool(
                run,
                "diagnostics",
                "inspect_conveyors",
                {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
                lambda: _conveyor_context(factory),
                db,
            )
        logistics = await _record_tool(
            run,
            "diagnostics",
            "inspect_logistics",
            {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
            lambda: _logistics_context(factory),
            db,
        )
        if "calculate_capacity" in selected_tools:
            await _record_tool(
                run,
                "diagnostics",
                "calculate_capacity",
                {"factory_id": run.factory_id, "factory_version": factory.updated_at.isoformat()},
                lambda: _capacity_context(factory),
                db,
            )
        diagnosis = await _record_tool(
            run,
            "diagnostics",
            "inspect_bottlenecks",
            {
                "factory_id": run.factory_id,
                "factory_version": factory.updated_at.isoformat(),
                "objective": run.objective,
            },
            lambda: _diagnose(factory, snapshot, graph, metrics, inventory, logistics),
            db,
        )
        await _set_step(run, "diagnostics", "completed", "生产与物流诊断已完成", db)
        await _raise_if_cancelled(run, db)

        await _set_step(run, "summary", "running", "按严重度整理发现和证据", db)
        result = _analysis_result(snapshot, graph, metrics, diagnosis)
        run.result = result
        run.summary = str(result["headline"])
        await _set_step(run, "summary", "completed", "诊断结果已生成", db)
        await _raise_if_cancelled(run, db)

        if run.mode == "plan_design":
            await _complete_plan_design(run, factory, diagnosis, db)
        else:
            run.status = "completed"
            run.completed_at = datetime.now(UTC)
            await db.commit()
            await _emit(run.id, "run_completed", {"run_id": run.id, "status": run.status, "result": result}, db)
    except AgentRunCancelledError:
        cancelled = await load_agent_run(run.id, db)
        assert cancelled is not None
        return cancelled
    except Exception as exc:
        logger.exception("Agent run %s failed", run.id)
        await db.rollback()
        failed = await load_agent_run(run.id, db)
        if failed is None:
            raise
        failed.status = "failed"
        failed.error = str(exc)
        failed.completed_at = datetime.now(UTC)
        for step in failed.steps:
            if step.status == "running":
                step.status = "failed"
                step.detail = str(exc)
                step.completed_at = failed.completed_at
        await db.commit()
        await _emit(failed.id, "agent_error", {"run_id": failed.id, "message": str(exc)}, db)

    refreshed = await load_agent_run(run.id, db)
    assert refreshed is not None
    return refreshed


async def approve_agent_patch(patch: AgentPatch, db: AsyncSession, *, note: str | None = None) -> AgentPatch:
    if patch.status not in {"awaiting_approval", "validated"}:
        raise ValueError("当前 Patch 不可批准")
    approval = _latest_pending_approval(patch)
    now = datetime.now(UTC)
    patch.status = "approved"
    patch.decided_at = now
    patch.error = None
    if approval is not None:
        approval.status = "approved"
        approval.decided_at = now
        approval.decision_note = note
    await db.commit()
    await _emit(
        patch.run_id,
        "agent_patch_approved",
        {"run_id": patch.run_id, "patch_id": patch.id, "status": patch.status},
        db,
    )
    refreshed = await load_agent_patch(patch.id, db)
    assert refreshed is not None
    return refreshed


async def reject_agent_patch(patch: AgentPatch, db: AsyncSession, *, note: str | None = None) -> AgentPatch:
    if patch.status not in {"awaiting_approval", "validated", "approved"}:
        raise ValueError("当前 Patch 不可拒绝")
    approval = _latest_pending_approval(patch) or (patch.approvals[-1] if patch.approvals else None)
    now = datetime.now(UTC)
    patch.status = "rejected"
    patch.decided_at = now
    if approval is not None:
        approval.status = "rejected"
        approval.decided_at = now
        approval.decision_note = note
    run = await load_agent_run(patch.run_id, db)
    if run is not None and run.status == "awaiting_approval":
        run.status = "rejected"
        run.completed_at = now
        run.summary = run.summary or "方案已拒绝"
    await db.commit()
    await _emit(
        patch.run_id,
        "agent_patch_rejected",
        {"run_id": patch.run_id, "patch_id": patch.id, "status": patch.status, "note": note},
        db,
    )
    refreshed = await load_agent_patch(patch.id, db)
    assert refreshed is not None
    return refreshed


async def replan_agent_patch(
    patch: AgentPatch,
    db: AsyncSession,
    *,
    rejection_reason: str,
) -> AgentRun:
    if patch.status not in {"rejected", "failed"}:
        raise ValueError("仅已拒绝或已冲突的 Patch 可重新规划")
    run = await load_agent_run(patch.run_id, db)
    if run is None:
        raise ValueError("Agent run 不存在")
    factory = await load_full_snapshot(patch.factory_id, db)
    if factory is None:
        raise ValueError("工厂不存在")

    goal = compile_factory_goal(run.objective, factory, mode="plan_design")
    findings = list(_dict(run.result).get("findings") or [])
    package = build_patch_package(
        factory,
        findings,
        goal,
        run_id=run.id,
        rejected_operations=list(patch.operations),
    )
    if not package["operations"] or not package["validation"].get("ok"):
        raise ValueError("拒绝条件下未找到不同且合法的替代方案")

    revision = len(run.patches) + 1
    diff_summary = dict(package["diff_summary"])
    diff_summary.update(
        {
            "revision": revision,
            "replan_of": patch.id,
            "rejection_reason": rejection_reason.strip(),
        }
    )
    replacement = AgentPatch(
        run_id=run.id,
        factory_id=run.factory_id,
        owner_id=run.owner_id,
        base_version=str(package["base_version"]),
        status="awaiting_approval",
        risk_level=str(package["risk_level"]),
        idempotency_key=str(package["idempotency_key"]),
        operations=list(package["operations"]),
        inverse_operations=list(package["inverse_operations"]),
        preconditions=list(package["preconditions"]),
        impact=dict(package["impact"]),
        validation=dict(package["validation"]),
        diff_summary=diff_summary,
    )
    db.add(replacement)
    await db.flush()
    db.add(
        AgentApproval(
            patch_id=replacement.id,
            run_id=run.id,
            owner_id=run.owner_id,
            status="pending",
            summary=f"第 {revision} 版替代方案待审批",
            risk_level=replacement.risk_level,
        )
    )
    run.compiled_goal = goal
    run.base_factory_updated_at = factory.updated_at
    run.status = "awaiting_approval"
    run.completed_at = None
    run.error = None
    run.summary = f"第 {revision} 版替代方案待审批：{len(replacement.operations)} 项变更"
    await db.commit()
    await _emit(
        run.id,
        "agent_patch_replanned",
        {
            "run_id": run.id,
            "patch_id": replacement.id,
            "replan_of": patch.id,
            "revision": revision,
            "operation_count": len(replacement.operations),
        },
        db,
    )
    refreshed = await load_agent_run(run.id, db)
    assert refreshed is not None
    return refreshed


async def apply_agent_patch(patch: AgentPatch, db: AsyncSession) -> AgentPatch:
    if patch.status not in {"approved", "awaiting_approval", "validated"}:
        raise ValueError("当前 Patch 不可应用")
    if patch.status == "applied":
        raise ValueError("Patch 已应用")
    if not patch.validation or not patch.validation.get("ok"):
        raise ValueError("Patch 未通过校验")
    if not patch.operations:
        raise ValueError("Patch 没有可应用的操作")

    run = await load_agent_run(patch.run_id, db)
    if run is None:
        raise ValueError("Agent run 不存在")
    if run.status == "applying":
        raise ValueError("Patch 正在应用")

    factory = await load_full_snapshot(patch.factory_id, db)
    if factory is None:
        raise ValueError("工厂不存在")
    if not versions_match(factory, patch.base_version):
        patch.status = "failed"
        patch.error = "主工厂已变更，旧 Patch 已失效"
        await db.commit()
        await _emit(
            patch.run_id,
            "agent_patch_conflict",
            {
                "run_id": patch.run_id,
                "patch_id": patch.id,
                "base_version": patch.base_version,
                "current_version": version_token(factory),
            },
            db,
        )
        raise ValueError(patch.error)

    run.status = "applying"
    patch.status = "approved"
    await db.commit()

    try:
        baseline = design_from_factory(factory)
        candidate = apply_ops_in_memory(baseline, list(patch.operations))
        validation = validate_design(
            baseline,
            candidate,
            hard_constraints=_goal_hard_constraints(run.compiled_goal),
        )
        if not validation["ok"]:
            raise ValueError("；".join(str(item) for item in validation["errors"]) or "应用前校验失败")
        sync_payload = design_to_sync_request(candidate, factory.id)
        updated = await sync_factory_snapshot(factory, sync_payload, db)
        now = datetime.now(UTC)
        patch.status = "applied"
        patch.applied_at = now
        patch.applied_factory_updated_at = updated.updated_at
        patch.error = None
        patch.validation = validation
        patch.diff_summary = build_diff_summary(baseline, candidate, list(patch.operations))
        approval = _latest_pending_approval(patch)
        if approval is not None:
            approval.status = "approved"
            approval.decided_at = now
        run.status = "completed"
        run.completed_at = now
        run.summary = f"已应用 {len(patch.operations)} 项方案变更"
        await db.commit()
        await _emit(
            patch.run_id,
            "agent_patch_applied",
            {
                "run_id": patch.run_id,
                "patch_id": patch.id,
                "status": patch.status,
                "factory_version": version_token(updated),
            },
            db,
        )
    except Exception as exc:
        await db.rollback()
        failed_patch = await load_agent_patch(patch.id, db)
        failed_run = await load_agent_run(patch.run_id, db)
        if failed_patch is None or failed_run is None:
            raise
        failed_patch.status = "failed"
        failed_patch.error = str(exc)
        if failed_run.status == "applying":
            failed_run.status = "awaiting_approval"
        await db.commit()
        await _emit(
            failed_patch.run_id,
            "agent_patch_failed",
            {"run_id": failed_patch.run_id, "patch_id": failed_patch.id, "message": str(exc)},
            db,
        )
        raise

    refreshed = await load_agent_patch(patch.id, db)
    assert refreshed is not None
    return refreshed


async def rollback_agent_patch(patch: AgentPatch, db: AsyncSession) -> AgentPatch:
    if patch.status != "applied":
        raise ValueError("仅已应用的 Patch 可回滚")
    if not patch.inverse_operations:
        raise ValueError("缺少反向操作，无法回滚")

    factory = await load_full_snapshot(patch.factory_id, db)
    if factory is None:
        raise ValueError("工厂不存在")
    if patch.applied_factory_updated_at is not None and factory.updated_at != patch.applied_factory_updated_at:
        raise ValueError("主工厂已在应用后变更，无法安全回滚")

    run = await load_agent_run(patch.run_id, db)
    if run is None:
        raise ValueError("Agent run 不存在")

    baseline = design_from_factory(factory)
    candidate = apply_ops_in_memory(baseline, list(patch.inverse_operations))
    validation = validate_design(
        baseline,
        candidate,
        hard_constraints=_goal_hard_constraints(run.compiled_goal),
    )
    if not validation["ok"]:
        raise ValueError("；".join(str(item) for item in validation["errors"]) or "回滚校验失败")

    sync_payload = design_to_sync_request(candidate, factory.id)
    updated = await sync_factory_snapshot(factory, sync_payload, db)
    now = datetime.now(UTC)
    patch.status = "rolled_back"
    patch.applied_factory_updated_at = updated.updated_at
    patch.updated_at = now
    patch.error = None
    run.summary = f"已回滚 Patch {patch.id}"
    await db.commit()
    await _emit(
        patch.run_id,
        "agent_patch_rolled_back",
        {
            "run_id": patch.run_id,
            "patch_id": patch.id,
            "status": patch.status,
            "factory_version": version_token(updated),
        },
        db,
    )
    refreshed = await load_agent_patch(patch.id, db)
    assert refreshed is not None
    return refreshed


async def _complete_plan_design(
    run: AgentRun,
    factory: Factory,
    diagnosis: dict[str, Any],
    db: AsyncSession,
) -> None:
    await _set_step(run, "plan", "running", "根据诊断生成受控 Patch", db)
    goal = dict(run.compiled_goal or {})
    goal_status = str(goal.get("status") or "ready")
    if goal_status == "conflicting":
        run.status = "completed"
        run.completed_at = datetime.now(UTC)
        run.summary = "目标约束冲突，未生成方案"
        await _set_step(run, "plan", "completed", "目标冲突，跳过方案生成", db, commit=False)
        await db.commit()
        await _emit(run.id, "run_completed", {"run_id": run.id, "status": run.status, "result": run.result}, db)
        return

    package = build_patch_package(
        factory,
        list(diagnosis.get("findings") or []),
        goal,
        run_id=run.id,
    )
    if not package["operations"] or not package["validation"].get("ok"):
        warning = "；".join(package["validation"].get("warnings") or package["validation"].get("errors") or [])
        run.status = "completed"
        run.completed_at = datetime.now(UTC)
        run.summary = warning or "未找到可自动生成的合法方案"
        await _set_step(run, "plan", "completed", run.summary, db, commit=False)
        await db.commit()
        await _emit(run.id, "run_completed", {"run_id": run.id, "status": run.status, "result": run.result}, db)
        return

    patch = AgentPatch(
        run_id=run.id,
        factory_id=run.factory_id,
        owner_id=run.owner_id,
        base_version=str(package["base_version"]),
        status="awaiting_approval",
        risk_level=str(package["risk_level"]),
        idempotency_key=str(package["idempotency_key"]),
        operations=list(package["operations"]),
        inverse_operations=list(package["inverse_operations"]),
        preconditions=list(package["preconditions"]),
        impact=dict(package["impact"]),
        validation=dict(package["validation"]),
        diff_summary=dict(package["diff_summary"]),
    )
    db.add(patch)
    await db.flush()
    approval = AgentApproval(
        patch_id=patch.id,
        run_id=run.id,
        owner_id=run.owner_id,
        status="pending",
        summary=f"{len(patch.operations)} 项变更待审批",
        risk_level=patch.risk_level,
    )
    db.add(approval)
    run.status = "awaiting_approval"
    run.completed_at = None
    run.summary = f"方案待审批：{len(patch.operations)} 项变更"
    await _set_step(run, "plan", "completed", f"已生成并通过校验，共 {len(patch.operations)} 项操作", db, commit=False)
    await db.commit()
    await _emit(
        run.id,
        "agent_patch_ready",
        {
            "run_id": run.id,
            "patch_id": patch.id,
            "status": run.status,
            "operation_count": len(patch.operations),
            "risk_level": patch.risk_level,
            "diff_summary": patch.diff_summary,
        },
        db,
    )


def _latest_pending_approval(patch: AgentPatch) -> AgentApproval | None:
    for approval in reversed(list(patch.approvals or [])):
        if approval.status == "pending":
            return approval
    return None


async def _set_step(
    run: AgentRun,
    key: str,
    status: str,
    detail: str,
    db: AsyncSession,
    *,
    commit: bool = True,
) -> None:
    step = next(item for item in run.steps if item.key == key)
    now = datetime.now(UTC)
    step.status = status
    step.detail = detail
    run.updated_at = now
    if status == "running" and step.started_at is None:
        step.started_at = now
    if status in {"completed", "failed", "cancelled"}:
        step.completed_at = now
    if commit:
        await db.commit()
    await _emit(
        run.id,
        "run_progress",
        {"run_id": run.id, "step": key, "status": status, "message": detail},
        db,
    )


async def _record_tool(
    run: AgentRun,
    step_key: str,
    tool_name: str,
    input_data: dict[str, object],
    execute: Callable[[], dict[str, Any]],
    db: AsyncSession,
) -> dict[str, Any]:
    definition = TOOL_DEFINITION_BY_NAME.get(tool_name)
    if definition is None:
        raise RuntimeError(f"未注册的 Agent 工具 {tool_name}")
    retry_limit = min(run.tool_retry_limit, definition.retry_limit)
    last_error: Exception | None = None
    for attempt in range(1, retry_limit + 2):
        if run.tool_calls_used >= run.tool_call_budget:
            raise RuntimeError(f"工具调用预算已用完 {run.tool_calls_used}/{run.tool_call_budget}")
        try:
            return await _record_tool_attempt(
                run,
                step_key,
                tool_name,
                input_data,
                execute,
                db,
                attempt=attempt,
                timeout_seconds=min(definition.timeout_seconds, run.tool_timeout_ms / 1000),
            )
        except Exception as exc:
            last_error = exc
            if attempt > retry_limit:
                raise
            await _raise_if_cancelled(run, db)
    assert last_error is not None
    raise last_error


async def _record_tool_attempt(
    run: AgentRun,
    step_key: str,
    tool_name: str,
    input_data: dict[str, object],
    execute: Callable[[], dict[str, Any]],
    db: AsyncSession,
    *,
    attempt: int,
    timeout_seconds: float,
) -> dict[str, Any]:
    step = next(item for item in run.steps if item.key == step_key)
    call = AgentToolCall(
        run_id=run.id,
        step_id=step.id,
        tool_name=tool_name,
        status="running",
        attempt=attempt,
        input_data=input_data,
    )
    run.tool_calls_used += 1
    db.add(call)
    await db.flush()
    await db.commit()
    await _emit(
        run.id,
        "tool_started",
        {
            "run_id": run.id,
            "tool_call_id": call.id,
            "tool": tool_name,
            "attempt": attempt,
            "tool_calls_used": run.tool_calls_used,
            "tool_call_budget": run.tool_call_budget,
        },
        db,
    )
    started = perf_counter()
    try:
        output = await asyncio.wait_for(asyncio.to_thread(execute), timeout=timeout_seconds)
        call.output_data = output
        call.status = "completed"
        return output
    except TimeoutError as exc:
        call.status = "failed"
        call.error = f"工具执行超过 {timeout_seconds:g} 秒"
        raise RuntimeError(call.error) from exc
    except Exception as exc:
        call.status = "failed"
        call.error = str(exc)
        raise
    finally:
        call.duration_ms = max(0, round((perf_counter() - started) * 1000))
        call.completed_at = datetime.now(UTC)
        await db.commit()
        await _emit(
            run.id,
            "tool_completed" if call.status == "completed" else "tool_failed",
            {
                "run_id": run.id,
                "tool_call_id": call.id,
                "tool": tool_name,
                "status": call.status,
                "attempt": attempt,
                "duration_ms": call.duration_ms,
            },
            db,
        )


async def _publish_progress(run: AgentRun, step: str, message: str, db: AsyncSession) -> None:
    await _emit(
        run.id,
        "run_progress",
        {"run_id": run.id, "step": step, "status": run.status, "message": message},
        db,
    )


async def _emit(run_id: str, event: str, data: dict[str, Any], db: AsyncSession) -> None:
    await db.execute(select(AgentRun.id).where(AgentRun.id == run_id).with_for_update())
    sequence_result = await db.execute(
        select(func.coalesce(func.max(AgentRunEvent.sequence), 0)).where(AgentRunEvent.run_id == run_id)
    )
    sequence = int(sequence_result.scalar_one()) + 1
    db.add(AgentRunEvent(run_id=run_id, sequence=sequence, event_name=event, data=data))
    await db.commit()
    try:
        await publish_event(agent_channel(run_id), event, data)
    except Exception:
        logger.warning("Unable to publish Agent event %s for run %s", event, run_id, exc_info=True)


async def _raise_if_cancelled(run: AgentRun, db: AsyncSession) -> None:
    await db.refresh(run, attribute_names=["status"])
    if run.status == "cancelled":
        raise AgentRunCancelledError


def _factory_snapshot(factory: Factory) -> dict[str, Any]:
    counts = Counter(obj.kind for obj in factory.factory_objects)
    return {
        "factory_id": factory.id,
        "factory_name": factory.name,
        "factory_version": factory.updated_at.isoformat(),
        "dimensions_m": {"width": factory.width_m, "length": factory.length_m},
        "floor_count": len(factory.floors),
        "object_count": len(factory.factory_objects),
        "object_counts": dict(sorted(counts.items())),
        "item_count": len(factory.items),
        "recipe_count": len(factory.recipes),
        "enabled_recipe_count": sum(1 for recipe in factory.recipes if recipe.enabled),
        "inventory_record_count": len(factory.inventory),
        "simulation_status": factory.simulation.status if factory.simulation else "idle",
        "elapsed_sim_sec": factory.simulation.elapsed_sim_sec if factory.simulation else 0,
    }


def _simulation_metrics(factory: Factory) -> dict[str, Any]:
    samples = list(factory.metric_samples)[-20:]
    latest = samples[-1] if samples else None
    simulation = factory.simulation
    machine_runtime = _dict(simulation.machine_runtime if simulation else {})
    agv_runtime = _dict(simulation.agv_runtime if simulation else {})
    drone_runtime = _dict(simulation.drone_runtime if simulation else {})
    machine_by_id = {obj.id: obj for obj in factory.factory_objects if obj.kind == "machine"}
    machines: list[dict[str, Any]] = []
    for object_id, raw in machine_runtime.items():
        runtime = _dict(raw)
        machine_object = machine_by_id.get(object_id)
        busy = _number(runtime.get("busySeconds"))
        idle = _number(runtime.get("idleSeconds"))
        blocked = _number(runtime.get("blockedSeconds"))
        observed = busy + idle + blocked
        machines.append(
            {
                "object_id": object_id,
                "name": machine_object.name if machine_object else object_id,
                "state": str(runtime.get("state", "idle")),
                "utilization": busy / observed if observed else 0,
                "waiting_ratio": idle / observed if observed else 0,
                "blocked_ratio": blocked / observed if observed else 0,
                "processed_cycles": int(_number(runtime.get("processedCycles"))),
            }
        )
    return {
        "sample_count": len(samples),
        "elapsed_sim_sec": simulation.elapsed_sim_sec if simulation else 0,
        "latest_throughput_per_min": latest.throughput_per_min if latest else 0,
        "average_throughput_per_min": (
            sum(sample.throughput_per_min for sample in samples) / len(samples) if samples else 0
        ),
        "latest_work_in_progress": latest.work_in_progress if latest else 0,
        "finished_goods": latest.finished_goods if latest else 0,
        "total_finished": simulation.total_finished if simulation else 0,
        "transit_item_count": len(simulation.transit_items) if simulation else 0,
        "machines": machines,
        "agv": _vehicle_runtime_summary(agv_runtime),
        "drone": _vehicle_runtime_summary(drone_runtime),
    }


def _event_timeline(factory: Factory) -> dict[str, Any]:
    events = list(factory.activities)[-50:]
    return {
        "event_count": len(events),
        "events": [
            {
                "event_id": event.id,
                "elapsed_sim_sec": event.elapsed_sim_sec,
                "title": event.title,
                "description": event.description,
                "tone": event.tone,
                "object_id": event.object_id,
                "created_at": event.created_at.isoformat(),
            }
            for event in events
        ],
    }


def _machine_context(factory: Factory) -> dict[str, Any]:
    recipe_by_id = {recipe.id: recipe for recipe in factory.recipes}
    runtime_by_id = _dict(factory.simulation.machine_runtime if factory.simulation else {})
    machines: list[dict[str, Any]] = []
    for machine in sorted(
        (obj for obj in factory.factory_objects if obj.kind == "machine"), key=lambda value: value.id
    ):
        config = _dict(machine.config)
        recipe_id = config.get("recipeId") if isinstance(config.get("recipeId"), str) else None
        recipe = recipe_by_id.get(recipe_id) if recipe_id else None
        runtime = _dict(runtime_by_id.get(machine.id))
        machines.append(
            {
                "object_id": machine.id,
                "name": machine.name,
                "status": machine.status,
                "floor_id": machine.floor_id,
                "recipe_id": recipe_id,
                "recipe_name": recipe.name if recipe else None,
                "recipe_enabled": recipe.enabled if recipe else False,
                "speed_multiplier": _number(config.get("speedMultiplier")) or 1,
                "input_capacity": _number(config.get("inputCapacity")),
                "output_capacity": _number(config.get("outputCapacity")),
                "input_port_count": int(_number(config.get("inputPortCount"))),
                "output_port_count": int(_number(config.get("outputPortCount"))),
                "runtime_state": str(runtime.get("state", "idle")),
                "processed_cycles": int(_number(runtime.get("processedCycles"))),
            }
        )
    return {
        "machine_count": len(machines),
        "bound_machine_count": sum(1 for machine in machines if machine["recipe_id"] is not None),
        "machines": machines,
    }


def _recipe_chain_context(factory: Factory, graph: dict[str, Any]) -> dict[str, Any]:
    item_by_id = {item.id: item for item in factory.items}
    dependency_edges = [edge for edge in graph["edges"] if edge["edge_type"] == "recipe_dependency"]
    recipes = []
    for recipe in sorted(factory.recipes, key=lambda value: value.id):
        recipes.append(
            {
                "recipe_id": recipe.id,
                "name": recipe.name,
                "enabled": recipe.enabled,
                "processing_time_sec": recipe.processing_time_sec,
                "inputs": [_named_recipe_line(line, item_by_id) for line in recipe.inputs],
                "outputs": [_named_recipe_line(line, item_by_id) for line in recipe.outputs],
                "upstream_recipe_ids": sorted(
                    str(edge["source_id"]) for edge in dependency_edges if edge["target_id"] == recipe.id
                ),
                "downstream_recipe_ids": sorted(
                    str(edge["target_id"]) for edge in dependency_edges if edge["source_id"] == recipe.id
                ),
            }
        )
    return {
        "recipe_count": len(recipes),
        "enabled_recipe_count": sum(1 for recipe in recipes if recipe["enabled"]),
        "dependency_count": len(dependency_edges),
        "recipes": recipes,
    }


def _conveyor_context(factory: Factory) -> dict[str, Any]:
    conveyors: list[dict[str, Any]] = []
    for conveyor in sorted(
        (obj for obj in factory.factory_objects if obj.kind == "conveyor"), key=lambda value: value.id
    ):
        config = _dict(conveyor.config)
        path = [point for point in config.get("path", []) if isinstance(point, dict)]
        length_m = sum(
            hypot(_number(end.get("x")) - _number(start.get("x")), _number(end.get("z")) - _number(start.get("z")))
            for start, end in zip(path, path[1:], strict=False)
        )
        source_id = config.get("fromObjectId") if isinstance(config.get("fromObjectId"), str) else None
        target_id = config.get("toObjectId") if isinstance(config.get("toObjectId"), str) else None
        conveyors.append(
            {
                "object_id": conveyor.id,
                "name": conveyor.name,
                "floor_id": conveyor.floor_id,
                "conveyor_type": str(config.get("conveyorType", "flat")),
                "source_id": source_id,
                "target_id": target_id,
                "from_port": config.get("fromPortIndex"),
                "to_port": config.get("toPortIndex"),
                "speed_mps": _number(config.get("speedMps")),
                "capacity": int(_number(config.get("capacity"))),
                "length_m": round(length_m, 3),
                "connected": bool(source_id and target_id),
            }
        )
    return {
        "conveyor_count": len(conveyors),
        "connected_count": sum(1 for conveyor in conveyors if conveyor["connected"]),
        "total_length_m": round(sum(float(conveyor["length_m"]) for conveyor in conveyors), 3),
        "conveyors": conveyors,
    }


def _capacity_context(factory: Factory) -> dict[str, Any]:
    machines_by_recipe: dict[str, list[Any]] = {}
    for machine in (obj for obj in factory.factory_objects if obj.kind == "machine"):
        recipe_id = _dict(machine.config).get("recipeId")
        if isinstance(recipe_id, str):
            machines_by_recipe.setdefault(recipe_id, []).append(machine)

    recipes: list[dict[str, Any]] = []
    for recipe in sorted(factory.recipes, key=lambda value: value.id):
        machines = machines_by_recipe.get(recipe.id, [])
        cycles_per_min = sum(
            60 / recipe.processing_time_sec * (_number(_dict(machine.config).get("speedMultiplier")) or 1)
            for machine in machines
        )
        recipes.append(
            {
                "recipe_id": recipe.id,
                "recipe_name": recipe.name,
                "enabled": recipe.enabled,
                "machine_count": len(machines),
                "theoretical_cycles_per_min": round(cycles_per_min, 6),
                "outputs_per_min": [
                    {
                        "item_id": str(_dict(line).get("itemId", "")),
                        "quantity_per_min": round(cycles_per_min * _number(_dict(line).get("quantity")), 6),
                    }
                    for line in recipe.outputs
                ],
            }
        )
    return {
        "method": "recipe_cycle_upper_bound_v1",
        "assumptions": ["不计缺料、阻塞、物流等待和切换损失"],
        "recipes": recipes,
    }


def _inventory_context(factory: Factory) -> dict[str, Any]:
    item_by_id = {item.id: item for item in factory.items}
    totals: dict[str, int] = Counter()
    infinite_items: set[str] = set()
    invalid_reservations: list[dict[str, Any]] = []
    for record in factory.inventory:
        totals[record.item_id] += record.quantity
        if record.infinite_supply:
            infinite_items.add(record.item_id)
        if record.reserved_outbound_quantity > record.quantity and not record.infinite_supply:
            invalid_reservations.append(
                {
                    "record_id": record.id,
                    "item_id": record.item_id,
                    "quantity": record.quantity,
                    "reserved_outbound": record.reserved_outbound_quantity,
                }
            )

    required_item_ids = {
        str(line.get("itemId"))
        for recipe in factory.recipes
        if recipe.enabled
        for line in recipe.inputs
        if isinstance(line, dict) and line.get("itemId")
    }
    shortages = [
        {
            "item_id": item_id,
            "item_name": item_by_id[item_id].name if item_id in item_by_id else item_id,
            "quantity": totals.get(item_id, 0),
        }
        for item_id in sorted(required_item_ids)
        if totals.get(item_id, 0) <= 0 and item_id not in infinite_items
    ]
    return {
        "total_quantity": sum(totals.values()),
        "infinite_item_count": len(infinite_items),
        "shortages": shortages,
        "invalid_reservations": invalid_reservations,
        "items": [
            {
                "item_id": item_id,
                "item_name": item_by_id[item_id].name if item_id in item_by_id else item_id,
                "quantity": quantity,
                "infinite": item_id in infinite_items,
            }
            for item_id, quantity in sorted(totals.items())
        ],
    }


def _logistics_context(factory: Factory) -> dict[str, Any]:
    conveyors = [obj for obj in factory.factory_objects if obj.kind == "conveyor"]
    vehicles = [obj for obj in factory.factory_objects if obj.kind in {"agv", "drone"}]
    disconnected = []
    for conveyor in conveyors:
        config = _dict(conveyor.config)
        if not config.get("fromObjectId") or not config.get("toObjectId"):
            disconnected.append({"object_id": conveyor.id, "name": conveyor.name})
    unconfigured = []
    programs = []
    for vehicle in vehicles:
        config = _dict(vehicle.config)
        program = _dict(config.get("agvProgram") if vehicle.kind == "agv" else config.get("transportProgram"))
        if not program.get("enabled") or not all(
            program.get(key) for key in ("sourceObjectId", "destinationObjectId", "itemId")
        ):
            unconfigured.append({"object_id": vehicle.id, "name": vehicle.name, "kind": vehicle.kind})
        programs.append(
            {
                "object_id": vehicle.id,
                "name": vehicle.name,
                "kind": vehicle.kind,
                "enabled": bool(program.get("enabled")),
                "source_object_id": program.get("sourceObjectId"),
                "destination_object_id": program.get("destinationObjectId"),
                "item_id": program.get("itemId"),
                "load_quantity": int(_number(program.get("loadQuantity"))),
                "trigger_location": program.get("triggerLocation"),
                "trigger_comparator": program.get("triggerComparator"),
                "trigger_quantity": int(_number(program.get("triggerQuantity"))),
            }
        )
    return {
        "conveyor_count": len(conveyors),
        "disconnected_conveyors": disconnected,
        "vehicle_count": len(vehicles),
        "agv_count": sum(1 for vehicle in vehicles if vehicle.kind == "agv"),
        "drone_count": sum(1 for vehicle in vehicles if vehicle.kind == "drone"),
        "unconfigured_vehicles": unconfigured,
        "programs": programs,
    }


def _diagnose(
    factory: Factory,
    snapshot: dict[str, Any],
    graph: dict[str, Any],
    metrics: dict[str, Any],
    inventory: dict[str, Any],
    logistics: dict[str, Any],
) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    machines = [obj for obj in factory.factory_objects if obj.kind == "machine"]
    recipe_by_id = {recipe.id: recipe for recipe in factory.recipes}

    invalid_references = list(graph["invalid_references"])
    if invalid_references:
        affected_ids = sorted({str(reference["source_id"]) for reference in invalid_references})
        findings.append(
            _finding(
                "graph-invalid-references",
                "configuration",
                "critical",
                f"依赖图存在 {len(invalid_references)} 个无效引用",
                "配方、库存、输送或运输任务引用了当前版本中不存在的对象",
                [("无效引用", str(len(invalid_references)), None)],
                affected_ids,
                "修复悬空引用后重新运行分析",
            )
        )

    if not machines:
        findings.append(
            _finding(
                "production-empty",
                "configuration",
                "warning",
                "工厂尚未形成生产链",
                "当前版本没有可执行生产周期的机器",
                [("机器", "0", None), ("配方", str(snapshot["recipe_count"]), None)],
                [],
                "先创建物品与配方，再放置机器并绑定配方",
            )
        )
    else:
        unbound = [obj for obj in machines if not _dict(obj.config).get("recipeId")]
        if unbound:
            findings.append(
                _finding(
                    "machine-unbound",
                    "configuration",
                    "warning",
                    f"{len(unbound)} 台机器未绑定配方",
                    "未绑定配方的机器不会进入确定性生产周期",
                    [("未绑定机器", str(len(unbound)), None)],
                    [obj.id for obj in unbound],
                    "为这些机器选择有效配方后重新运行诊断",
                )
            )
        invalid = []
        for obj in machines:
            recipe_id = _dict(obj.config).get("recipeId")
            if not isinstance(recipe_id, str):
                continue
            recipe = recipe_by_id.get(recipe_id)
            if recipe is None or not recipe.enabled:
                invalid.append(obj)
        if invalid:
            findings.append(
                _finding(
                    "machine-invalid-recipe",
                    "configuration",
                    "critical",
                    f"{len(invalid)} 台机器引用无效配方",
                    "机器引用的配方不存在或已停用",
                    [("异常机器", str(len(invalid)), None)],
                    [obj.id for obj in invalid],
                    "恢复对应配方或重新绑定有效配方",
                )
            )

    if metrics["sample_count"] == 0 or metrics["elapsed_sim_sec"] < 60:
        findings.append(
            _finding(
                "evidence-window-short",
                "evidence",
                "info",
                "运行证据窗口不足",
                "当前数据适合检查配置，但不足以稳定判断产能趋势",
                [
                    ("仿真时长", f"{metrics['elapsed_sim_sec']:.0f} 秒", None),
                    ("指标样本", str(metrics["sample_count"]), None),
                ],
                [],
                "先运行至少 60 秒仿真，再比较吞吐与等待趋势",
            )
        )

    for machine in metrics["machines"]:
        object_id = str(machine["object_id"])
        if machine["blocked_ratio"] >= 0.2 or machine["state"] == "blocked":
            findings.append(
                _finding(
                    f"machine-blocked-{object_id}",
                    "production",
                    "critical",
                    f"{machine['name']} 输出阻塞",
                    "阻塞时间已成为当前设备周期的重要组成部分",
                    [("阻塞占比", _percent(machine["blocked_ratio"]), object_id)],
                    [object_id],
                    "检查输出带容量、下游端口和成品库存空间",
                )
            )
        elif machine["waiting_ratio"] >= 0.4 and metrics["elapsed_sim_sec"] >= 30:
            findings.append(
                _finding(
                    f"machine-waiting-{object_id}",
                    "production",
                    "warning",
                    f"{machine['name']} 长时间等待输入",
                    "设备空闲主要来自上游供料不足或物流等待",
                    [("等待占比", _percent(machine["waiting_ratio"]), object_id)],
                    [object_id],
                    "检查输入物料库存、上游机器和输送连接",
                )
            )
        elif machine["utilization"] >= 0.9 and machine["processed_cycles"] > 0:
            findings.append(
                _finding(
                    f"machine-capacity-{object_id}",
                    "production",
                    "warning",
                    f"{machine['name']} 接近满载",
                    "该设备可能限制进一步提升整线产能",
                    [("利用率", _percent(machine["utilization"]), object_id)],
                    [object_id],
                    "在分支中验证并行设备、节拍或缓存调整",
                )
            )

    shortages = list(inventory["shortages"])
    if shortages:
        names = "、".join(str(item["item_name"]) for item in shortages[:3])
        findings.append(
            _finding(
                "inventory-shortage",
                "inventory",
                "critical" if machines else "warning",
                f"{len(shortages)} 种配方输入没有可用库存",
                f"缺料涉及 {names}",
                [("缺料品类", str(len(shortages)), None)],
                [],
                "补充起始库存、启用明确无限供应或配置补料任务",
            )
        )
    invalid_reservations = list(inventory["invalid_reservations"])
    if invalid_reservations:
        findings.append(
            _finding(
                "inventory-reservation-invalid",
                "inventory",
                "critical",
                "出库预留超过实际库存",
                "库存预约状态与当前现货不一致",
                [("异常记录", str(len(invalid_reservations)), None)],
                [],
                "取消失效运输任务并重建库存预约",
            )
        )

    disconnected = list(logistics["disconnected_conveyors"])
    if disconnected:
        findings.append(
            _finding(
                "conveyor-disconnected",
                "logistics",
                "warning",
                f"{len(disconnected)} 条传送带没有完整连接",
                "这些传送带无法形成确定的起点到终点物流关系",
                [("未连接传送带", str(len(disconnected)), None)],
                [str(item["object_id"]) for item in disconnected],
                "连接有效输出端与输入端，或删除不再使用的线路",
            )
        )

    for vehicle_kind in ("agv", "drone"):
        vehicle_metrics = _dict(metrics[vehicle_kind])
        if _number(vehicle_metrics.get("blocked_ratio")) >= 0.2:
            label = "AGV" if vehicle_kind == "agv" else "无人机"
            findings.append(
                _finding(
                    f"{vehicle_kind}-blocked",
                    "logistics",
                    "critical",
                    f"{label} 阻塞占比过高",
                    "载具运行时间中存在持续的路径或装卸等待",
                    [("阻塞占比", _percent(_number(vehicle_metrics.get("blocked_ratio"))), None)],
                    [],
                    "检查共享装卸点、路径冲突和任务目标",
                )
            )

    if not findings:
        findings.append(
            _finding(
                "no-blocking-signal",
                "system",
                "success",
                "当前没有明确阻塞信号",
                "配置引用、库存和运行状态未出现高风险异常",
                [("已检查对象", str(snapshot["object_count"]), None)],
                [],
                "继续延长仿真时间并观察吞吐趋势",
            )
        )
    findings.sort(key=lambda item: {"critical": 0, "warning": 1, "info": 2, "success": 3}[str(item["severity"])])
    return {"findings": findings}


def _analysis_result(
    snapshot: dict[str, Any], graph: dict[str, Any], metrics: dict[str, Any], diagnosis: dict[str, Any]
) -> dict[str, Any]:
    findings = list(diagnosis["findings"])
    critical = sum(1 for item in findings if item["severity"] == "critical")
    warnings = sum(1 for item in findings if item["severity"] == "warning")
    if critical:
        headline = f"发现 {critical} 个高优先级问题"
    elif warnings:
        headline = f"发现 {warnings} 个需要处理的信号"
    else:
        headline = "当前没有明确阻塞信号"
    evidence_ready = metrics["sample_count"] > 0 and metrics["elapsed_sim_sec"] >= 60
    return {
        "headline": headline,
        "assessment": (
            f"已检查 {snapshot['object_count']} 个对象、{snapshot['recipe_count']} 个配方"
            f"和 {metrics['sample_count']} 个指标样本"
        ),
        "confidence": 0.92 if evidence_ready else 0.68,
        "snapshot": snapshot,
        "graph_summary": graph["summary"],
        "metrics": {
            "throughput_per_min": metrics["latest_throughput_per_min"],
            "work_in_progress": metrics["latest_work_in_progress"],
            "finished_goods": metrics["finished_goods"],
            "elapsed_sim_sec": metrics["elapsed_sim_sec"],
            "sample_count": metrics["sample_count"],
        },
        "findings": findings,
    }


def _vehicle_runtime_summary(runtime_by_id: dict[str, Any]) -> dict[str, Any]:
    moving = waiting = blocked = completed_trips = 0.0
    for raw in runtime_by_id.values():
        runtime = _dict(raw)
        moving += _number(runtime.get("movingSeconds"))
        waiting += _number(runtime.get("waitingSeconds"))
        blocked += _number(runtime.get("blockedSeconds"))
        completed_trips += _number(runtime.get("completedTrips"))
    observed = moving + waiting + blocked
    return {
        "vehicle_count": len(runtime_by_id),
        "completed_trips": int(completed_trips),
        "moving_ratio": moving / observed if observed else 0,
        "waiting_ratio": waiting / observed if observed else 0,
        "blocked_ratio": blocked / observed if observed else 0,
    }


def _finding(
    finding_id: str,
    category: str,
    severity: str,
    title: str,
    detail: str,
    evidence: list[tuple[str, str, str | None]],
    object_ids: list[str],
    recommendation: str,
) -> dict[str, Any]:
    return {
        "id": finding_id,
        "category": category,
        "severity": severity,
        "title": title,
        "detail": detail,
        "evidence": [
            {"label": label, "value": value, **({"object_id": object_id} if object_id else {})}
            for label, value, object_id in evidence
        ],
        "object_ids": object_ids,
        "recommendation": recommendation,
    }


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: object) -> float:
    return float(value) if isinstance(value, int | float) else 0.0


def _percent(value: object) -> str:
    return f"{_number(value) * 100:.0f}%"


def _named_recipe_line(value: object, item_by_id: dict[str, Any]) -> dict[str, Any]:
    line = _dict(value)
    item_id = str(line.get("itemId", ""))
    item = item_by_id.get(item_id)
    return {
        "item_id": item_id,
        "item_name": item.name if item else item_id,
        "quantity": _number(line.get("quantity")),
    }
