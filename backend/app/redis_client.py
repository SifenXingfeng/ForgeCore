"""Redis async client factory."""

from __future__ import annotations

import asyncio

from redis.asyncio import Redis, from_url

from app.config import get_settings

_redis: Redis | None = None
_redis_loop: asyncio.AbstractEventLoop | None = None


def get_redis() -> Redis:
    """Returns the lazily-created singleton async Redis client."""
    global _redis, _redis_loop
    loop = asyncio.get_running_loop()
    if _redis is None or _redis_loop is not loop:
        _redis = from_url(get_settings().redis_url, decode_responses=True)
        _redis_loop = loop
    return _redis
