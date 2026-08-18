"""Tests for auth endpoints: register, login, refresh, logout, me."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_register_returns_token_pair(client: AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "alice",
            "email": "alice@forgecore.dev",
            "password": "supersecret123",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["token_type"] == "bearer"
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == "alice@forgecore.dev"
    assert data["user"]["username"] == "alice"


async def test_register_duplicate_email_conflicts(client: AsyncClient):
    payload = {"username": "bob", "email": "bob@forgecore.dev", "password": "supersecret123"}
    first = await client.post("/api/auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/api/auth/register", json=payload)
    assert second.status_code == 409


async def test_register_short_password_rejected(client: AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "charlie",
            "email": "c@forgecore.dev",
            "password": "short",
        },
    )
    assert resp.status_code == 422


async def test_login_success(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={
            "username": "dave",
            "email": "dave@forgecore.dev",
            "password": "supersecret123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={
            "email": "dave@forgecore.dev",
            "password": "supersecret123",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["username"] == "dave"


async def test_login_wrong_password(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={
            "username": "eve",
            "email": "eve@forgecore.dev",
            "password": "supersecret123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={
            "email": "eve@forgecore.dev",
            "password": "wrongpassword",
        },
    )
    assert resp.status_code == 401


async def test_me_requires_auth(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401  # Bearer scheme auto_error=True → 403 or 401


async def test_me_with_token(client: AsyncClient):
    reg = await client.post(
        "/api/auth/register",
        json={
            "username": "frank",
            "email": "frank@forgecore.dev",
            "password": "supersecret123",
        },
    )
    token = reg.json()["access_token"]
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "frank"


async def test_refresh_rotates_token(client: AsyncClient):
    reg = await client.post(
        "/api/auth/register",
        json={
            "username": "grace",
            "email": "grace@forgecore.dev",
            "password": "supersecret123",
        },
    )
    refresh_token = reg.json()["refresh_token"]
    resp = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    new_tokens = resp.json()
    assert new_tokens["refresh_token"] != refresh_token
    # Old refresh token should now be revoked.
    second = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert second.status_code == 401
