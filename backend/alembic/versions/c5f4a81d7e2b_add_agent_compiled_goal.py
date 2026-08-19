"""Add FactoryGoal, execution controls, attempts, and durable run events.

Revision ID: c5f4a81d7e2b
Revises: 8d9a3f7c2b10
Create Date: 2026-08-18
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c5f4a81d7e2b"
down_revision: Union[str, None] = "8d9a3f7c2b10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column(
            "compiled_goal",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.alter_column("agent_runs", "compiled_goal", server_default=None)
    op.add_column(
        "agent_runs",
        sa.Column("tool_call_budget", sa.Integer(), server_default=sa.text("24"), nullable=False),
    )
    op.add_column(
        "agent_runs",
        sa.Column("tool_timeout_ms", sa.Integer(), server_default=sa.text("5000"), nullable=False),
    )
    op.add_column(
        "agent_runs",
        sa.Column("tool_retry_limit", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column(
        "agent_runs",
        sa.Column("tool_calls_used", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    for column_name in ("tool_call_budget", "tool_timeout_ms", "tool_retry_limit", "tool_calls_used"):
        op.alter_column("agent_runs", column_name, server_default=None)

    op.add_column(
        "agent_tool_calls",
        sa.Column("attempt", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.alter_column("agent_tool_calls", "attempt", server_default=None)

    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_name", sa.String(length=64), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_agent_run_event_run_sequence"),
    )
    op.create_index(op.f("ix_agent_run_events_event_name"), "agent_run_events", ["event_name"], unique=False)
    op.create_index(op.f("ix_agent_run_events_run_id"), "agent_run_events", ["run_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_run_events_run_id"), table_name="agent_run_events")
    op.drop_index(op.f("ix_agent_run_events_event_name"), table_name="agent_run_events")
    op.drop_table("agent_run_events")
    op.drop_column("agent_tool_calls", "attempt")
    op.drop_column("agent_runs", "tool_calls_used")
    op.drop_column("agent_runs", "tool_retry_limit")
    op.drop_column("agent_runs", "tool_timeout_ms")
    op.drop_column("agent_runs", "tool_call_budget")
    op.drop_column("agent_runs", "compiled_goal")
