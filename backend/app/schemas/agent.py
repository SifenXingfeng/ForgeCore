"""Stable contracts for future LLM analysis and browser-run simulation branches."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


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
