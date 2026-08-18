"""Tests for factory endpoints: create, list, get, sync, delete."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio

AUTH_PAYLOAD = {"username": "factory", "email": "factory@forgecore.dev", "password": "supersecret123"}


async def auth_headers(client: AsyncClient) -> dict[str, str]:
    resp = await client.post("/api/auth/register", json=AUTH_PAYLOAD)
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def test_create_factory(client: AsyncClient):
    headers = await auth_headers(client)
    resp = await client.post(
        "/api/factories",
        json={
            "name": "我的测试工厂",
            "width_m": 32,
            "length_m": 20,
            "grid_size_m": 1,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "我的测试工厂"
    assert data["width_m"] == 32
    assert data["schema_version"] == 4


async def test_list_factories(client: AsyncClient):
    headers = await auth_headers(client)
    await client.post(
        "/api/factories", json={"name": "A", "width_m": 32, "length_m": 20, "grid_size_m": 1}, headers=headers
    )
    await client.post(
        "/api/factories", json={"name": "B", "width_m": 48, "length_m": 48, "grid_size_m": 2}, headers=headers
    )
    resp = await client.get("/api/factories", headers=headers)
    assert resp.status_code == 200
    factories = resp.json()
    assert len(factories) == 2
    assert {f["name"] for f in factories} == {"A", "B"}


async def test_get_factory_snapshot(client: AsyncClient):
    headers = await auth_headers(client)
    create = await client.post(
        "/api/factories", json={"name": "快照测试", "width_m": 32, "length_m": 20, "grid_size_m": 1}, headers=headers
    )
    factory_id = create.json()["id"]
    resp = await client.get(f"/api/factories/{factory_id}", headers=headers)
    assert resp.status_code == 200
    snap = resp.json()
    assert snap["factory"]["id"] == factory_id
    assert len(snap["floors"]) == 1
    assert snap["floors"][0]["name"] == "1F 生产区"
    assert snap["simulation"]["status"] == "idle"
    assert snap["objects"] == []
    assert snap["items"] == []


async def test_sync_factory_overwrites_data(client: AsyncClient):
    headers = await auth_headers(client)
    create = await client.post(
        "/api/factories", json={"name": "同步", "width_m": 32, "length_m": 20, "grid_size_m": 1}, headers=headers
    )
    factory_id = create.json()["id"]

    # Sync with a snapshot that has one floor, one object, one item.
    sync_resp = await client.put(
        f"/api/factories/{factory_id}/sync",
        json={
            "name": "同步后工厂",
            "width_m": 32,
            "length_m": 20,
            "grid_size_m": 1,
            "schema_version": 4,
            "floors": [
                {
                    "id": "floor-1",
                    "factory_id": factory_id,
                    "level": 1,
                    "name": "1F",
                    "elevation_m": 0,
                    "height_m": 4.5,
                },
                {
                    "id": "floor-2",
                    "factory_id": factory_id,
                    "level": 2,
                    "name": "2F",
                    "elevation_m": 4.5,
                    "height_m": 4.5,
                },
            ],
            "objects": [
                {
                    "id": "obj-machine-1",
                    "factory_id": factory_id,
                    "floor_id": "floor-1",
                    "kind": "machine",
                    "name": "加工机",
                    "model_ref": "machine.glb",
                    "transform_x": 0,
                    "transform_z": 0,
                    "transform_rotation_y": 0,
                    "footprint_width": 6,
                    "footprint_depth": 6,
                    "status": "idle",
                    "config": {
                        "kind": "machine",
                        "recipeId": None,
                        "inputCapacity": 12,
                        "outputCapacity": 12,
                        "speedMultiplier": 1,
                        "inputPortCount": 3,
                        "outputPortCount": 3,
                    },
                },
            ],
            "items": [
                {
                    "id": "item-iron",
                    "factory_id": factory_id,
                    "code": "IRON-001",
                    "name": "铁锭",
                    "category": "raw-material",
                    "description": "",
                    "item_model_id": "material/ingot",
                    "model_parameters": {},
                    "icon": None,
                    "mass_kg": 2.5,
                    "max_stack_size": 50,
                },
            ],
            "recipes": [],
            "inventory": [],
            "simulation": {
                "factory_id": factory_id,
                "status": "idle",
                "speed": 1,
                "elapsed_sim_sec": 0,
                "tick_count": 0,
                "seed": 41731,
                "accumulated_unstepped_sec": 0,
                "machine_runtime": {},
                "agv_runtime": {},
                "drone_runtime": {},
                "transit_items": [],
                "warehouse_dispatch_cooldown_sec_by_port": {},
                "source_feed_cooldown_sec": 0,
                "next_transit_sequence": 1,
                "next_metric_sample_at_sec": 1,
                "production_events_sec": [],
                "completed_transport_durations_sec": [],
                "total_finished": 0,
            },
        },
        headers=headers,
    )
    assert sync_resp.status_code == 200
    snap = sync_resp.json()
    assert snap["factory"]["name"] == "同步后工厂"
    assert len(snap["floors"]) == 2
    assert len(snap["objects"]) == 1
    assert snap["objects"][0]["kind"] == "machine"
    assert len(snap["items"]) == 1
    assert snap["items"][0]["code"] == "IRON-001"

    # Re-sync with fewer items to verify overwrite (not append).
    sync2 = await client.put(
        f"/api/factories/{factory_id}/sync",
        json={
            "name": "清空测试",
            "width_m": 32,
            "length_m": 20,
            "grid_size_m": 1,
            "schema_version": 4,
            "floors": [
                {"id": "floor-1", "factory_id": factory_id, "level": 1, "name": "1F", "elevation_m": 0, "height_m": 4.5}
            ],
            "objects": [],
            "items": [],
            "recipes": [],
            "inventory": [],
            "simulation": {
                "factory_id": factory_id,
                "status": "idle",
                "speed": 1,
                "elapsed_sim_sec": 0,
                "tick_count": 0,
                "seed": 41731,
                "accumulated_unstepped_sec": 0,
                "machine_runtime": {},
                "agv_runtime": {},
                "drone_runtime": {},
                "transit_items": [],
                "warehouse_dispatch_cooldown_sec_by_port": {},
                "source_feed_cooldown_sec": 0,
                "next_transit_sequence": 1,
                "next_metric_sample_at_sec": 1,
                "production_events_sec": [],
                "completed_transport_durations_sec": [],
                "total_finished": 0,
            },
        },
        headers=headers,
    )
    assert sync2.status_code == 200
    snap2 = sync2.json()
    assert len(snap2["floors"]) == 1
    assert len(snap2["objects"]) == 0
    assert len(snap2["items"]) == 0


async def test_delete_factory(client: AsyncClient):
    headers = await auth_headers(client)
    create = await client.post(
        "/api/factories", json={"name": "待删除", "width_m": 32, "length_m": 20, "grid_size_m": 1}, headers=headers
    )
    factory_id = create.json()["id"]
    resp = await client.delete(f"/api/factories/{factory_id}", headers=headers)
    assert resp.status_code == 204
    # Verify gone.
    get_resp = await client.get(f"/api/factories/{factory_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_cannot_access_other_users_factory(client: AsyncClient):
    # User A creates a factory.
    headers_a = await auth_headers(client)
    create = await client.post(
        "/api/factories", json={"name": "A的工厂", "width_m": 32, "length_m": 20, "grid_size_m": 1}, headers=headers_a
    )
    factory_id = create.json()["id"]

    # User B registers and tries to access A's factory.
    resp_b = await client.post(
        "/api/auth/register", json={"username": "b-user", "email": "b-user@forgecore.dev", "password": "supersecret123"}
    )
    assert resp_b.status_code == 201, resp_b.text
    headers_b = {"Authorization": f"Bearer {resp_b.json()['access_token']}"}
    forbidden = await client.get(f"/api/factories/{factory_id}", headers=headers_b)
    assert forbidden.status_code == 403


async def test_factory_endpoints_require_auth(client: AsyncClient):
    assert (await client.get("/api/factories")).status_code == 401
    assert (
        await client.post("/api/factories", json={"name": "X", "width_m": 32, "length_m": 20, "grid_size_m": 1})
    ).status_code == 401
