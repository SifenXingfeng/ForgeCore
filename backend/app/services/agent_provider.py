"""Replaceable LLM tool selector with a deterministic fallback."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.config import Settings
from app.services.agent_tool_registry import DEFAULT_TOOL_NAMES, REQUIRED_TOOL_NAMES

logger = logging.getLogger(__name__)


class AgentModelProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def select_tools(
        self,
        objective: str,
        compiled_goal: dict[str, object],
        available_tool_names: tuple[str, ...],
    ) -> list[str]: ...


@dataclass(frozen=True, slots=True)
class DeterministicAgentProvider:
    name: str = "deterministic"

    async def select_tools(
        self,
        objective: str,
        compiled_goal: dict[str, object],
        available_tool_names: tuple[str, ...],
    ) -> list[str]:
        del objective, compiled_goal
        return list(available_tool_names)


@dataclass(frozen=True, slots=True)
class OpenAICompatibleAgentProvider:
    api_key: str
    model: str
    base_url: str
    timeout_seconds: float
    name: str = "openai"

    async def select_tools(
        self,
        objective: str,
        compiled_goal: dict[str, object],
        available_tool_names: tuple[str, ...],
    ) -> list[str]:
        prompt = {
            "objective": objective,
            "intent": compiled_goal.get("intent"),
            "goal_status": compiled_goal.get("status"),
            "available_tools": list(available_tool_names),
            "rules": [
                "Return only a JSON object with a tools array",
                "Select only names from available_tools",
                "Do not calculate, infer or return factory facts",
                "Always include inspect_bottlenecks",
            ],
        }
        request = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "You select read-only ForgeCore tools. You cannot modify factory state or report facts.",
                },
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
        }
        async with httpx.AsyncClient(base_url=f"{self.base_url.rstrip('/')}/", timeout=self.timeout_seconds) as client:
            response = await client.post(
                "chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=request,
            )
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        raw_tools = parsed.get("tools", []) if isinstance(parsed, dict) else []
        allowed = set(available_tool_names)
        selected = [name for name in raw_tools if isinstance(name, str) and name in allowed]
        if "inspect_bottlenecks" not in selected:
            selected.append("inspect_bottlenecks")
        return list(dict.fromkeys(selected))


def create_agent_provider(settings: Settings) -> AgentModelProvider:
    if settings.llm_provider == "openai" and settings.openai_api_key:
        return OpenAICompatibleAgentProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            base_url=settings.llm_base_url,
            timeout_seconds=settings.agent_llm_timeout_seconds,
        )
    return DeterministicAgentProvider()


async def select_tools_with_fallback(
    provider: AgentModelProvider,
    objective: str,
    compiled_goal: dict[str, object],
) -> tuple[str, list[str], str | None]:
    try:
        selected = await provider.select_tools(objective, compiled_goal, DEFAULT_TOOL_NAMES)
        selected_set = set(selected) | set(REQUIRED_TOOL_NAMES)
        ordered = [name for name in DEFAULT_TOOL_NAMES if name in selected_set]
        return provider.name, ordered, None
    except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Agent provider %s failed, using deterministic tools: %s", provider.name, exc)
        fallback = DeterministicAgentProvider()
        return fallback.name, await fallback.select_tools(objective, compiled_goal, DEFAULT_TOOL_NAMES), str(exc)
