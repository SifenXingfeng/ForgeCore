"""Durable Agent run, step, and tool-call records."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.factory import Factory
    from app.models.user import User


def _uuid() -> str:
    return str(uuid.uuid4())


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"run-{_uuid()}")
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="read_only")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="created", index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, default="deterministic")
    llm_configured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    base_factory_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    compiled_goal: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    tool_call_budget: Mapped[int] = mapped_column(Integer, nullable=False, default=24)
    tool_timeout_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=5000)
    tool_retry_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    tool_calls_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    result: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped[User] = relationship()
    factory: Mapped[Factory] = relationship()
    steps: Mapped[list[AgentStep]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentStep.position"
    )
    tool_calls: Mapped[list[AgentToolCall]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentToolCall.created_at"
    )
    events: Mapped[list[AgentRunEvent]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentRunEvent.sequence"
    )
    patches: Mapped[list[AgentPatch]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentPatch.created_at"
    )
    approvals: Mapped[list[AgentApproval]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentApproval.created_at"
    )


class AgentRunEvent(Base):
    __tablename__ = "agent_run_events"
    __table_args__ = (UniqueConstraint("run_id", "sequence", name="uq_agent_run_event_run_sequence"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"event-{_uuid()}")
    run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    data: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    run: Mapped[AgentRun] = relationship(back_populates="events")


class AgentStep(Base):
    __tablename__ = "agent_steps"
    __table_args__ = (
        UniqueConstraint("run_id", "position", name="uq_agent_step_run_position"),
        UniqueConstraint("run_id", "key", name="uq_agent_step_run_key"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"step-{_uuid()}")
    run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[AgentRun] = relationship(back_populates="steps")
    tool_calls: Mapped[list[AgentToolCall]] = relationship(back_populates="step")


class AgentToolCall(Base):
    __tablename__ = "agent_tool_calls"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"tool-{_uuid()}")
    run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("agent_steps.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tool_name: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="running")
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    input_data: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    output_data: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[AgentRun] = relationship(back_populates="tool_calls")
    step: Mapped[AgentStep | None] = relationship(back_populates="tool_calls")


class AgentPatch(Base):
    __tablename__ = "agent_patches"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_agent_patch_idempotency_key"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"patch-{_uuid()}")
    run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    base_version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="proposed", index=True)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="low")
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    operations: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    inverse_operations: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    preconditions: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    impact: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    validation: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    diff_summary: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    applied_factory_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[AgentRun] = relationship(back_populates="patches")
    factory: Mapped[Factory] = relationship()
    owner: Mapped[User] = relationship()
    approvals: Mapped[list[AgentApproval]] = relationship(
        back_populates="patch", cascade="all, delete-orphan", order_by="AgentApproval.created_at"
    )


class AgentApproval(Base):
    __tablename__ = "agent_approvals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"approval-{_uuid()}")
    patch_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_patches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", index=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="low")
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    patch: Mapped[AgentPatch] = relationship(back_populates="approvals")
    run: Mapped[AgentRun] = relationship(back_populates="approvals")
    owner: Mapped[User] = relationship()
