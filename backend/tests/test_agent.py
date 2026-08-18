"""B8 Agent session and structured event contract tests."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_agent_session_events_and_ownership(client: AsyncClient):
    suffix = uuid.uuid4().hex[:8]
    register = await client.post(
        "/api/auth/register",
        json={"username": f"agent-{suffix}", "email": f"agent-{suffix}@forgecore.dev", "password": "supersecret123"},
    )
    headers = {"Authorization": f"Bearer {register.json()['access_token']}"}
    factory = await client.post(
        "/api/factories",
        headers=headers,
        json={"name": "Agent 工厂", "width_m": 32, "length_m": 20, "grid_size_m": 1},
    )
    factory_id = factory.json()["id"]

    created = await client.post(
        "/api/agent/sessions",
        headers=headers,
        json={"factory_id": factory_id, "objective": "降低物流拥堵"},
    )
    assert created.status_code == 201, created.text
    session = created.json()
    assert session["factory_id"] == factory_id
    assert session["status"] == "ready"

    event = await client.post(
        f"/api/agent/sessions/{session['id']}/events",
        headers=headers,
        json={
            "event": "agent_suggestion",
            "data": {
                "id": "suggestion-1",
                "title": "移动机器",
                "rationale": "释放主通道",
                "confidence": 0.8,
                "actions": [{"kind": "move_object", "target_id": "machine-1", "parameters": {"x": 4, "z": 4}}],
                "expected_delta": {"throughput": 12},
                "requires_simulation": True,
            },
        },
    )
    assert event.status_code == 201, event.text
    events = await client.get(f"/api/agent/sessions/{session['id']}/events", headers=headers)
    assert events.status_code == 200
    assert [row["event"] for row in events.json()] == ["agent_progress", "agent_suggestion"]

    invalid = await client.post(
        f"/api/agent/sessions/{session['id']}/events",
        headers=headers,
        json={"event": "agent_suggestion", "data": {"title": "missing required fields"}},
    )
    assert invalid.status_code == 422

    cancelled = await client.delete(f"/api/agent/sessions/{session['id']}", headers=headers)
    assert cancelled.status_code == 204
    assert (await client.get(f"/api/agent/sessions/{session['id']}", headers=headers)).json()["status"] == "cancelled"
