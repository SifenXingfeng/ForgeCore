"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.auth import router as auth_router
from app.api.blueprints import router as blueprints_router
from app.api.factories import router as factories_router
from app.api.health import router as health_router
from app.api.realtime import router as realtime_router
from app.api.simulation import router as simulation_router
from app.config import get_settings
from app.core.utils import configure_logging


@asynccontextmanager
async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    configure_logging()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ForgeCore Backend",
        description="ForgeCore 数字工厂后端 - 用户系统、工厂持久化、蓝图分享、AI agent 编排",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix="/api")
    app.include_router(agent_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(blueprints_router, prefix="/api")
    app.include_router(factories_router, prefix="/api")
    app.include_router(simulation_router, prefix="/api")
    app.include_router(realtime_router, prefix="/api")

    return app


app = create_app()
