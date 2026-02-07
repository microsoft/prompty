"""Integration tests — agent loop (tool calling) against real OpenAI / Azure OpenAI."""

from __future__ import annotations

import pytest

from prompty.core.types import Message, TextPart
from prompty.providers.azure.executor import AzureExecutor
from prompty.providers.azure.processor import AzureProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import make_azure_agent, make_openai_agent, skip_azure, skip_openai

_TOOLS = [
    {
        "name": "get_weather",
        "kind": "function",
        "description": "Get the current weather for a city. Always call this when asked about weather.",
        "parameters": {
            "properties": [
                {
                    "name": "city",
                    "kind": "string",
                    "description": "The city name, e.g. 'Seattle'",
                    "required": True,
                }
            ]
        },
    }
]


def _weather_fn(city: str) -> str:
    return f"72°F and sunny in {city}"


def _agent_messages() -> list[Message]:
    return [
        Message(
            role="system",
            parts=[
                TextPart(
                    value="You are a helpful assistant. Use tools when needed. Be brief."
                )
            ],
        ),
        Message(
            role="user",
            parts=[TextPart(value="What is the weather in Seattle?")],
        ),
    ]


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@skip_openai
class TestOpenAIAgent:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_tool_call_loop(self):
        agent = make_openai_agent(
            api_type="agent",
            options={"temperature": 0, "maxOutputTokens": 200},
            tools=_TOOLS,
            metadata={"tool_functions": {"get_weather": _weather_fn}},
        )
        messages = _agent_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        # The model should have called get_weather and incorporated the result
        assert "72" in result or "sunny" in result or "Seattle" in result.lower()

    @pytest.mark.asyncio
    async def test_async_tool_call_loop(self):
        agent = make_openai_agent(
            api_type="agent",
            options={"temperature": 0, "maxOutputTokens": 200},
            tools=_TOOLS,
            metadata={"tool_functions": {"get_weather": _weather_fn}},
        )
        messages = _agent_messages()
        response = await self.executor.execute_async(agent, messages)
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Azure OpenAI
# ---------------------------------------------------------------------------


@skip_azure
class TestAzureAgent:
    executor = AzureExecutor()
    processor = AzureProcessor()

    def test_tool_call_loop(self):
        agent = make_azure_agent(
            api_type="agent",
            options={"temperature": 0, "maxOutputTokens": 200},
            tools=_TOOLS,
            metadata={"tool_functions": {"get_weather": _weather_fn}},
        )
        messages = _agent_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert "72" in result or "sunny" in result or "Seattle" in result.lower()
