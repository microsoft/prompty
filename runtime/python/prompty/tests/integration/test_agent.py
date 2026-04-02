"""Integration tests — agent loop (tool calling) against real OpenAI / Azure OpenAI."""

from __future__ import annotations

import pytest

from prompty.core.pipeline import execute_agent, execute_agent_async

from .conftest import make_foundry_agent, make_openai_agent, skip_foundry, skip_openai

_TOOLS = [
    {
        "name": "get_weather",
        "kind": "function",
        "description": "Get the current weather for a city. Always call this when asked about weather.",
        "parameters": [
            {
                "name": "city",
                "kind": "string",
                "description": "The city name, e.g. 'Seattle'",
                "required": True,
            }
        ],
    }
]


def _weather_fn(city: str) -> str:
    return f"72°F and sunny in {city}"


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@skip_openai
class TestOpenAIAgent:
    def test_tool_call_loop(self):
        agent = make_openai_agent(
            api_type="chat",
            options={"temperature": 0, "maxOutputTokens": 200},
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = execute_agent(
            agent,
            tools={"get_weather": _weather_fn},
        )
        assert isinstance(result, str)
        assert "72" in result or "sunny" in result or "seattle" in result.lower()

    @pytest.mark.asyncio
    async def test_async_tool_call_loop(self):
        agent = make_openai_agent(
            api_type="chat",
            options={"temperature": 0, "maxOutputTokens": 200},
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = await execute_agent_async(
            agent,
            tools={"get_weather": _weather_fn},
        )
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Azure OpenAI (Foundry)
# ---------------------------------------------------------------------------


@skip_foundry
class TestFoundryAgent:
    def test_tool_call_loop(self):
        agent = make_foundry_agent(
            api_type="chat",
            options={"temperature": 0, "maxOutputTokens": 200},
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = execute_agent(
            agent,
            tools={"get_weather": _weather_fn},
        )
        assert isinstance(result, str)
        assert "72" in result or "sunny" in result or "seattle" in result.lower()
