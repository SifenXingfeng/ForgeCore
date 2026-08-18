"""Pydantic schemas for factory, objects, items, recipes, inventory, simulation."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

# ── Factory ─────────────────────────────────────────────────


class FactoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    width_m: float = Field(32, gt=0, le=500)
    length_m: float = Field(20, gt=0, le=500)
    grid_size_m: float = Field(1, gt=0, le=5)


class FactoryBrief(BaseModel):
    id: str
    name: str
    width_m: float
    length_m: float
    grid_size_m: float
    schema_version: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FactoryFull(FactoryBrief):
    owner_id: str


# ── Floor ───────────────────────────────────────────────────


class FloorSchema(BaseModel):
    id: str
    factory_id: str
    level: int
    name: str
    elevation_m: float
    height_m: float

    model_config = {"from_attributes": True}


class FloorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    height_m: float = Field(4.5, ge=2.5, le=12)


# ── FactoryObject ───────────────────────────────────────────


class FactoryObjectSchema(BaseModel):
    id: str
    factory_id: str
    floor_id: str
    kind: str
    name: str
    model_ref: str | None = None
    transform_x: float
    transform_z: float
    transform_rotation_y: int
    footprint_width: float
    footprint_depth: float
    status: str
    config: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FactoryObjectCreate(BaseModel):
    floor_id: str
    kind: str = Field(..., max_length=32)
    name: str = Field(..., max_length=128)
    model_ref: str | None = None
    transform_x: float
    transform_z: float
    transform_rotation_y: int = Field(0, ge=0, le=270)
    footprint_width: float = Field(1, gt=0)
    footprint_depth: float = Field(1, gt=0)
    status: str = "idle"
    config: dict[str, Any] = Field(default_factory=dict)


class FactoryObjectUpdate(BaseModel):
    floor_id: str | None = None
    name: str | None = Field(None, max_length=128)
    model_ref: str | None = None
    transform_x: float | None = None
    transform_z: float | None = None
    transform_rotation_y: int | None = Field(None, ge=0, le=270)
    footprint_width: float | None = Field(None, gt=0)
    footprint_depth: float | None = Field(None, gt=0)
    status: str | None = None
    config: dict[str, Any] | None = None


# ── Item ────────────────────────────────────────────────────


class ItemSchema(BaseModel):
    id: str
    factory_id: str
    code: str
    name: str
    category: str
    description: str
    item_model_id: str
    model_parameters: dict[str, Any]
    icon: str | None = None
    mass_kg: float
    max_stack_size: int

    model_config = {"from_attributes": True}


class ItemCreate(BaseModel):
    code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=128)
    category: str = Field(..., max_length=32)
    description: str = ""
    item_model_id: str = Field(..., max_length=128)
    model_parameters: dict[str, Any] = Field(default_factory=dict)
    icon: str | None = None
    mass_kg: float = Field(1, gt=0)
    max_stack_size: int = Field(1, ge=1)


class ItemUpdate(BaseModel):
    code: str | None = Field(None, max_length=64)
    name: str | None = Field(None, max_length=128)
    category: str | None = Field(None, max_length=32)
    description: str | None = None
    item_model_id: str | None = Field(None, max_length=128)
    model_parameters: dict[str, Any] | None = None
    icon: str | None = None
    mass_kg: float | None = Field(None, gt=0)
    max_stack_size: int | None = Field(None, ge=1)


# ── Recipe ──────────────────────────────────────────────────


class RecipeSchema(BaseModel):
    id: str
    factory_id: str
    code: str
    name: str
    description: str
    inputs: list[dict[str, Any]]
    outputs: list[dict[str, Any]]
    processing_time_sec: float
    enabled: bool

    model_config = {"from_attributes": True}


class RecipeCreate(BaseModel):
    code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=128)
    description: str = ""
    inputs: list[dict[str, Any]] = Field(default_factory=list, max_length=3)
    outputs: list[dict[str, Any]] = Field(default_factory=list, max_length=3)
    processing_time_sec: float = Field(10, gt=0)
    enabled: bool = True


class RecipeUpdate(BaseModel):
    code: str | None = Field(None, max_length=64)
    name: str | None = Field(None, max_length=128)
    description: str | None = None
    inputs: list[dict[str, Any]] | None = Field(None, max_length=3)
    outputs: list[dict[str, Any]] | None = Field(None, max_length=3)
    processing_time_sec: float | None = Field(None, gt=0)
    enabled: bool | None = None


# ── Inventory ──────────────────────────────────────────────


class InventorySchema(BaseModel):
    id: str
    factory_id: str
    location_type: str
    location_id: str
    item_id: str
    quantity: int
    initial_quantity: int
    capacity: int
    reserved_outbound_quantity: int
    reserved_inbound_capacity: int
    infinite_supply: bool

    model_config = {"from_attributes": True}


class InventoryAdjust(BaseModel):
    quantity_delta: int
    infinite_supply: bool | None = None


# ── Simulation ─────────────────────────────────────────────


class SimulationSchema(BaseModel):
    factory_id: str
    status: str
    speed: int
    elapsed_sim_sec: float
    tick_count: int
    seed: int
    accumulated_unstepped_sec: float
    machine_runtime: dict[str, Any]
    agv_runtime: dict[str, Any]
    drone_runtime: dict[str, Any]
    transit_items: list[dict[str, Any]]
    warehouse_dispatch_cooldown_sec_by_port: dict[str, Any]
    source_feed_cooldown_sec: float
    next_transit_sequence: int
    next_metric_sample_at_sec: float
    production_events_sec: list[float]
    completed_transport_durations_sec: list[float]
    total_finished: int

    model_config = {"from_attributes": True}


class SimulationUpsert(BaseModel):
    status: str = "idle"
    speed: int = 1
    elapsed_sim_sec: float = 0
    tick_count: int = 0
    seed: int = 41731
    accumulated_unstepped_sec: float = 0
    machine_runtime: dict[str, Any] = Field(default_factory=dict)
    agv_runtime: dict[str, Any] = Field(default_factory=dict)
    drone_runtime: dict[str, Any] = Field(default_factory=dict)
    transit_items: list[dict[str, Any]] = Field(default_factory=list)
    warehouse_dispatch_cooldown_sec_by_port: dict[str, Any] = Field(default_factory=dict)
    source_feed_cooldown_sec: float = 0
    next_transit_sequence: int = 1
    next_metric_sample_at_sec: float = 1
    production_events_sec: list[float] = Field(default_factory=list)
    completed_transport_durations_sec: list[float] = Field(default_factory=list)
    total_finished: int = 0


class MetricCreate(BaseModel):
    elapsed_sim_sec: float = Field(ge=0)
    throughput_per_min: float = Field(default=0, ge=0)
    work_in_progress: int = Field(default=0, ge=0)
    finished_goods: int = Field(default=0, ge=0)
    machine_a_utilization: float = Field(default=0, ge=0, le=1)
    machine_b_utilization: float = Field(default=0, ge=0, le=1)


class MetricSchema(MetricCreate):
    id: str
    factory_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ActivityCreate(BaseModel):
    id: str | None = None
    elapsed_sim_sec: float = Field(ge=0)
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    tone: str = Field(default="neutral", pattern="^(neutral|success|warning|info|error)$")
    object_id: str | None = None


class ActivitySchema(ActivityCreate):
    id: str
    factory_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Full factory snapshot (sync endpoint) ──────────────────


class FactorySnapshot(BaseModel):
    """Full project data for save/restore sync, matching TS ForgeProjectData."""

    factory: FactoryFull
    floors: list[FloorSchema]
    objects: list[FactoryObjectSchema]
    items: list[ItemSchema]
    recipes: list[RecipeSchema]
    inventory: list[InventorySchema]
    simulation: SimulationSchema
    metrics: list[MetricSchema]
    activities: list[ActivitySchema]


class FloorPayload(BaseModel):
    id: str
    factory_id: str | None = None
    level: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=64)
    elevation_m: float = Field(ge=0)
    height_m: float = Field(ge=2.5, le=12)


class FactoryObjectPayload(BaseModel):
    id: str
    factory_id: str | None = None
    floor_id: str
    kind: str = Field(pattern="^(machine|conveyor|rack|shelf|buffer|agv|drone)$")
    name: str = Field(min_length=1, max_length=128)
    model_ref: str | None = None
    transform_x: float
    transform_z: float
    transform_rotation_y: int
    footprint_width: float = Field(gt=0)
    footprint_depth: float = Field(gt=0)
    status: str = Field(max_length=32)
    config: dict[str, Any]

    @field_validator("transform_rotation_y")
    @classmethod
    def validate_quarter_turn(cls, value: int) -> int:
        if value not in (0, 90, 180, 270):
            raise ValueError("rotation must be 0, 90, 180, or 270")
        return value


class ItemPayload(BaseModel):
    id: str
    factory_id: str | None = None
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    category: str = Field(pattern="^(raw-material|work-in-progress|finished-good)$")
    description: str = ""
    item_model_id: str = Field(min_length=1, max_length=128)
    model_parameters: dict[str, Any] = Field(default_factory=dict)
    icon: str | None = None
    mass_kg: float = Field(ge=0)
    max_stack_size: int = Field(ge=1)


class RecipePayload(BaseModel):
    id: str
    factory_id: str | None = None
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
    inputs: list[dict[str, Any]] = Field(min_length=1, max_length=3)
    outputs: list[dict[str, Any]] = Field(min_length=1, max_length=3)
    processing_time_sec: float = Field(gt=0)
    enabled: bool = True


class InventoryPayload(BaseModel):
    id: str
    factory_id: str | None = None
    location_type: str = Field(pattern="^(rack-slot|finished-goods)$")
    location_id: str
    item_id: str
    quantity: int = Field(ge=0)
    initial_quantity: int = Field(ge=0)
    capacity: int = Field(ge=0)
    reserved_outbound_quantity: int = Field(default=0, ge=0)
    reserved_inbound_capacity: int = Field(default=0, ge=0)
    infinite_supply: bool = False


class FactorySyncRequest(BaseModel):
    """Full-snapshot sync payload from the frontend store."""

    name: str = Field(min_length=1, max_length=128)
    width_m: float = Field(gt=0, le=500)
    length_m: float = Field(gt=0, le=500)
    grid_size_m: float = Field(gt=0, le=5)
    schema_version: int = Field(default=4, ge=1)
    floors: list[FloorPayload] = Field(min_length=1)
    objects: list[FactoryObjectPayload]
    items: list[ItemPayload]
    recipes: list[RecipePayload]
    inventory: list[InventoryPayload]
    simulation: SimulationUpsert
    metrics: list[MetricCreate] = Field(default_factory=list, max_length=5000)
    activities: list[ActivityCreate] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def validate_snapshot_references(self) -> FactorySyncRequest:
        collections = (self.floors, self.objects, self.items, self.recipes, self.inventory)
        for rows in collections:
            ids = [row.id for row in rows]
            if len(ids) != len(set(ids)):
                raise ValueError("snapshot child ids must be unique within each collection")

        floor_ids = {floor.id for floor in self.floors}
        if any(obj.floor_id not in floor_ids for obj in self.objects):
            raise ValueError("every object must reference a floor in the snapshot")

        item_ids = {item.id for item in self.items}
        if any(record.item_id not in item_ids for record in self.inventory):
            raise ValueError("every inventory record must reference an item in the snapshot")

        return self
