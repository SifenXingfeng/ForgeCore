"""Blueprint sharing, import/export, starring, and fork isolation tests."""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def register(client: AsyncClient, prefix: str) -> dict[str, str]:
    suffix = uuid.uuid4().hex[:8]
    response = await client.post(
        "/api/auth/register",
        json={
            "username": f"{prefix}-{suffix}",
            "email": f"{prefix}-{suffix}@forgecore.dev",
            "password": "supersecret123",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def create_factory(client: AsyncClient, headers: dict[str, str], name: str = "蓝图源工厂") -> str:
    response = await client.post(
        "/api/factories",
        json={"name": name, "width_m": 32, "length_m": 20, "grid_size_m": 1},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_blueprint_public_star_export_and_fork(client: AsyncClient):
    owner = await register(client, "blueprint-owner")
    factory_id = await create_factory(client, owner)
    floor_id = (await client.get(f"/api/factories/{factory_id}", headers=owner)).json()["floors"][0]["id"]
    sync = await client.put(
        f"/api/factories/{factory_id}/sync",
        headers=owner,
        json={
            "name": "蓝图源工厂",
            "width_m": 32,
            "length_m": 20,
            "grid_size_m": 1,
            "floors": [{"id": floor_id, "level": 1, "name": "1F", "elevation_m": 0, "height_m": 4.5}],
            "objects": [
                {
                    "id": "machine-source",
                    "floor_id": floor_id,
                    "kind": "machine",
                    "name": "加工机",
                    "model_ref": None,
                    "transform_x": 0,
                    "transform_z": 0,
                    "transform_rotation_y": 0,
                    "footprint_width": 6,
                    "footprint_depth": 6,
                    "status": "idle",
                    "config": {"kind": "machine", "recipeId": "recipe-1", "inputPortCount": 3, "outputPortCount": 3},
                },
            ],
            "items": [
                {
                    "id": "item-1",
                    "code": "IRON-1",
                    "name": "铁锭",
                    "category": "raw-material",
                    "description": "",
                    "item_model_id": "material/ingot",
                    "model_parameters": {},
                    "mass_kg": 2.5,
                    "max_stack_size": 50,
                },
            ],
            "recipes": [
                {
                    "id": "recipe-1",
                    "code": "RECIPE-1",
                    "name": "铁锭加工",
                    "description": "",
                    "inputs": [{"itemId": "item-1", "quantity": 1}],
                    "outputs": [{"itemId": "item-1", "quantity": 1}],
                    "processing_time_sec": 5,
                    "enabled": True,
                },
            ],
            "inventory": [
                {
                    "id": "inventory-1",
                    "location_type": "finished-goods",
                    "location_id": "finished-goods",
                    "item_id": "item-1",
                    "quantity": 3,
                    "initial_quantity": 3,
                    "capacity": 100,
                },
            ],
            "simulation": {},
        },
    )
    assert sync.status_code == 200, sync.text

    created = await client.post(
        "/api/blueprints",
        headers=owner,
        json={"factory_id": factory_id, "name": "电子产线模板", "tags": [" 自动化 ", "自动化"], "is_public": True},
    )
    assert created.status_code == 201, created.text
    blueprint = created.json()
    assert blueprint["snapshot"]["objects"][0]["id"] == "machine-source"
    blueprint_id = blueprint["id"]

    visitor = await register(client, "blueprint-visitor")
    public = await client.get("/api/blueprints/public?tag=自动化", headers=visitor)
    assert public.status_code == 200, public.text
    assert public.json()["total"] == 1

    assert (await client.post(f"/api/blueprints/{blueprint_id}/star", headers=visitor)).status_code == 204
    detail = await client.get(f"/api/blueprints/{blueprint_id}", headers=visitor)
    assert detail.status_code == 200
    assert detail.json()["star_count"] == 1
    assert detail.json()["is_starred"] is True

    exported = await client.get(f"/api/blueprints/{blueprint_id}/export", headers=owner)
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/vnd.forgecore.blueprint+json")
    export_payload = exported.json()
    imported = await client.post(
        "/api/blueprints/import",
        headers=visitor,
        json={**export_payload, "is_public": False},
    )
    assert imported.status_code == 201, imported.text

    forked = await client.post(
        f"/api/blueprints/{blueprint_id}/fork",
        headers=visitor,
        json={"name": "访客副本"},
    )
    assert forked.status_code == 201, forked.text
    fork_factory_id = forked.json()["factory_id"]
    fork_snapshot = await client.get(f"/api/factories/{fork_factory_id}", headers=visitor)
    assert fork_snapshot.status_code == 200, fork_snapshot.text
    fork_data = fork_snapshot.json()
    assert fork_data["factory"]["name"] == "访客副本"
    assert fork_data["objects"][0]["id"] != "machine-source"
    assert fork_data["objects"][0]["config"]["recipeId"] != "recipe-1"
    assert fork_data["inventory"][0]["item_id"] != "item-1"


async def test_private_blueprint_is_not_visible_to_other_user(client: AsyncClient):
    owner = await register(client, "private-owner")
    factory_id = await create_factory(client, owner, "私有源")
    response = await client.post(
        "/api/blueprints",
        headers=owner,
        json={"factory_id": factory_id, "name": "私有模板", "is_public": False},
    )
    assert response.status_code == 201
    visitor = await register(client, "private-visitor")
    blueprint_id = response.json()["id"]
    assert (await client.get(f"/api/blueprints/{blueprint_id}", headers=visitor)).status_code == 403
    assert (await client.post(f"/api/blueprints/{blueprint_id}/fork", headers=visitor, json={})).status_code == 403


async def test_export_is_valid_json_file(client: AsyncClient):
    headers = await register(client, "export-check")
    factory_id = await create_factory(client, headers, "导出检查")
    created = await client.post(
        "/api/blueprints",
        headers=headers,
        json={"factory_id": factory_id, "name": "导出检查蓝图"},
    )
    payload = await client.get(f"/api/blueprints/{created.json()['id']}/export", headers=headers)
    assert json.loads(payload.text)["format"] == "forgecore-blueprint"
