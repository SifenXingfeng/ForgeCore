"""Deterministic, versioned dependency graph for Agent evidence."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from app.models.factory import Factory

GRAPH_SCHEMA_VERSION = 1
FINISHED_GOODS_NODE_ID = "external:finished-goods"


def build_factory_graph(factory: Factory) -> dict[str, Any]:
    """Build a stable graph from an eagerly loaded factory snapshot."""
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    invalid_references: list[dict[str, str]] = []

    object_by_id = {obj.id: obj for obj in factory.factory_objects}
    item_by_id = {item.id: item for item in factory.items}
    recipe_by_id = {recipe.id: recipe for recipe in factory.recipes}

    for item in sorted(factory.items, key=lambda value: value.id):
        nodes.append(
            {
                "id": item.id,
                "node_type": "item",
                "kind": item.category,
                "label": item.name,
                "attributes": {"code": item.code, "mass_kg": item.mass_kg},
            }
        )
    for recipe in sorted(factory.recipes, key=lambda value: value.id):
        nodes.append(
            {
                "id": recipe.id,
                "node_type": "recipe",
                "kind": "enabled" if recipe.enabled else "disabled",
                "label": recipe.name,
                "attributes": {
                    "code": recipe.code,
                    "processing_time_sec": recipe.processing_time_sec,
                    "enabled": recipe.enabled,
                },
            }
        )
    for obj in sorted(factory.factory_objects, key=lambda value: value.id):
        nodes.append(
            {
                "id": obj.id,
                "node_type": "object",
                "kind": obj.kind,
                "label": obj.name,
                "attributes": {
                    "floor_id": obj.floor_id,
                    "status": obj.status,
                    "position": {"x": obj.transform_x, "z": obj.transform_z},
                },
            }
        )

    needs_finished_goods = any(
        _dict(obj.config).get("toObjectId") == "finished-goods" for obj in factory.factory_objects
    ) or any(record.location_type == "finished-goods" for record in factory.inventory)
    if needs_finished_goods:
        nodes.append(
            {
                "id": FINISHED_GOODS_NODE_ID,
                "node_type": "external",
                "kind": "finished-goods",
                "label": "成品区",
                "attributes": {},
            }
        )

    producers_by_item: dict[str, list[str]] = defaultdict(list)
    consumers_by_item: dict[str, list[str]] = defaultdict(list)
    for recipe in sorted(factory.recipes, key=lambda value: value.id):
        for position, line in enumerate(recipe.inputs):
            item_id, quantity = _recipe_line(line)
            if item_id is None:
                invalid_references.append(_invalid("recipe_input", recipe.id, "", "配方输入缺少物品 ID"))
                continue
            if item_id not in item_by_id:
                invalid_references.append(_invalid("recipe_input", recipe.id, item_id, "配方输入引用不存在的物品"))
                continue
            consumers_by_item[item_id].append(recipe.id)
            edges.append(
                _edge(
                    f"recipe:{recipe.id}:input:{position}:{item_id}",
                    "recipe_consumes",
                    item_id,
                    recipe.id,
                    item_id=item_id,
                    quantity=quantity,
                    enabled=recipe.enabled,
                )
            )
        for position, line in enumerate(recipe.outputs):
            item_id, quantity = _recipe_line(line)
            if item_id is None:
                invalid_references.append(_invalid("recipe_output", recipe.id, "", "配方输出缺少物品 ID"))
                continue
            if item_id not in item_by_id:
                invalid_references.append(_invalid("recipe_output", recipe.id, item_id, "配方输出引用不存在的物品"))
                continue
            producers_by_item[item_id].append(recipe.id)
            edges.append(
                _edge(
                    f"recipe:{recipe.id}:output:{position}:{item_id}",
                    "recipe_produces",
                    recipe.id,
                    item_id,
                    item_id=item_id,
                    quantity=quantity,
                    enabled=recipe.enabled,
                )
            )

    for item_id in sorted(set(producers_by_item) & set(consumers_by_item)):
        for producer_id in sorted(producers_by_item[item_id]):
            for consumer_id in sorted(consumers_by_item[item_id]):
                if producer_id == consumer_id:
                    continue
                edges.append(
                    _edge(
                        f"dependency:{producer_id}:{consumer_id}:{item_id}",
                        "recipe_dependency",
                        producer_id,
                        consumer_id,
                        item_id=item_id,
                    )
                )

    for machine in sorted(
        (obj for obj in factory.factory_objects if obj.kind == "machine"), key=lambda value: value.id
    ):
        recipe_id = _dict(machine.config).get("recipeId")
        if not isinstance(recipe_id, str) or not recipe_id:
            continue
        if recipe_id not in recipe_by_id:
            invalid_references.append(_invalid("machine_binding", machine.id, recipe_id, "机器引用不存在的配方"))
            continue
        edges.append(
            _edge(
                f"binding:{machine.id}:{recipe_id}",
                "machine_binding",
                machine.id,
                recipe_id,
                enabled=recipe_by_id[recipe_id].enabled,
            )
        )

    for conveyor in sorted(
        (obj for obj in factory.factory_objects if obj.kind == "conveyor"), key=lambda value: value.id
    ):
        config = _dict(conveyor.config)
        source_id = config.get("fromObjectId")
        raw_target_id = config.get("toObjectId")
        target_id = FINISHED_GOODS_NODE_ID if raw_target_id == "finished-goods" else raw_target_id
        if not isinstance(source_id, str) or not source_id:
            invalid_references.append(_invalid("conveyor_source", conveyor.id, "", "传送带缺少起点"))
            continue
        if source_id not in object_by_id:
            invalid_references.append(_invalid("conveyor_source", conveyor.id, source_id, "传送带起点不存在"))
            continue
        if not isinstance(target_id, str) or not target_id:
            invalid_references.append(_invalid("conveyor_target", conveyor.id, "", "传送带缺少终点"))
            continue
        if target_id != FINISHED_GOODS_NODE_ID and target_id not in object_by_id:
            invalid_references.append(_invalid("conveyor_target", conveyor.id, target_id, "传送带终点不存在"))
            continue
        edges.append(
            _edge(
                f"conveyor:{conveyor.id}",
                "conveyor_transport",
                source_id,
                target_id,
                object_id=conveyor.id,
                item_id=config.get("outputItemId") if isinstance(config.get("outputItemId"), str) else None,
                from_port=config.get("fromPortIndex"),
                to_port=config.get("toPortIndex"),
                speed_mps=config.get("speedMps"),
                capacity=config.get("capacity"),
            )
        )

    for record in sorted(factory.inventory, key=lambda value: value.id):
        location_id = FINISHED_GOODS_NODE_ID if record.location_type == "finished-goods" else record.location_id
        if location_id != FINISHED_GOODS_NODE_ID and location_id not in object_by_id:
            invalid_references.append(_invalid("inventory_location", record.id, location_id, "库存位置不存在"))
            continue
        if record.item_id not in item_by_id:
            invalid_references.append(_invalid("inventory_item", record.id, record.item_id, "库存引用不存在的物品"))
            continue
        edges.append(
            _edge(
                f"inventory:{record.id}",
                "inventory_holds",
                location_id,
                record.item_id,
                object_id=record.id,
                item_id=record.item_id,
                quantity=record.quantity,
                capacity=record.capacity,
                infinite_supply=record.infinite_supply,
                reserved_outbound=record.reserved_outbound_quantity,
                reserved_inbound=record.reserved_inbound_capacity,
            )
        )

    for vehicle in sorted(
        (obj for obj in factory.factory_objects if obj.kind in {"agv", "drone"}), key=lambda value: value.id
    ):
        config = _dict(vehicle.config)
        program = _dict(config.get("agvProgram") if vehicle.kind == "agv" else config.get("transportProgram"))
        if not program.get("enabled"):
            continue
        source_id = program.get("sourceObjectId")
        target_id = program.get("destinationObjectId")
        item_id = program.get("itemId")
        references = (
            ("source", source_id, object_by_id),
            ("target", target_id, object_by_id),
            ("item", item_id, item_by_id),
        )
        invalid = False
        for role, reference, lookup in references:
            if not isinstance(reference, str) or reference not in lookup:
                invalid_references.append(
                    _invalid(
                        f"{vehicle.kind}_{role}",
                        vehicle.id,
                        str(reference or ""),
                        f"{vehicle.kind} 任务{role}引用无效",
                    )
                )
                invalid = True
        if invalid:
            continue
        assert isinstance(source_id, str) and isinstance(target_id, str) and isinstance(item_id, str)
        edges.append(
            _edge(
                f"{vehicle.kind}:{vehicle.id}",
                f"{vehicle.kind}_transport",
                source_id,
                target_id,
                object_id=vehicle.id,
                item_id=item_id,
                load_quantity=program.get("loadQuantity"),
                trigger_location=program.get("triggerLocation"),
                trigger_comparator=program.get("triggerComparator"),
                trigger_quantity=program.get("triggerQuantity"),
            )
        )

    nodes.sort(key=lambda value: (str(value["node_type"]), str(value["id"])))
    edges.sort(key=lambda value: str(value["id"]))
    invalid_references.sort(key=lambda value: (value["kind"], value["source_id"], value["target_id"]))
    node_counts = Counter(str(node["node_type"]) for node in nodes)
    edge_counts = Counter(str(edge["edge_type"]) for edge in edges)
    return {
        "graph_schema_version": GRAPH_SCHEMA_VERSION,
        "factory_id": factory.id,
        "factory_version": factory.updated_at.isoformat(),
        "factory_schema_version": factory.schema_version,
        "nodes": nodes,
        "edges": edges,
        "invalid_references": invalid_references,
        "summary": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "invalid_reference_count": len(invalid_references),
            "node_counts": dict(sorted(node_counts.items())),
            "edge_counts": dict(sorted(edge_counts.items())),
        },
    }


def _edge(edge_id: str, edge_type: str, source_id: str, target_id: str, **attributes: object) -> dict[str, Any]:
    return {
        "id": edge_id,
        "edge_type": edge_type,
        "source_id": source_id,
        "target_id": target_id,
        "attributes": {key: value for key, value in attributes.items() if value is not None},
    }


def _invalid(kind: str, source_id: str, target_id: str, message: str) -> dict[str, str]:
    return {"kind": kind, "source_id": source_id, "target_id": target_id, "message": message}


def _recipe_line(value: object) -> tuple[str | None, float]:
    line = _dict(value)
    item_id = line.get("itemId")
    quantity = line.get("quantity")
    return (item_id if isinstance(item_id, str) and item_id else None, _number(quantity))


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: object) -> float:
    return float(value) if isinstance(value, int | float) else 0.0
