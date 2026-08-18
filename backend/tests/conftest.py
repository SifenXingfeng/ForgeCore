"""Shared pytest fixtures - isolated test database and Redis."""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncGenerator
from urllib.parse import urlparse

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

test_redis_url = os.environ.get("TEST_REDIS_URL", "redis://localhost:6380/15")
if urlparse(test_redis_url).path in ("", "/", "/0"):
    raise RuntimeError("TEST_REDIS_URL must use an isolated non-zero Redis database")
os.environ["REDIS_URL"] = test_redis_url

from app.config import get_settings  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import *  # noqa: E402,F401,F403 - register all models on Base.metadata
from app.redis_client import get_redis  # noqa: E402


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Create a private Postgres schema so tests never touch development data."""
    settings = get_settings()
    test_url = settings.effective_database_url
    schema = f"test_{uuid.uuid4().hex}"
    admin_engine = create_async_engine(test_url, echo=False)
    async with admin_engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        test_url,
        echo=False,
        connect_args={"server_settings": {"search_path": schema}},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()
    async with admin_engine.begin() as conn:
        await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    await admin_engine.dispose()


@pytest_asyncio.fixture(scope="function", autouse=True)
async def clean_test_redis():
    """Keep auth and Agent test keys out of the development Redis database."""
    redis = get_redis()
    await redis.flushdb()
    yield
    await redis.flushdb()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """HTTP client with the DB dependency overridden to use the test session."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
