"""Stable contracts for future LLM analysis and browser-run simulation branches."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class AgentSessionCreate(BaseModel):
    factory_id: str
    objective: str = Field(min_length=1, max_length=2000)


class AgentSession(BaseModel):
    id: str
    owner_id: str
    factory_id: str
    objective: str
    status: Literal["ready", "analyzing", "awaiting_simulation", "completed", "failed", "cancelled"]
    llm_configured: bool
    created_at: datetime
    updated_at: datetime


class SuggestionAction(BaseModel):
    kind: Literal[
        "move_object",
        "update_config",
        "add_object",
        "remove_object",
        "change_recipe",
        "adjust_inventory",
    ]
    target_id: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class AgentSuggestion(BaseModel):
    id: str
    title: str = Field(min_length=1, max_length=255)
    rationale: str = Field(min_length=1, max_length=8000)
    confidence: float = Field(ge=0, le=1)
    actions: list[SuggestionAction] = Field(min_length=1, max_length=50)
    expected_delta: dict[str, float] = Field(default_factory=dict)
    requires_simulation: bool = True


class AgentEventCreate(BaseModel):
    event: Literal["agent_progress", "agent_suggestion", "branch_result", "agent_error"]
    data: dict[str, Any]


class AgentEvent(BaseModel):
    id: str
    session_id: str
    event: str
    data: dict[str, Any]
    created_at: datetime


AgentRunStatus = Literal[
    "created",
    "planning",
    "contextualizing",
    "executing_tools",
    "awaiting_approval",
    "applying",
    "completed",
    "rejected",
    "failed",
    "cancelled",
]
AgentStepStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
AgentFindingSeverity = Literal["success", "info", "warning", "critical"]
AgentRunMode = Literal["read_only", "plan_design"]
PatchStatus = Literal[
    "proposed",
    "validated",
    "awaiting_approval",
    "approved",
    "rejected",
    "applied",
    "failed",
    "superseded",
    "rolled_back",
]
ApprovalStatus = Literal["pending", "approved", "rejected", "expired"]
PatchOpKind = Literal["move_object", "update_config", "adjust_inventory", "add_object", "remove_object"]
RiskLevel = Literal["low", "medium", "high"]


class AgentRunCreate(BaseModel):
    factory_id: str
    objective: str = Field(min_length=1, max_length=2000)
    mode: AgentRunMode = "read_only"


class AgentEvidence(BaseModel):
    label: str
    value: str
    object_id: str | None = None


class AgentFinding(BaseModel):
    id: str
    category: str
    severity: AgentFindingSeverity
    title: str
    detail: str
    evidence: list[AgentEvidence] = Field(default_factory=list)
    object_ids: list[str] = Field(default_factory=list)
    recommendation: str


class AgentAnalysisResult(BaseModel):
    headline: str
    assessment: str
    confidence: float = Field(ge=0, le=1)
    snapshot: dict[str, Any]
    graph_summary: dict[str, Any]
    metrics: dict[str, Any]
    findings: list[AgentFinding]


class FactoryGoalMetric(BaseModel):
    key: str
    operator: Literal["eq", "gte", "lte", "minimize", "maximize"]
    target: float | None = None
    unit: str
    hard: bool
    source: str


class FactoryGoalConstraint(BaseModel):
    key: str
    operator: str
    value: float | int | str | bool | None = None
    unit: str | None = None
    hard: bool
    source: str


class FactoryGoalConflict(BaseModel):
    code: str
    message: str
    sources: list[str]


class FactoryGoal(BaseModel):
    goal_schema_version: int
    compiler: str
    objective: str
    intent: Literal["diagnose", "explain", "optimize", "monitor"]
    status: Literal["ready", "needs_clarification", "conflicting"]
    baseline_version: str
    metrics: list[FactoryGoalMetric]
    hard_constraints: list[FactoryGoalConstraint]
    soft_constraints: list[FactoryGoalConstraint]
    time_horizon_sec: int = Field(gt=0)
    allowed_actions: list[str]
    assumptions: list[str]
    missing_constraints: list[str]
    conflicts: list[FactoryGoalConflict]


class AgentStepSchema(BaseModel):
    id: str
    position: int
    key: str
    title: str
    status: AgentStepStatus
    detail: str
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class AgentToolCallSchema(BaseModel):
    id: str
    step_id: str | None = None
    tool_name: str
    status: AgentStepStatus
    attempt: int
    input_data: dict[str, Any]
    output_data: dict[str, Any]
    error: str | None = None
    duration_ms: int | None = None
    created_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class FactoryPatchOp(BaseModel):
    op_id: str
    kind: PatchOpKind
    object_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    preconditions: list[dict[str, Any]] = Field(default_factory=list)
    risk: RiskLevel = "low"
    summary: str = ""


class AgentApprovalSchema(BaseModel):
    id: str
    patch_id: str
    run_id: str
    owner_id: str
    status: ApprovalStatus
    summary: str
    risk_level: RiskLevel
    decision_note: str | None = None
    decided_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentPatchSchema(BaseModel):
    id: str
    run_id: str
    factory_id: str
    owner_id: str
    base_version: str
    status: PatchStatus
    risk_level: RiskLevel
    idempotency_key: str
    operations: list[FactoryPatchOp]
    inverse_operations: list[FactoryPatchOp]
    preconditions: list[dict[str, Any]]
    impact: dict[str, Any]
    validation: dict[str, Any]
    diff_summary: dict[str, Any]
    applied_factory_updated_at: datetime | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    decided_at: datetime | None = None
    applied_at: datetime | None = None
    approvals: list[AgentApprovalSchema] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class AgentRunSchema(BaseModel):
    id: str
    owner_id: str
    factory_id: str
    objective: str
    mode: AgentRunMode
    status: AgentRunStatus
    provider: str
    llm_configured: bool
    base_factory_updated_at: datetime | None = None
    compiled_goal: FactoryGoal | None = None
    tool_call_budget: int
    tool_timeout_ms: int
    tool_retry_limit: int
    tool_calls_used: int
    summary: str
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_validator("compiled_goal", mode="before")
    @classmethod
    def empty_compiled_goal_is_none(cls, value: object) -> object:
        return None if value == {} else value


class AgentRunEventSchema(BaseModel):
    id: str
    sequence: int
    event_name: str
    data: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentRunDetail(AgentRunSchema):
    result: AgentAnalysisResult | None = None
    steps: list[AgentStepSchema]
    tool_calls: list[AgentToolCallSchema]
    events: list[AgentRunEventSchema]
    patches: list[AgentPatchSchema] = Field(default_factory=list)

    @field_validator("result", mode="before")
    @classmethod
    def empty_result_is_none(cls, value: object) -> object:
        return None if value == {} else value


class AgentApprovalDecision(BaseModel):
    note: str | None = Field(default=None, max_length=2000)
