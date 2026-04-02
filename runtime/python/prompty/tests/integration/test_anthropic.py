"""Integration tests for the Anthropic provider.

Requires ``ANTHROPIC_API_KEY`` in the environment (or ``.env``).
Skipped automatically when the key is missing.

Run::

    pytest tests/integration/test_anthropic.py -v -o "addopts="
"""

from __future__ import annotations

import json

import pytest

from prompty.core.pipeline import execute_agent
from prompty.core.types import Message, PromptyStream, TextPart
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
            tools=[
                {
                    "name": "get_weather",
                    "kind": "function",
                    "description": "Get the current weather for a city",
                    "parameters": [
                        {"name": "location", "kind": "string", "description": "City name", "required": True},
                    ],
                }
            ],
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

    def test_full_agent_loop(self):
        """Test the full execute_agent pipeline: call → tool → call → final answer."""
        from pathlib import Path

        prompty_path = Path(__file__).parent.parent / "prompts" / "anthropic_agent.prompty"
        result = execute_agent(
            str(prompty_path),
            inputs={"question": "What is the weather in Seattle?"},
            tools={"get_weather": lambda location: f"72°F and sunny in {location}"},
        )

        # Should get a final text response mentioning the weather
        assert isinstance(result, str), f"Expected string result, got {type(result)}: {result}"
        assert len(result) > 0


@skip_anthropic
class TestAnthropicStreaming:
    def test_streaming_chat(self):
        agent = make_anthropic_agent(
            options={"maxOutputTokens": 64, "additionalProperties": {"stream": True}},
        )
        messages = [
            Message("system", [TextPart(value="You are a helpful assistant. Be concise.")]),
            Message("user", [TextPart(value="Say hello in exactly 3 words.")]),
        ]
        response = executor.execute(agent, messages)

        assert isinstance(response, PromptyStream)

        # Consume the stream — collect all events
        events = list(response)
        assert len(events) > 0


@skip_anthropic
class TestAnthropicMultiTurn:
    def test_multi_turn_conversation(self):
        """Test sending prior assistant/user turns — Anthropic is strict about role alternation."""
        agent = make_anthropic_agent(options={"maxOutputTokens": 64})
        messages = [
            Message("system", [TextPart(value="You are a helpful assistant. Be concise.")]),
            Message("user", [TextPart(value="My name is Alice.")]),
            Message("assistant", [TextPart(value="Nice to meet you, Alice!")]),
            Message("user", [TextPart(value="What is my name?")]),
        ]
        response = executor.execute(agent, messages)
        result = processor.process(agent, response)

        assert isinstance(result, str)
        assert "alice" in result.lower()
