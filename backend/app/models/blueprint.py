"""Blueprint ORM model - factory snapshots for sharing and forking."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Blueprint(Base):
    __tablename__ = "blueprints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fork_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    star_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    forks: Mapped[list[BlueprintFork]] = relationship(back_populates="blueprint", cascade="all, delete-orphan")
    stars: Mapped[list[BlueprintStar]] = relationship(back_populates="blueprint", cascade="all, delete-orphan")


class BlueprintFork(Base):
    __tablename__ = "blueprint_forks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    blueprint_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("blueprints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    blueprint: Mapped[Blueprint] = relationship(back_populates="forks")


class BlueprintStar(Base):
    __tablename__ = "blueprint_stars"
    __table_args__ = (UniqueConstraint("blueprint_id", "owner_id", name="uq_blueprint_star_owner"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    blueprint_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("blueprints.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    blueprint: Mapped[Blueprint] = relationship(back_populates="stars")
