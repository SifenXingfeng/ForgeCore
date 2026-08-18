"""Authentication routes: register, login, refresh, logout, me."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.core.utils import configure_logging
from app.deps import CurrentUser, DbSession
from app.models.user import User
from app.schemas.auth import RefreshRequest, TokenPair, UserLogin, UserPublic, UserRegister
from app.services.auth_service import (
    authenticate_user,
    issue_token_pair,
    refresh_access_token,
    register_user,
    revoke_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(payload: UserRegister, db: DbSession) -> TokenPair:
    configure_logging()
    try:
        user = await register_user(payload, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    access, refresh = await issue_token_pair(user)
    return TokenPair(access_token=access, refresh_token=refresh, user=UserPublic.model_validate(user))


@router.post("/login", response_model=TokenPair)
async def login(payload: UserLogin, db: DbSession) -> TokenPair:
    try:
        user = await authenticate_user(payload, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    access, refresh = await issue_token_pair(user)
    return TokenPair(access_token=access, refresh_token=refresh, user=UserPublic.model_validate(user))


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    try:
        access, user = await refresh_access_token(payload.refresh_token, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    # Rotate refresh token: revoke the old one, issue a new pair.
    await revoke_refresh_token(payload.refresh_token)
    new_refresh = create_refresh_token_safe(user.id)
    return TokenPair(access_token=access, refresh_token=new_refresh, user=UserPublic.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest) -> None:
    await revoke_refresh_token(payload.refresh_token)


@router.get("/me", response_model=UserPublic)
async def me(current: CurrentUser) -> User:
    return current


def create_refresh_token_safe(user_id: str) -> str:
    """Local import to avoid circular dependency at module load time."""
    from app.core.security import create_refresh_token

    return create_refresh_token(user_id)
