"""Allowlisted Agent tool metadata and execution policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class AgentToolDefinition:
    name: str
    category: str
    description: str
    input_schema: dict[str, Any]
    evidence_type: str
    timeout_seconds: float = 5
    retry_limit: int = 1
    permission: str = "read_only"


def _factory_input(*, objective: bool = False, version: bool = False) -> dict[str, Any]:
    properties: dict[str, Any] = {"factory_id": {"type": "string", "minLength": 1}}
    required = ["factory_id"]
    if objective:
        properties["objective"] = {"type": "string", "minLength": 1, "maxLength": 2000}
        required.append("objective")
    if version:
        properties["factory_version"] = {"type": "string", "format": "date-time"}
        required.append("factory_version")
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
    }


READ_ONLY_TOOL_DEFINITIONS = (
    AgentToolDefinition(
        "explain_constraint",
        "goal",
        "Return the deterministic FactoryGoal and constraint conflicts",
        _factory_input(objective=True),
        "compiled_goal",
    ),
    AgentToolDefinition(
        "get_factory_snapshot",
        "context",
        "Return selected factory identity and object counts",
        _factory_input(version=True),
        "factory_snapshot",
    ),
    AgentToolDefinition(
        "get_factory_graph",
        "context",
        "Return versioned production, inventory, conveyor and vehicle dependencies",
        _factory_input(version=True),
        "factory_graph",
    ),
    AgentToolDefinition(
        "get_simulation_metrics",
        "metrics",
        "Return deterministic simulation metrics and runtime ratios",
        _factory_input(version=True),
        "metric_series",
    ),
    AgentToolDefinition(
        "query_event_timeline",
        "metrics",
        "Return recent persisted factory activity events",
        _factory_input(version=True),
        "event_timeline",
    ),
    AgentToolDefinition(
        "inspect_inventory",
        "diagnostics",
        "Return inventory totals, supply sources, reservations and shortages",
        _factory_input(version=True),
        "inventory_evidence",
    ),
    AgentToolDefinition(
        "inspect_machine",
        "diagnostics",
        "Return machine bindings, capacities and runtime states",
        _factory_input(version=True),
        "machine_evidence",
    ),
    AgentToolDefinition(
        "inspect_recipe_chain",
        "diagnostics",
        "Return enabled recipe inputs, outputs and dependency edges",
        _factory_input(version=True),
        "recipe_evidence",
    ),
    AgentToolDefinition(
        "inspect_conveyors",
        "diagnostics",
        "Return conveyor topology, ports, capacity and disconnected segments",
        _factory_input(version=True),
        "conveyor_evidence",
    ),
    AgentToolDefinition(
        "inspect_logistics",
        "diagnostics",
        "Return AGV and drone programs plus aggregate runtime state",
        _factory_input(version=True),
        "logistics_evidence",
    ),
    AgentToolDefinition(
        "calculate_capacity",
        "diagnostics",
        "Return rule-derived theoretical recipe and machine capacity",
        _factory_input(version=True),
        "capacity_evidence",
    ),
    AgentToolDefinition(
        "inspect_bottlenecks",
        "diagnostics",
        "Return causal findings grounded in prior deterministic evidence",
        _factory_input(objective=True, version=True),
        "finding_set",
    ),
)

TOOL_DEFINITION_BY_NAME = {definition.name: definition for definition in READ_ONLY_TOOL_DEFINITIONS}
DEFAULT_TOOL_NAMES = tuple(definition.name for definition in READ_ONLY_TOOL_DEFINITIONS)
REQUIRED_TOOL_NAMES = (
    "explain_constraint",
    "get_factory_snapshot",
    "get_factory_graph",
    "get_simulation_metrics",
    "inspect_inventory",
    "inspect_logistics",
    "inspect_bottlenecks",
)


def public_tool_catalog() -> list[dict[str, Any]]:
    return [
        {
            "name": definition.name,
            "category": definition.category,
            "description": definition.description,
            "input_schema": definition.input_schema,
            "evidence_type": definition.evidence_type,
            "permission": definition.permission,
            "timeout_seconds": definition.timeout_seconds,
            "retry_limit": definition.retry_limit,
        }
        for definition in READ_ONLY_TOOL_DEFINITIONS
    ]
