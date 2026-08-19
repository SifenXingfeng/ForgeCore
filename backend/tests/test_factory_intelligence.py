"""Pure deterministic tests for the Agent graph and goal compiler."""

from __future__ import annotations

from datetime import UTC, datetime

from app.models.factory import Factory, FactoryObjectModel, InventoryRecord, Item, Recipe
from app.services.agent_provider import select_tools_with_fallback
from app.services.agent_tool_registry import DEFAULT_TOOL_NAMES, public_tool_catalog
from app.services.factory_goal_service import compile_factory_goal
from app.services.factory_graph_service import build_factory_graph


def _factory() -> Factory:
    factory = Factory(
        id="factory-a",
        owner_id="owner-a",
        name="测试工厂",
        width_m=40,
        length_m=25,
        grid_size_m=1,
        schema_version=4,
        updated_at=datetime(2026, 8, 18, 8, 0, tzinfo=UTC),
    )
    raw = Item(
        id="item-raw",
        factory_id=factory.id,
        code="RAW",
        name="原料",
        category="raw-material",
        item_model_id="basic/box",
        mass_kg=1,
        max_stack_size=100,
    )
    product = Item(
        id="item-product",
        factory_id=factory.id,
        code="PRODUCT",
        name="成品",
        category="finished-good",
        item_model_id="basic/box",
        mass_kg=1,
        max_stack_size=100,
    )
    recipe = Recipe(
        id="recipe-a",
        factory_id=factory.id,
        code="R-A",
        name="加工",
        inputs=[{"itemId": raw.id, "quantity": 2}],
        outputs=[{"itemId": product.id, "quantity": 1}],
        processing_time_sec=10,
        enabled=True,
    )
    source = _object("rack-source", "rack", "原料仓", {})
    machine = _object("machine-a", "machine", "加工机", {"recipeId": recipe.id})
    sink = _object("rack-sink", "rack", "成品仓", {})
    conveyor = _object(
        "conveyor-a",
        "conveyor",
        "输送线",
        {"fromObjectId": machine.id, "toObjectId": sink.id, "speedMps": 1, "capacity": 8},
    )
    agv = _object(
        "agv-a",
        "agv",
        "AGV A",
        {
            "agvProgram": {
                "enabled": True,
                "sourceObjectId": source.id,
                "destinationObjectId": machine.id,
                "itemId": raw.id,
                "loadQuantity": 4,
            }
        },
    )
    inventory = InventoryRecord(
        id="inventory-a",
        factory_id=factory.id,
        location_type="rack-slot",
        location_id=source.id,
        item_id=raw.id,
        quantity=20,
        initial_quantity=20,
        capacity=100,
        reserved_outbound_quantity=0,
        reserved_inbound_capacity=0,
        infinite_supply=False,
    )
    factory.items = [raw, product]
    factory.recipes = [recipe]
    factory.factory_objects = [source, machine, sink, conveyor, agv]
    factory.inventory = [inventory]
    return factory


def _object(object_id: str, kind: str, name: str, config: dict[str, object]) -> FactoryObjectModel:
    return FactoryObjectModel(
        id=object_id,
        factory_id="factory-a",
        floor_id="floor-a",
        kind=kind,
        name=name,
        transform_x=0,
        transform_z=0,
        transform_rotation_y=0,
        footprint_width=2,
        footprint_depth=2,
        status="idle",
        config=config,
    )


def test_factory_graph_covers_production_inventory_and_transport_edges() -> None:
    graph = build_factory_graph(_factory())
    edge_types = {edge["edge_type"] for edge in graph["edges"]}

    assert graph["factory_version"] == "2026-08-18T08:00:00+00:00"
    assert graph["summary"]["node_count"] == 8
    assert graph["summary"]["invalid_reference_count"] == 0
    assert {
        "recipe_consumes",
        "recipe_produces",
        "machine_binding",
        "conveyor_transport",
        "inventory_holds",
        "agv_transport",
    } <= edge_types


def test_factory_goal_compiles_targets_fixed_constraints_and_conflicts() -> None:
    factory = _factory()
    goal = compile_factory_goal(
        "把成品产能提升到 120 件/分钟，面积和 AGV 数量不变，评估 30 分钟",
        factory,
    )

    assert goal["intent"] == "optimize"
    assert goal["status"] == "ready"
    assert goal["metrics"][0]["target"] == 120
    assert goal["time_horizon_sec"] == 1800
    assert {item["key"] for item in goal["hard_constraints"]} == {"floor_area_m2", "agv_count"}
    assert goal["allowed_actions"] == ["inspect"]

    conflict = compile_factory_goal("产能至少 120 件/分钟且不超过 100 件/分钟", factory)
    assert conflict["status"] == "conflicting"
    assert conflict["conflicts"][0]["code"] == "metric_range_throughput_per_min"


async def test_provider_failure_falls_back_to_complete_allowlisted_tool_set() -> None:
    class FailingProvider:
        name = "failing"

        async def select_tools(
            self,
            objective: str,
            compiled_goal: dict[str, object],
            available_tool_names: tuple[str, ...],
        ) -> list[str]:
            del objective, compiled_goal, available_tool_names
            raise ValueError("provider unavailable")

    provider_name, tools, error = await select_tools_with_fallback(FailingProvider(), "检查工厂", {})

    assert provider_name == "deterministic"
    assert tools == list(DEFAULT_TOOL_NAMES)
    assert error == "provider unavailable"
    catalog = public_tool_catalog()
    assert len(catalog) == len(DEFAULT_TOOL_NAMES) == 12
    assert all(tool["permission"] == "read_only" and tool["input_schema"]["required"] for tool in catalog)
