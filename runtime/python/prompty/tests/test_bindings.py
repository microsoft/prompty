"""Tests for tool binding injection — wire format + runtime argument merging.

Bindings allow a .prompty file to declare that a tool parameter should be
filled from the parent agent's inputs rather than from the LLM's response.

Two aspects must work:
1. **Wire format**: Bound parameters are stripped from the tool definition
   sent to the LLM so it doesn't try to fill them.
2. **Runtime injection**: When executing the tool, bound values from
   parent_inputs are merged into the LLM-provided arguments before calling.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from prompty.core.pipeline import (
    _build_openai_tool_result_messages,
    _build_tool_messages_from_calls,
    _resolve_bindings,
    execute_agent,
    execute_agent_async,
)
from prompty.core.types import Message, TextPart
from prompty.model import Prompty

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_bound_agent(
    *,
    provider: str = "openai",
    bindings: dict[str, str] | None = None,
) -> Prompty:
    """Create a Prompty with a function tool that has bindings.

    Default tool: get_weather(city: str, unit: str) with unit bound to preferred_unit.
    """
    binding_list = []
    if bindings:
        for param_name, input_name in bindings.items():
            binding_list.append({"name": param_name, "input": input_name})

    data: dict[str, Any] = {
        "name": "binding-agent",
        "model": {
            "id": "gpt-4",
            "provider": provider,
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
        "tools": [
            {
                "name": "get_weather",
                "kind": "function",
                "description": "Get weather for a city",
                "parameters": [
                    {"name": "city", "kind": "string", "required": True},
                    {"name": "unit", "kind": "string", "required": False},
                ],
                "bindings": binding_list,
            }
        ],
        "template": {"format": {"kind": "jinja2"}, "parser": {"kind": "prompty"}},
    }
    return Prompty.load(data)


def _mock_tool_call_response(fn_name: str, fn_args: str, call_id: str = "call_1") -> MagicMock:
    tc = MagicMock()
    tc.id = call_id
    tc.function.name = fn_name
    tc.function.arguments = fn_args
    tc.model_dump.return_value = {
        "id": call_id,
        "type": "function",
        "function": {"name": fn_name, "arguments": fn_args},
    }

    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].finish_reason = "tool_calls"
    response.choices[0].message.tool_calls = [tc]
    response.choices[0].message.content = None
    return response


def _mock_final_response(content: str = "22°C sunny") -> MagicMock:
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].finish_reason = "stop"
    response.choices[0].message.tool_calls = None
    response.choices[0].message.content = content
    return response


# ---------------------------------------------------------------------------
# Tests: _resolve_bindings helper
# ---------------------------------------------------------------------------


class TestResolveBindings:
    """Tests for the _resolve_bindings helper that merges bound values."""

    def test_injects_bound_value(self):
        """Bound param gets injected from parent_inputs."""
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        fn_args = {"city": "Paris"}
        parent_inputs = {"preferred_unit": "celsius"}

        result = _resolve_bindings(agent, "get_weather", fn_args, parent_inputs)
        assert result == {"city": "Paris", "unit": "celsius"}

    def test_does_not_overwrite_llm_provided(self):
        """If LLM already provided the bound param, binding still overrides.

        Rationale: bound params are stripped from the wire format so the LLM
        shouldn't provide them, but if it does, the binding takes precedence.
        """
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        fn_args = {"city": "Paris", "unit": "fahrenheit"}
        parent_inputs = {"preferred_unit": "celsius"}

        result = _resolve_bindings(agent, "get_weather", fn_args, parent_inputs)
        assert result == {"city": "Paris", "unit": "celsius"}

    def test_no_bindings_passes_through(self):
        """Without bindings, args pass through unchanged."""
        agent = _make_bound_agent(bindings={})
        fn_args = {"city": "Paris"}

        result = _resolve_bindings(agent, "get_weather", fn_args, {})
        assert result == {"city": "Paris"}

    def test_missing_parent_input_skips(self):
        """If the bound input key isn't in parent_inputs, skip silently.

        The param might have a default or the LLM may have guessed it.
        """
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        fn_args = {"city": "Paris"}
        parent_inputs = {}  # no preferred_unit

        result = _resolve_bindings(agent, "get_weather", fn_args, parent_inputs)
        assert result == {"city": "Paris"}  # unit not injected

    def test_no_matching_tool(self):
        """If the tool name doesn't match any tool, args pass through."""
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        fn_args = {"city": "Paris"}

        result = _resolve_bindings(agent, "unknown_tool", fn_args, {"preferred_unit": "celsius"})
        assert result == {"city": "Paris"}

    def test_multiple_bindings(self):
        """Multiple params can be bound simultaneously."""
        data: dict[str, Any] = {
            "name": "multi-bind",
            "model": {"id": "gpt-4", "provider": "openai", "connection": {"kind": "key", "apiKey": "k"}},
            "tools": [
                {
                    "name": "search",
                    "kind": "function",
                    "parameters": [
                        {"name": "query", "kind": "string"},
                        {"name": "lang", "kind": "string"},
                        {"name": "limit", "kind": "integer"},
                    ],
                    "bindings": [
                        {"name": "lang", "input": "user_language"},
                        {"name": "limit", "input": "max_results"},
                    ],
                }
            ],
            "template": {"format": {"kind": "jinja2"}, "parser": {"kind": "prompty"}},
        }
        agent = Prompty.load(data)
        fn_args = {"query": "weather"}
        parent_inputs = {"user_language": "en", "max_results": 10}

        result = _resolve_bindings(agent, "search", fn_args, parent_inputs)
        assert result == {"query": "weather", "lang": "en", "limit": 10}

    def test_none_agent_tools(self):
        """Agent with no tools at all passes args through."""
        data: dict[str, Any] = {
            "name": "no-tools",
            "model": {"id": "gpt-4", "provider": "openai", "connection": {"kind": "key", "apiKey": "k"}},
            "template": {"format": {"kind": "jinja2"}, "parser": {"kind": "prompty"}},
        }
        agent = Prompty.load(data)
        fn_args = {"x": 1}

        result = _resolve_bindings(agent, "fn", fn_args, {})
        assert result == {"x": 1}


# ---------------------------------------------------------------------------
# Tests: Wire format (bound params stripped from tool definition)
# ---------------------------------------------------------------------------


class TestWireFormatBindings:
    """Bound parameters should be stripped from tool definitions sent to the LLM."""

    def test_openai_strips_bound_params(self):
        """OpenAI _tools_to_wire strips bound param names."""
        from prompty.providers.openai.executor import _tools_to_wire

        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        wire = _tools_to_wire(agent)

        assert wire is not None
        assert len(wire) == 1
        params = wire[0]["function"]["parameters"]
        # Only 'city' should be in properties; 'unit' is bound and stripped
        assert "city" in params["properties"]
        assert "unit" not in params["properties"]

    def test_openai_no_bindings_keeps_all(self):
        """Without bindings, all params are present."""
        from prompty.providers.openai.executor import _tools_to_wire

        agent = _make_bound_agent(bindings={})
        wire = _tools_to_wire(agent)

        assert wire is not None
        params = wire[0]["function"]["parameters"]
        assert "city" in params["properties"]
        assert "unit" in params["properties"]


# ---------------------------------------------------------------------------
# Tests: _build_openai_tool_result_messages with bindings
# ---------------------------------------------------------------------------


class TestBuildToolResultMessagesWithBindings:
    """_build_openai_tool_result_messages should inject bound values before calling tools."""

    def test_binding_injected_into_tool_call(self):
        """Tool function receives merged args including bound values."""
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        parent_inputs = {"preferred_unit": "celsius"}

        # LLM provides only city (unit is bound)
        response = _mock_tool_call_response("get_weather", '{"city": "Paris"}')

        received_args: dict[str, Any] = {}

        def get_weather(city: str, unit: str = "fahrenheit") -> str:
            received_args["city"] = city
            received_args["unit"] = unit
            return f"{city}: 22°C"

        tools = {"get_weather": get_weather}
        _build_openai_tool_result_messages(response, tools, agent, parent_inputs)

        assert received_args["city"] == "Paris"
        assert received_args["unit"] == "celsius"

    def test_no_bindings_works_normally(self):
        """Without bindings, tool receives only LLM-provided args."""
        agent = _make_bound_agent(bindings={})
        response = _mock_tool_call_response("get_weather", '{"city": "Paris"}')

        received_args: dict[str, Any] = {}

        def get_weather(city: str) -> str:
            received_args["city"] = city
            return "sunny"

        tools = {"get_weather": get_weather}
        _build_openai_tool_result_messages(response, tools, agent, {})

        assert received_args["city"] == "Paris"


# ---------------------------------------------------------------------------
# Tests: Streaming path (_build_tool_messages_from_calls) with bindings
# ---------------------------------------------------------------------------


class TestStreamingPathBindings:
    """_build_tool_messages_from_calls (streaming) should also inject bindings."""

    def test_streaming_binding_injection(self):
        """Streaming tool execution merges bound values."""
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        parent_inputs = {"preferred_unit": "celsius"}

        tc = MagicMock()
        tc.id = "call_1"
        tc.name = "get_weather"
        tc.arguments = '{"city": "Paris"}'

        received_args: dict[str, Any] = {}

        def get_weather(city: str, unit: str = "f") -> str:
            received_args["city"] = city
            received_args["unit"] = unit
            return "22°C"

        tools = {"get_weather": get_weather}
        _build_tool_messages_from_calls([tc], "", tools, agent, parent_inputs)

        assert received_args["city"] == "Paris"
        assert received_args["unit"] == "celsius"


# ---------------------------------------------------------------------------
# Tests: execute_agent end-to-end with bindings
# ---------------------------------------------------------------------------


class TestExecuteAgentBindings:
    """Full execute_agent pipeline should thread inputs through for binding injection."""

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_bindings_injected_e2e(self, mock_prepare, mock_execute, mock_process):
        """execute_agent injects bound values into tool calls."""
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        messages = [Message(role="user", parts=[TextPart(value="Weather in Paris?")])]
        mock_prepare.return_value = messages

        # First call: tool call, second call: final answer
        tool_response = _mock_tool_call_response("get_weather", '{"city": "Paris"}')
        final_response = _mock_final_response("22°C and sunny")
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "22°C and sunny"

        received_args: dict[str, Any] = {}

        def get_weather(city: str, unit: str = "f") -> str:
            received_args["city"] = city
            received_args["unit"] = unit
            return "22°C sunny"

        result = execute_agent(
            agent,
            inputs={"preferred_unit": "celsius"},
            tools={"get_weather": get_weather},
        )

        assert received_args["city"] == "Paris"
        assert received_args["unit"] == "celsius"
        assert result == "22°C and sunny"

    @pytest.mark.asyncio
    @patch("prompty.core.pipeline.process_async")
    @patch("prompty.core.pipeline._invoke_executor_async")
    @patch("prompty.core.pipeline.prepare_async")
    async def test_bindings_injected_async(self, mock_prepare, mock_execute, mock_process):
        """Async execute_agent also injects bound values."""
        agent = _make_bound_agent(bindings={"unit": "preferred_unit"})
        messages = [Message(role="user", parts=[TextPart(value="Weather?")])]
        mock_prepare.return_value = messages

        tool_response = _mock_tool_call_response("get_weather", '{"city": "London"}')
        final_response = _mock_final_response("15°C rainy")
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "15°C rainy"

        received_args: dict[str, Any] = {}

        def get_weather(city: str, unit: str = "f") -> str:
            received_args["city"] = city
            received_args["unit"] = unit
            return "15°C rainy"

        await execute_agent_async(
            agent,
            inputs={"preferred_unit": "celsius"},
            tools={"get_weather": get_weather},
        )

        assert received_args["city"] == "London"
        assert received_args["unit"] == "celsius"
