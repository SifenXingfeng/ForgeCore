"""Core utilities: logging, IDs, shared enums."""

from __future__ import annotations

import logging
import uuid

from app.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    level = logging.DEBUG if settings.app_log_level == "debug" else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def new_id(prefix: str = "") -> str:
    """Prefixed UUID4 string, e.g. ``usr-<uuid>`` or ``<uuid>``."""
    raw = str(uuid.uuid4())
    return f"{prefix}-{raw}" if prefix else raw
