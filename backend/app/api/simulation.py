"""Simulation, metrics, and activity event routes.

The simulation engine itself runs in the browser; this module provides
persistence endpoints for saving/restoring simulation state and querying
historical metric samples and activity events.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, DbSession
from app.models.factory import ActivityEvent, Factory, MetricSample, SimulationStateModel
from app.models.user import User
from app.realtime.event_bus import factory_channel, publish_event
from app.schemas.factory import (
    ActivityCreate,
    ActivitySchema,
    MetricCreate,
    MetricSchema,
    SimulationSchema,
    SimulationUpsert,
)
from app.services.factory_service import get_factory_by_id

router = APIRouter(prefix="/factories/{factory_id}", tags=["simulation"])


async def _verify_owner(factory_id: str, user: User, db: AsyncSession) -> Factory:
    factory = await get_factory_by_id(factory_id, db)
    if factory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工厂不存在。")
    if factory.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该工厂。")
    return factory


@router.get("/simulation", response_model=SimulationSchema)
async def get_simulation(
    factory_id: str,
    user: CurrentUser,
    db: DbSession,
) -> SimulationStateModel:
    await _verify_owner(factory_id, user, db)
    sim = await db.get(SimulationStateModel, factory_id)
    if sim is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="仿真状态尚未初始化。")
    return sim


@router.put("/simulation", response_model=SimulationSchema)
async def upsert_simulation(
    factory_id: str,
    payload: SimulationUpsert,
    user: CurrentUser,
    db: DbSession,
) -> SimulationStateModel:
    await _verify_owner(factory_id, user, db)
    sim = await db.get(SimulationStateModel, factory_id)
    if sim is None:
        sim = SimulationStateModel(factory_id=factory_id, **payload.model_dump())
        db.add(sim)
    else:
        for k, v in payload.model_dump().items():
            setattr(sim, k, v)
    await db.commit()
    await db.refresh(sim)
    await publish_event(
        factory_channel(factory_id),
        "simulation",
        SimulationSchema.model_validate(sim).model_dump(mode="json"),
    )
    return sim


@router.get("/metrics", response_model=list[MetricSchema])
async def get_metrics(
    factory_id: str,
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(240, ge=1, le=5000),
    offset: int = Query(0, ge=0),
) -> list[MetricSample]:
    await _verify_owner(factory_id, user, db)
    result = await db.execute(
        select(MetricSample)
        .where(MetricSample.factory_id == factory_id)
        .order_by(MetricSample.elapsed_sim_sec.asc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


@router.post("/metrics", status_code=status.HTTP_201_CREATED, response_model=MetricSchema)
async def append_metric(
    factory_id: str,
    sample: MetricCreate,
    user: CurrentUser,
    db: DbSession,
) -> MetricSample:
    await _verify_owner(factory_id, user, db)
    record = MetricSample(
        factory_id=factory_id,
        **sample.model_dump(),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    await publish_event(
        factory_channel(factory_id),
        "metrics",
        MetricSchema.model_validate(record).model_dump(mode="json"),
    )
    return record


@router.get("/activities", response_model=list[ActivitySchema])
async def get_activities(
    factory_id: str,
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(80, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[ActivityEvent]:
    await _verify_owner(factory_id, user, db)
    result = await db.execute(
        select(ActivityEvent)
        .where(ActivityEvent.factory_id == factory_id)
        .order_by(desc(ActivityEvent.elapsed_sim_sec))
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


@router.post("/activities", status_code=status.HTTP_201_CREATED, response_model=ActivitySchema)
async def append_activity(
    factory_id: str,
    event: ActivityCreate,
    user: CurrentUser,
    db: DbSession,
) -> ActivityEvent:
    await _verify_owner(factory_id, user, db)
    record = ActivityEvent(
        factory_id=factory_id,
        **event.model_dump(exclude_none=True),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    await publish_event(
        factory_channel(factory_id),
        "activity",
        ActivitySchema.model_validate(record).model_dump(mode="json"),
    )
    return record
