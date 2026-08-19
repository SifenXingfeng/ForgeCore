"""Create agent patch and approval tables.

Revision ID: d7e2b91c4a30
Revises: c5f4a81d7e2b
Create Date: 2026-08-19
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d7e2b91c4a30"
down_revision: Union[str, None] = "c5f4a81d7e2b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_patches",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("factory_id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("base_version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("risk_level", sa.String(length=16), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("operations", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("inverse_operations", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("preconditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("impact", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("validation", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("diff_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("applied_factory_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["factory_id"], ["factories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key", name="uq_agent_patch_idempotency_key"),
    )
    op.create_index(op.f("ix_agent_patches_factory_id"), "agent_patches", ["factory_id"], unique=False)
    op.create_index(op.f("ix_agent_patches_owner_id"), "agent_patches", ["owner_id"], unique=False)
    op.create_index(op.f("ix_agent_patches_run_id"), "agent_patches", ["run_id"], unique=False)
    op.create_index(op.f("ix_agent_patches_status"), "agent_patches", ["status"], unique=False)

    op.create_table(
        "agent_approvals",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("patch_id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("risk_level", sa.String(length=16), nullable=False),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["patch_id"], ["agent_patches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_agent_approvals_owner_id"), "agent_approvals", ["owner_id"], unique=False)
    op.create_index(op.f("ix_agent_approvals_patch_id"), "agent_approvals", ["patch_id"], unique=False)
    op.create_index(op.f("ix_agent_approvals_run_id"), "agent_approvals", ["run_id"], unique=False)
    op.create_index(op.f("ix_agent_approvals_status"), "agent_approvals", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_agent_approvals_status"), table_name="agent_approvals")
    op.drop_index(op.f("ix_agent_approvals_run_id"), table_name="agent_approvals")
    op.drop_index(op.f("ix_agent_approvals_patch_id"), table_name="agent_approvals")
    op.drop_index(op.f("ix_agent_approvals_owner_id"), table_name="agent_approvals")
    op.drop_table("agent_approvals")
    op.drop_index(op.f("ix_agent_patches_status"), table_name="agent_patches")
    op.drop_index(op.f("ix_agent_patches_run_id"), table_name="agent_patches")
    op.drop_index(op.f("ix_agent_patches_owner_id"), table_name="agent_patches")
    op.drop_index(op.f("ix_agent_patches_factory_id"), table_name="agent_patches")
    op.drop_table("agent_patches")
