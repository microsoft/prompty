"""Integration tests against direct OpenAI (api.openai.com).

These tests use DIRECT_OPENAI_API_KEY and hit OpenAI's own endpoints —
no Azure compat proxy, no base URL override. Auto-skipped when the
key is not set.
"""

from __future__ import annotations

import pytest

from prompty.core.pipeline import execute, execute_agent, process
from prompty.core.types import AsyncPromptyStream, PromptyStream

from .conftest import make_direct_openai_agent, skip_direct_openai

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


@skip_direct_openai
class TestDirectOpenAIChat:
    """Basic chat completions against api.openai.com."""

    def test_basic_chat(self) -> None:
        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 200},
        )
        agent.instructions = (
            "system:\nYou are a helpful assistant. Be very brief.\nuser:\nSay hello in exactly 3 words."
        )
        result = execute(agent)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_chat_with_temperature(self) -> None:
        agent = make_direct_openai_agent(
            options={"temperature": 0.9, "maxOutputTokens": 200},
        )
        agent.instructions = (
            "system:\nYou are a helpful assistant. Be very brief.\nuser:\nSay hello in exactly 3 words."
        )
        result = execute(agent)
        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio(loop_scope="function")
    async def test_async_chat(self) -> None:
        from prompty.core.pipeline import execute_async

        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 200},
        )
        agent.instructions = (
            "system:\nYou are a helpful assistant. Be very brief.\nuser:\nSay hello in exactly 3 words."
        )
        result = await execute_async(agent)
        assert isinstance(result, str)
        assert len(result) > 0


@skip_direct_openai
class TestDirectOpenAIStreaming:
    """Streaming completions against api.openai.com."""

    def test_streaming_chat(self) -> None:
        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 200, "additionalProperties": {"stream": True}},
        )
        agent.instructions = "system:\nYou are a helpful assistant. Be brief.\nuser:\nSay hello in exactly 3 words."
        from prompty.core.pipeline import _invoke_executor, prepare

        messages = prepare(agent)
        raw = _invoke_executor(agent, messages)
        assert isinstance(raw, PromptyStream)
        result = process(agent, raw)
        chunks = list(result)
        text = "".join(c for c in chunks if isinstance(c, str))
        assert len(text) > 0

    @pytest.mark.asyncio(loop_scope="function")
    async def test_async_streaming_chat(self) -> None:
        from prompty.core.pipeline import _invoke_executor_async, prepare_async, process_async

        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 200, "additionalProperties": {"stream": True}},
        )
        agent.instructions = "system:\nYou are a helpful assistant. Be brief.\nuser:\nSay hello in exactly 3 words."
        messages = await prepare_async(agent)
        raw = await _invoke_executor_async(agent, messages)
        assert isinstance(raw, AsyncPromptyStream)
        result = await process_async(agent, raw)
        chunks = [c async for c in result]
        text = "".join(c for c in chunks if isinstance(c, str))
        assert len(text) > 0


@skip_direct_openai
class TestDirectOpenAIStructured:
    """Structured output against api.openai.com."""

    def test_structured_output(self) -> None:
        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 500},
            output_schema={
                "properties": [
                    {"name": "city", "kind": "string"},
                    {"name": "country", "kind": "string"},
                    {"name": "population", "kind": "integer"},
                ]
            },
        )
        agent.instructions = "system:\nYou are a data assistant. Respond with valid JSON matching the schema.\nuser:\nGive me info about Tokyo."
        result = execute(agent)
        assert isinstance(result, dict)
        assert "city" in result
        assert "country" in result


@skip_direct_openai
class TestDirectOpenAIAgent:
    """Agent loop (tool calling) against api.openai.com."""

    def test_tool_call_loop(self) -> None:
        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 300},
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = execute_agent(agent, tools={"get_weather": _weather_fn})
        assert isinstance(result, str)
        assert any(w in result.lower() for w in ("72", "sunny", "seattle"))

    def test_streaming_agent_loop(self) -> None:
        """Agent loop with streaming enabled — stream is consumed internally."""
        agent = make_direct_openai_agent(
            options={
                "temperature": 0,
                "maxOutputTokens": 300,
                "additionalProperties": {"stream": True},
            },
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = execute_agent(agent, tools={"get_weather": _weather_fn})
        assert isinstance(result, str)
        assert any(w in result.lower() for w in ("72", "sunny", "seattle"))

    @pytest.mark.asyncio(loop_scope="function")
    async def test_async_tool_call_loop(self) -> None:
        from prompty.core.pipeline import execute_agent_async

        agent = make_direct_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 300},
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = await execute_agent_async(agent, tools={"get_weather": _weather_fn})
        assert isinstance(result, str)
        assert any(w in result.lower() for w in ("72", "sunny", "seattle"))


@skip_direct_openai
class TestDirectOpenAIResponses:
    """Responses API against api.openai.com."""

    def test_responses_chat(self) -> None:
        agent = make_direct_openai_agent(
            api_type="responses",
            options={"temperature": 0, "maxOutputTokens": 200},
        )
        agent.instructions = (
            "system:\nYou are a helpful assistant. Be very brief.\nuser:\nSay hello in exactly 3 words."
        )
        result = execute(agent)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_responses_agent_loop(self) -> None:
        agent = make_direct_openai_agent(
            api_type="responses",
            options={"temperature": 0, "maxOutputTokens": 300},
            tools=_TOOLS,
        )
        agent.instructions = "system:\nYou are a helpful assistant. Use tools when needed. Be brief.\nuser:\nWhat is the weather in Seattle?"
        result = execute_agent(agent, tools={"get_weather": _weather_fn})
        assert isinstance(result, str)
        assert any(w in result.lower() for w in ("72", "sunny", "seattle"))
