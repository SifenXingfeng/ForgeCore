"""Factory service: CRUD, full-snapshot sync, ownership checks."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.factory import (
    ActivityEvent,
    Factory,
    FactoryObjectModel,
    Floor,
    InventoryRecord,
    Item,
    MetricSample,
    Recipe,
    SimulationStateModel,
)
from app.schemas.factory import FactoryCreate, FactorySyncRequest


async def get_factory_by_id(factory_id: str, db: AsyncSession) -> Factory | None:
    return await db.get(Factory, factory_id)


async def list_user_factories(user_id: str, db: AsyncSession) -> list[Factory]:
    result = await db.execute(select(Factory).where(Factory.owner_id == user_id).order_by(Factory.updated_at.desc()))
    return list(result.scalars().all())


async def create_factory(owner_id: str, payload: FactoryCreate, db: AsyncSession) -> Factory:
    factory = Factory(
        owner_id=owner_id,
        name=payload.name,
        width_m=payload.width_m,
        length_m=payload.length_m,
        grid_size_m=payload.grid_size_m,
        schema_version=4,
    )
    db.add(factory)
    await db.flush()
    # Create the default 1F floor.
    floor = Floor(
        factory_id=factory.id,
        level=1,
        name="1F 生产区",
        elevation_m=0,
        height_m=4.5,
    )
    db.add(floor)
    # Create an empty simulation state.
    sim = SimulationStateModel(factory_id=factory.id)
    db.add(sim)
    await db.commit()
    await db.refresh(factory)
    return factory


async def delete_factory(factory_id: str, db: AsyncSession) -> None:
    factory = await db.get(Factory, factory_id)
    if factory is not None:
        await db.delete(factory)
        await db.commit()


async def load_full_snapshot(factory_id: str, db: AsyncSession) -> Factory | None:
    """Eagerly load a factory with all related data for snapshot serialization."""
    result = await db.execute(
        select(Factory)
        .where(Factory.id == factory_id)
        .execution_options(populate_existing=True)
        .options(
            selectinload(Factory.floors),
            selectinload(Factory.factory_objects),
            selectinload(Factory.items),
            selectinload(Factory.recipes),
            selectinload(Factory.inventory),
            selectinload(Factory.simulation),
            selectinload(Factory.metric_samples),
            selectinload(Factory.activities),
        )
    )
    return result.scalar_one_or_none()


async def sync_factory_snapshot(factory: Factory, payload: FactorySyncRequest, db: AsyncSession) -> Factory:
    """Full-snapshot overwrite: replaces all child rows, then commits.

    This mirrors the frontend's existing localStorage save semantics where the
    entire ForgeProjectData is serialized atomically. Returns the factory with
    all relationships eagerly loaded so the caller can serialize it directly.
    """
    # Explicitly query simulation state without touching the lazy relationship
    # attribute on the factory object (which would trigger async IO outside a
    # greenlet context in some code paths).
    existing_sim_result = await db.execute(
        select(SimulationStateModel).where(SimulationStateModel.factory_id == factory.id)
    )
    sim_row = existing_sim_result.scalar_one_or_none()

    # Update factory basics.
    factory.name = payload.name
    factory.width_m = payload.width_m
    factory.length_m = payload.length_m
    factory.grid_size_m = payload.grid_size_m
    factory.schema_version = payload.schema_version
    factory.updated_at = datetime.now(UTC)

    # Delete dependents before their referenced design rows, then reinsert in
    # dependency order. IDs come from the browser snapshot so links stay stable.
    for model_cls in (ActivityEvent, MetricSample, InventoryRecord, Recipe, Item, FactoryObjectModel, Floor):
        await db.execute(delete(model_cls).where(model_cls.factory_id == factory.id))
    await db.flush()

    for floor_row in payload.floors:
        db.add(Floor(factory_id=factory.id, **floor_row.model_dump(exclude={"factory_id"})))
    for object_row in payload.objects:
        db.add(FactoryObjectModel(factory_id=factory.id, **object_row.model_dump(exclude={"factory_id"})))
    for item_row in payload.items:
        db.add(Item(factory_id=factory.id, **item_row.model_dump(exclude={"factory_id"})))
    for recipe_row in payload.recipes:
        db.add(Recipe(factory_id=factory.id, **recipe_row.model_dump(exclude={"factory_id"})))
    for inventory_row in payload.inventory:
        db.add(InventoryRecord(factory_id=factory.id, **inventory_row.model_dump(exclude={"factory_id"})))
    for metric_row in payload.metrics:
        db.add(MetricSample(factory_id=factory.id, **metric_row.model_dump()))
    for activity_row in payload.activities:
        activity_data = activity_row.model_dump(exclude_none=True)
        db.add(ActivityEvent(factory_id=factory.id, **activity_data))

    # Upsert simulation state using the explicitly queried row.
    sim_fields = payload.simulation.model_dump()
    if sim_row is None:
        sim = SimulationStateModel(factory_id=factory.id, **sim_fields)
        db.add(sim)
    else:
        for k, v in sim_fields.items():
            setattr(sim_row, k, v)

    await db.commit()

    # Reload with all relationships eagerly loaded so the caller can serialize
    # without triggering lazy loads outside an async context.
    full = await load_full_snapshot(factory.id, db)
    assert full is not None
    return full
