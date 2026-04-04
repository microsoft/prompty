"""Tests for the Anthropic provider — executor and processor.

Covers wire format, client resolution, chat execution, streaming,
tool calls, structured output, and error handling.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from prompty.core.connections import clear_connections, register_connection
from prompty.core.types import (
    AsyncPromptyStream,
    ImagePart,
    Message,
    PromptyStream,
    TextPart,
)
from prompty.model import Prompty
from prompty.providers.anthropic.executor import (
    AnthropicExecutor,
    _build_chat_args,
    _build_options,
    _message_to_wire,
    _output_schema_to_wire,
    _part_to_wire,
    _tools_to_wire,
)
from prompty.providers.anthropic.processor import AnthropicProcessor

PROMPTS_DIR = Path(__file__).parent / "prompts"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent(
    *,
    api_type: str = "chat",
    model: str = "claude-sonnet-4-5-20250929",
    provider: str = "anthropic",
    connection: dict | None = None,
    options: dict | None = None,
    tools: list | None = None,
    outputs: list | None = None,
    metadata: dict | None = None,
) -> Prompty:
    """Build a test agent for Anthropic."""
    conn = connection or {"kind": "key", "apiKey": "test-key"}
    data: dict = {
        "name": "test-anthropic",
        "model": {
            "id": model,
            "provider": provider,
            "apiType": api_type,
            "connection": conn,
        },
    }
    if options:
        data["model"]["options"] = options
    if tools:
        data["tools"] = tools
    if outputs:
        data["outputs"] = outputs
    if metadata:
        data["metadata"] = metadata
    return Prompty.load(data)


def _make_messages() -> list[Message]:
    return [
        Message("system", [TextPart(value="You are helpful.")]),
        Message("user", [TextPart(value="Hello")]),
    ]


def _mock_anthropic_response(
    content: list[dict] | None = None,
    stop_reason: str = "end_turn",
    model: str = "claude-sonnet-4-5-20250929",
) -> MagicMock:
    """Create a mock Anthropic Messages response."""
    resp = MagicMock()
    resp.id = "msg_test_123"
    resp.model = model
    resp.role = "assistant"
    resp.stop_reason = stop_reason
    resp.content = content or [MagicMock(type="text", text="Hello!", id=None, name=None, input=None)]
    resp.usage = MagicMock(input_tokens=10, output_tokens=5)
    return resp


def _mock_tool_use_response(
    tool_id: str = "toolu_123",
    tool_name: str = "get_weather",
    tool_input: dict | None = None,
) -> MagicMock:
    """Create a mock tool_use response."""
    text_block = MagicMock(type="text", text="Let me check the weather.", id=None, input=None)
    text_block.name = None  # avoid MagicMock name collision

    tool_block = MagicMock(type="tool_use", id=tool_id, input=tool_input or {"location": "Seattle"})
    tool_block.name = tool_name  # set name explicitly — MagicMock reserves 'name' kwarg

    return _mock_anthropic_response(content=[text_block, tool_block], stop_reason="tool_use")


# ---------------------------------------------------------------------------
# Wire format tests
# ---------------------------------------------------------------------------


class TestMessageToWire:
    def test_text_message(self):
        msg = Message("user", [TextPart(value="Hello")])
        wire = _message_to_wire(msg)
        assert wire["role"] == "user"
        # Anthropic always uses array content format
        assert wire["content"] == [{"type": "text", "text": "Hello"}]

    def test_system_message(self):
        msg = Message("system", [TextPart(value="Be helpful")])
        wire = _message_to_wire(msg)
        assert wire["role"] == "system"
        assert wire["content"] == [{"type": "text", "text": "Be helpful"}]

    def test_multi_part_message(self):
        msg = Message(
            "user",
            [
                TextPart(value="Look at this:"),
                ImagePart(source="https://example.com/img.png"),
            ],
        )
        wire = _message_to_wire(msg)
        assert wire["role"] == "user"
        assert isinstance(wire["content"], list)
        assert wire["content"][0] == {"type": "text", "text": "Look at this:"}
        assert wire["content"][1]["type"] == "image"
        assert wire["content"][1]["source"]["url"] == "https://example.com/img.png"

    def test_tool_result_message(self):
        msg = Message("tool", [TextPart(value="72°F")], {"tool_use_id": "toolu_123", "name": "get_weather"})
        wire = _message_to_wire(msg)
        assert wire["role"] == "user"
        assert wire["content"][0]["type"] == "tool_result"
        assert wire["content"][0]["tool_use_id"] == "toolu_123"

    def test_base64_image(self):
        msg = Message("user", [ImagePart(source="data:image/png;base64,iVBOR==")])
        wire = _message_to_wire(msg)
        content = wire["content"]
        assert isinstance(content, list)
        assert content[0]["type"] == "image"
        assert content[0]["source"]["type"] == "base64"
        assert content[0]["source"]["media_type"] == "image/png"
        assert content[0]["source"]["data"] == "iVBOR=="


class TestPartToWire:
    def test_text_part(self):
        assert _part_to_wire(TextPart(value="hi")) == {"type": "text", "text": "hi"}

    def test_image_url(self):
        result = _part_to_wire(ImagePart(source="https://example.com/img.png"))
        assert result["type"] == "image"
        assert result["source"]["type"] == "url"


class TestBuildOptions:
    def test_all_options(self):
        agent = _make_agent(
            options={
                "temperature": 0.5,
                "topP": 0.9,
                "topK": 40,
                "stopSequences": ["END"],
                "maxOutputTokens": 2048,
            }
        )
        opts = _build_options(agent)
        assert opts["temperature"] == 0.5
        assert opts["top_p"] == 0.9
        assert opts["top_k"] == 40
        assert opts["stop_sequences"] == ["END"]
        # maxOutputTokens is NOT included here — it's handled separately in _build_chat_args

    def test_empty_options(self):
        agent = _make_agent()
        opts = _build_options(agent)
        assert opts == {}


class TestToolsToWire:
    def test_function_tool(self):
        agent = _make_agent(
            tools=[
                {
                    "name": "get_weather",
                    "kind": "function",
                    "description": "Get weather",
                    "parameters": [
                        {"name": "location", "kind": "string", "description": "City", "required": True},
                    ],
                }
            ]
        )
        tools = _tools_to_wire(agent)
        assert len(tools) == 1
        assert tools[0]["name"] == "get_weather"
        assert tools[0]["description"] == "Get weather"
        assert "input_schema" in tools[0]
        assert "location" in tools[0]["input_schema"]["properties"]

    def test_no_tools(self):
        agent = _make_agent()
        assert _tools_to_wire(agent) == []

    def test_non_function_tools_excluded(self):
        agent = _make_agent(
            tools=[
                {
                    "name": "mcp_tool",
                    "kind": "mcp",
                    "connection": {"kind": "reference", "name": "test"},
                }
            ]
        )
        assert _tools_to_wire(agent) == []


class TestOutputSchemaToWire:
    def test_with_outputs(self):
        agent = _make_agent(
            outputs=[
                {"name": "city", "kind": "string", "description": "City name"},
                {"name": "temp", "kind": "float", "description": "Temperature"},
            ]
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        assert result["format"]["type"] == "json_schema"
        schema = result["format"]["schema"]
        assert "city" in schema["properties"]
        assert "temp" in schema["properties"]

    def test_no_outputs(self):
        agent = _make_agent()
        assert _output_schema_to_wire(agent) is None


class TestBuildChatArgs:
    def test_basic_args(self):
        agent = _make_agent(options={"maxOutputTokens": 512})
        messages = _make_messages()
        args = _build_chat_args(agent, messages)

        assert args["model"] == "claude-sonnet-4-5-20250929"
        assert args["max_tokens"] == 512
        assert "system" in args  # system message extracted
        assert args["system"] == "You are helpful."
        # Only user message in conversation (system extracted)
        assert len(args["messages"]) == 1
        assert args["messages"][0]["role"] == "user"

    def test_default_max_tokens(self):
        agent = _make_agent()
        messages = _make_messages()
        args = _build_chat_args(agent, messages)
        assert args["max_tokens"] == 4096  # DEFAULT_MAX_TOKENS

    def test_tools_included(self):
        agent = _make_agent(
            tools=[
                {
                    "name": "search",
                    "kind": "function",
                    "description": "Search",
                    "parameters": [{"name": "q", "kind": "string"}],
                }
            ]
        )
        args = _build_chat_args(agent, _make_messages())
        assert "tools" in args
        assert args["tools"][0]["name"] == "search"


# ---------------------------------------------------------------------------
# Executor tests
# ---------------------------------------------------------------------------


class TestExecutor:
    def test_chat_execution(self):
        mock_client = MagicMock()
        mock_response = _mock_anthropic_response()
        mock_client.messages.create.return_value = mock_response

        register_connection("mock-anthropic", client=mock_client)
        try:
            agent = _make_agent(connection={"kind": "reference", "name": "mock-anthropic"})
            executor = AnthropicExecutor()
            result = executor.execute(agent, _make_messages())

            assert result is mock_response
            mock_client.messages.create.assert_called_once()
            call_kwargs = mock_client.messages.create.call_args.kwargs
            assert call_kwargs["model"] == "claude-sonnet-4-5-20250929"
            assert "max_tokens" in call_kwargs
        finally:
            clear_connections()

    def test_streaming_execution(self):
        mock_client = MagicMock()
        mock_stream = MagicMock()
        mock_client.messages.create.return_value = mock_stream

        register_connection("mock-anthropic", client=mock_client)
        try:
            agent = _make_agent(
                connection={"kind": "reference", "name": "mock-anthropic"},
                options={"additionalProperties": {"stream": True}},
            )
            executor = AnthropicExecutor()
            result = executor.execute(agent, _make_messages())

            assert isinstance(result, PromptyStream)
            mock_client.messages.create.assert_called_once()
            call_kwargs = mock_client.messages.create.call_args.kwargs
            assert call_kwargs.get("stream") is True
        finally:
            clear_connections()

    def test_unsupported_api_type(self):
        mock_client = MagicMock()
        register_connection("mock-anthropic", client=mock_client)
        try:
            agent = _make_agent(
                api_type="embedding",
                connection={"kind": "reference", "name": "mock-anthropic"},
            )
            executor = AnthropicExecutor()
            with pytest.raises(ValueError, match="Unsupported apiType"):
                executor.execute(agent, _make_messages())
        finally:
            clear_connections()

    @patch("anthropic.Anthropic")
    def test_api_key_client_resolution(self, MockAnthropic):
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response()

        agent = _make_agent(
            connection={
                "kind": "key",
                "apiKey": "sk-ant-test123",
                "endpoint": "https://custom.anthropic.com",
            }
        )
        executor = AnthropicExecutor()
        executor.execute(agent, _make_messages())

        MockAnthropic.assert_called_once_with(api_key="sk-ant-test123", base_url="https://custom.anthropic.com")

    def test_reference_connection(self):
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response()

        register_connection("my-anthropic", client=mock_client)
        try:
            agent = _make_agent(connection={"kind": "reference", "name": "my-anthropic"})
            executor = AnthropicExecutor()
            result = executor.execute(agent, _make_messages())
            assert result is not None
        finally:
            clear_connections()


class TestExecutorAsync:
    @pytest.mark.asyncio
    async def test_async_chat_execution(self):
        mock_client = MagicMock()
        mock_response = _mock_anthropic_response()
        mock_client.messages.create = AsyncMock(return_value=mock_response)

        register_connection("mock-anthropic", client=mock_client)
        try:
            agent = _make_agent(connection={"kind": "reference", "name": "mock-anthropic"})
            executor = AnthropicExecutor()
            result = await executor.execute_async(agent, _make_messages())
            assert result is mock_response
        finally:
            clear_connections()

    @pytest.mark.asyncio
    async def test_async_streaming(self):
        mock_client = MagicMock()
        mock_stream = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_stream)

        register_connection("mock-anthropic", client=mock_client)
        try:
            agent = _make_agent(
                connection={"kind": "reference", "name": "mock-anthropic"},
                options={"additionalProperties": {"stream": True}},
            )
            executor = AnthropicExecutor()
            result = await executor.execute_async(agent, _make_messages())
            assert isinstance(result, AsyncPromptyStream)
        finally:
            clear_connections()


# ---------------------------------------------------------------------------
# Processor tests
# ---------------------------------------------------------------------------


class TestProcessor:
    def test_text_response(self):
        response = _mock_anthropic_response()
        agent = _make_agent()
        processor = AnthropicProcessor()
        result = processor.process(agent, response)
        assert result == "Hello!"

    def test_tool_use_response(self):
        response = _mock_tool_use_response()
        agent = _make_agent()
        processor = AnthropicProcessor()
        result = processor.process(agent, response)

        # Should return ToolCall list
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0].name == "get_weather"
        assert result[0].id == "toolu_123"
        args = json.loads(result[0].arguments)
        assert args["location"] == "Seattle"

    def test_multiple_tool_calls(self):
        tool1 = MagicMock(type="tool_use", id="toolu_1", input={"location": "Seattle"})
        tool1.name = "get_weather"
        tool2 = MagicMock(type="tool_use", id="toolu_2", input={"timezone": "PST"})
        tool2.name = "get_time"
        response = _mock_anthropic_response(content=[tool1, tool2], stop_reason="tool_use")

        agent = _make_agent()
        result = AnthropicProcessor().process(agent, response)
        assert len(result) == 2
        assert result[0].name == "get_weather"
        assert result[1].name == "get_time"

    def test_structured_output(self):
        json_text = json.dumps({"city": "Seattle", "temperature": 72.5})
        text_block = MagicMock(type="text", text=json_text, id=None, name=None, input=None)
        response = _mock_anthropic_response(content=[text_block])

        agent = _make_agent(
            outputs=[
                {"name": "city", "kind": "string"},
                {"name": "temperature", "kind": "float"},
            ]
        )
        result = AnthropicProcessor().process(agent, response)
        assert isinstance(result, dict)
        assert result["city"] == "Seattle"
        assert result["temperature"] == 72.5

    def test_structured_output_invalid_json(self):
        text_block = MagicMock(type="text", text="not valid json", id=None, name=None, input=None)
        response = _mock_anthropic_response(content=[text_block])

        agent = _make_agent(outputs=[{"name": "x", "kind": "string"}])
        result = AnthropicProcessor().process(agent, response)
        assert result == "not valid json"

    def test_passthrough_unknown(self):
        agent = _make_agent()
        result = AnthropicProcessor().process(agent, "raw string")
        assert result == "raw string"

    @pytest.mark.asyncio
    async def test_async_processor(self):
        response = _mock_anthropic_response()
        agent = _make_agent()
        result = await AnthropicProcessor().process_async(agent, response)
        assert result == "Hello!"


# ---------------------------------------------------------------------------
# Load from .prompty files
# ---------------------------------------------------------------------------


class TestPromptyFileLoad:
    def test_load_chat_prompty(self):
        from prompty import load

        agent = load(PROMPTS_DIR / "anthropic_chat.prompty")
        assert agent.model.provider == "anthropic"
        assert agent.model.apiType == "chat"
        assert agent.model.id == "claude-sonnet-4-5-20250929"

    def test_load_tools_prompty(self):
        from prompty import load

        agent = load(PROMPTS_DIR / "anthropic_tools.prompty")
        assert agent.model.provider == "anthropic"
        assert agent.tools is not None
        assert len(agent.tools) == 1
        assert agent.tools[0].name == "get_weather"

    def test_load_structured_prompty(self):
        from prompty import load

        agent = load(PROMPTS_DIR / "anthropic_structured.prompty")
        assert agent.outputs is not None
        assert len(agent.outputs) == 2
