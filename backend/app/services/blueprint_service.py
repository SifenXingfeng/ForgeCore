"""Blueprint persistence, publication, import/export, starring, and forking."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import new_id
from app.models.blueprint import Blueprint, BlueprintFork, BlueprintStar
from app.models.factory import Factory
from app.schemas.blueprint import (
    BlueprintCreate,
    BlueprintDesignSnapshot,
    BlueprintExport,
    BlueprintExportData,
    BlueprintFactoryData,
    BlueprintForkRequest,
    BlueprintImportRequest,
    BlueprintUpdate,
)
from app.schemas.factory import (
    FactoryCreate,
    FactoryObjectPayload,
    FactorySyncRequest,
    FloorPayload,
    InventoryPayload,
    ItemPayload,
    RecipePayload,
    SimulationUpsert,
)
from app.services.factory_service import create_factory, load_full_snapshot, sync_factory_snapshot


async def create_blueprint(owner_id: str, payload: BlueprintCreate, db: AsyncSession) -> Blueprint:
    factory = await load_full_snapshot(payload.factory_id, db)
    if factory is None:
        raise LookupError("工厂不存在。")
    if factory.owner_id != owner_id:
        raise PermissionError("无权从该工厂创建蓝图。")
    blueprint = Blueprint(
        owner_id=owner_id,
        name=payload.name.strip(),
        description=payload.description.strip(),
        tags=payload.tags,
        is_public=payload.is_public,
        snapshot=design_snapshot_from_factory(factory).model_dump(mode="json"),
    )
    db.add(blueprint)
    await db.commit()
    await db.refresh(blueprint)
    return blueprint


def design_snapshot_from_factory(factory: Factory) -> BlueprintDesignSnapshot:
    inventory = []
    for row in factory.inventory:
        inventory.append(
            InventoryPayload(
                id=row.id,
                location_type=row.location_type,
                location_id=row.location_id,
                item_id=row.item_id,
                quantity=row.quantity,
                initial_quantity=row.initial_quantity,
                capacity=row.capacity,
                reserved_outbound_quantity=0,
                reserved_inbound_capacity=0,
                infinite_supply=row.infinite_supply,
            )
        )
    return BlueprintDesignSnapshot(
        factory=BlueprintFactoryData(
            name=factory.name,
            width_m=factory.width_m,
            length_m=factory.length_m,
            grid_size_m=factory.grid_size_m,
            schema_version=factory.schema_version,
        ),
        floors=[FloorPayload.model_validate(row, from_attributes=True) for row in factory.floors],
        objects=[FactoryObjectPayload.model_validate(row, from_attributes=True) for row in factory.factory_objects],
        items=[ItemPayload.model_validate(row, from_attributes=True) for row in factory.items],
        recipes=[RecipePayload.model_validate(row, from_attributes=True) for row in factory.recipes],
        inventory=inventory,
    )


async def list_blueprints(
    owner_id: str,
    db: AsyncSession,
    *,
    public_only: bool,
    search: str | None,
    tag: str | None,
    sort: str,
    page: int,
    page_size: int,
) -> tuple[list[Blueprint], int]:
    filters: list[Any] = [Blueprint.is_public.is_(True)] if public_only else [Blueprint.owner_id == owner_id]
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Blueprint.name.ilike(term), Blueprint.description.ilike(term)))
    if tag:
        filters.append(Blueprint.tags.contains([tag.strip().lower()]))

    count = await db.scalar(select(func.count()).select_from(Blueprint).where(*filters))
    ordering = (
        (Blueprint.star_count.desc(), Blueprint.fork_count.desc(), Blueprint.updated_at.desc())
        if sort == "popular"
        else (Blueprint.updated_at.desc(),)
    )
    result = await db.execute(
        select(Blueprint).where(*filters).order_by(*ordering).offset((page - 1) * page_size).limit(page_size)
    )
    return list(result.scalars().all()), int(count or 0)


async def get_blueprint(blueprint_id: str, db: AsyncSession) -> Blueprint | None:
    return await db.get(Blueprint, blueprint_id)


def can_read_blueprint(blueprint: Blueprint, user_id: str) -> bool:
    return blueprint.owner_id == user_id or blueprint.is_public


async def update_blueprint(blueprint: Blueprint, payload: BlueprintUpdate, db: AsyncSession) -> Blueprint:
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip()
        setattr(blueprint, field, value)
    blueprint.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(blueprint)
    return blueprint


async def delete_blueprint(blueprint: Blueprint, db: AsyncSession) -> None:
    await db.delete(blueprint)
    await db.commit()


async def starred_blueprint_ids(user_id: str, blueprint_ids: list[str], db: AsyncSession) -> set[str]:
    if not blueprint_ids:
        return set()
    result = await db.execute(
        select(BlueprintStar.blueprint_id).where(
            BlueprintStar.owner_id == user_id,
            BlueprintStar.blueprint_id.in_(blueprint_ids),
        )
    )
    return set(result.scalars().all())


async def star_blueprint(blueprint: Blueprint, user_id: str, db: AsyncSession) -> None:
    existing = await db.scalar(
        select(BlueprintStar).where(
            BlueprintStar.blueprint_id == blueprint.id,
            BlueprintStar.owner_id == user_id,
        )
    )
    if existing is not None:
        return
    db.add(BlueprintStar(blueprint_id=blueprint.id, owner_id=user_id))
    blueprint.star_count += 1
    await db.commit()


async def unstar_blueprint(blueprint: Blueprint, user_id: str, db: AsyncSession) -> None:
    result = await db.execute(
        delete(BlueprintStar)
        .where(BlueprintStar.blueprint_id == blueprint.id, BlueprintStar.owner_id == user_id)
        .returning(BlueprintStar.id)
    )
    if result.scalar_one_or_none() is not None:
        blueprint.star_count = max(0, blueprint.star_count - 1)
    await db.commit()


async def fork_blueprint(
    blueprint: Blueprint,
    owner_id: str,
    payload: BlueprintForkRequest,
    db: AsyncSession,
) -> Factory:
    snapshot = BlueprintDesignSnapshot.model_validate(blueprint.snapshot)
    name = payload.name.strip() if payload.name else f"{snapshot.factory.name} 副本"
    factory = await create_factory(
        owner_id,
        FactoryCreate(
            name=name,
            width_m=snapshot.factory.width_m,
            length_m=snapshot.factory.length_m,
            grid_size_m=snapshot.factory.grid_size_m,
        ),
        db,
    )
    sync_payload = remap_snapshot_for_factory(snapshot, factory.id, name)
    await sync_factory_snapshot(factory, sync_payload, db)
    db.add(BlueprintFork(blueprint_id=blueprint.id, factory_id=factory.id, owner_id=owner_id))
    blueprint.fork_count += 1
    await db.commit()
    await db.refresh(factory)
    return factory


def remap_snapshot_for_factory(
    snapshot: BlueprintDesignSnapshot,
    factory_id: str,
    factory_name: str,
) -> FactorySyncRequest:
    mapping: dict[str, str] = {}
    for prefix, rows in (
        ("floor", snapshot.floors),
        ("object", snapshot.objects),
        ("item", snapshot.items),
        ("recipe", snapshot.recipes),
        ("inventory", snapshot.inventory),
    ):
        mapping.update({row.id: new_id(prefix) for row in rows})

    def remap(value: Any) -> Any:
        if isinstance(value, str):
            if value in mapping:
                return mapping[value]
            for old_id, new_value in mapping.items():
                if value.startswith(f"{old_id}:"):
                    return f"{new_value}{value[len(old_id) :]}"
            return value
        if isinstance(value, list):
            return [remap(entry) for entry in value]
        if isinstance(value, dict):
            return {key: remap(entry) for key, entry in value.items()}
        return value

    def remapped_rows(rows: Sequence[BaseModel]) -> list[dict[str, Any]]:
        return [remap(row.model_dump(exclude={"factory_id"})) for row in rows]

    return FactorySyncRequest(
        name=factory_name,
        width_m=snapshot.factory.width_m,
        length_m=snapshot.factory.length_m,
        grid_size_m=snapshot.factory.grid_size_m,
        schema_version=snapshot.factory.schema_version,
        floors=remapped_rows(snapshot.floors),
        objects=remapped_rows(snapshot.objects),
        items=remapped_rows(snapshot.items),
        recipes=remapped_rows(snapshot.recipes),
        inventory=remapped_rows(snapshot.inventory),
        simulation=SimulationUpsert(),
    )


def export_blueprint(blueprint: Blueprint) -> BlueprintExport:
    return BlueprintExport(
        exported_at=datetime.now(UTC),
        blueprint=BlueprintExportData(
            name=blueprint.name,
            description=blueprint.description,
            tags=blueprint.tags,
            snapshot=BlueprintDesignSnapshot.model_validate(blueprint.snapshot),
        ),
    )


async def import_blueprint(owner_id: str, payload: BlueprintImportRequest, db: AsyncSession) -> Blueprint:
    blueprint = Blueprint(
        owner_id=owner_id,
        name=payload.blueprint.name.strip(),
        description=payload.blueprint.description.strip(),
        tags=payload.blueprint.tags,
        is_public=payload.is_public,
        snapshot=payload.blueprint.snapshot.model_dump(mode="json"),
    )
    db.add(blueprint)
    await db.commit()
    await db.refresh(blueprint)
    return blueprint
