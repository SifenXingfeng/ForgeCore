"""Deterministic FactoryPatch propose / validate / apply helpers for Agent A2."""

from __future__ import annotations

import copy
import hashlib
import json
import uuid
from typing import Any

from app.models.factory import Factory
from app.schemas.factory import (
    ActivityCreate,
    FactoryObjectPayload,
    FactorySyncRequest,
    FloorPayload,
    InventoryPayload,
    ItemPayload,
    MetricCreate,
    RecipePayload,
    SimulationUpsert,
)

MAX_PATCH_OPS = 8
SUPPORTED_OP_KINDS = frozenset(
    {"move_object", "update_config", "adjust_inventory", "add_object", "remove_object"}
)
STRUCTURAL_OBJECT_KINDS = frozenset({"machine", "buffer", "rack", "shelf", "agv", "drone"})
DEFAULT_FOOTPRINTS: dict[str, tuple[float, float]] = {
    "machine": (4.0, 4.0),
    "buffer": (2.0, 2.0),
    "rack": (2.0, 2.0),
    "shelf": (2.0, 1.0),
    "agv": (1.0, 1.0),
    "drone": (1.0, 1.0),
}


def design_from_factory(factory: Factory) -> dict[str, Any]:
    """Normalize an eagerly-loaded factory into a mutable design dict."""
    return {
        "meta": {
            "name": factory.name,
            "width_m": float(factory.width_m),
            "length_m": float(factory.length_m),
            "grid_size_m": float(factory.grid_size_m),
            "schema_version": int(factory.schema_version),
            "updated_at": factory.updated_at.isoformat() if factory.updated_at else "",
        },
        "floors": [
            {
                "id": floor.id,
                "level": floor.level,
                "name": floor.name,
                "elevation_m": float(floor.elevation_m),
                "height_m": float(floor.height_m),
            }
            for floor in factory.floors
        ],
        "objects": [
            {
                "id": obj.id,
                "floor_id": obj.floor_id,
                "kind": obj.kind,
                "name": obj.name,
                "model_ref": obj.model_ref,
                "transform_x": float(obj.transform_x),
                "transform_z": float(obj.transform_z),
                "transform_rotation_y": int(obj.transform_rotation_y),
                "footprint_width": float(obj.footprint_width),
                "footprint_depth": float(obj.footprint_depth),
                "status": obj.status,
                "config": copy.deepcopy(obj.config or {}),
            }
            for obj in factory.factory_objects
        ],
        "items": [
            {
                "id": item.id,
                "code": item.code,
                "name": item.name,
                "category": item.category,
                "description": item.description,
                "item_model_id": item.item_model_id,
                "model_parameters": copy.deepcopy(item.model_parameters or {}),
                "icon": item.icon,
                "mass_kg": float(item.mass_kg),
                "max_stack_size": int(item.max_stack_size),
            }
            for item in factory.items
        ],
        "recipes": [
            {
                "id": recipe.id,
                "code": recipe.code,
                "name": recipe.name,
                "description": recipe.description,
                "inputs": copy.deepcopy(recipe.inputs or []),
                "outputs": copy.deepcopy(recipe.outputs or []),
                "processing_time_sec": float(recipe.processing_time_sec),
                "enabled": bool(recipe.enabled),
            }
            for recipe in factory.recipes
        ],
        "inventory": [
            {
                "id": row.id,
                "location_type": row.location_type,
                "location_id": row.location_id,
                "item_id": row.item_id,
                "quantity": int(row.quantity),
                "initial_quantity": int(row.initial_quantity),
                "capacity": int(row.capacity),
                "reserved_outbound_quantity": int(row.reserved_outbound_quantity),
                "reserved_inbound_capacity": int(row.reserved_inbound_capacity),
                "infinite_supply": bool(row.infinite_supply),
            }
            for row in factory.inventory
        ],
        "simulation": _simulation_dict(factory),
        "metrics": [
            {
                "elapsed_sim_sec": float(sample.elapsed_sim_sec),
                "throughput_per_min": float(sample.throughput_per_min),
                "work_in_progress": int(sample.work_in_progress),
                "finished_goods": int(sample.finished_goods),
                "machine_a_utilization": float(sample.machine_a_utilization),
                "machine_b_utilization": float(sample.machine_b_utilization),
            }
            for sample in factory.metric_samples
        ],
        "activities": [
            {
                "elapsed_sim_sec": float(activity.elapsed_sim_sec),
                "title": activity.title,
                "description": activity.description,
                "tone": activity.tone,
                "object_id": activity.object_id,
            }
            for activity in factory.activities
        ],
    }


def design_to_sync_request(design: dict[str, Any], factory_id: str) -> FactorySyncRequest:
    meta = design["meta"]
    return FactorySyncRequest(
        name=str(meta["name"]),
        width_m=float(meta["width_m"]),
        length_m=float(meta["length_m"]),
        grid_size_m=float(meta["grid_size_m"]),
        schema_version=int(meta["schema_version"]),
        floors=[
            FloorPayload(
                id=str(floor["id"]),
                factory_id=factory_id,
                level=int(floor["level"]),
                name=str(floor["name"]),
                elevation_m=float(floor["elevation_m"]),
                height_m=float(floor["height_m"]),
            )
            for floor in design["floors"]
        ],
        objects=[
            FactoryObjectPayload(
                id=str(obj["id"]),
                factory_id=factory_id,
                floor_id=str(obj["floor_id"]),
                kind=str(obj["kind"]),
                name=str(obj["name"]),
                model_ref=obj.get("model_ref"),
                transform_x=float(obj["transform_x"]),
                transform_z=float(obj["transform_z"]),
                transform_rotation_y=int(obj["transform_rotation_y"]),
                footprint_width=float(obj["footprint_width"]),
                footprint_depth=float(obj["footprint_depth"]),
                status=str(obj["status"]),
                config=dict(obj.get("config") or {}),
            )
            for obj in design["objects"]
        ],
        items=[
            ItemPayload(
                id=str(item["id"]),
                factory_id=factory_id,
                code=str(item["code"]),
                name=str(item["name"]),
                category=str(item["category"]),
                description=str(item.get("description") or ""),
                item_model_id=str(item["item_model_id"]),
                model_parameters=dict(item.get("model_parameters") or {}),
                icon=item.get("icon"),
                mass_kg=float(item["mass_kg"]),
                max_stack_size=int(item["max_stack_size"]),
            )
            for item in design["items"]
        ],
        recipes=[
            RecipePayload(
                id=str(recipe["id"]),
                factory_id=factory_id,
                code=str(recipe["code"]),
                name=str(recipe["name"]),
                description=str(recipe.get("description") or ""),
                inputs=list(recipe.get("inputs") or []),
                outputs=list(recipe.get("outputs") or []),
                processing_time_sec=float(recipe["processing_time_sec"]),
                enabled=bool(recipe.get("enabled", True)),
            )
            for recipe in design["recipes"]
        ],
        inventory=[
            InventoryPayload(
                id=str(row["id"]),
                factory_id=factory_id,
                location_type=str(row["location_type"]),
                location_id=str(row["location_id"]),
                item_id=str(row["item_id"]),
                quantity=int(row["quantity"]),
                initial_quantity=int(row["initial_quantity"]),
                capacity=int(row["capacity"]),
                reserved_outbound_quantity=int(row.get("reserved_outbound_quantity") or 0),
                reserved_inbound_capacity=int(row.get("reserved_inbound_capacity") or 0),
                infinite_supply=bool(row.get("infinite_supply", False)),
            )
            for row in design["inventory"]
        ],
        simulation=SimulationUpsert(**design["simulation"]),
        metrics=[MetricCreate(**sample) for sample in design.get("metrics") or []],
        activities=[ActivityCreate(**activity) for activity in design.get("activities") or []],
    )


def apply_ops_in_memory(design: dict[str, Any], ops: list[dict[str, Any]]) -> dict[str, Any]:
    next_design = copy.deepcopy(design)
    objects = {str(obj["id"]): obj for obj in next_design["objects"]}
    inventory = list(next_design["inventory"])
    for op in ops:
        kind = str(op.get("kind", ""))
        params = dict(op.get("params") or {})
        object_id = op.get("object_id") or params.get("object_id")
        if kind == "move_object":
            obj = objects.get(str(object_id))
            if obj is None:
                raise ValueError(f"对象不存在: {object_id}")
            if "x" in params:
                obj["transform_x"] = float(params["x"])
            if "z" in params:
                obj["transform_z"] = float(params["z"])
            if params.get("floor_id"):
                obj["floor_id"] = str(params["floor_id"])
        elif kind == "update_config":
            obj = objects.get(str(object_id))
            if obj is None:
                raise ValueError(f"对象不存在: {object_id}")
            patch = dict(params.get("config_patch") or params)
            patch.pop("object_id", None)
            config = dict(obj.get("config") or {})
            config.update(patch)
            obj["config"] = config
        elif kind == "adjust_inventory":
            item_id = str(params.get("item_id") or "")
            location_id = str(object_id or params.get("location_id") or "")
            quantity = int(params["quantity"])
            matched = False
            for row in inventory:
                if str(row["location_id"]) == location_id and str(row["item_id"]) == item_id:
                    row["quantity"] = quantity
                    matched = True
                    break
            if not matched:
                raise ValueError(f"库存记录不存在: {location_id}/{item_id}")
        elif kind == "add_object":
            new_id = str(object_id or params.get("id") or f"obj-{uuid.uuid4().hex[:12]}")
            if new_id in objects:
                raise ValueError(f"对象已存在: {new_id}")
            obj_kind = str(params.get("kind") or "")
            if obj_kind not in STRUCTURAL_OBJECT_KINDS:
                raise ValueError(f"不支持新增对象类型: {obj_kind}")
            width, depth = DEFAULT_FOOTPRINTS.get(obj_kind, (1.0, 1.0))
            objects[new_id] = {
                "id": new_id,
                "floor_id": str(params.get("floor_id") or ""),
                "kind": obj_kind,
                "name": str(params.get("name") or f"{obj_kind}-{new_id[-4:]}"),
                "model_ref": params.get("model_ref"),
                "transform_x": float(params.get("x", 0)),
                "transform_z": float(params.get("z", 0)),
                "transform_rotation_y": int(params.get("rotation_y", 0)),
                "footprint_width": float(params.get("footprint_width", width)),
                "footprint_depth": float(params.get("footprint_depth", depth)),
                "status": str(params.get("status") or "idle"),
                "config": copy.deepcopy(params.get("config") or {"kind": obj_kind}),
            }
            restored_inventory = params.get("restored_inventory") or []
            if isinstance(restored_inventory, list):
                for row in restored_inventory:
                    inventory.append(copy.deepcopy(row))
            op["object_id"] = new_id
        elif kind == "remove_object":
            target_id = str(object_id or "")
            if target_id not in objects:
                raise ValueError(f"对象不存在: {target_id}")
            removed = objects.pop(target_id)
            if str(removed.get("kind")) == "conveyor":
                raise ValueError("本切片不支持删除传送带")
            inventory = [row for row in inventory if str(row["location_id"]) != target_id]
        else:
            raise ValueError(f"不支持的操作类型: {kind}")
    next_design["inventory"] = inventory
    next_design["objects"] = list(objects.values())
    return next_design


def build_inverse_ops(design: dict[str, Any], ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    objects = {str(obj["id"]): obj for obj in design["objects"]}
    inventory_by_location: dict[str, list[dict[str, Any]]] = {}
    for row in design["inventory"]:
        inventory_by_location.setdefault(str(row["location_id"]), []).append(copy.deepcopy(row))
    inventory_index = {
        (str(row["location_id"]), str(row["item_id"])): row for row in design["inventory"]
    }
    inverse: list[dict[str, Any]] = []
    for index, op in enumerate(reversed(ops)):
        kind = str(op.get("kind", ""))
        params = dict(op.get("params") or {})
        object_id = str(op.get("object_id") or params.get("object_id") or "")
        if kind == "move_object":
            obj = objects[object_id]
            inverse.append(
                {
                    "op_id": f"inv-{index + 1}",
                    "kind": "move_object",
                    "object_id": object_id,
                    "params": {
                        "x": float(obj["transform_x"]),
                        "z": float(obj["transform_z"]),
                        "floor_id": str(obj["floor_id"]),
                    },
                    "preconditions": [{"type": "object_exists", "object_id": object_id}],
                    "risk": op.get("risk", "low"),
                    "summary": f"还原 {obj.get('name', object_id)} 位置",
                }
            )
        elif kind == "update_config":
            obj = objects[object_id]
            patch = dict(params.get("config_patch") or params)
            patch.pop("object_id", None)
            old_config = dict(obj.get("config") or {})
            restore = {key: old_config.get(key) for key in patch}
            inverse.append(
                {
                    "op_id": f"inv-{index + 1}",
                    "kind": "update_config",
                    "object_id": object_id,
                    "params": {"config_patch": restore},
                    "preconditions": [{"type": "object_exists", "object_id": object_id}],
                    "risk": op.get("risk", "low"),
                    "summary": f"还原 {obj.get('name', object_id)} 配置",
                }
            )
        elif kind == "adjust_inventory":
            item_id = str(params.get("item_id") or "")
            row = inventory_index[(object_id, item_id)]
            inverse.append(
                {
                    "op_id": f"inv-{index + 1}",
                    "kind": "adjust_inventory",
                    "object_id": object_id,
                    "params": {"item_id": item_id, "quantity": int(row["quantity"])},
                    "preconditions": [{"type": "inventory_exists", "location_id": object_id, "item_id": item_id}],
                    "risk": op.get("risk", "medium"),
                    "summary": f"还原库存 {item_id}@{object_id}",
                }
            )
        elif kind == "add_object":
            inverse.append(
                {
                    "op_id": f"inv-{index + 1}",
                    "kind": "remove_object",
                    "object_id": object_id,
                    "params": {},
                    "preconditions": [{"type": "object_exists", "object_id": object_id}],
                    "risk": op.get("risk", "medium"),
                    "summary": f"删除新增对象 {object_id}",
                }
            )
        elif kind == "remove_object":
            obj = objects[object_id]
            restore_params = {
                "kind": str(obj["kind"]),
                "floor_id": str(obj["floor_id"]),
                "x": float(obj["transform_x"]),
                "z": float(obj["transform_z"]),
                "rotation_y": int(obj["transform_rotation_y"]),
                "footprint_width": float(obj["footprint_width"]),
                "footprint_depth": float(obj["footprint_depth"]),
                "name": str(obj.get("name") or object_id),
                "model_ref": obj.get("model_ref"),
                "status": str(obj.get("status") or "idle"),
                "config": copy.deepcopy(obj.get("config") or {}),
                "restored_inventory": inventory_by_location.get(object_id, []),
            }
            inverse.append(
                {
                    "op_id": f"inv-{index + 1}",
                    "kind": "add_object",
                    "object_id": object_id,
                    "params": restore_params,
                    "preconditions": [{"type": "object_missing", "object_id": object_id}],
                    "risk": op.get("risk", "high"),
                    "summary": f"恢复对象 {obj.get('name', object_id)}",
                }
            )
        else:
            raise ValueError(f"不支持的操作类型: {kind}")
    return inverse


def validate_design(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    *,
    hard_constraints: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    floor_ids = {str(floor["id"]) for floor in candidate["floors"]}
    item_ids = {str(item["id"]) for item in candidate["items"]}
    object_ids = {str(obj["id"]) for obj in candidate["objects"]}
    baseline_ids = {str(obj["id"]) for obj in baseline["objects"]}
    width = float(candidate["meta"]["width_m"])
    length = float(candidate["meta"]["length_m"])

    if float(candidate["meta"]["width_m"]) != float(baseline["meta"]["width_m"]) or float(
        candidate["meta"]["length_m"]
    ) != float(baseline["meta"]["length_m"]):
        errors.append("厂区面积不可在本切片 Patch 中修改")

    for obj in candidate["objects"]:
        kind = str(obj["kind"])
        if kind not in STRUCTURAL_OBJECT_KINDS | {"conveyor"}:
            errors.append(f"对象 {obj['id']} 类型非法: {kind}")
        if str(obj["floor_id"]) not in floor_ids:
            errors.append(f"对象 {obj['id']} 引用了不存在的楼层 {obj['floor_id']}")
        fw = float(obj["footprint_width"])
        fd = float(obj["footprint_depth"])
        if fw <= 0 or fd <= 0:
            errors.append(f"对象 {obj['id']} 的占地无效")
        x = float(obj["transform_x"])
        z = float(obj["transform_z"])
        if kind != "conveyor" and (
            x < -1e-6 or z < -1e-6 or x + fw > width + 1e-6 or z + fd > length + 1e-6
        ):
            errors.append(f"对象 {obj['id']} 超出厂区边界")
        if kind == "conveyor":
            config = dict(obj.get("config") or {})
            for key in ("fromObjectId", "toObjectId"):
                ref = config.get(key)
                if ref and str(ref) not in object_ids:
                    errors.append(f"传送带 {obj['id']} 引用了不存在的对象 {ref}")

    removed_ids = baseline_ids - object_ids
    for obj in candidate["objects"]:
        if str(obj["kind"]) != "conveyor":
            continue
        config = dict(obj.get("config") or {})
        for key in ("fromObjectId", "toObjectId"):
            ref = config.get(key)
            if ref and str(ref) in removed_ids:
                errors.append(f"不能删除仍被传送带 {obj['id']} 引用的对象 {ref}")

    for recipe in candidate["recipes"]:
        for line in list(recipe.get("inputs") or []) + list(recipe.get("outputs") or []):
            item_id = str(dict(line).get("itemId") or "")
            if item_id and item_id not in item_ids:
                errors.append(f"配方 {recipe['id']} 引用了不存在的物品 {item_id}")

    for row in candidate["inventory"]:
        if int(row["quantity"]) < 0:
            errors.append(f"库存 {row['id']} 数量不能为负")
        if str(row["item_id"]) not in item_ids:
            errors.append(f"库存 {row['id']} 引用了不存在的物品 {row['item_id']}")
        location_id = str(row["location_id"])
        if location_id not in object_ids and str(row["location_type"]) != "finished-goods":
            errors.append(f"库存 {row['id']} 引用了不存在的位置 {location_id}")
        capacity = int(row.get("capacity") or 0)
        if capacity > 0 and int(row["quantity"]) > capacity and not bool(row.get("infinite_supply")):
            errors.append(f"库存 {row['id']} 数量超过容量")

    facilities = [obj for obj in candidate["objects"] if str(obj["kind"]) != "conveyor"]
    for index, left in enumerate(facilities):
        for right in facilities[index + 1 :]:
            if str(left["floor_id"]) != str(right["floor_id"]):
                continue
            if _footprints_overlap(left, right):
                errors.append(f"对象 {left['id']} 与 {right['id']} 占地冲突")

    candidate_counts = _kind_counts(candidate)
    for constraint in hard_constraints or []:
        key = str(constraint.get("key") or "")
        operator = str(constraint.get("operator") or "eq")
        value = constraint.get("value")
        if key == "floor_area_m2" and operator == "eq" and value is not None:
            area = float(candidate["meta"]["width_m"]) * float(candidate["meta"]["length_m"])
            if abs(area - float(value)) > 1e-6:
                errors.append("硬约束要求面积保持不变")
        elif key.endswith("_count") and operator == "eq" and value is not None:
            kind = key.removesuffix("_count")
            if candidate_counts.get(kind, 0) != int(value):
                errors.append(f"硬约束要求 {kind} 数量保持为 {value}")

    if not candidate["floors"]:
        errors.append("至少需要一层楼层")

    return {"ok": not errors, "errors": errors, "warnings": warnings}


def build_diff_summary(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    ops: list[dict[str, Any]],
) -> dict[str, Any]:
    baseline_objects = {str(obj["id"]): obj for obj in baseline["objects"]}
    candidate_objects = {str(obj["id"]): obj for obj in candidate["objects"]}
    moved: list[dict[str, Any]] = []
    config_changed: list[dict[str, Any]] = []
    added = [
        {"object_id": object_id, "name": obj.get("name"), "kind": obj.get("kind")}
        for object_id, obj in candidate_objects.items()
        if object_id not in baseline_objects
    ]
    removed = [
        {"object_id": object_id, "name": obj.get("name"), "kind": obj.get("kind")}
        for object_id, obj in baseline_objects.items()
        if object_id not in candidate_objects
    ]
    for object_id, before in baseline_objects.items():
        after = candidate_objects.get(object_id)
        if after is None:
            continue
        if (
            float(before["transform_x"]) != float(after["transform_x"])
            or float(before["transform_z"]) != float(after["transform_z"])
            or str(before["floor_id"]) != str(after["floor_id"])
        ):
            moved.append(
                {
                    "object_id": object_id,
                    "name": after.get("name"),
                    "from": {
                        "x": before["transform_x"],
                        "z": before["transform_z"],
                        "floor_id": before["floor_id"],
                    },
                    "to": {
                        "x": after["transform_x"],
                        "z": after["transform_z"],
                        "floor_id": after["floor_id"],
                    },
                }
            )
        if before.get("config") != after.get("config"):
            config_changed.append({"object_id": object_id, "name": after.get("name")})

    baseline_inv = {
        (str(row["location_id"]), str(row["item_id"])): int(row["quantity"]) for row in baseline["inventory"]
    }
    candidate_inv_keys = {
        (str(row["location_id"]), str(row["item_id"])) for row in candidate["inventory"]
    }
    inventory_changed: list[dict[str, Any]] = []
    for row in candidate["inventory"]:
        key = (str(row["location_id"]), str(row["item_id"]))
        before_qty = baseline_inv.get(key)
        after_qty = int(row["quantity"])
        if before_qty is None or before_qty != after_qty:
            inventory_changed.append(
                {"location_id": key[0], "item_id": key[1], "from": before_qty, "to": after_qty}
            )
    for key, before_qty in baseline_inv.items():
        if key not in candidate_inv_keys:
            inventory_changed.append(
                {"location_id": key[0], "item_id": key[1], "from": before_qty, "to": None}
            )

    return {
        "operation_count": len(ops),
        "moved_object_count": len(moved),
        "config_change_count": len(config_changed),
        "inventory_change_count": len(inventory_changed),
        "added_object_count": len(added),
        "removed_object_count": len(removed),
        "moved_objects": moved,
        "config_changes": config_changed,
        "inventory_changes": inventory_changed,
        "added_objects": added,
        "removed_objects": removed,
        "operations": [
            {
                "op_id": op.get("op_id"),
                "kind": op.get("kind"),
                "object_id": op.get("object_id"),
                "summary": op.get("summary") or _default_op_summary(op),
                "risk": op.get("risk", "low"),
            }
            for op in ops
        ],
    }


def propose_ops_from_analysis(
    factory: Factory,
    findings: list[dict[str, Any]],
    goal: dict[str, Any] | None = None,
    *,
    rejected_operations: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Rule-based proposer: inventory/config first, then structural add when unlocked."""
    design = design_from_factory(factory)
    slot_design = copy.deepcopy(design)
    goal = goal or {}
    rejected_operations = rejected_operations or []
    rejected_signatures = {_operation_signature(op) for op in rejected_operations}
    rejected_remove_ids = {
        str(op.get("object_id")) for op in rejected_operations if str(op.get("kind")) == "remove_object"
    }
    for index, op in enumerate(rejected_operations):
        if str(op.get("kind")) != "add_object":
            continue
        params = dict(op.get("params") or {})
        default_width, default_depth = DEFAULT_FOOTPRINTS.get(str(params.get("kind")), (1, 1))
        slot_design["objects"].append(
            {
                "id": f"__rejected-placement-{index}",
                "floor_id": str(params.get("floor_id") or ""),
                "kind": str(params.get("kind") or "machine"),
                "transform_x": float(params.get("x") or 0),
                "transform_z": float(params.get("z") or 0),
                "footprint_width": float(params.get("footprint_width") or default_width),
                "footprint_depth": float(params.get("footprint_depth") or default_depth),
            }
        )
    hard_constraints = [c for c in (goal.get("hard_constraints") or []) if isinstance(c, dict)]
    locked = _locked_count_kinds(hard_constraints)
    ops: list[dict[str, Any]] = []
    finding_ids = {str(item.get("id")) for item in findings}
    finding_categories = {str(item.get("category")) for item in findings}
    objective = str(goal.get("objective") or "").lower()

    def try_append(op: dict[str, Any]) -> bool:
        if len(ops) >= MAX_PATCH_OPS:
            return False
        if _operation_signature(op) in rejected_signatures:
            return False
        trial_ops = [*ops, op]
        try:
            candidate = apply_ops_in_memory(design, trial_ops)
        except ValueError:
            return False
        validation = validate_design(design, candidate, hard_constraints=hard_constraints)
        if not validation["ok"]:
            return False
        ops.append(op)
        if str(op.get("kind")) == "add_object":
            try:
                updated_slot_design = apply_ops_in_memory(slot_design, [copy.deepcopy(op)])
                slot_design["objects"] = updated_slot_design["objects"]
            except ValueError:
                pass
        return True

    requested_kind = next(
        (
            kind
            for kind, tokens in (
                ("drone", ("无人机", "drone")),
                ("agv", ("agv",)),
                ("rack", ("仓库", "warehouse", "rack")),
                ("shelf", ("货架", "shelf")),
                ("buffer", ("缓冲区", "buffer")),
                ("machine", ("机器", "设备", "machine")),
            )
            if any(token in objective for token in tokens)
        ),
        None,
    )
    requests_add = any(token in objective for token in ("新增", "增加", "添加", "add", "扩容"))
    requests_remove = any(token in objective for token in ("删除", "移除", "拆除", "remove", "delete"))

    if requests_remove:
        referenced = {
            str(config.get(key))
            for obj in design["objects"]
            if str(obj.get("kind")) == "conveyor"
            for config in [dict(obj.get("config") or {})]
            for key in ("fromObjectId", "toObjectId")
            if config.get(key)
        }
        for obj in design["objects"]:
            object_id = str(obj.get("id") or "")
            if (
                str(obj.get("kind")) == "conveyor"
                or object_id in referenced
                or object_id in rejected_remove_ids
                or (requested_kind and str(obj.get("kind")) != requested_kind)
            ):
                continue
            if try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "remove_object",
                    "object_id": object_id,
                    "params": {},
                    "preconditions": [{"type": "object_exists", "object_id": object_id}],
                    "risk": "high",
                    "summary": f"移除 {obj.get('name', object_id)}",
                }
            ):
                break

    if requests_add and requested_kind and requested_kind not in locked:
        slot = _find_free_slot(slot_design, footprint=DEFAULT_FOOTPRINTS[requested_kind])
        if slot is not None:
            new_id = f"obj-{uuid.uuid4().hex[:12]}"
            config: dict[str, Any] = {"kind": requested_kind}
            if requested_kind == "machine":
                template = next((obj for obj in design["objects"] if str(obj.get("kind")) == "machine"), None)
                template_config = dict(template.get("config") or {}) if template else {}
                config = copy.deepcopy(template_config) or {
                    "kind": "machine", "recipeId": None, "inputCapacity": 6, "outputCapacity": 6,
                    "speedMultiplier": 1, "inputPortCount": 3, "outputPortCount": 3,
                }
            elif requested_kind == "agv":
                config.update({"speedMps": 1.5, "maxPayloadKg": 50})
            elif requested_kind == "drone":
                config.update({"speedMps": 3, "maxPayloadKg": 30})
            elif requested_kind == "rack":
                config.update({"dispatchIntervalSecByPort": [2, 2, 2]})
            try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "add_object",
                    "object_id": new_id,
                    "params": {
                        "kind": requested_kind,
                        "floor_id": slot["floor_id"],
                        "x": slot["x"],
                        "z": slot["z"],
                        "name": f"Agent {requested_kind}",
                        "config": config,
                    },
                    "preconditions": [{"type": "floor_exists", "floor_id": slot["floor_id"]}],
                    "risk": "medium",
                    "summary": f"新增 {requested_kind}",
                }
            )

    if "inventory-shortage" in finding_ids or "inventory" in finding_categories:
        for row in design["inventory"]:
            if bool(row.get("infinite_supply")) or int(row["quantity"]) > 0:
                continue
            capacity = int(row.get("capacity") or 0)
            target = capacity if capacity > 0 else max(int(row.get("initial_quantity") or 0), 10)
            try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "adjust_inventory",
                    "object_id": str(row["location_id"]),
                    "params": {"item_id": str(row["item_id"]), "quantity": target},
                    "preconditions": [
                        {
                            "type": "inventory_exists",
                            "location_id": str(row["location_id"]),
                            "item_id": str(row["item_id"]),
                        }
                    ],
                    "risk": "medium",
                    "summary": f"补充库存 {row['item_id']} 至 {target}",
                }
            )

    capacity_pressure = any(
        str(item.get("id", "")).startswith("machine-capacity-")
        or str(item.get("id", "")).startswith("machine-blocked-")
        for item in findings
    ) or "production" in finding_categories
    if capacity_pressure and "machine" not in locked:
        template = next((obj for obj in design["objects"] if str(obj["kind"]) == "machine"), None)
        slot = _find_free_slot(slot_design, footprint=DEFAULT_FOOTPRINTS["machine"])
        if template is not None and slot is not None:
            new_id = f"obj-{uuid.uuid4().hex[:12]}"
            config = copy.deepcopy(template.get("config") or {"kind": "machine"})
            try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "add_object",
                    "object_id": new_id,
                    "params": {
                        "kind": "machine",
                        "floor_id": slot["floor_id"],
                        "x": slot["x"],
                        "z": slot["z"],
                        "rotation_y": int(template.get("transform_rotation_y") or 0),
                        "footprint_width": float(template.get("footprint_width") or 4),
                        "footprint_depth": float(template.get("footprint_depth") or 4),
                        "name": f"{template.get('name', '机器')}-扩容",
                        "config": config,
                    },
                    "preconditions": [{"type": "floor_exists", "floor_id": slot["floor_id"]}],
                    "risk": "medium",
                    "summary": "新增机器以缓解产能压力",
                }
            )

    logistics_pressure = "logistics" in finding_categories or any(
        str(item_id).endswith("-blocked") for item_id in finding_ids
    )
    if logistics_pressure and "agv" not in locked:
        slot = _find_free_slot(slot_design, footprint=DEFAULT_FOOTPRINTS["agv"])
        if slot is not None:
            new_id = f"obj-{uuid.uuid4().hex[:12]}"
            try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "add_object",
                    "object_id": new_id,
                    "params": {
                        "kind": "agv",
                        "floor_id": slot["floor_id"],
                        "x": slot["x"],
                        "z": slot["z"],
                        "name": "AGV-扩容",
                        "config": {"kind": "agv", "speedMps": 1.5, "maxPayloadKg": 50},
                    },
                    "preconditions": [{"type": "floor_exists", "floor_id": slot["floor_id"]}],
                    "risk": "medium",
                    "summary": "新增 AGV 以缓解物流压力",
                }
            )

    if ("inventory-shortage" in finding_ids or "inventory" in finding_categories) and not any(
        str(obj["kind"]) in {"rack", "buffer", "shelf"} for obj in design["objects"]
    ):
        slot = _find_free_slot(slot_design, footprint=DEFAULT_FOOTPRINTS["rack"])
        if slot is not None:
            new_id = f"obj-{uuid.uuid4().hex[:12]}"
            try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "add_object",
                    "object_id": new_id,
                    "params": {
                        "kind": "rack",
                        "floor_id": slot["floor_id"],
                        "x": slot["x"],
                        "z": slot["z"],
                        "name": "原料仓-扩容",
                        "config": {"kind": "rack", "dispatchIntervalSecByPort": [2, 2, 2]},
                    },
                    "preconditions": [{"type": "floor_exists", "floor_id": slot["floor_id"]}],
                    "risk": "medium",
                    "summary": "新增货架以承载库存",
                }
            )

    if logistics_pressure:
        for obj in design["objects"]:
            if str(obj["kind"]) != "agv":
                continue
            config = dict(obj.get("config") or {})
            speed = float(config.get("speedMps") or 1.5)
            next_speed = min(6.0, round(speed + 0.5, 2))
            if next_speed <= speed:
                continue
            if try_append(
                {
                    "op_id": f"op-{len(ops) + 1}",
                    "kind": "update_config",
                    "object_id": str(obj["id"]),
                    "params": {"config_patch": {"speedMps": next_speed}},
                    "preconditions": [{"type": "object_exists", "object_id": str(obj["id"])}],
                    "risk": "low",
                    "summary": f"提高 {obj.get('name', obj['id'])} 速度至 {next_speed}",
                }
            ):
                break

    if not ops:
        grid = float(design["meta"]["grid_size_m"] or 1)
        for obj in design["objects"]:
            if str(obj["kind"]) != "agv":
                continue
            trial = {
                "op_id": "op-1",
                "kind": "move_object",
                "object_id": str(obj["id"]),
                "params": {
                    "x": float(obj["transform_x"]) + grid,
                    "z": float(obj["transform_z"]),
                    "floor_id": str(obj["floor_id"]),
                },
                "preconditions": [{"type": "object_exists", "object_id": str(obj["id"])}],
                "risk": "low",
                "summary": f"移动 {obj.get('name', obj['id'])} 至邻近格",
            }
            if try_append(trial):
                break

    if not ops:
        for obj in design["objects"]:
            if str(obj["kind"]) not in {"rack", "buffer", "shelf"}:
                continue
            config = dict(obj.get("config") or {})
            if "dispatchIntervalSecByPort" in config and isinstance(config["dispatchIntervalSecByPort"], list):
                ports = [max(0.5, float(value) * 0.9) for value in config["dispatchIntervalSecByPort"]]
                try_append(
                    {
                        "op_id": "op-1",
                        "kind": "update_config",
                        "object_id": str(obj["id"]),
                        "params": {"config_patch": {"dispatchIntervalSecByPort": ports}},
                        "preconditions": [{"type": "object_exists", "object_id": str(obj["id"])}],
                        "risk": "low",
                        "summary": f"加快 {obj.get('name', obj['id'])} 出库节拍",
                    }
                )
                break

    for index, op in enumerate(ops, start=1):
        op["op_id"] = f"op-{index}"
    return ops[:MAX_PATCH_OPS]


def build_patch_package(
    factory: Factory,
    findings: list[dict[str, Any]],
    goal: dict[str, Any] | None = None,
    *,
    run_id: str,
    rejected_operations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    baseline = design_from_factory(factory)
    goal = goal or {}
    hard_constraints = list(goal.get("hard_constraints") or [])
    ops = propose_ops_from_analysis(factory, findings, goal, rejected_operations=rejected_operations)
    if not ops:
        return {
            "operations": [],
            "inverse_operations": [],
            "preconditions": [],
            "impact": {"object_ids": [], "reason": "no_safe_ops"},
            "validation": {
                "ok": False,
                "errors": [],
                "warnings": ["当前诊断未找到可在约束内自动生成的合法 Patch"],
            },
            "diff_summary": {
                "operation_count": 0,
                "moved_object_count": 0,
                "config_change_count": 0,
                "inventory_change_count": 0,
                "added_object_count": 0,
                "removed_object_count": 0,
                "moved_objects": [],
                "config_changes": [],
                "inventory_changes": [],
                "added_objects": [],
                "removed_objects": [],
                "operations": [],
            },
            "risk_level": "low",
            "idempotency_key": f"{run_id}:empty",
            "base_version": baseline["meta"]["updated_at"],
        }

    candidate = apply_ops_in_memory(baseline, ops)
    validation = validate_design(baseline, candidate, hard_constraints=hard_constraints)
    inverse = build_inverse_ops(baseline, ops) if validation["ok"] else []
    diff = build_diff_summary(baseline, candidate, ops)
    object_ids = sorted(
        {
            str(op.get("object_id"))
            for op in ops
            if op.get("object_id")
        }
    )
    risk_level = _highest_risk([str(op.get("risk") or "low") for op in ops])
    payload = {
        "operations": ops,
        "inverse_operations": inverse,
        "preconditions": _collect_preconditions(ops),
        "impact": {
            "object_ids": object_ids,
            "hard_constraints": hard_constraints,
            "kind_counts_before": _kind_counts(baseline),
            "kind_counts_after": _kind_counts(candidate),
        },
        "validation": validation,
        "diff_summary": diff,
        "risk_level": risk_level,
        "base_version": baseline["meta"]["updated_at"],
    }
    payload["idempotency_key"] = f"{run_id}:{_ops_hash(ops)}"
    return payload


def version_token(factory: Factory) -> str:
    return factory.updated_at.isoformat() if factory.updated_at else ""


def versions_match(factory: Factory, base_version: str) -> bool:
    return version_token(factory) == base_version


def _simulation_dict(factory: Factory) -> dict[str, Any]:
    sim = factory.simulation
    if sim is None:
        return SimulationUpsert().model_dump()
    return {
        "status": sim.status,
        "speed": int(sim.speed),
        "elapsed_sim_sec": float(sim.elapsed_sim_sec),
        "tick_count": int(sim.tick_count),
        "seed": int(sim.seed),
        "accumulated_unstepped_sec": float(sim.accumulated_unstepped_sec),
        "machine_runtime": copy.deepcopy(sim.machine_runtime or {}),
        "agv_runtime": copy.deepcopy(sim.agv_runtime or {}),
        "drone_runtime": copy.deepcopy(sim.drone_runtime or {}),
        "transit_items": copy.deepcopy(sim.transit_items or []),
        "warehouse_dispatch_cooldown_sec_by_port": copy.deepcopy(
            sim.warehouse_dispatch_cooldown_sec_by_port or {}
        ),
        "source_feed_cooldown_sec": float(sim.source_feed_cooldown_sec),
        "next_transit_sequence": int(sim.next_transit_sequence),
        "next_metric_sample_at_sec": float(sim.next_metric_sample_at_sec),
        "production_events_sec": list(sim.production_events_sec or []),
        "completed_transport_durations_sec": list(sim.completed_transport_durations_sec or []),
        "total_finished": int(sim.total_finished),
    }


def _footprints_overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_rect = _footprint_rect(left)
    right_rect = _footprint_rect(right)
    return (
        left_rect["min_x"] < right_rect["max_x"]
        and left_rect["max_x"] > right_rect["min_x"]
        and left_rect["min_z"] < right_rect["max_z"]
        and left_rect["max_z"] > right_rect["min_z"]
    )


def _footprint_rect(obj: dict[str, Any]) -> dict[str, float]:
    x = float(obj["transform_x"])
    z = float(obj["transform_z"])
    width = float(obj["footprint_width"])
    depth = float(obj["footprint_depth"])
    return {"min_x": x, "max_x": x + width, "min_z": z, "max_z": z + depth}


def _kind_counts(design: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for obj in design["objects"]:
        kind = str(obj["kind"])
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def _highest_risk(levels: list[str]) -> str:
    order = {"low": 0, "medium": 1, "high": 2}
    best = "low"
    for level in levels:
        if order.get(level, 0) > order[best]:
            best = level
    return best


def _collect_preconditions(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for op in ops:
        for precondition in op.get("preconditions") or []:
            key = json.dumps(precondition, sort_keys=True, ensure_ascii=False)
            if key in seen:
                continue
            seen.add(key)
            collected.append(dict(precondition))
    return collected


def _ops_hash(ops: list[dict[str, Any]]) -> str:
    raw = json.dumps(ops, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _operation_signature(op: dict[str, Any]) -> tuple[object, ...]:
    kind = str(op.get("kind") or "")
    params = dict(op.get("params") or {})
    if kind == "add_object":
        return (
            kind,
            str(params.get("kind") or ""),
            str(params.get("floor_id") or ""),
            float(params.get("x") or 0),
            float(params.get("z") or 0),
        )
    if kind == "update_config":
        config_signature = json.dumps(params.get("config_patch") or params, sort_keys=True, default=str)
        return (kind, str(op.get("object_id") or ""), config_signature)
    if kind == "move_object":
        return (kind, str(op.get("object_id") or ""), float(params.get("x") or 0), float(params.get("z") or 0))
    return (kind, str(op.get("object_id") or ""))




def _locked_count_kinds(hard_constraints: list[dict[str, Any]] | None) -> set[str]:
    locked: set[str] = set()
    for constraint in hard_constraints or []:
        key = str(constraint.get("key") or "")
        if key.endswith("_count") and str(constraint.get("operator") or "eq") == "eq":
            locked.add(key.removesuffix("_count"))
    return locked


def _find_free_slot(
    design: dict[str, Any],
    *,
    footprint: tuple[float, float],
    margin: float = 0.0,
) -> dict[str, Any] | None:
    width_m = float(design["meta"]["width_m"])
    length_m = float(design["meta"]["length_m"])
    grid = float(design["meta"]["grid_size_m"] or 1)
    fw, fd = footprint
    floors = design["floors"] or [{"id": "floor-1"}]
    facilities = [obj for obj in design["objects"] if str(obj["kind"]) != "conveyor"]
    for floor in floors:
        floor_id = str(floor["id"])
        x = 0.0
        while x + fw <= width_m + 1e-9:
            z = 0.0
            while z + fd <= length_m + 1e-9:
                candidate = {
                    "id": "__probe__",
                    "floor_id": floor_id,
                    "transform_x": x,
                    "transform_z": z,
                    "footprint_width": fw,
                    "footprint_depth": fd,
                }
                blocked = False
                for other in facilities:
                    if str(other["floor_id"]) != floor_id:
                        continue
                    if _footprints_overlap(candidate, other):
                        blocked = True
                        break
                if not blocked:
                    return {"floor_id": floor_id, "x": x, "z": z}
                z += grid
            x += grid
    del margin
    return None


def _default_op_summary(op: dict[str, Any]) -> str:
    kind = str(op.get("kind") or "")
    object_id = op.get("object_id") or ""
    if kind == "move_object":
        return f"移动对象 {object_id}"
    if kind == "update_config":
        return f"更新配置 {object_id}"
    if kind == "adjust_inventory":
        return f"调整库存 {object_id}"
    if kind == "add_object":
        return f"新增对象 {object_id}"
    if kind == "remove_object":
        return f"删除对象 {object_id}"
    return kind or "未知操作"


def new_op_id() -> str:
    return f"op-{uuid.uuid4().hex[:8]}"
