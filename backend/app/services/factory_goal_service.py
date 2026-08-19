"""Deterministic compiler from user objectives to inspectable FactoryGoal data."""

from __future__ import annotations

import re
from typing import Any

from app.models.factory import Factory

GOAL_SCHEMA_VERSION = 1
DEFAULT_TIME_HORIZON_SEC = 3600


def compile_factory_goal(objective: str, factory: Factory, *, mode: str = "read_only") -> dict[str, Any]:
    text = objective.strip()
    normalized = re.sub(r"\s+", "", text.lower())
    metrics = _compile_metrics(text)
    hard_constraints = _compile_hard_constraints(normalized, factory)
    soft_constraints = _compile_soft_constraints(normalized)
    time_horizon_sec, horizon_source = _time_horizon(text)
    intent = _intent(normalized, metrics)
    conflicts = _detect_conflicts(metrics, hard_constraints, normalized)
    missing_constraints: list[str] = []
    assumptions: list[str] = []

    if horizon_source is None:
        assumptions.append("未指定评估时间窗，使用 60 分钟诊断窗口")
    if intent == "optimize" and metrics and not _mentions_target_product(normalized):
        missing_constraints.append("优化目标未指定产品范围")

    if conflicts:
        status = "conflicting"
    elif missing_constraints:
        status = "needs_clarification"
    else:
        status = "ready"

    return {
        "goal_schema_version": GOAL_SCHEMA_VERSION,
        "compiler": "deterministic-v1",
        "objective": text,
        "intent": intent,
        "status": status,
        "baseline_version": factory.updated_at.isoformat(),
        "metrics": metrics,
        "hard_constraints": hard_constraints,
        "soft_constraints": soft_constraints,
        "time_horizon_sec": time_horizon_sec,
        "allowed_actions": ["inspect"] if mode == "read_only" else _requested_actions(normalized),
        "assumptions": assumptions,
        "missing_constraints": missing_constraints,
        "conflicts": conflicts,
    }


def _compile_metrics(text: str) -> list[dict[str, Any]]:
    metrics: list[dict[str, Any]] = []
    patterns = (
        (
            "throughput_per_min",
            "件/分钟",
            re.compile(
                r"(?:产能|吞吐量?|产量).{0,10}?(?P<operator>提升到|达到|至少|不低于|不超过|至多|最多|等于|为)\s*"
                r"(?P<value>\d+(?:\.\d+)?)\s*(?:件)?\s*(?P<unit>/分钟|每分钟|件/分|/小时|每小时|件/小时)?",
                re.IGNORECASE,
            ),
        ),
        (
            "work_in_progress",
            "件",
            re.compile(
                r"(?:在制品|wip).{0,10}?(?P<operator>降到|不超过|至多|最多|至少|不低于|等于|为)\s*"
                r"(?P<value>\d+(?:\.\d+)?)\s*(?:件)?",
                re.IGNORECASE,
            ),
        ),
    )
    for key, default_unit, pattern in patterns:
        for match in pattern.finditer(text):
            raw_operator = match.group("operator")
            target = float(match.group("value"))
            raw_unit = match.groupdict().get("unit") or default_unit
            unit = default_unit
            if key == "throughput_per_min" and raw_unit in {"/小时", "每小时", "件/小时"}:
                target /= 60
            metrics.append(
                {
                    "key": key,
                    "operator": _operator(raw_operator),
                    "target": target,
                    "unit": unit,
                    "hard": True,
                    "source": match.group(0),
                }
            )

    if re.search(r"产能|吞吐量?|产量", text):
        for match in re.finditer(
            r"(?P<operator>至少|不低于|不超过|至多|最多)\s*(?P<value>\d+(?:\.\d+)?)\s*"
            r"(?P<unit>件/分钟|件/分|每分钟|件/小时|每小时)?",
            text,
        ):
            target = float(match.group("value"))
            if match.group("unit") in {"件/小时", "每小时"}:
                target /= 60
            candidate = {
                "key": "throughput_per_min",
                "operator": _operator(match.group("operator")),
                "target": target,
                "unit": "件/分钟",
                "hard": True,
                "source": match.group(0),
            }
            if not any(
                metric["key"] == candidate["key"]
                and metric["operator"] == candidate["operator"]
                and metric["target"] == candidate["target"]
                for metric in metrics
            ):
                metrics.append(candidate)

    lower = text.lower()
    if not any(metric["key"] == "throughput_per_min" for metric in metrics):
        english = re.search(
            r"throughput.{0,12}?(?P<operator>at least|at most|to|=|>=|<=)\s*(?P<value>\d+(?:\.\d+)?)\s*"
            r"(?P<unit>per minute|/min|per hour|/hour)?",
            lower,
        )
        if english:
            target = float(english.group("value"))
            if english.group("unit") in {"per hour", "/hour"}:
                target /= 60
            metrics.append(
                {
                    "key": "throughput_per_min",
                    "operator": _operator(english.group("operator")),
                    "target": target,
                    "unit": "件/分钟",
                    "hard": True,
                    "source": english.group(0),
                }
            )

    if re.search(r"(最大化|尽可能提高|最高).{0,8}(产能|吞吐|产量)|(产能|吞吐|产量).{0,8}(最大化|尽可能提高)", text):
        metrics.append(
            {
                "key": "throughput_per_min",
                "operator": "maximize",
                "target": None,
                "unit": "件/分钟",
                "hard": False,
                "source": "最大化产能",
            }
        )
    if re.search(r"(最小化|尽可能降低).{0,8}(在制品|wip)|(在制品|wip).{0,8}(最小化|尽可能降低)", lower):
        metrics.append(
            {
                "key": "work_in_progress",
                "operator": "minimize",
                "target": None,
                "unit": "件",
                "hard": False,
                "source": "最小化在制品",
            }
        )
    return metrics


def _compile_hard_constraints(normalized: str, factory: Factory) -> list[dict[str, Any]]:
    counts = {
        "agv_count": sum(1 for obj in factory.factory_objects if obj.kind == "agv"),
        "drone_count": sum(1 for obj in factory.factory_objects if obj.kind == "drone"),
        "machine_count": sum(1 for obj in factory.factory_objects if obj.kind == "machine"),
    }
    constraints: list[dict[str, Any]] = []
    area_shared_predicate = re.search(r"(?:面积|占地)(?:和|与).{0,16}(?:数量)?不变", normalized)
    if area_shared_predicate or any(
        value in normalized for value in ("面积不变", "面积保持不变", "不扩大面积", "占地不变")
    ):
        constraints.append(_constraint("floor_area_m2", "eq", factory.width_m * factory.length_m, "平方米", "面积不变"))
    for key, label, tokens in (
        ("agv_count", "AGV 数量", ("agv数量不变", "不增加agv", "agv不变")),
        ("drone_count", "无人机数量", ("无人机数量不变", "不增加无人机", "无人机不变")),
        ("machine_count", "机器数量", ("机器数量不变", "不增加机器", "设备数量不变")),
    ):
        if any(token in normalized for token in tokens):
            constraints.append(_constraint(key, "eq", counts[key], "台", f"{label}不变"))
    return constraints


def _compile_soft_constraints(normalized: str) -> list[dict[str, Any]]:
    constraints: list[dict[str, Any]] = []
    if any(value in normalized for value in ("尽量少改", "最少改动", "少改设备")):
        constraints.append(_constraint("change_count", "minimize", None, "项", "最少改动", hard=False))
    if any(value in normalized for value in ("降低成本", "成本最低", "尽量省钱")):
        constraints.append(_constraint("cost", "minimize", None, None, "降低成本", hard=False))
    if any(value in normalized for value in ("降低能耗", "能耗最低", "节能")):
        constraints.append(_constraint("energy", "minimize", None, None, "降低能耗", hard=False))
    return constraints


def _time_horizon(text: str) -> tuple[int, str | None]:
    match = re.search(r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>秒|分钟|分|小时|时)(?:内|窗口|评估)?", text)
    if not match:
        return DEFAULT_TIME_HORIZON_SEC, None
    value = float(match.group("value"))
    unit = match.group("unit")
    multiplier = 1 if unit == "秒" else 60 if unit in {"分钟", "分"} else 3600
    return max(1, round(value * multiplier)), match.group(0)


def _detect_conflicts(
    metrics: list[dict[str, Any]], constraints: list[dict[str, Any]], normalized: str
) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    by_key: dict[str, list[dict[str, Any]]] = {}
    for metric in metrics:
        by_key.setdefault(str(metric["key"]), []).append(metric)
    for key, values in by_key.items():
        lower = [
            float(value["target"])
            for value in values
            if value["operator"] == "gte" and value["target"] is not None
        ]
        upper = [
            float(value["target"])
            for value in values
            if value["operator"] == "lte" and value["target"] is not None
        ]
        equal = [
            float(value["target"])
            for value in values
            if value["operator"] == "eq" and value["target"] is not None
        ]
        minimum = max(lower + equal) if lower or equal else None
        maximum = min(upper + equal) if upper or equal else None
        if minimum is not None and maximum is not None and minimum > maximum:
            conflicts.append(
                {
                    "code": f"metric_range_{key}",
                    "message": f"{key} 的下限高于上限",
                    "sources": [str(value["source"]) for value in values],
                }
            )
    fixed_keys = {str(constraint["key"]) for constraint in constraints if constraint["operator"] == "eq"}
    for key, action_tokens, label in (
        ("floor_area_m2", ("扩大面积", "增加面积"), "面积"),
        ("agv_count", ("增加agv", "新增agv"), "AGV 数量"),
        ("drone_count", ("增加无人机", "新增无人机"), "无人机数量"),
        ("machine_count", ("增加机器", "新增机器", "增加设备"), "机器数量"),
    ):
        if key in fixed_keys and any(token in normalized for token in action_tokens):
            conflicts.append(
                {
                    "code": f"fixed_{key}_change",
                    "message": f"{label}要求不变，但目标同时要求增加",
                    "sources": [label],
                }
            )
    return conflicts


def _intent(normalized: str, metrics: list[dict[str, Any]]) -> str:
    if any(value in normalized for value in ("监控", "持续观察", "告警")):
        return "monitor"
    if metrics or any(value in normalized for value in ("优化", "提升", "降低", "最大化", "最小化")):
        return "optimize"
    if any(value in normalized for value in ("为什么", "原因", "解释")):
        return "explain"
    return "diagnose"


def _requested_actions(normalized: str) -> list[str]:
    actions = ["inspect", "propose_patch", "simulate_branch"]
    if "只分析" in normalized or "不要修改" in normalized:
        return ["inspect"]
    return actions


def _mentions_target_product(normalized: str) -> bool:
    return any(value in normalized for value in ("产品", "成品", "物品", "sku", "配方"))


def _constraint(
    key: str,
    operator: str,
    value: float | int | None,
    unit: str | None,
    source: str,
    *,
    hard: bool = True,
) -> dict[str, Any]:
    return {"key": key, "operator": operator, "value": value, "unit": unit, "hard": hard, "source": source}


def _operator(value: str) -> str:
    normalized = value.lower()
    if normalized in {"提升到", "达到", "至少", "不低于", ">=", "at least", "to"}:
        return "gte"
    if normalized in {"降到", "不超过", "至多", "最多", "<=", "at most"}:
        return "lte"
    return "eq"
