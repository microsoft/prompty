"""Tests for OpenAIExecutor and AzureExecutor.

All tests mock the OpenAI API — no real API calls are made.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from agentschema import PromptAgent

from prompty.executor import (
    AzureExecutor,
    OpenAIExecutor,
    _build_options,
    _message_to_wire,
    _part_to_wire,
    _schema_to_wire,
    _tools_to_wire,
)
from prompty.types import AudioPart, FilePart, ImagePart, Message, TextPart

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent(**kwargs) -> PromptAgent:
    data = {
        "kind": "prompt",
        "name": "test",
        "model": {
            "id": "gpt-4",
            "provider": "openai",
            "apiType": "chat",
            "connection": {"kind": "key", "apiKey": "test-key"},
            "options": {"temperature": 0.7, "maxOutputTokens": 100},
        },
    }
    data.update(kwargs)
    return PromptAgent.load(data)


def _make_azure_agent(**kwargs) -> PromptAgent:
    data = {
        "kind": "prompt",
        "name": "test-azure",
        "model": {
            "id": "gpt-4",
            "provider": "azure",
            "apiType": "chat",
            "connection": {
                "kind": "key",
                "endpoint": "https://myendpoint.openai.azure.com",
                "apiKey": "test-key",
            },
            "options": {"temperature": 0.5},
        },
    }
    data.update(kwargs)
    return PromptAgent.load(data)


def _make_messages() -> list[Message]:
    return [
        Message(role="system", parts=[TextPart(value="You are helpful.")]),
        Message(role="user", parts=[TextPart(value="Hello!")]),
    ]


# ---------------------------------------------------------------------------
# Wire format mapping
# ---------------------------------------------------------------------------


class TestMessageToWire:
    def test_text_message(self):
        msg = Message(role="user", parts=[TextPart(value="Hello")])
        wire = _message_to_wire(msg)
        assert wire == {"role": "user", "content": "Hello"}

    def test_multimodal_message(self):
        msg = Message(
            role="user",
            parts=[
                TextPart(value="Look at this:"),
                ImagePart(source="https://example.com/img.png"),
            ],
        )
        wire = _message_to_wire(msg)
        assert wire["role"] == "user"
        assert isinstance(wire["content"], list)
        assert wire["content"][0] == {"type": "text", "text": "Look at this:"}
        assert wire["content"][1]["type"] == "image_url"
        assert wire["content"][1]["image_url"]["url"] == "https://example.com/img.png"

    def test_image_with_detail(self):
        part = ImagePart(source="https://img.com/x.png", detail="high")
        wire = _part_to_wire(part)
        assert wire["image_url"]["detail"] == "high"

    def test_audio_part(self):
        part = AudioPart(source="base64data", media_type="audio/wav")
        wire = _part_to_wire(part)
        assert wire["type"] == "input_audio"
        assert wire["input_audio"]["format"] == "wav"

    def test_file_part(self):
        part = FilePart(source="https://example.com/doc.pdf")
        wire = _part_to_wire(part)
        assert wire["type"] == "file"

    def test_metadata_passthrough(self):
        msg = Message(
            role="user",
            parts=[TextPart(value="Hi")],
            metadata={"name": "Alice"},
        )
        wire = _message_to_wire(msg)
        assert wire["name"] == "Alice"


class TestBuildOptions:
    def test_basic_options(self):
        agent = _make_agent()
        opts = _build_options(agent)
        assert opts["temperature"] == 0.7
        assert opts["max_tokens"] == 100

    def test_no_options(self):
        agent = _make_agent()
        agent.model.options = None
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
                    "parameters": {
                        "properties": [
                            {
                                "name": "location",
                                "kind": "string",
                                "description": "City",
                            }
                        ]
                    },
                }
            ]
        )
        tools = _tools_to_wire(agent)
        assert tools is not None
        assert len(tools) == 1
        assert tools[0]["type"] == "function"
        assert tools[0]["function"]["name"] == "get_weather"
        assert "location" in tools[0]["function"]["parameters"]["properties"]

    def test_no_tools(self):
        agent = _make_agent()
        assert _tools_to_wire(agent) is None


class TestSchemaToWire:
    def test_converts_property_schema(self):
        agent = _make_agent(
            tools=[
                {
                    "name": "test",
                    "kind": "function",
                    "parameters": {
                        "properties": [
                            {"name": "x", "kind": "integer", "description": "A number"},
                            {
                                "name": "y",
                                "kind": "string",
                                "enumValues": ["a", "b"],
                            },
                        ],
                        "strict": True,
                    },
                }
            ]
        )
        from agentschema import FunctionTool

        tool = agent.tools[0]
        assert isinstance(tool, FunctionTool)
        result = _schema_to_wire(tool.parameters)
        assert result["properties"]["x"]["type"] == "integer"
        assert result["properties"]["y"]["enum"] == ["a", "b"]
        assert result["strict"] is True


# ---------------------------------------------------------------------------
# OpenAIExecutor
# ---------------------------------------------------------------------------


class TestOpenAIExecutor:
    def test_execute_calls_api(self):
        agent = _make_agent()
        messages = _make_messages()
        executor = OpenAIExecutor()

        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Hi there!"

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.return_value = mock_response

            result = executor.execute(agent, messages)

        assert result == mock_response
        mock_client.chat.completions.create.assert_called_once()
        call_args = mock_client.chat.completions.create.call_args
        assert call_args.kwargs["model"] == "gpt-4"
        assert len(call_args.kwargs["messages"]) == 2

    def test_includes_tools_in_args(self):
        agent = _make_agent(
            tools=[
                {
                    "name": "get_weather",
                    "kind": "function",
                    "description": "Get weather",
                    "parameters": {
                        "properties": [
                            {"name": "loc", "kind": "string"},
                        ]
                    },
                }
            ]
        )
        messages = _make_messages()
        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.return_value = MagicMock()

            executor.execute(agent, messages)

        call_args = mock_client.chat.completions.create.call_args
        assert "tools" in call_args.kwargs

    def test_client_kwargs_from_connection(self):
        executor = OpenAIExecutor()
        agent = _make_agent()
        kwargs = executor._client_kwargs(agent)
        assert kwargs["api_key"] == "test-key"


# ---------------------------------------------------------------------------
# AzureExecutor
# ---------------------------------------------------------------------------


class TestAzureExecutor:
    def test_execute_calls_azure_api(self):
        agent = _make_azure_agent()
        messages = _make_messages()
        executor = AzureExecutor()

        mock_response = MagicMock()

        with patch("openai.AzureOpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.return_value = mock_response

            result = executor.execute(agent, messages)

        assert result == mock_response
        MockClient.assert_called_once()
        ctor_kwargs = MockClient.call_args.kwargs
        assert "azure_endpoint" in ctor_kwargs or "api_key" in ctor_kwargs

    def test_client_kwargs_includes_endpoint(self):
        executor = AzureExecutor()
        agent = _make_azure_agent()
        kwargs = executor._client_kwargs(agent)
        assert kwargs["azure_endpoint"] == "https://myendpoint.openai.azure.com"
        assert kwargs["api_key"] == "test-key"

    def test_api_version_default(self):
        executor = AzureExecutor()
        agent = _make_azure_agent()
        kwargs = executor._client_kwargs(agent)
        assert "api_version" in kwargs
