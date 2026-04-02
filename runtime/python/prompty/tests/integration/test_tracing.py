"""Integration tests — validate PromptyTracer JSON output during real API calls.

Runs real Azure OpenAI calls with the PromptyTracer (JSON emitter) enabled,
then inspects the resulting ``.tracy`` files to confirm correct structure:
nested frames, timing, signatures, inputs, results, and usage hoisting.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from prompty.core.types import Message, PromptyStream, TextPart
from prompty.providers.foundry.executor import FoundryExecutor
from prompty.providers.foundry.processor import FoundryProcessor
from prompty.tracing.tracer import PromptyTracer, Tracer

from .conftest import (
    _AZURE_EMBEDDING_DEPLOYMENT,
    make_foundry_agent,
    skip_foundry,
    skip_foundry_embedding,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _chat_messages() -> list[Message]:
    return [
        Message(
            role="system",
            parts=[TextPart(value="You are a helpful assistant. Reply in one short sentence.")],
        ),
        Message(role="user", parts=[TextPart(value="Say hello.")]),
    ]


def _setup_tracer(tmp_path: Path) -> PromptyTracer:
    """Register a PromptyTracer pointing at *tmp_path* and return it."""
    Tracer.clear()
    pt = PromptyTracer(output_dir=str(tmp_path))
    Tracer.add("prompty", pt.tracer)
    return pt


def _read_tracy(tmp_path: Path) -> dict[str, Any]:
    """Read and return the single .tracy file from *tmp_path*."""
    files = list(tmp_path.glob("*.tracy"))
    assert len(files) >= 1, f"Expected at least 1 .tracy file, found {len(files)}"
    with open(files[0]) as f:
        return json.load(f)


def _assert_trace_envelope(data: dict[str, Any]) -> dict[str, Any]:
    """Validate the outer envelope and return the trace dict."""
    assert data["runtime"] == "python"
    assert "version" in data
    assert "trace" in data
    return data["trace"]


def _assert_timing(frame: dict[str, Any]) -> None:
    """Validate __time block is present with start, end, duration."""
    assert "__time" in frame, f"Missing __time in frame '{frame.get('name')}'"
    t = frame["__time"]
    assert "start" in t
    assert "end" in t
    assert "duration" in t
    assert isinstance(t["duration"], int)
    assert t["duration"] >= 0


def _find_frame(frames: list[dict[str, Any]], name_contains: str) -> dict[str, Any] | None:
    """Find a child frame whose name contains *name_contains*."""
    for f in frames:
        if name_contains.lower() in f.get("name", "").lower():
            return f
    return None


# ---------------------------------------------------------------------------
# Chat tracing
# ---------------------------------------------------------------------------


@skip_foundry
class TestFoundryChatTracing:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_chat_trace_structure(self, tmp_path):
        """A basic chat call produces a .tracy with nested executor frames."""
        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(options={"maxOutputTokens": 50, "temperature": 0})
            messages = _chat_messages()
            response = self.executor.execute(agent, messages)
            result = self.processor.process(agent, response)
            assert isinstance(result, str)
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)
        _assert_timing(root)

        # Root should be the executor's execute call
        assert root["name"] == "execute"
        assert "signature" in root
        assert "FoundryExecutor" in root["signature"] or "execute" in root["signature"]

        # Should have inputs recorded
        assert "inputs" in root

        # Should have a result
        assert "result" in root

        # Should have nested frames for the client + completion call
        assert "__frames" in root
        frames = root["__frames"]
        assert len(frames) >= 1

        # Look for the chat.completions.create frame
        chat_frame = _find_frame(frames, "chat.completions")
        assert chat_frame is not None, f"No chat.completions frame found in {[f['name'] for f in frames]}"
        _assert_timing(chat_frame)

        # The chat frame should have inputs (the args dict)
        assert "inputs" in chat_frame

        # The chat frame should have a result (the API response)
        assert "result" in chat_frame

    def test_chat_trace_has_usage(self, tmp_path):
        """Usage metrics (prompt_tokens, completion_tokens) are hoisted."""
        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(options={"maxOutputTokens": 50, "temperature": 0})
            messages = _chat_messages()
            response = self.executor.execute(agent, messages)
            _ = self.processor.process(agent, response)
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)

        # Usage should be hoisted from the nested chat frame to root
        # Check at both levels — the chat frame's result has usage, and it
        # should be hoisted up to __usage on the root or chat frame
        frames = root.get("__frames", [])
        chat_frame = _find_frame(frames, "chat.completions")
        assert chat_frame is not None

        # The result from the LLM should contain usage info
        result = chat_frame.get("result")
        if isinstance(result, dict) and "usage" in result:
            usage = result["usage"]
            assert "prompt_tokens" in usage or "total_tokens" in usage

        # Check that __usage was hoisted somewhere in the frame hierarchy
        assert "__usage" in root or "__usage" in chat_frame
        # Usage hoisting depends on the response format — check frame result at minimum
        assert result is not None, "Chat frame should have a result"

    @pytest.mark.asyncio
    async def test_async_chat_trace(self, tmp_path):
        """Async calls also produce valid trace output."""
        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(options={"maxOutputTokens": 50, "temperature": 0})
            messages = _chat_messages()
            response = await self.executor.execute_async(agent, messages)
            result = await self.processor.process_async(agent, response)
            assert isinstance(result, str)
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)
        _assert_timing(root)
        assert root["name"] == "execute_async"
        assert "__frames" in root
        assert "result" in root


# ---------------------------------------------------------------------------
# Embedding tracing
# ---------------------------------------------------------------------------


@skip_foundry_embedding
class TestFoundryEmbeddingTracing:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_embedding_trace_structure(self, tmp_path):
        """Embedding call produces correct trace frames."""
        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(api_type="embedding", deployment=_AZURE_EMBEDDING_DEPLOYMENT)
            response = self.executor.execute(agent, "Hello world")
            result = self.processor.process(agent, response)
            assert isinstance(result, list)
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)
        _assert_timing(root)
        assert root["name"] == "execute"
        assert "__frames" in root

        # Look for the embeddings.create frame
        frames = root["__frames"]
        embed_frame = _find_frame(frames, "embeddings")
        assert embed_frame is not None, f"No embeddings frame found in {[f['name'] for f in frames]}"
        _assert_timing(embed_frame)
        assert "inputs" in embed_frame
        assert "result" in embed_frame


# ---------------------------------------------------------------------------
# Agent loop tracing
# ---------------------------------------------------------------------------


@skip_foundry
class TestFoundryAgentTracing:
    def test_agent_loop_trace(self, tmp_path):
        """Agent loop with tool calls produces a trace with the AgentLoop frame."""
        from prompty.core.pipeline import execute_agent

        def get_weather(city: str) -> str:
            return f"72°F and sunny in {city}"

        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(
                api_type="chat",
                options={"temperature": 0, "maxOutputTokens": 200},
                tools=[
                    {
                        "name": "get_weather",
                        "kind": "function",
                        "description": "Get the current weather for a city.",
                        "parameters": [
                            {
                                "name": "city",
                                "kind": "string",
                                "description": "City name",
                                "required": True,
                            }
                        ],
                    }
                ],
            )
            agent.instructions = (
                "system:\nYou are a helpful assistant. Use tools when needed.\nuser:\nWhat is the weather in Seattle?"
            )
            result = execute_agent(
                agent,
                tools={"get_weather": get_weather},
            )
            assert isinstance(result, str)
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)
        _assert_timing(root)

        # The root should be 'execute', with an AgentLoop child frame
        assert "__frames" in root
        frames = root["__frames"]
        agent_frame = _find_frame(frames, "AgentLoop")
        assert agent_frame is not None, f"No AgentLoop frame found in {[f['name'] for f in frames]}"
        _assert_timing(agent_frame)

        # Agent loop should have sub-frames (the executor calls) and iteration tracking
        assert "__frames" in agent_frame, f"AgentLoop frame missing __frames: {list(agent_frame.keys())}"
        assert "iterations" in agent_frame, f"AgentLoop frame missing iterations: {list(agent_frame.keys())}"


# ---------------------------------------------------------------------------
# Streaming tracing
# ---------------------------------------------------------------------------


@skip_foundry
class TestFoundryStreamingTracing:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_streaming_trace(self, tmp_path):
        """Streaming call produces trace with the stream wrapper noted."""
        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(options={"temperature": 0, "maxOutputTokens": 50})
            assert agent.model is not None
            assert agent.model.options is not None
            if agent.model.options.additionalProperties is None:
                agent.model.options.additionalProperties = {}
            agent.model.options.additionalProperties["stream"] = True

            messages = _chat_messages()
            response = self.executor.execute(agent, messages)
            assert isinstance(response, PromptyStream)

            # Consume the stream via processor
            result = self.processor.process(agent, response)
            chunks = list(result)
            assert len(chunks) > 0
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)
        _assert_timing(root)
        assert "__frames" in root

        # Should have the chat.completions.create frame
        frames = root["__frames"]
        chat_frame = _find_frame(frames, "chat.completions")
        assert chat_frame is not None
        _assert_timing(chat_frame)


# ---------------------------------------------------------------------------
# Structured output tracing
# ---------------------------------------------------------------------------


@skip_foundry
class TestFoundryStructuredTracing:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_structured_output_trace(self, tmp_path):
        """Structured output call produces trace with response_format in inputs."""
        _setup_tracer(tmp_path)
        try:
            agent = make_foundry_agent(
                options={"temperature": 0, "maxOutputTokens": 200},
                output_schema={
                    "properties": [
                        {
                            "name": "city",
                            "kind": "string",
                            "description": "The city name",
                        },
                        {
                            "name": "population",
                            "kind": "integer",
                            "description": "Approximate population",
                        },
                        {
                            "name": "country",
                            "kind": "string",
                            "description": "The country",
                        },
                    ]
                },
            )
            messages = [
                Message(
                    role="system",
                    parts=[
                        TextPart(value="You are a data assistant. Always respond with the requested JSON structure.")
                    ],
                ),
                Message(
                    role="user",
                    parts=[TextPart(value="Give me information about Tokyo.")],
                ),
            ]
            response = self.executor.execute(agent, messages)
            result = self.processor.process(agent, response)
            assert isinstance(result, dict)
        finally:
            Tracer.clear()

        data = _read_tracy(tmp_path)
        root = _assert_trace_envelope(data)
        _assert_timing(root)
        assert "__frames" in root

        # Find the chat frame and verify response_format was in the inputs
        frames = root["__frames"]
        chat_frame = _find_frame(frames, "chat.completions")
        assert chat_frame is not None

        inputs = chat_frame.get("inputs", {})
        assert "response_format" in inputs, f"response_format not found in chat frame inputs: {list(inputs.keys())}"
        assert inputs["response_format"]["type"] == "json_schema"
