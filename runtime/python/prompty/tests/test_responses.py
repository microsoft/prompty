"""Tests for Responses API support — wire format, executor dispatch, and processor.

Covers:
- Wire format helpers: _build_responses_options, _responses_tools_to_wire,
  _output_schema_to_responses_wire, _message_to_responses_input
- Executor dispatch: apiType="responses" routes to responses.create
- Processor: _process_responses_api handles text, tool calls, structured output, errors
- E2E with mocked client: full pipeline from messages → processed result
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from prompty.core.types import Message, TextPart
from prompty.model import Prompty
from prompty.providers.openai.executor import (
    _BaseExecutor,
    _build_responses_options,
    _message_to_responses_input,
    _output_schema_to_responses_wire,
    _responses_tools_to_wire,
)
from prompty.providers.openai.processor import (
    ToolCall,
    _process_response,
    _process_responses_api,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent(
    api_type: str = "responses",
    model_id: str = "gpt-4o",
    provider: str = "openai",
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    name: str = "test-agent",
) -> Prompty:
    """Build a Prompty agent via Prompty.load()."""
    data: dict[str, Any] = {
        "name": name,
        "model": {
            "id": model_id,
            "provider": provider,
            "apiType": api_type,
        },
    }

    if options:
        data["model"]["options"] = options

    if tools:
        data["tools"] = tools

    if outputs:
        data["outputs"] = outputs

    return Prompty.load(data)


def _make_response(
    output_text: str = "Hello!",
    output: list[Any] | None = None,
    error: Any = None,
) -> SimpleNamespace:
    """Build a mock Responses API response object."""
    resp = SimpleNamespace()
    resp.object = "response"
    resp.output_text = output_text
    resp.output = output or []
    resp.error = error
    return resp


def _make_function_call_item(
    call_id: str = "call_123",
    name: str = "get_weather",
    arguments: str = '{"city": "Seattle"}',
) -> SimpleNamespace:
    return SimpleNamespace(type="function_call", call_id=call_id, name=name, arguments=arguments)


def _make_message_item(text: str = "Hello!") -> SimpleNamespace:
    part = SimpleNamespace(type="output_text", text=text)
    return SimpleNamespace(type="message", content=[part])


# ---------------------------------------------------------------------------
# Wire format: _build_responses_options
# ---------------------------------------------------------------------------


class TestBuildResponsesOptions:
    def test_empty_options(self) -> None:
        agent = _make_agent(options=None)
        assert _build_responses_options(agent) == {}

    def test_temperature(self) -> None:
        agent = _make_agent(options={"temperature": 0.5})
        opts = _build_responses_options(agent)
        assert opts["temperature"] == 0.5

    def test_max_output_tokens(self) -> None:
        """Responses API uses max_output_tokens (not max_completion_tokens)."""
        agent = _make_agent(options={"maxOutputTokens": 500})
        opts = _build_responses_options(agent)
        assert opts["max_output_tokens"] == 500
        assert "max_completion_tokens" not in opts

    def test_top_p(self) -> None:
        agent = _make_agent(options={"topP": 0.9})
        opts = _build_responses_options(agent)
        assert opts["top_p"] == 0.9

    def test_additional_properties(self) -> None:
        agent = _make_agent(options={"additionalProperties": {"store": True, "metadata": {"foo": "bar"}}})
        opts = _build_responses_options(agent)
        assert opts["store"] is True
        assert opts["metadata"] == {"foo": "bar"}

    def test_no_frequency_penalty(self) -> None:
        """frequencyPenalty is NOT valid for Responses API."""
        agent = _make_agent(options={"frequencyPenalty": 0.5})
        opts = _build_responses_options(agent)
        assert "frequency_penalty" not in opts


# ---------------------------------------------------------------------------
# Wire format: _responses_tools_to_wire
# ---------------------------------------------------------------------------


class TestResponsesToolsToWire:
    def test_no_tools(self) -> None:
        agent = _make_agent(tools=None)
        assert _responses_tools_to_wire(agent) is None

    def test_function_tool_flat_format(self) -> None:
        agent = _make_agent(
            tools=[
                {
                    "name": "get_weather",
                    "kind": "function",
                    "description": "Get the weather",
                    "parameters": [{"name": "city", "kind": "string"}],
                }
            ]
        )
        tools = _responses_tools_to_wire(agent)
        assert tools is not None
        assert len(tools) == 1

        tool = tools[0]
        assert tool["type"] == "function"
        assert tool["name"] == "get_weather"
        assert tool["description"] == "Get the weather"
        # Flat: name/parameters at top level, NOT nested under "function"
        assert "function" not in tool
        assert "parameters" in tool

    def test_strict_tool(self) -> None:
        agent = _make_agent(
            tools=[
                {
                    "name": "calc",
                    "kind": "function",
                    "strict": True,
                    "parameters": [{"name": "expr", "kind": "string"}],
                }
            ]
        )
        tools = _responses_tools_to_wire(agent)
        assert tools is not None
        tool = tools[0]
        assert tool["strict"] is True
        assert tool["parameters"]["additionalProperties"] is False

    def test_non_function_tools_skipped(self) -> None:
        """MCP, OpenAPI, etc. tools are not sent in the Responses API."""
        agent = _make_agent(
            tools=[
                {
                    "name": "my_mcp",
                    "kind": "mcp",
                    "connection": {"kind": "reference"},
                    "serverName": "my-server",
                }
            ]
        )
        result = _responses_tools_to_wire(agent)
        assert result is None


# ---------------------------------------------------------------------------
# Wire format: _output_schema_to_responses_wire
# ---------------------------------------------------------------------------


class TestOutputSchemaToResponsesWire:
    def test_no_output_schema(self) -> None:
        agent = _make_agent(outputs=None)
        assert _output_schema_to_responses_wire(agent) is None

    def test_basic_schema(self) -> None:
        agent = _make_agent(
            name="weather-response",
            outputs=[
                {"name": "temperature", "kind": "integer", "description": "Temp in F"},
                {"name": "condition", "kind": "string"},
            ],
        )
        result = _output_schema_to_responses_wire(agent)
        assert result is not None

        fmt = result["format"]
        assert fmt["type"] == "json_schema"
        assert fmt["name"] == "structured_output"
        assert fmt["strict"] is True

        schema = fmt["schema"]
        assert schema["type"] == "object"
        assert "temperature" in schema["properties"]
        assert "condition" in schema["properties"]
        assert schema["properties"]["temperature"]["type"] == "integer"
        assert schema["additionalProperties"] is False


# ---------------------------------------------------------------------------
# Wire format: _message_to_responses_input
# ---------------------------------------------------------------------------


class TestMessageToResponsesInput:
    def test_user_message(self) -> None:
        msg = Message(role="user", parts=[TextPart(value="Hello")])
        wire = _message_to_responses_input(msg)
        assert wire["role"] == "user"
        assert wire["content"] == "Hello"

    def test_assistant_message(self) -> None:
        msg = Message(role="assistant", parts=[TextPart(value="Hi there")])
        wire = _message_to_responses_input(msg)
        assert wire["role"] == "assistant"
        assert wire["content"] == "Hi there"

    def test_tool_result_message(self) -> None:
        """Tool result messages convert to function_call_output."""
        msg = Message(
            role="tool",
            parts=[TextPart(value="72°F")],
            metadata={"tool_call_id": "call_abc"},
        )
        wire = _message_to_responses_input(msg)
        assert wire["type"] == "function_call_output"
        assert wire["call_id"] == "call_abc"
        assert wire["output"] == "72°F"


# ---------------------------------------------------------------------------
# Executor: _build_responses_args (via _BaseExecutor)
# ---------------------------------------------------------------------------


class TestBuildResponsesArgs:
    def _build(self, agent: Any, messages: list[Message]) -> dict[str, Any]:
        executor = _BaseExecutor.__new__(_BaseExecutor)
        return executor._build_responses_args(agent, messages)

    def test_basic_chat(self) -> None:
        agent = _make_agent(model_id="gpt-4o")
        messages = [
            Message(role="system", parts=[TextPart(value="You are helpful.")]),
            Message(role="user", parts=[TextPart(value="Hi")]),
        ]
        args = self._build(agent, messages)

        assert args["model"] == "gpt-4o"
        assert args["instructions"] == "You are helpful."
        assert len(args["input"]) == 1
        assert args["input"][0]["role"] == "user"
        assert args["input"][0]["content"] == "Hi"

    def test_no_system_message(self) -> None:
        agent = _make_agent()
        messages = [Message(role="user", parts=[TextPart(value="Hello")])]
        args = self._build(agent, messages)
        assert "instructions" not in args
        assert len(args["input"]) == 1

    def test_multiple_system_messages_joined(self) -> None:
        agent = _make_agent()
        messages = [
            Message(role="system", parts=[TextPart(value="Rule 1")]),
            Message(role="system", parts=[TextPart(value="Rule 2")]),
            Message(role="user", parts=[TextPart(value="Hi")]),
        ]
        args = self._build(agent, messages)
        assert args["instructions"] == "Rule 1\n\nRule 2"

    def test_with_tools(self) -> None:
        agent = _make_agent(
            tools=[
                {
                    "name": "get_weather",
                    "kind": "function",
                    "description": "Weather lookup",
                    "parameters": [{"name": "city", "kind": "string"}],
                }
            ]
        )
        messages = [Message(role="user", parts=[TextPart(value="Weather?")])]
        args = self._build(agent, messages)
        assert "tools" in args
        assert args["tools"][0]["type"] == "function"
        assert args["tools"][0]["name"] == "get_weather"

    def test_with_output_schema(self) -> None:
        agent = _make_agent(
            outputs=[
                {"name": "answer", "kind": "string"},
            ]
        )
        messages = [Message(role="user", parts=[TextPart(value="Structured?")])]
        args = self._build(agent, messages)
        assert "text" in args
        assert args["text"]["format"]["type"] == "json_schema"

    def test_options_applied(self) -> None:
        agent = _make_agent(options={"temperature": 0.3, "maxOutputTokens": 100})
        messages = [Message(role="user", parts=[TextPart(value="Hi")])]
        args = self._build(agent, messages)
        assert args["temperature"] == 0.3
        assert args["max_output_tokens"] == 100

    def test_tool_result_in_input(self) -> None:
        agent = _make_agent()
        messages = [
            Message(role="user", parts=[TextPart(value="Weather?")]),
            Message(
                role="tool",
                parts=[TextPart(value="72°F")],
                metadata={"tool_call_id": "call_xyz"},
            ),
        ]
        args = self._build(agent, messages)
        assert len(args["input"]) == 2
        assert args["input"][1]["type"] == "function_call_output"
        assert args["input"][1]["call_id"] == "call_xyz"


# ---------------------------------------------------------------------------
# Processor: _process_responses_api
# ---------------------------------------------------------------------------


class TestProcessResponsesApi:
    def test_text_response(self) -> None:
        resp = _make_response(output_text="Hello world!")
        result = _process_responses_api(resp)
        assert result == "Hello world!"

    def test_function_calls(self) -> None:
        fc = _make_function_call_item(call_id="call_1", name="get_weather", arguments='{"city": "NYC"}')
        resp = _make_response(output_text=None, output=[fc])
        result = _process_responses_api(resp)

        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], ToolCall)
        assert result[0].id == "call_1"
        assert result[0].name == "get_weather"
        assert result[0].arguments == '{"city": "NYC"}'

    def test_multiple_function_calls(self) -> None:
        fc1 = _make_function_call_item(call_id="call_1", name="get_weather", arguments='{"city": "NYC"}')
        fc2 = _make_function_call_item(call_id="call_2", name="get_time", arguments='{"tz": "EST"}')
        resp = _make_response(output_text=None, output=[fc1, fc2])
        result = _process_responses_api(resp)

        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0].name == "get_weather"
        assert result[1].name == "get_time"

    def test_structured_output_json_parsed(self) -> None:
        agent = _make_agent(
            outputs=[
                {"name": "temperature", "kind": "integer"},
                {"name": "condition", "kind": "string"},
            ]
        )
        json_str = json.dumps({"temperature": 72, "condition": "sunny"})
        resp = _make_response(output_text=json_str)
        result = _process_responses_api(resp, agent)

        assert isinstance(result, dict)
        assert result["temperature"] == 72
        assert result["condition"] == "sunny"

    def test_structured_output_invalid_json_passthrough(self) -> None:
        agent = _make_agent(outputs=[{"name": "x", "kind": "string"}])
        resp = _make_response(output_text="not json {{{")
        result = _process_responses_api(resp, agent)
        assert result == "not json {{{"

    def test_error_response(self) -> None:
        error = SimpleNamespace(message="Rate limit exceeded")
        resp = _make_response(error=error)
        with pytest.raises(ValueError, match="Rate limit exceeded"):
            _process_responses_api(resp)

    def test_fallback_to_message_items(self) -> None:
        """When output_text is None, extract from message output items."""
        msg_item = _make_message_item("Extracted text")
        resp = SimpleNamespace(
            object="response",
            output_text=None,
            output=[msg_item],
            error=None,
        )
        result = _process_responses_api(resp)
        assert result == "Extracted text"

    def test_empty_response_passthrough(self) -> None:
        resp = SimpleNamespace(
            object="response",
            output_text=None,
            output=[],
            error=None,
        )
        result = _process_responses_api(resp)
        # With no text and no tools, returns the raw response object
        assert result is resp


# ---------------------------------------------------------------------------
# Processor: _process_response dispatches to Responses API
# ---------------------------------------------------------------------------


class TestProcessResponseDispatchResponses:
    def test_duck_typed_response(self) -> None:
        """_process_response detects Responses API via duck typing."""
        resp = _make_response(output_text="Hi from responses")
        result = _process_response(resp)
        assert result == "Hi from responses"

    def test_duck_typed_with_agent(self) -> None:
        """Structured output parsing works through the main dispatcher."""
        agent = _make_agent(outputs=[{"name": "answer", "kind": "string"}])
        json_str = json.dumps({"answer": "42"})
        resp = _make_response(output_text=json_str)
        result = _process_response(resp, agent)
        assert isinstance(result, dict)
        assert result["answer"] == "42"


# ---------------------------------------------------------------------------
# E2E: Executor dispatch with mocked client
# ---------------------------------------------------------------------------


class TestExecutorResponsesDispatch:
    def _make_mock_client(self, response: Any = None) -> MagicMock:
        client = MagicMock()
        client.responses.create.return_value = response or _make_response()
        return client

    def test_dispatch_calls_responses_create(self) -> None:
        agent = _make_agent(api_type="responses", model_id="gpt-4o")
        mock_resp = _make_response(output_text="Test response")
        client = self._make_mock_client(mock_resp)

        executor = _BaseExecutor.__new__(_BaseExecutor)
        executor._trace_prefix = "OpenAI"

        executor._execute_responses(client, agent, [Message(role="user", parts=[TextPart(value="Hi")])])

        client.responses.create.assert_called_once()
        call_kwargs = client.responses.create.call_args[1]
        assert call_kwargs["model"] == "gpt-4o"

    def test_responses_with_tools_in_args(self) -> None:
        agent = _make_agent(
            api_type="responses",
            tools=[
                {
                    "name": "get_weather",
                    "kind": "function",
                    "description": "Weather",
                    "parameters": [{"name": "city", "kind": "string"}],
                }
            ],
        )
        client = self._make_mock_client()
        executor = _BaseExecutor.__new__(_BaseExecutor)
        executor._trace_prefix = "OpenAI"

        executor._execute_responses(client, agent, [Message(role="user", parts=[TextPart(value="Weather?")])])

        call_kwargs = client.responses.create.call_args[1]
        assert "tools" in call_kwargs
        assert call_kwargs["tools"][0]["name"] == "get_weather"

    def test_responses_with_structured_output(self) -> None:
        agent = _make_agent(
            api_type="responses",
            outputs=[{"name": "answer", "kind": "string"}],
        )
        client = self._make_mock_client()
        executor = _BaseExecutor.__new__(_BaseExecutor)
        executor._trace_prefix = "OpenAI"

        executor._execute_responses(
            client,
            agent,
            [
                Message(role="user", parts=[TextPart(value="Answer?")]),
            ],
        )

        call_kwargs = client.responses.create.call_args[1]
        assert "text" in call_kwargs
        assert call_kwargs["text"]["format"]["type"] == "json_schema"


# ---------------------------------------------------------------------------
# E2E: Async executor dispatch
# ---------------------------------------------------------------------------


class TestExecutorResponsesAsync:
    @pytest.mark.asyncio
    async def test_async_dispatch(self) -> None:
        agent = _make_agent(api_type="responses")
        mock_resp = _make_response(output_text="Async response")

        client = MagicMock()
        client.responses.create = AsyncMock(return_value=mock_resp)

        executor = _BaseExecutor.__new__(_BaseExecutor)
        executor._trace_prefix = "OpenAI"

        await executor._execute_responses_async(client, agent, [Message(role="user", parts=[TextPart(value="Hi")])])

        client.responses.create.assert_called_once()


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


class TestResponsesErrorCases:
    def test_api_error_response(self) -> None:
        """Responses API can return an error in the response object."""
        error = SimpleNamespace(message="Content filter triggered")
        resp = _make_response(error=error)

        with pytest.raises(ValueError, match="Content filter triggered"):
            _process_responses_api(resp)

    def test_refusal_in_output(self) -> None:
        """Model refusal — output_text is None, no function calls."""
        resp = SimpleNamespace(
            object="response",
            output_text=None,
            output=[],
            error=None,
        )
        result = _process_responses_api(resp)
        # Returns raw response when nothing extractable
        assert result is resp

    def test_api_exception_propagates(self) -> None:
        """SDK exception from responses.create propagates up."""
        agent = _make_agent(api_type="responses")
        client = MagicMock()
        client.responses.create.side_effect = RuntimeError("Connection failed")

        executor = _BaseExecutor.__new__(_BaseExecutor)
        executor._trace_prefix = "OpenAI"

        with pytest.raises(RuntimeError, match="Connection failed"):
            executor._execute_responses(client, agent, [Message(role="user", parts=[TextPart(value="Hi")])])

    def test_malformed_tool_call_missing_fields(self) -> None:
        """Tool call items with missing fields should still produce ToolCall."""
        item = SimpleNamespace(type="function_call", call_id=None, name=None, arguments=None)
        resp = _make_response(output_text=None, output=[item])
        result = _process_responses_api(resp)

        assert isinstance(result, list)
        assert len(result) == 1
        tc = result[0]
        assert tc.id == ""
        assert tc.name == ""
        assert tc.arguments == ""

    def test_invalid_structured_json_with_output_schema(self) -> None:
        """Invalid JSON with output_schema defined → return raw string."""
        agent = _make_agent(outputs=[{"name": "x", "kind": "string"}])
        resp = _make_response(output_text="This is not JSON!")
        result = _process_responses_api(resp, agent)
        assert result == "This is not JSON!"
