"""Blueprint CRUD, community discovery, import/export, stars, and forks."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.deps import CurrentUser, DbSession
from app.models.blueprint import Blueprint, BlueprintFork
from app.schemas.blueprint import (
    BlueprintBrief,
    BlueprintCreate,
    BlueprintDesignSnapshot,
    BlueprintDetail,
    BlueprintExport,
    BlueprintForkEntry,
    BlueprintForkRequest,
    BlueprintForkResult,
    BlueprintImportRequest,
    BlueprintPage,
    BlueprintUpdate,
)
from app.services.blueprint_service import (
    can_read_blueprint,
    create_blueprint,
    delete_blueprint,
    export_blueprint,
    fork_blueprint,
    get_blueprint,
    import_blueprint,
    list_blueprints,
    star_blueprint,
    starred_blueprint_ids,
    unstar_blueprint,
    update_blueprint,
)

router = APIRouter(prefix="/blueprints", tags=["blueprints"])


def _brief(blueprint: Blueprint, starred_ids: set[str]) -> BlueprintBrief:
    return BlueprintBrief(
        **BlueprintBrief.model_validate(blueprint).model_dump(exclude={"is_starred"}),
        is_starred=blueprint.id in starred_ids,
    )


async def _readable_blueprint(blueprint_id: str, user_id: str, db: DbSession) -> Blueprint:
    blueprint = await get_blueprint(blueprint_id, db)
    if blueprint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="蓝图不存在。")
    if not can_read_blueprint(blueprint, user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该蓝图。")
    return blueprint


async def _owned_blueprint(blueprint_id: str, user_id: str, db: DbSession) -> Blueprint:
    blueprint = await _readable_blueprint(blueprint_id, user_id, db)
    if blueprint.owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有蓝图所有者可以修改。")
    return blueprint


@router.get("", response_model=BlueprintPage)
async def mine(
    user: CurrentUser,
    db: DbSession,
    search: str | None = Query(default=None, max_length=128),
    tag: str | None = Query(default=None, max_length=32),
    sort: str = Query(default="recent", pattern="^(recent|popular)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
) -> BlueprintPage:
    rows, total = await list_blueprints(
        user.id,
        db,
        public_only=False,
        search=search,
        tag=tag,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    starred = await starred_blueprint_ids(user.id, [row.id for row in rows], db)
    return BlueprintPage(items=[_brief(row, starred) for row in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=BlueprintDetail, status_code=status.HTTP_201_CREATED)
async def create(payload: BlueprintCreate, user: CurrentUser, db: DbSession) -> BlueprintDetail:
    try:
        blueprint = await create_blueprint(user.id, payload, db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    brief = _brief(blueprint, set())
    return BlueprintDetail(**brief.model_dump(), snapshot=BlueprintDesignSnapshot.model_validate(blueprint.snapshot))


@router.get("/public", response_model=BlueprintPage)
async def public_blueprints(
    user: CurrentUser,
    db: DbSession,
    search: str | None = Query(default=None, max_length=128),
    tag: str | None = Query(default=None, max_length=32),
    sort: str = Query(default="popular", pattern="^(recent|popular)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
) -> BlueprintPage:
    rows, total = await list_blueprints(
        user.id,
        db,
        public_only=True,
        search=search,
        tag=tag,
        sort=sort,
        page=page,
        page_size=page_size,
    )
    starred = await starred_blueprint_ids(user.id, [row.id for row in rows], db)
    return BlueprintPage(items=[_brief(row, starred) for row in rows], total=total, page=page, page_size=page_size)


@router.post("/import", response_model=BlueprintDetail, status_code=status.HTTP_201_CREATED)
async def import_file(payload: BlueprintImportRequest, user: CurrentUser, db: DbSession) -> BlueprintDetail:
    blueprint = await import_blueprint(user.id, payload, db)
    brief = _brief(blueprint, set())
    return BlueprintDetail(**brief.model_dump(), snapshot=BlueprintDesignSnapshot.model_validate(blueprint.snapshot))


@router.get("/{blueprint_id}", response_model=BlueprintDetail)
async def detail(blueprint_id: str, user: CurrentUser, db: DbSession) -> BlueprintDetail:
    blueprint = await _readable_blueprint(blueprint_id, user.id, db)
    starred = await starred_blueprint_ids(user.id, [blueprint.id], db)
    brief = _brief(blueprint, starred)
    return BlueprintDetail(**brief.model_dump(), snapshot=BlueprintDesignSnapshot.model_validate(blueprint.snapshot))


@router.put("/{blueprint_id}", response_model=BlueprintDetail)
async def update(
    blueprint_id: str,
    payload: BlueprintUpdate,
    user: CurrentUser,
    db: DbSession,
) -> BlueprintDetail:
    blueprint = await _owned_blueprint(blueprint_id, user.id, db)
    blueprint = await update_blueprint(blueprint, payload, db)
    starred = await starred_blueprint_ids(user.id, [blueprint.id], db)
    brief = _brief(blueprint, starred)
    return BlueprintDetail(**brief.model_dump(), snapshot=BlueprintDesignSnapshot.model_validate(blueprint.snapshot))


@router.delete("/{blueprint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(blueprint_id: str, user: CurrentUser, db: DbSession) -> None:
    blueprint = await _owned_blueprint(blueprint_id, user.id, db)
    await delete_blueprint(blueprint, db)


@router.post("/{blueprint_id}/fork", response_model=BlueprintForkResult, status_code=status.HTTP_201_CREATED)
async def fork(
    blueprint_id: str,
    payload: BlueprintForkRequest,
    user: CurrentUser,
    db: DbSession,
) -> BlueprintForkResult:
    blueprint = await _readable_blueprint(blueprint_id, user.id, db)
    factory = await fork_blueprint(blueprint, user.id, payload, db)
    return BlueprintForkResult(blueprint_id=blueprint.id, factory_id=factory.id, factory_name=factory.name)


@router.get("/{blueprint_id}/forks", response_model=list[BlueprintForkEntry])
async def forks(blueprint_id: str, user: CurrentUser, db: DbSession) -> list[object]:
    await _readable_blueprint(blueprint_id, user.id, db)
    result = await db.execute(
        select(BlueprintFork)
        .where(BlueprintFork.blueprint_id == blueprint_id)
        .order_by(BlueprintFork.created_at.desc())
    )
    return list(result.scalars().all())


@router.post("/{blueprint_id}/star", status_code=status.HTTP_204_NO_CONTENT)
async def star(blueprint_id: str, user: CurrentUser, db: DbSession) -> None:
    blueprint = await _readable_blueprint(blueprint_id, user.id, db)
    await star_blueprint(blueprint, user.id, db)


@router.delete("/{blueprint_id}/star", status_code=status.HTTP_204_NO_CONTENT)
async def unstar(blueprint_id: str, user: CurrentUser, db: DbSession) -> None:
    blueprint = await _readable_blueprint(blueprint_id, user.id, db)
    await unstar_blueprint(blueprint, user.id, db)


@router.get("/{blueprint_id}/export", response_class=Response)
async def export_file(blueprint_id: str, user: CurrentUser, db: DbSession) -> Response:
    blueprint = await _readable_blueprint(blueprint_id, user.id, db)
    payload: BlueprintExport = export_blueprint(blueprint)
    filename = f"forgecore-{blueprint.id}.fcbp"
    return Response(
        content=json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2),
        media_type="application/vnd.forgecore.blueprint+json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
