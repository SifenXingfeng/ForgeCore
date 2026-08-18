"""Factory CRUD + full-snapshot sync routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DbSession
from app.models.factory import Factory
from app.models.user import User
from app.realtime.event_bus import factory_channel, publish_event
from app.schemas.factory import (
    FactoryBrief,
    FactoryCreate,
    FactorySnapshot,
    FactorySyncRequest,
)
from app.services.factory_service import (
    create_factory,
    delete_factory,
    get_factory_by_id,
    list_user_factories,
    load_full_snapshot,
    sync_factory_snapshot,
)

router = APIRouter(prefix="/factories", tags=["factories"])


async def _get_owned_factory(factory_id: str, user: User, db: AsyncSession) -> Factory:
    factory = await get_factory_by_id(factory_id, db)
    if factory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂不存在。")
    if factory.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该工厂。")
    return factory


@router.get("", response_model=list[FactoryBrief])
async def list_factories(
    user: CurrentUser,
    db: DbSession,
) -> list[Factory]:
    return await list_user_factories(user.id, db)


@router.post("", response_model=FactoryBrief, status_code=status.HTTP_201_CREATED)
async def create(
    payload: FactoryCreate,
    user: CurrentUser,
    db: DbSession,
) -> Factory:
    return await create_factory(user.id, payload, db)


@router.get("/{factory_id}", response_model=FactorySnapshot)
async def get_factory(
    factory_id: str,
    user: CurrentUser,
    db: DbSession,
) -> dict[str, object]:
    factory = await _get_owned_factory(factory_id, user, db)
    full = await load_full_snapshot(factory.id, db)
    if full is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂数据加载失败。")
    return serialize_snapshot(full)


@router.put("/{factory_id}/sync", response_model=FactorySnapshot)
async def sync_factory(
    factory_id: str,
    payload: FactorySyncRequest,
    user: CurrentUser,
    db: DbSession,
) -> dict[str, object]:
    factory = await _get_owned_factory(factory_id, user, db)
    full = await sync_factory_snapshot(factory, payload, db)
    await publish_event(
        factory_channel(factory_id),
        "factory_synced",
        {"factory_id": factory_id, "updated_at": full.updated_at.isoformat()},
    )
    return serialize_snapshot(full)


def serialize_snapshot(full: Factory) -> dict[str, object]:
    """Build the FactorySnapshot dict from an eagerly-loaded Factory ORM object."""
    return {
        "factory": full,
        "floors": full.floors,
        "objects": full.factory_objects,
        "items": full.items,
        "recipes": full.recipes,
        "inventory": full.inventory,
        "simulation": full.simulation,
        "metrics": full.metric_samples,
        "activities": full.activities,
    }


@router.delete("/{factory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_factory(
    factory_id: str,
    user: CurrentUser,
    db: DbSession,
) -> None:
    factory = await _get_owned_factory(factory_id, user, db)
    await delete_factory(factory.id, db)
