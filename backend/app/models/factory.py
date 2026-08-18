"""Factory ORM models - factory, floors, items, recipes."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Factory(Base):
    __tablename__ = "factories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    width_m: Mapped[float] = mapped_column(Float, nullable=False, default=32)
    length_m: Mapped[float] = mapped_column(Float, nullable=False, default=20)
    grid_size_m: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    floors: Mapped[list[Floor]] = relationship(back_populates="factory", cascade="all, delete-orphan")
    factory_objects: Mapped[list[FactoryObjectModel]] = relationship(
        back_populates="factory", cascade="all, delete-orphan"
    )
    items: Mapped[list[Item]] = relationship(back_populates="factory", cascade="all, delete-orphan")
    recipes: Mapped[list[Recipe]] = relationship(back_populates="factory", cascade="all, delete-orphan")
    inventory: Mapped[list[InventoryRecord]] = relationship(back_populates="factory", cascade="all, delete-orphan")
    simulation: Mapped[SimulationStateModel | None] = relationship(
        back_populates="factory", cascade="all, delete-orphan", uselist=False
    )
    metric_samples: Mapped[list[MetricSample]] = relationship(
        back_populates="factory",
        cascade="all, delete-orphan",
        order_by="MetricSample.elapsed_sim_sec",
    )
    activities: Mapped[list[ActivityEvent]] = relationship(
        back_populates="factory",
        cascade="all, delete-orphan",
        order_by="ActivityEvent.elapsed_sim_sec",
    )


class Floor(Base):
    __tablename__ = "floors"
    __table_args__ = (UniqueConstraint("factory_id", "level", name="uq_floor_factory_level"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    elevation_m: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    height_m: Mapped[float] = mapped_column(Float, nullable=False, default=4.5)

    factory: Mapped[Factory] = relationship(back_populates="floors")


class FactoryObjectModel(Base):
    __tablename__ = "factory_objects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    floor_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    model_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    transform_x: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    transform_z: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    transform_rotation_y: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    footprint_width: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    footprint_depth: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="idle")
    config: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    factory: Mapped[Factory] = relationship(back_populates="factory_objects")


class Item(Base):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("factory_id", "code", name="uq_item_factory_code"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    item_model_id: Mapped[str] = mapped_column(String(128), nullable=False)
    model_parameters: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    mass_kg: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    max_stack_size: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    factory: Mapped[Factory] = relationship(back_populates="items")


class Recipe(Base):
    __tablename__ = "recipes"
    __table_args__ = (UniqueConstraint("factory_id", "code", name="uq_recipe_factory_code"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    inputs: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    outputs: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    processing_time_sec: Mapped[float] = mapped_column(Float, nullable=False, default=10)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    factory: Mapped[Factory] = relationship(back_populates="recipes")


class InventoryRecord(Base):
    __tablename__ = "inventory_records"
    __table_args__ = (
        UniqueConstraint("factory_id", "location_id", "item_id", name="uq_inventory_factory_location_item"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_type: Mapped[str] = mapped_column(String(32), nullable=False)
    location_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    initial_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_outbound_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_inbound_capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    infinite_supply: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    factory: Mapped[Factory] = relationship(back_populates="inventory")


class SimulationStateModel(Base):
    __tablename__ = "simulation_states"

    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="idle")
    speed: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    elapsed_sim_sec: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    tick_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=41731)
    accumulated_unstepped_sec: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    machine_runtime: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    agv_runtime: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    drone_runtime: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    transit_items: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    warehouse_dispatch_cooldown_sec_by_port: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    source_feed_cooldown_sec: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    next_transit_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    next_metric_sample_at_sec: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    production_events_sec: Mapped[list[float]] = mapped_column(JSONB, nullable=False, default=list)
    completed_transport_durations_sec: Mapped[list[float]] = mapped_column(JSONB, nullable=False, default=list)
    total_finished: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    factory: Mapped[Factory] = relationship(back_populates="simulation")


class MetricSample(Base):
    __tablename__ = "metric_samples"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elapsed_sim_sec: Mapped[float] = mapped_column(Float, nullable=False)
    throughput_per_min: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    work_in_progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    finished_goods: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    machine_a_utilization: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    machine_b_utilization: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    factory: Mapped[Factory] = relationship(back_populates="metric_samples")


class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    factory_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("factories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elapsed_sim_sec: Mapped[float] = mapped_column(Float, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tone: Mapped[str] = mapped_column(String(16), nullable=False, default="neutral")
    object_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    factory: Mapped[Factory] = relationship(back_populates="activities")
