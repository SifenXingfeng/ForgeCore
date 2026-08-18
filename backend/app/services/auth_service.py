"""Authentication business logic: register, login, refresh, token revocation."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.core.utils import new_id
from app.models.user import User
from app.redis_client import get_redis
from app.schemas.auth import UserLogin, UserRegister

REFRESH_BLOCKLIST_PREFIX = "auth:refresh:revoked:"


def _redis_key(token: str) -> str:
    return f"{REFRESH_BLOCKLIST_PREFIX}{token}"


async def register_user(payload: UserRegister, db: AsyncSession) -> User:
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none() is not None:
        raise ValueError("该邮箱已注册，请直接登录。")

    user = User(
        id=new_id("usr"),
        email=payload.email.lower(),
        username=payload.username,
        display_name=payload.username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(payload: UserLogin, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise ValueError("邮箱或密码不正确。")
    return user


async def issue_token_pair(user: User) -> tuple[str, str]:
    """Returns (access_token, refresh_token)."""
    return create_access_token(user.id), create_refresh_token(user.id)


async def refresh_access_token(refresh_token: str, db: AsyncSession) -> tuple[str, User]:
    """Issues a fresh access token if the refresh token is valid and not revoked."""
    user_id = decode_token(refresh_token, "refresh")
    if user_id is None:
        raise ValueError("刷新令牌无效或已过期。")

    redis = get_redis()
    if await redis.exists(_redis_key(refresh_token)):
        raise ValueError("刷新令牌已被吊销。")

    user = await db.get(User, user_id)
    if user is None:
        raise ValueError("用户不存在。")
    return create_access_token(user.id), user


async def revoke_refresh_token(refresh_token: str) -> None:
    """Adds a refresh token to the Redis revocation blocklist until its natural expiry."""
    user_id = decode_token(refresh_token, "refresh")
    if user_id is None:
        return
    settings_ttl_days = 8  # slightly longer than token lifetime to be safe
    redis = get_redis()
    await redis.set(_redis_key(refresh_token), "1", ex=settings_ttl_days * 86400)
