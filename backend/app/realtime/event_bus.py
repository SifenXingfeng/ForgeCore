"""Redis-backed event bus shared by factory and agent SSE streams."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from redis.exceptions import RedisError

from app.redis_client import get_redis

logger = logging.getLogger(__name__)

FACTORY_CHANNEL_PREFIX = "realtime:factory:"
AGENT_CHANNEL_PREFIX = "realtime:agent:"


def factory_channel(factory_id: str) -> str:
    return f"{FACTORY_CHANNEL_PREFIX}{factory_id}"


def agent_channel(session_id: str) -> str:
    return f"{AGENT_CHANNEL_PREFIX}{session_id}"


async def publish_event(channel: str, event: str, payload: dict[str, Any]) -> bool:
    """Publish an event without making persistence depend on Redis availability."""
    message = json.dumps({"event": event, "data": payload}, ensure_ascii=False, separators=(",", ":"))
    try:
        await get_redis().publish(channel, message)
    except (RedisError, RuntimeError):
        logger.warning("Realtime publish failed for %s", channel, exc_info=True)
        return False
    return True


async def event_stream(channel: str) -> AsyncGenerator[dict[str, str], None]:
    """Yield SSE-compatible event dictionaries from a Redis Pub/Sub channel."""
    pubsub = get_redis().pubsub()
    await pubsub.subscribe(channel)
    try:
        yield {"event": "ready", "data": json.dumps({"channel": channel})}
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
            if message is None:
                yield {"comment": "keepalive"}
                continue
            raw = message.get("data")
            if not isinstance(raw, str):
                continue
            try:
                envelope = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Discarded malformed realtime event on %s", channel)
                continue
            event = envelope.get("event")
            data = envelope.get("data")
            if not isinstance(event, str) or not isinstance(data, dict):
                continue
            yield {"event": event, "data": json.dumps(data, ensure_ascii=False, separators=(",", ":"))}
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()  # type: ignore[no-untyped-call]
