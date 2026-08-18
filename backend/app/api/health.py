"""Health-check route - unauthenticated, used by Docker and orchestrators."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.deps import DbSession
from app.redis_client import get_redis

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: DbSession) -> dict[str, str]:
    checks: dict[str, str] = {"status": "ok"}
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["database"] = f"error: {exc}"
        checks["status"] = "degraded"
    try:
        redis = get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error: {exc}"
        checks["status"] = "degraded"
    return checks
