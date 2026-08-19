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
    catalog = await client.get("/api/agent/tools", headers=headers)
    assert catalog.status_code == 200
    assert len(catalog.json()) == 12
    assert {tool["permission"] for tool in catalog.json()} == {"read_only"}
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


async def test_durable_agent_run_executes_grounded_tools(client: AsyncClient):
    suffix = uuid.uuid4().hex[:8]
    register = await client.post(
        "/api/auth/register",
        json={"username": f"run-{suffix}", "email": f"run-{suffix}@forgecore.dev", "password": "supersecret123"},
    )
    headers = {"Authorization": f"Bearer {register.json()['access_token']}"}
    factory = await client.post(
        "/api/factories",
        headers=headers,
        json={"name": "空白诊断工厂", "width_m": 32, "length_m": 20, "grid_size_m": 1},
    )
    factory_id = factory.json()["id"]

    created = await client.post(
        "/api/agent/runs",
        headers=headers,
        json={"factory_id": factory_id, "objective": "检查当前工厂为什么没有产出", "mode": "read_only"},
    )
    assert created.status_code == 201, created.text
    run = created.json()
    assert run["status"] == "created"
    assert [step["key"] for step in run["steps"]] == ["goal", "context", "metrics", "diagnostics", "summary"]
    assert run["compiled_goal"]["intent"] == "explain"
    assert run["compiled_goal"]["baseline_version"]
    assert run["result"] is None

    analyzed = await client.post(f"/api/agent/runs/{run['id']}/analyze", headers=headers)
    assert analyzed.status_code == 200, analyzed.text
    result = analyzed.json()
    assert result["status"] == "completed"
    assert all(step["status"] == "completed" for step in result["steps"])
    assert [tool["tool_name"] for tool in result["tool_calls"]] == [
        "explain_constraint",
        "get_factory_snapshot",
        "get_factory_graph",
        "get_simulation_metrics",
        "query_event_timeline",
        "inspect_inventory",
        "inspect_machine",
        "inspect_recipe_chain",
        "inspect_conveyors",
        "inspect_logistics",
        "calculate_capacity",
        "inspect_bottlenecks",
    ]
    assert all(tool["status"] == "completed" for tool in result["tool_calls"])
    assert result["result"]["snapshot"]["factory_id"] == factory_id
    assert result["result"]["graph_summary"]["node_count"] == 0
    assert result["result"]["findings"][0]["id"] == "production-empty"
    assert result["base_factory_updated_at"] is not None
    assert result["tool_calls_used"] == 12
    assert result["events"][0]["event_name"] == "run_created"
    assert result["events"][-1]["event_name"] == "run_completed"

    repeated = await client.post(f"/api/agent/runs/{run['id']}/analyze", headers=headers)
    assert repeated.status_code == 200
    assert len(repeated.json()["tool_calls"]) == 12

    listed = await client.get(f"/api/agent/runs?factory_id={factory_id}", headers=headers)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [run["id"]]

    other_suffix = uuid.uuid4().hex[:8]
    other = await client.post(
        "/api/auth/register",
        json={
            "username": f"other-{other_suffix}",
            "email": f"other-{other_suffix}@forgecore.dev",
            "password": "supersecret123",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    forbidden = await client.get(f"/api/agent/runs/{run['id']}", headers=other_headers)
    assert forbidden.status_code == 403

    cancellable = await client.post(
        "/api/agent/runs",
        headers=headers,
        json={"factory_id": factory_id, "objective": "创建后立即取消"},
    )
    cancelled = await client.post(f"/api/agent/runs/{cancellable.json()['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert all(step["status"] == "cancelled" for step in cancelled.json()["steps"])
    after_cancel = await client.post(f"/api/agent/runs/{cancellable.json()['id']}/analyze", headers=headers)
    assert after_cancel.status_code == 200
    assert after_cancel.json()["status"] == "cancelled"
    assert after_cancel.json()["tool_calls"] == []
