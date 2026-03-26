"""Tests for execute_agent() / execute_agent_async() pipeline functions.

These tests mock the pipeline's _invoke_executor/process functions (not the SDK client)
since execute_agent is a pipeline-level orchestration, not an executor concern.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from prompty.core.pipeline import (
    _build_tool_result_messages,
    _execute_tool,
    _execute_tool_async,
    _has_tool_calls,
    execute_agent,
    execute_agent_async,
)
from prompty.core.types import Message, TextPart
from prompty.model import Prompty

# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------


def _make_agent() -> Prompty:
    """Create a minimal Prompty with a function tool."""
    data = {
        "name": "test-agent",
        "model": {
            "id": "gpt-4",
            "provider": "openai",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
        "tools": [
            {
                "name": "get_weather",
                "kind": "function",
                "description": "Get weather",
                "parameters": [
                    {"name": "location", "kind": "string", "description": "City"},
                ],
            }
        ],
        "template": {"format": {"kind": "jinja2"}, "parser": {"kind": "prompty"}},
    }
    agent = Prompty.load(data)
    return agent


def _mock_tool_call_response(fn_name: str, fn_args: str, call_id: str = "call_1") -> MagicMock:
    """Mock a ChatCompletion response with tool_calls."""
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
    return response


def _mock_final_response(content: str = "The weather is sunny.") -> MagicMock:
    """Mock a normal ChatCompletion (no tool calls)."""
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].finish_reason = "stop"
    response.choices[0].message.tool_calls = None
    response.choices[0].message.content = content
    return response


# ---------------------------------------------------------------------------
# _has_tool_calls
# ---------------------------------------------------------------------------


class TestHasToolCalls:
    def test_true_when_tool_calls_present(self):
        response = _mock_tool_call_response("fn", "{}")
        assert _has_tool_calls(response)

    def test_false_when_no_tool_calls(self):
        response = _mock_final_response()
        assert not _has_tool_calls(response)

    def test_false_when_no_choices(self):
        response = MagicMock()
        response.choices = []
        assert not _has_tool_calls(response)

    def test_false_when_no_choices_attr(self):
        assert not _has_tool_calls("not a response")


# ---------------------------------------------------------------------------
# _execute_tool
# ---------------------------------------------------------------------------


class TestExecuteTool:
    def test_success(self):
        result = _execute_tool(lambda city: f"Sunny in {city}", "get_weather", '{"city": "Seattle"}')
        assert result == "Sunny in Seattle"

    def test_bad_json(self):
        result = _execute_tool(lambda: None, "fn", "not json")
        assert "invalid JSON" in result
        assert "fn" in result

    def test_tool_exception(self):
        def failing_fn():
            raise RuntimeError("oops")

        result = _execute_tool(failing_fn, "fn", "{}")
        assert "Error calling 'fn'" in result
        assert "RuntimeError" in result
        assert "oops" in result

    def test_result_is_stringified(self):
        result = _execute_tool(lambda: {"temp": 72}, "fn", "{}")
        assert result == "{'temp': 72}"


class TestExecuteToolAsync:
    def test_success_sync_fn(self):
        result = asyncio.get_event_loop().run_until_complete(
            _execute_tool_async(lambda city: f"Rainy in {city}", "fn", '{"city": "London"}')
        )
        assert result == "Rainy in London"

    def test_success_async_fn(self):
        async def async_fn(city: str) -> str:
            return f"Cloudy in {city}"

        result = asyncio.get_event_loop().run_until_complete(_execute_tool_async(async_fn, "fn", '{"city": "Paris"}'))
        assert result == "Cloudy in Paris"

    def test_bad_json(self):
        result = asyncio.get_event_loop().run_until_complete(_execute_tool_async(lambda: None, "fn", "{bad}"))
        assert "invalid JSON" in result


# ---------------------------------------------------------------------------
# _build_tool_result_messages
# ---------------------------------------------------------------------------


class TestBuildToolResultMessages:
    def test_basic(self):
        response = _mock_tool_call_response("get_weather", '{"location": "Seattle"}')
        tools = {"get_weather": lambda location: f"Sunny in {location}"}

        messages, _ = _build_tool_result_messages(response, tools)

        assert len(messages) == 2
        # First message is assistant with tool_calls metadata
        assert messages[0].role == "assistant"
        assert "tool_calls" in messages[0].metadata
        # Second is the tool result
        assert messages[1].role == "tool"
        assert messages[1].metadata["tool_call_id"] == "call_1"
        assert messages[1].metadata["name"] == "get_weather"
        assert messages[1].parts[0].value == "Sunny in Seattle"

    def test_missing_tool(self):
        response = _mock_tool_call_response("unknown_fn", "{}")
        tools: dict[str, Any] = {}

        messages, _ = _build_tool_result_messages(response, tools)

        assert len(messages) == 2
        assert "not registered" in messages[1].parts[0].value

    def test_async_tool_in_sync_mode(self):
        async def async_fn():
            return "hi"

        response = _mock_tool_call_response("async_fn", "{}")
        tools = {"async_fn": async_fn}

        messages, _ = _build_tool_result_messages(response, tools)

        assert "async tool" in messages[1].parts[0].value
        assert "sync mode" in messages[1].parts[0].value


# ---------------------------------------------------------------------------
# execute_agent (sync)
# ---------------------------------------------------------------------------


class TestRunAgent:
    """Tests for execute_agent() pipeline function."""

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_no_tool_calls_returns_immediately(self, mock_prepare, mock_execute, mock_process):
        """When the model returns no tool calls, execute_agent does a single pass."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Hello")])]
        final_response = _mock_final_response("Hello back!")

        mock_prepare.return_value = messages
        mock_execute.return_value = final_response
        mock_process.return_value = "Hello back!"

        result = execute_agent(agent, inputs={"question": "Hello"})

        assert result == "Hello back!"
        assert mock_execute.call_count == 1
        mock_process.assert_called_once_with(agent, final_response)

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_single_tool_call_loop(self, mock_prepare, mock_execute, mock_process):
        """Model calls a tool, gets result, then responds normally."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Weather?")])]

        tool_response = _mock_tool_call_response("get_weather", '{"location": "Seattle"}')
        final_response = _mock_final_response("It's sunny in Seattle.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "It's sunny in Seattle."

        tools = {"get_weather": lambda location: f"72°F in {location}"}
        result = execute_agent(agent, inputs={}, tools=tools)

        assert result == "It's sunny in Seattle."
        assert mock_execute.call_count == 2
        # Messages should have been extended with tool result
        assert len(messages) > 1

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_multiple_iterations(self, mock_prepare, mock_execute, mock_process):
        """Model calls tools twice before final response."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Weather?")])]

        tool_resp_1 = _mock_tool_call_response("get_weather", '{"location": "Seattle"}', "call_1")
        tool_resp_2 = _mock_tool_call_response("get_weather", '{"location": "Portland"}', "call_2")
        final_response = _mock_final_response("Both are sunny.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_resp_1, tool_resp_2, final_response]
        mock_process.return_value = "Both are sunny."

        tools = {"get_weather": lambda location: f"72°F in {location}"}
        result = execute_agent(agent, inputs={}, tools=tools)

        assert result == "Both are sunny."
        assert mock_execute.call_count == 3

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_max_iterations_exceeded(self, mock_prepare, mock_execute, mock_process):
        """Raises ValueError when max_iterations is exceeded."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Loop forever")])]
        tool_response = _mock_tool_call_response("get_weather", '{"location": "X"}')

        mock_prepare.return_value = messages
        mock_execute.return_value = tool_response  # Always returns tool calls

        tools = {"get_weather": lambda location: "sunny"}

        with pytest.raises(ValueError, match="max_iterations"):
            execute_agent(agent, inputs={}, tools=tools, max_iterations=3)

        # Should have been called 4 times: initial + 3 retries
        assert mock_execute.call_count == 4

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_bad_json_tool_args_recovers(self, mock_prepare, mock_execute, mock_process):
        """Bad JSON in tool arguments sends error back to model, model self-corrects."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Go")])]

        bad_args_response = _mock_tool_call_response("get_weather", "not valid json")
        final_response = _mock_final_response("Fixed it.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [bad_args_response, final_response]
        mock_process.return_value = "Fixed it."

        tools = {"get_weather": lambda location: "sunny"}
        result = execute_agent(agent, inputs={}, tools=tools)

        assert result == "Fixed it."
        # Check that error message was sent back as tool result
        tool_msg = [m for m in messages if m.role == "tool"][0]
        assert "invalid JSON" in tool_msg.parts[0].value

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_tool_exception_recovers(self, mock_prepare, mock_execute, mock_process):
        """Tool function raises an exception; error sent back to model."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Go")])]

        tool_response = _mock_tool_call_response("get_weather", '{"location": "X"}')
        final_response = _mock_final_response("Sorry about that.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "Sorry about that."

        def failing_tool(location: str) -> str:
            raise RuntimeError("API down")

        tools = {"get_weather": failing_tool}
        result = execute_agent(agent, inputs={}, tools=tools)

        assert result == "Sorry about that."
        tool_msg = [m for m in messages if m.role == "tool"][0]
        assert "RuntimeError" in tool_msg.parts[0].value
        assert "API down" in tool_msg.parts[0].value

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_missing_tool_sends_error_to_model(self, mock_prepare, mock_execute, mock_process):
        """Unknown tool name sends error back to model, doesn't crash."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Go")])]

        tool_response = _mock_tool_call_response("unknown_tool", "{}")
        final_response = _mock_final_response("I'll try differently.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "I'll try differently."

        tools: dict[str, Any] = {"get_weather": lambda: "sunny"}
        result = execute_agent(agent, inputs={}, tools=tools)

        assert result == "I'll try differently."
        tool_msg = [m for m in messages if m.role == "tool"][0]
        assert "not registered" in tool_msg.parts[0].value

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_raw_mode_skips_processing(self, mock_prepare, mock_execute, mock_process):
        """When raw=True, the raw response is returned without processing."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Hi")])]
        final_response = _mock_final_response("Raw result")

        mock_prepare.return_value = messages
        mock_execute.return_value = final_response

        result = execute_agent(agent, inputs={}, raw=True)

        assert result is final_response
        mock_process.assert_not_called()

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_tool_result_stringified(self, mock_prepare, mock_execute, mock_process):
        """Tool results (dicts, lists, etc.) are converted to strings."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Go")])]

        tool_response = _mock_tool_call_response("get_weather", '{"location": "X"}')
        final_response = _mock_final_response("Done.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "Done."

        tools = {"get_weather": lambda location: {"temp": 72, "condition": "sunny"}}
        execute_agent(agent, inputs={}, tools=tools)

        tool_msg = [m for m in messages if m.role == "tool"][0]
        assert tool_msg.parts[0].value == "{'temp': 72, 'condition': 'sunny'}"

    @patch("prompty.core.pipeline.process")
    @patch("prompty.core.pipeline._invoke_executor")
    @patch("prompty.core.pipeline.prepare")
    def test_loads_from_path(self, mock_prepare, mock_execute, mock_process):
        """When given a string path, execute_agent loads the prompty file."""
        final_response = _mock_final_response("Done.")
        mock_prepare.return_value = [Message(role="user", parts=[TextPart(value="Hi")])]
        mock_execute.return_value = final_response
        mock_process.return_value = "Done."

        with patch("prompty.core.loader.load") as mock_load:
            mock_load.return_value = _make_agent()
            result = execute_agent("test.prompty", inputs={})

        mock_load.assert_called_once_with("test.prompty")
        assert result == "Done."


# ---------------------------------------------------------------------------
# execute_agent_async
# ---------------------------------------------------------------------------


class TestRunAgentAsync:
    """Tests for execute_agent_async() pipeline function."""

    @pytest.mark.asyncio
    @patch("prompty.core.pipeline.process_async")
    @patch("prompty.core.pipeline._invoke_executor_async")
    @patch("prompty.core.pipeline.prepare_async")
    async def test_basic_async(self, mock_prepare, mock_execute, mock_process):
        """Basic async agent loop with one tool call."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Weather?")])]

        tool_response = _mock_tool_call_response("get_weather", '{"location": "Seattle"}')
        final_response = _mock_final_response("Sunny!")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "Sunny!"

        tools = {"get_weather": lambda location: f"72°F in {location}"}
        result = await execute_agent_async(agent, inputs={}, tools=tools)

        assert result == "Sunny!"
        assert mock_execute.call_count == 2

    @pytest.mark.asyncio
    @patch("prompty.core.pipeline.process_async")
    @patch("prompty.core.pipeline._invoke_executor_async")
    @patch("prompty.core.pipeline.prepare_async")
    async def test_async_tool_function(self, mock_prepare, mock_execute, mock_process):
        """Async tool functions are properly awaited."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Go")])]

        tool_response = _mock_tool_call_response("get_weather", '{"location": "X"}')
        final_response = _mock_final_response("Done.")

        mock_prepare.return_value = messages
        mock_execute.side_effect = [tool_response, final_response]
        mock_process.return_value = "Done."

        async def async_weather(location: str) -> str:
            return f"Async: 72°F in {location}"

        tools = {"get_weather": async_weather}
        result = await execute_agent_async(agent, inputs={}, tools=tools)

        assert result == "Done."
        tool_msg = [m for m in messages if m.role == "tool"][0]
        assert "Async: 72°F" in tool_msg.parts[0].value

    @pytest.mark.asyncio
    @patch("prompty.core.pipeline.process_async")
    @patch("prompty.core.pipeline._invoke_executor_async")
    @patch("prompty.core.pipeline.prepare_async")
    async def test_async_max_iterations(self, mock_prepare, mock_execute, mock_process):
        """Async variant also respects max_iterations."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Loop")])]
        tool_response = _mock_tool_call_response("get_weather", '{"location": "X"}')

        mock_prepare.return_value = messages
        mock_execute.return_value = tool_response

        tools = {"get_weather": lambda location: "sunny"}

        with pytest.raises(ValueError, match="max_iterations"):
            await execute_agent_async(agent, inputs={}, tools=tools, max_iterations=2)

    @pytest.mark.asyncio
    @patch("prompty.core.pipeline.process_async")
    @patch("prompty.core.pipeline._invoke_executor_async")
    @patch("prompty.core.pipeline.prepare_async")
    async def test_async_no_tool_calls(self, mock_prepare, mock_execute, mock_process):
        """No tool calls → single pass, same as sync."""
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Hi")])]
        final_response = _mock_final_response("Hello!")

        mock_prepare.return_value = messages
        mock_execute.return_value = final_response
        mock_process.return_value = "Hello!"

        result = await execute_agent_async(agent, inputs={})

        assert result == "Hello!"
        assert mock_execute.call_count == 1

    @pytest.mark.asyncio
    @patch("prompty.core.loader.load_async")
    @patch("prompty.core.pipeline.process_async")
    @patch("prompty.core.pipeline._invoke_executor_async")
    @patch("prompty.core.pipeline.prepare_async")
    async def test_async_loads_from_path(self, mock_prepare, mock_execute, mock_process, mock_load):
        """Async variant loads from file path when given a string."""
        agent = _make_agent()
        mock_load.return_value = agent
        mock_prepare.return_value = [Message(role="user", parts=[TextPart(value="Hi")])]
        mock_execute.return_value = _mock_final_response("Done.")
        mock_process.return_value = "Done."

        result = await execute_agent_async("test.prompty", inputs={})

        mock_load.assert_called_once_with("test.prompty")
        assert result == "Done."
