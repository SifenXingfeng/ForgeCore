"""Agent A2 FactoryPatch approve / apply / version conflict tests."""

from __future__ import annotations

import copy
import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


def _sim(factory_id: str) -> dict:
    return {
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
    }


async def _register(client: AsyncClient, prefix: str) -> dict[str, str]:
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


async def _seed_factory(client: AsyncClient, headers: dict[str, str]) -> tuple[str, dict]:
    created = await client.post(
        "/api/factories",
        headers=headers,
        json={"name": "Patch 工厂", "width_m": 32, "length_m": 20, "grid_size_m": 1},
    )
    assert created.status_code == 201, created.text
    factory_id = created.json()["id"]
    payload = {
        "name": "Patch 工厂",
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
            }
        ],
        "objects": [
            {
                "id": "obj-rack-1",
                "factory_id": factory_id,
                "floor_id": "floor-1",
                "kind": "rack",
                "name": "原料仓",
                "model_ref": None,
                "transform_x": 2,
                "transform_z": 2,
                "transform_rotation_y": 0,
                "footprint_width": 2,
                "footprint_depth": 2,
                "status": "idle",
                "config": {"kind": "rack", "dispatchIntervalSecByPort": [2, 2, 2]},
            },
            {
                "id": "obj-agv-1",
                "factory_id": factory_id,
                "floor_id": "floor-1",
                "kind": "agv",
                "name": "AGV-1",
                "model_ref": None,
                "transform_x": 8,
                "transform_z": 8,
                "transform_rotation_y": 0,
                "footprint_width": 1,
                "footprint_depth": 1,
                "status": "idle",
                "config": {"kind": "agv", "speedMps": 1.5, "maxPayloadKg": 50},
            },
            {
                "id": "obj-machine-1",
                "factory_id": factory_id,
                "floor_id": "floor-1",
                "kind": "machine",
                "name": "加工机",
                "model_ref": None,
                "transform_x": 14,
                "transform_z": 4,
                "transform_rotation_y": 0,
                "footprint_width": 4,
                "footprint_depth": 4,
                "status": "idle",
                "config": {
                    "kind": "machine",
                    "recipeId": "recipe-1",
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
            {
                "id": "item-plate",
                "factory_id": factory_id,
                "code": "PLATE-001",
                "name": "钢板",
                "category": "finished-good",
                "description": "",
                "item_model_id": "material/plate",
                "model_parameters": {},
                "icon": None,
                "mass_kg": 3,
                "max_stack_size": 30,
            },
        ],
        "recipes": [
            {
                "id": "recipe-1",
                "factory_id": factory_id,
                "code": "R-PLATE",
                "name": "钢板加工",
                "description": "",
                "inputs": [{"itemId": "item-iron", "quantity": 1}],
                "outputs": [{"itemId": "item-plate", "quantity": 1}],
                "processing_time_sec": 5,
                "enabled": True,
            }
        ],
        "inventory": [
            {
                "id": "inv-1",
                "factory_id": factory_id,
                "location_type": "rack-slot",
                "location_id": "obj-rack-1",
                "item_id": "item-iron",
                "quantity": 0,
                "initial_quantity": 20,
                "capacity": 40,
                "reserved_outbound_quantity": 0,
                "reserved_inbound_capacity": 0,
                "infinite_supply": False,
            }
        ],
        "simulation": _sim(factory_id),
    }
    synced = await client.put(f"/api/factories/{factory_id}/sync", headers=headers, json=payload)
    assert synced.status_code == 200, synced.text
    return factory_id, synced.json()


async def test_plan_design_patch_approve_apply_and_version_conflict(client: AsyncClient):
    headers = await _register(client, "patch")
    factory_id, before = await _seed_factory(client, headers)
    agv_before = next(obj for obj in before["objects"] if obj["id"] == "obj-agv-1")
    inv_before = next(row for row in before["inventory"] if row["id"] == "inv-1")
    assert inv_before["quantity"] == 0

    created = await client.post(
        "/api/agent/runs",
        headers=headers,
        json={
            "factory_id": factory_id,
            "objective": "在面积和 AGV 数量不变的前提下补充缺料并优化物流",
            "mode": "plan_design",
        },
    )
    assert created.status_code == 201, created.text
    run = created.json()
    assert run["mode"] == "plan_design"
    assert [step["key"] for step in run["steps"]] == [
        "goal",
        "context",
        "metrics",
        "diagnostics",
        "summary",
        "plan",
    ]
    hard_keys = {item["key"] for item in run["compiled_goal"]["hard_constraints"]}
    assert "floor_area_m2" in hard_keys
    assert "agv_count" in hard_keys

    analyzed = await client.post(f"/api/agent/runs/{run['id']}/analyze", headers=headers)
    assert analyzed.status_code == 200, analyzed.text
    result = analyzed.json()
    assert result["status"] == "awaiting_approval"
    assert result["result"] is not None
    assert len(result["patches"]) == 1
    patch = result["patches"][0]
    assert patch["status"] == "awaiting_approval"
    assert patch["validation"]["ok"] is True
    assert patch["operations"]
    assert all(op["kind"] in {"adjust_inventory", "update_config", "move_object"} for op in patch["operations"])
    assert patch["approvals"][0]["status"] == "pending"

    # Main factory must stay unchanged before apply.
    snapshot = await client.get(f"/api/factories/{factory_id}", headers=headers)
    assert snapshot.status_code == 200
    current = snapshot.json()
    agv_now = next(obj for obj in current["objects"] if obj["id"] == "obj-agv-1")
    inv_now = next(row for row in current["inventory"] if row["id"] == "inv-1")
    assert agv_now["transform_x"] == agv_before["transform_x"]
    assert inv_now["quantity"] == 0
    assert current["factory"]["updated_at"] == before["factory"]["updated_at"]

    approved = await client.post(f"/api/agent/patches/{patch['id']}/approve", headers=headers, json={})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    applied = await client.post(f"/api/agent/patches/{patch['id']}/apply", headers=headers)
    assert applied.status_code == 200, applied.text
    applied_patch = applied.json()
    assert applied_patch["status"] == "applied"
    assert applied_patch["applied_factory_updated_at"] is not None

    after = (await client.get(f"/api/factories/{factory_id}", headers=headers)).json()
    assert after["factory"]["updated_at"] != before["factory"]["updated_at"]
    assert after["factory"]["width_m"] == 32
    assert after["factory"]["length_m"] == 20
    assert sum(1 for obj in after["objects"] if obj["kind"] == "agv") == 1
    inv_after = next(row for row in after["inventory"] if row["id"] == "inv-1")
    agv_after = next(obj for obj in after["objects"] if obj["id"] == "obj-agv-1")
    changed = inv_after["quantity"] != 0 or agv_after != agv_before
    assert changed

    repeated = await client.post(f"/api/agent/patches/{patch['id']}/apply", headers=headers)
    assert repeated.status_code == 409

    rolled = await client.post(f"/api/agent/patches/{patch['id']}/rollback", headers=headers)
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["status"] == "rolled_back"

    # Fresh patch then stale base_version after external sync.
    created2 = await client.post(
        "/api/agent/runs",
        headers=headers,
        json={
            "factory_id": factory_id,
            "objective": "在面积和 AGV 数量不变的前提下补充缺料",
            "mode": "plan_design",
        },
    )
    run2 = (
        await client.post(f"/api/agent/runs/{created2.json()['id']}/analyze", headers=headers)
    ).json()
    if run2["status"] != "awaiting_approval":
        # If inventory already full after previous ops, force zero inventory and re-run.
        force = copy.deepcopy((await client.get(f"/api/factories/{factory_id}", headers=headers)).json())
        force_payload = {
            "name": force["factory"]["name"],
            "width_m": force["factory"]["width_m"],
            "length_m": force["factory"]["length_m"],
            "grid_size_m": force["factory"]["grid_size_m"],
            "schema_version": force["factory"]["schema_version"],
            "floors": force["floors"],
            "objects": force["objects"],
            "items": force["items"],
            "recipes": force["recipes"],
            "inventory": [
                {**row, "quantity": 0} if row["id"] == "inv-1" else row for row in force["inventory"]
            ],
            "simulation": {
                key: value
                for key, value in force["simulation"].items()
                if key != "id" and key != "created_at" and key != "updated_at"
            },
            "metrics": [],
            "activities": [],
        }
        # simulation may include factory_id already
        if "factory_id" not in force_payload["simulation"]:
            force_payload["simulation"]["factory_id"] = factory_id
        # Strip ORM-only fields from nested entities for sync payload.
        for collection in ("floors", "objects", "items", "recipes", "inventory"):
            cleaned = []
            for row in force_payload[collection]:
                cleaned.append(
                    {
                        key: value
                        for key, value in row.items()
                        if key not in {"created_at", "updated_at"}
                    }
                )
            force_payload[collection] = cleaned
        force_payload["simulation"] = {
            key: value
            for key, value in force_payload["simulation"].items()
            if key
            in {
                "status",
                "speed",
                "elapsed_sim_sec",
                "tick_count",
                "seed",
                "accumulated_unstepped_sec",
                "machine_runtime",
                "agv_runtime",
                "drone_runtime",
                "transit_items",
                "warehouse_dispatch_cooldown_sec_by_port",
                "source_feed_cooldown_sec",
                "next_transit_sequence",
                "next_metric_sample_at_sec",
                "production_events_sec",
                "completed_transport_durations_sec",
                "total_finished",
            }
        }
        assert (
            await client.put(f"/api/factories/{factory_id}/sync", headers=headers, json=force_payload)
        ).status_code == 200
        created2 = await client.post(
            "/api/agent/runs",
            headers=headers,
            json={
                "factory_id": factory_id,
                "objective": "在面积和 AGV 数量不变的前提下补充缺料",
                "mode": "plan_design",
            },
        )
        run2 = (
            await client.post(f"/api/agent/runs/{created2.json()['id']}/analyze", headers=headers)
        ).json()

    assert run2["status"] == "awaiting_approval", run2
    stale_patch = run2["patches"][0]

    # Mutate factory after patch creation.
    mutated = copy.deepcopy((await client.get(f"/api/factories/{factory_id}", headers=headers)).json())
    mutate_payload = {
        "name": mutated["factory"]["name"] + " 已改",
        "width_m": mutated["factory"]["width_m"],
        "length_m": mutated["factory"]["length_m"],
        "grid_size_m": mutated["factory"]["grid_size_m"],
        "schema_version": mutated["factory"]["schema_version"],
        "floors": [
            {k: v for k, v in floor.items() if k not in {"created_at", "updated_at"}}
            for floor in mutated["floors"]
        ],
        "objects": [
            {k: v for k, v in obj.items() if k not in {"created_at", "updated_at"}}
            for obj in mutated["objects"]
        ],
        "items": [
            {k: v for k, v in item.items() if k not in {"created_at", "updated_at"}}
            for item in mutated["items"]
        ],
        "recipes": [
            {k: v for k, v in recipe.items() if k not in {"created_at", "updated_at"}}
            for recipe in mutated["recipes"]
        ],
        "inventory": [
            {k: v for k, v in row.items() if k not in {"created_at", "updated_at"}}
            for row in mutated["inventory"]
        ],
        "simulation": {
            key: value
            for key, value in mutated["simulation"].items()
            if key
            in {
                "status",
                "speed",
                "elapsed_sim_sec",
                "tick_count",
                "seed",
                "accumulated_unstepped_sec",
                "machine_runtime",
                "agv_runtime",
                "drone_runtime",
                "transit_items",
                "warehouse_dispatch_cooldown_sec_by_port",
                "source_feed_cooldown_sec",
                "next_transit_sequence",
                "next_metric_sample_at_sec",
                "production_events_sec",
                "completed_transport_durations_sec",
                "total_finished",
            }
        },
        "metrics": [],
        "activities": [],
    }
    mutated_sync = await client.put(f"/api/factories/{factory_id}/sync", headers=headers, json=mutate_payload)
    assert mutated_sync.status_code == 200, mutated_sync.text
    mutated_version = mutated_sync.json()["factory"]["updated_at"]

    conflict = await client.post(f"/api/agent/patches/{stale_patch['id']}/apply", headers=headers)
    assert conflict.status_code == 409, conflict.text
    assert "主工厂已变更" in conflict.json()["detail"]

    final = (await client.get(f"/api/factories/{factory_id}", headers=headers)).json()
    assert final["factory"]["updated_at"] == mutated_version
    assert final["factory"]["name"].endswith("已改")


async def test_read_only_mode_does_not_create_patch(client: AsyncClient):
    headers = await _register(client, "readonly")
    factory_id, _ = await _seed_factory(client, headers)
    created = await client.post(
        "/api/agent/runs",
        headers=headers,
        json={
            "factory_id": factory_id,
            "objective": "检查当前工厂为什么没有产出",
            "mode": "read_only",
        },
    )
    analyzed = await client.post(f"/api/agent/runs/{created.json()['id']}/analyze", headers=headers)
    assert analyzed.status_code == 200, analyzed.text
    result = analyzed.json()
    assert result["status"] == "completed"
    assert result["patches"] == []
    assert [step["key"] for step in result["steps"]] == [
        "goal",
        "context",
        "metrics",
        "diagnostics",
        "summary",
    ]


async def test_patch_validation_rejects_agv_count_change(client: AsyncClient):
    del client
    from app.services.factory_patch_service import validate_design

    baseline = {
        "meta": {
            "name": "约束工厂",
            "width_m": 32,
            "length_m": 20,
            "grid_size_m": 1,
            "schema_version": 4,
            "updated_at": "2026-08-19T00:00:00+00:00",
        },
        "floors": [{"id": "floor-1", "level": 1, "name": "1F", "elevation_m": 0, "height_m": 4.5}],
        "objects": [
            {
                "id": "agv-1",
                "floor_id": "floor-1",
                "kind": "agv",
                "name": "A1",
                "model_ref": None,
                "transform_x": 1,
                "transform_z": 1,
                "transform_rotation_y": 0,
                "footprint_width": 1,
                "footprint_depth": 1,
                "status": "idle",
                "config": {"kind": "agv"},
            }
        ],
        "items": [],
        "recipes": [],
        "inventory": [],
        "simulation": {},
        "metrics": [],
        "activities": [],
    }
    candidate = copy.deepcopy(baseline)
    candidate["objects"] = []
    result = validate_design(
        baseline,
        candidate,
        hard_constraints=[{"key": "agv_count", "operator": "eq", "value": 1}],
    )
    assert result["ok"] is False
    assert any("agv" in error for error in result["errors"])


def _base_design() -> dict:
    return {
        "meta": {
            "name": "结构工厂",
            "width_m": 32,
            "length_m": 20,
            "grid_size_m": 1,
            "schema_version": 4,
            "updated_at": "2026-08-19T00:00:00+00:00",
        },
        "floors": [{"id": "floor-1", "level": 1, "name": "1F", "elevation_m": 0, "height_m": 4.5}],
        "objects": [
            {
                "id": "machine-1",
                "floor_id": "floor-1",
                "kind": "machine",
                "name": "加工机",
                "model_ref": None,
                "transform_x": 2,
                "transform_z": 2,
                "transform_rotation_y": 0,
                "footprint_width": 4,
                "footprint_depth": 4,
                "status": "idle",
                "config": {"kind": "machine", "recipeId": None},
            },
            {
                "id": "conveyor-1",
                "floor_id": "floor-1",
                "kind": "conveyor",
                "name": "输送",
                "model_ref": None,
                "transform_x": 0,
                "transform_z": 0,
                "transform_rotation_y": 0,
                "footprint_width": 1,
                "footprint_depth": 1,
                "status": "idle",
                "config": {
                    "kind": "conveyor",
                    "fromObjectId": "machine-1",
                    "toObjectId": None,
                    "path": [{"x": 0, "z": 0}, {"x": 2, "z": 0}],
                },
            },
        ],
        "items": [],
        "recipes": [],
        "inventory": [
            {
                "id": "inv-m1",
                "location_type": "rack-slot",
                "location_id": "machine-1",
                "item_id": "item-x",
                "quantity": 3,
                "initial_quantity": 3,
                "capacity": 10,
                "reserved_outbound_quantity": 0,
                "reserved_inbound_capacity": 0,
                "infinite_supply": False,
            }
        ],
        "simulation": {},
        "metrics": [],
        "activities": [],
    }


async def test_structural_add_remove_roundtrip_and_conveyor_guard(client: AsyncClient):
    del client
    from app.services.factory_patch_service import (
        apply_ops_in_memory,
        build_inverse_ops,
        validate_design,
    )

    baseline = _base_design()
    # inventory references missing item in baseline - strip inventory for clean structural tests
    baseline["inventory"] = []

    add_op = {
        "op_id": "op-1",
        "kind": "add_object",
        "object_id": "obj-new-buffer",
        "params": {
            "kind": "buffer",
            "floor_id": "floor-1",
            "x": 10,
            "z": 10,
            "name": "缓存-新",
            "config": {"kind": "buffer"},
        },
        "risk": "medium",
        "summary": "新增缓存",
    }
    after_add = apply_ops_in_memory(baseline, [add_op])
    assert any(obj["id"] == "obj-new-buffer" for obj in after_add["objects"])
    assert validate_design(baseline, after_add, hard_constraints=[])["ok"] is True
    inverse = build_inverse_ops(baseline, [add_op])
    assert inverse[0]["kind"] == "remove_object"
    restored = apply_ops_in_memory(after_add, inverse)
    assert {obj["id"] for obj in restored["objects"]} == {obj["id"] for obj in baseline["objects"]}

    # remove machine referenced by conveyor must fail validation
    remove_op = {
        "op_id": "op-2",
        "kind": "remove_object",
        "object_id": "machine-1",
        "params": {},
        "risk": "high",
        "summary": "删除机器",
    }
    after_remove = apply_ops_in_memory(baseline, [remove_op])
    invalid = validate_design(baseline, after_remove, hard_constraints=[])
    assert invalid["ok"] is False
    assert any("传送带" in error for error in invalid["errors"])

    # hard constraint blocks adding AGV
    add_agv = {
        "op_id": "op-3",
        "kind": "add_object",
        "object_id": "obj-agv-2",
        "params": {
            "kind": "agv",
            "floor_id": "floor-1",
            "x": 12,
            "z": 12,
            "name": "AGV-2",
            "config": {"kind": "agv"},
        },
        "risk": "medium",
        "summary": "新增 AGV",
    }
    after_agv = apply_ops_in_memory(baseline, [add_agv])
    locked = validate_design(
        baseline,
        after_agv,
        hard_constraints=[{"key": "agv_count", "operator": "eq", "value": 0}],
    )
    assert locked["ok"] is False
    assert any("agv" in error for error in locked["errors"])


async def test_structural_add_apply_and_rollback_via_api(client: AsyncClient):
    """Directly construct a validated add_object patch through analyze is optional;
    apply path is exercised by seeding factory then using service package + API."""
    from app.services.factory_patch_service import (
        apply_ops_in_memory,
        build_diff_summary,
        build_inverse_ops,
        design_from_factory,
        design_to_sync_request,
        validate_design,
    )
    from app.services.factory_service import load_full_snapshot, sync_factory_snapshot
    from app.models.agent import AgentApproval, AgentPatch, AgentRun
    from sqlalchemy import select

    headers = await _register(client, "struct")
    factory_id, before = await _seed_factory(client, headers)

    # Build structural patch ops against live factory via internal helpers, persist via analyze-like path.
    # Use API apply by inserting patch through DB session on the test client app - simpler: sync a free-space add via patch endpoints after creating run manually.

    # Create run shell
    created = await client.post(
        "/api/agent/runs",
        headers=headers,
        json={
            "factory_id": factory_id,
            "objective": "扩容缓冲能力",
            "mode": "plan_design",
        },
    )
    assert created.status_code == 201
    run_id = created.json()["id"]

    # Use pure service to make ops then write patch via apply endpoint needs existing patch.
    # Analyze may not always emit add_object; inject by applying ops through a one-off internal package:
    # We'll PUT a second machine-free design and force inventoy shortage without AGV lock, then analyze.
    # Faster path: call factory_patch_service and commit patch using HTTP is not available for raw ops.
    # So: use analyze with unlocked constraints on a factory that has capacity findings only via empty production.
    # Direct unit of API: create patch is only via analyze. Use analyze and if no add_object, fall back to
    # service-level apply simulation + sync_factory_snapshot to still cover apply_ops path already tested.
    # Instead inject via agent_run after analyze by creating patch through code using app dependency.

    from app.main import app
    from app.database import get_db

    # Grab the overridden db session from the test app
    async for db in app.dependency_overrides[get_db]():
        factory = await load_full_snapshot(factory_id, db)
        assert factory is not None
        design = design_from_factory(factory)
        add_op = {
            "op_id": "op-1",
            "kind": "add_object",
            "object_id": "obj-buffer-api",
            "params": {
                "kind": "buffer",
                "floor_id": design["floors"][0]["id"],
                "x": 20,
                "z": 10,
                "name": "API缓冲",
                "config": {"kind": "buffer"},
            },
            "preconditions": [],
            "risk": "medium",
            "summary": "新增缓冲",
        }
        candidate = apply_ops_in_memory(design, [add_op])
        validation = validate_design(design, candidate, hard_constraints=[])
        assert validation["ok"], validation
        inverse = build_inverse_ops(design, [add_op])
        diff = build_diff_summary(design, candidate, [add_op])
        run = await db.get(AgentRun, run_id)
        assert run is not None
        patch = AgentPatch(
            run_id=run_id,
            factory_id=factory_id,
            owner_id=run.owner_id,
            base_version=design["meta"]["updated_at"],
            status="awaiting_approval",
            risk_level="medium",
            idempotency_key=f"{run_id}:structural-add",
            operations=[add_op],
            inverse_operations=inverse,
            preconditions=[],
            impact={"object_ids": ["obj-buffer-api"]},
            validation=validation,
            diff_summary=diff,
        )
        db.add(patch)
        await db.flush()
        db.add(
            AgentApproval(
                patch_id=patch.id,
                run_id=run_id,
                owner_id=run.owner_id,
                status="pending",
                summary="结构变更待审批",
                risk_level="medium",
            )
        )
        run.status = "awaiting_approval"
        await db.commit()
        patch_id = patch.id
        break

    # Main factory unchanged
    snap = (await client.get(f"/api/factories/{factory_id}", headers=headers)).json()
    assert all(obj["id"] != "obj-buffer-api" for obj in snap["objects"])

    approved = await client.post(f"/api/agent/patches/{patch_id}/approve", headers=headers, json={})
    assert approved.status_code == 200
    applied = await client.post(f"/api/agent/patches/{patch_id}/apply", headers=headers)
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"] == "applied"

    after = (await client.get(f"/api/factories/{factory_id}", headers=headers)).json()
    assert any(obj["id"] == "obj-buffer-api" for obj in after["objects"])
    assert sum(1 for obj in after["objects"] if obj["kind"] == "agv") == 1

    rolled = await client.post(f"/api/agent/patches/{patch_id}/rollback", headers=headers)
    assert rolled.status_code == 200, rolled.text
    final = (await client.get(f"/api/factories/{factory_id}", headers=headers)).json()
    assert all(obj["id"] != "obj-buffer-api" for obj in final["objects"])
