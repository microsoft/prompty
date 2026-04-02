"""Integration tests for the Anthropic provider.

Requires ``ANTHROPIC_API_KEY`` in the environment (or ``.env``).
Skipped automatically when the key is missing.

Run::

    pytest tests/integration/test_anthropic.py -v -o "addopts="
"""

from __future__ import annotations

import json

import pytest

from prompty.core.types import Message, TextPart
from prompty.providers.anthropic.executor import AnthropicExecutor
from prompty.providers.anthropic.processor import AnthropicProcessor

from .conftest import make_anthropic_agent, skip_anthropic

executor = AnthropicExecutor()
processor = AnthropicProcessor()


def _hello_messages() -> list[Message]:
    return [
        Message("system", [TextPart(value="You are a helpful assistant. Be concise.")]),
        Message("user", [TextPart(value="Say hello in exactly 3 words.")]),
    ]


@skip_anthropic
class TestAnthropicChat:
    def test_basic_chat(self):
        agent = make_anthropic_agent(options={"maxOutputTokens": 64})
        response = executor.execute(agent, _hello_messages())
        result = processor.process(agent, response)

        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_async_chat(self):
        agent = make_anthropic_agent(options={"maxOutputTokens": 64})
        response = await executor.execute_async(agent, _hello_messages())
        result = await processor.process_async(agent, response)

        assert isinstance(result, str)
        assert len(result) > 0

    def test_temperature_control(self):
        agent = make_anthropic_agent(options={"temperature": 0.0, "maxOutputTokens": 64})
        r1 = processor.process(agent, executor.execute(agent, _hello_messages()))
        r2 = processor.process(agent, executor.execute(agent, _hello_messages()))

        assert isinstance(r1, str) and isinstance(r2, str)
        # Temperature 0 should give deterministic results
        assert r1 == r2


@skip_anthropic
class TestAnthropicStructured:
    def test_structured_output(self):
        agent = make_anthropic_agent(
            options={"maxOutputTokens": 128},
            output_schema=[
                {"name": "greeting", "kind": "string", "description": "A greeting message"},
                {"name": "language", "kind": "string", "description": "The language of the greeting"},
            ],
        )
        messages = [
            Message("system", [TextPart(value="You are a helpful assistant. Always respond with valid JSON.")]),
            Message("user", [TextPart(value="Say hello in French. Return greeting and language fields.")]),
        ]
        response = executor.execute(agent, messages)
        result = processor.process(agent, response)

        assert isinstance(result, dict)
        assert "greeting" in result
        assert "language" in result


@skip_anthropic
class TestAnthropicAgent:
    def test_tool_calling(self):
        def get_weather(location: str) -> str:
            return f"72°F and sunny in {location}"

        agent = make_anthropic_agent(
            options={"maxOutputTokens": 256},
            tools=[{
                "name": "get_weather",
                "kind": "function",
                "description": "Get the current weather for a city",
                "parameters": [
                    {"name": "location", "kind": "string", "description": "City name", "required": True},
                ],
            }],
            metadata={"tool_functions": {"get_weather": get_weather}},
        )
        messages = [
            Message("system", [TextPart(value="You are a helpful assistant. Use tools when needed.")]),
            Message("user", [TextPart(value="What is the weather in Seattle?")]),
        ]

        # First call — should request tool use
        response = executor.execute(agent, messages)
        result = processor.process(agent, response)

        # Processor returns ToolCall list when tool_use is in the response
        assert isinstance(result, list), f"Expected tool calls, got {type(result)}: {result}"
        assert len(result) >= 1
        assert result[0].name == "get_weather"
        args = json.loads(result[0].arguments)
        assert "location" in args
