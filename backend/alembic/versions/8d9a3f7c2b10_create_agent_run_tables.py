"""Create durable Agent run, step, and tool-call tables.

Revision ID: 8d9a3f7c2b10
Revises: be0d5f18f01b
Create Date: 2026-08-18
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "8d9a3f7c2b10"
down_revision: Union[str, None] = "be0d5f18f01b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("factory_id", sa.String(length=64), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("llm_configured", sa.Boolean(), nullable=False),
        sa.Column("base_factory_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["factory_id"], ["factories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_runs_factory_id"), "agent_runs", ["factory_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_owner_id"), "agent_runs", ["owner_id"], unique=False)
    op.create_index(op.f("ix_agent_runs_status"), "agent_runs", ["status"], unique=False)

    op.create_table(
        "agent_steps",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "key", name="uq_agent_step_run_key"),
        sa.UniqueConstraint("run_id", "position", name="uq_agent_step_run_position"),
    )
    op.create_index(op.f("ix_agent_steps_run_id"), "agent_steps", ["run_id"], unique=False)

    op.create_table(
        "agent_tool_calls",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("step_id", sa.String(length=64), nullable=True),
        sa.Column("tool_name", sa.String(length=96), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("input_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("output_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["agent_steps.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_tool_calls_run_id"), "agent_tool_calls", ["run_id"], unique=False)
    op.create_index(op.f("ix_agent_tool_calls_step_id"), "agent_tool_calls", ["step_id"], unique=False)
    op.create_index(op.f("ix_agent_tool_calls_tool_name"), "agent_tool_calls", ["tool_name"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_tool_calls_tool_name"), table_name="agent_tool_calls")
    op.drop_index(op.f("ix_agent_tool_calls_step_id"), table_name="agent_tool_calls")
    op.drop_index(op.f("ix_agent_tool_calls_run_id"), table_name="agent_tool_calls")
    op.drop_table("agent_tool_calls")
    op.drop_index(op.f("ix_agent_steps_run_id"), table_name="agent_steps")
    op.drop_table("agent_steps")
    op.drop_index(op.f("ix_agent_runs_status"), table_name="agent_runs")
    op.drop_index(op.f("ix_agent_runs_owner_id"), table_name="agent_runs")
    op.drop_index(op.f("ix_agent_runs_factory_id"), table_name="agent_runs")
    op.drop_table("agent_runs")
