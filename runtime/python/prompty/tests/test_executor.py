"""Tests for OpenAIExecutor and FoundryExecutor.

All tests mock the OpenAI API — no real API calls are made.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from prompty.core.types import AudioPart, FilePart, ImagePart, Message, TextPart
from prompty.model import Prompty
from prompty.providers.foundry.executor import FoundryExecutor
from prompty.providers.openai.executor import (
    OpenAIExecutor,
    _build_options,
    _message_to_wire,
    _output_schema_to_wire,
    _part_to_wire,
    _property_to_json_schema,
    _schema_to_wire,
    _tools_to_wire,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent(**kwargs) -> Prompty:
    data = {
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
    return Prompty.load(data)


def _make_foundry_agent(**kwargs) -> Prompty:
    data = {
        "name": "test-foundry",
        "model": {
            "id": "gpt-4",
            "provider": "foundry",
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
    return Prompty.load(data)


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
        assert opts["max_completion_tokens"] == 100

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
                    "parameters": [
                        {
                            "name": "location",
                            "kind": "string",
                            "description": "City",
                        }
                    ],
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

    def test_strict_on_function_def(self):
        """strict should appear at the function definition level, not inside parameters."""
        agent = _make_agent(
            tools=[
                {
                    "name": "strict_fn",
                    "kind": "function",
                    "strict": True,
                    "parameters": [
                        {"name": "x", "kind": "string"},
                    ],
                }
            ]
        )
        tools = _tools_to_wire(agent)
        assert tools is not None
        func = tools[0]["function"]
        assert func["strict"] is True
        # strict should NOT be inside the parameters JSON Schema
        assert "strict" not in func["parameters"]
        # additionalProperties: false should be in the parameters schema
        assert func["parameters"]["additionalProperties"] is False


class TestSchemaToWire:
    def test_converts_property_schema(self):
        agent = _make_agent(
            tools=[
                {
                    "name": "test",
                    "kind": "function",
                    "parameters": [
                        {"name": "x", "kind": "integer", "description": "A number"},
                        {
                            "name": "y",
                            "kind": "string",
                            "enumValues": ["a", "b"],
                        },
                    ],
                }
            ]
        )
        from prompty.model import FunctionTool

        tool = agent.tools[0]
        assert isinstance(tool, FunctionTool)
        result = _schema_to_wire(tool.parameters)
        assert result["properties"]["x"]["type"] == "integer"
        assert result["properties"]["y"]["enum"] == ["a", "b"]


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
                    "parameters": [
                        {"name": "loc", "kind": "string"},
                    ],
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
# FoundryExecutor
# ---------------------------------------------------------------------------


class TestFoundryExecutor:
    def test_execute_calls_azure_api(self):
        agent = _make_foundry_agent()
        messages = _make_messages()
        executor = FoundryExecutor()

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

    def test_resolve_client_with_api_key(self):
        executor = FoundryExecutor()
        agent = _make_foundry_agent()
        with patch("openai.AzureOpenAI") as MockClient:
            executor._resolve_client(agent)
        MockClient.assert_called_once()
        kwargs = MockClient.call_args.kwargs
        assert kwargs["api_key"] == "test-key"
        assert kwargs["azure_endpoint"] == "https://myendpoint.openai.azure.com"
        assert "api_version" in kwargs

    def test_resolve_client_no_api_key_raises(self):
        executor = FoundryExecutor()
        agent = _make_foundry_agent(
            model={
                "id": "gpt-4",
                "provider": "foundry",
                "apiType": "chat",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myendpoint.openai.azure.com",
                    # No apiKey
                },
            }
        )
        with pytest.raises(ValueError, match="no apiKey"):
            executor._resolve_client(agent)

    def test_resolve_client_reference_connection(self):
        from prompty.core.connections import clear_connections, register_connection

        executor = FoundryExecutor()
        agent = Prompty.load(
            {
                "name": "test-ref",
                "model": {
                    "id": "gpt-4",
                    "provider": "foundry",
                    "connection": {"kind": "reference", "name": "my-foundry"},
                },
            }
        )
        mock_client = MagicMock()
        register_connection("my-foundry", client=mock_client)
        try:
            client = executor._resolve_client(agent)
            assert client is mock_client
        finally:
            clear_connections()

    def test_azure_executor_backward_compat(self):
        """AzureExecutor import still works and is the same class as FoundryExecutor."""
        from prompty.providers.azure.executor import AzureExecutor

        assert AzureExecutor is FoundryExecutor


# ---------------------------------------------------------------------------
# Structured Output (outputs → response_format)
# ---------------------------------------------------------------------------


class TestPropertyToJsonSchema:
    def test_string_property(self):
        from prompty.model import Property

        prop = Property.load({"name": "answer", "kind": "string", "description": "The answer"})
        result = _property_to_json_schema(prop)
        assert result == {"type": "string", "description": "The answer"}

    def test_integer_property(self):
        from prompty.model import Property

        prop = Property.load({"name": "count", "kind": "integer"})
        result = _property_to_json_schema(prop)
        assert result == {"type": "integer"}

    def test_float_to_number(self):
        from prompty.model import Property

        prop = Property.load({"name": "score", "kind": "float"})
        result = _property_to_json_schema(prop)
        assert result["type"] == "number"

    def test_enum_values(self):
        from prompty.model import Property

        prop = Property.load({"name": "status", "kind": "string", "enumValues": ["ok", "error"]})
        result = _property_to_json_schema(prop)
        assert result["enum"] == ["ok", "error"]

    def test_array_with_items(self):
        from prompty.model import Property

        prop = Property.load(
            {
                "name": "tags",
                "kind": "array",
                "items": {"name": "tag", "kind": "string"},
            }
        )
        result = _property_to_json_schema(prop)
        assert result["type"] == "array"
        assert result["items"] == {"type": "string"}

    def test_object_with_properties(self):
        from prompty.model import Property

        prop = Property.load(
            {
                "name": "person",
                "kind": "object",
                "properties": [
                    {"name": "name", "kind": "string"},
                    {"name": "age", "kind": "integer", "required": True},
                ],
            }
        )
        result = _property_to_json_schema(prop)
        assert result["type"] == "object"
        assert "name" in result["properties"]
        assert "age" in result["properties"]
        assert result["properties"]["age"]["type"] == "integer"
        # strict mode: ALL properties must be in required
        assert result["required"] == ["name", "age"]
        assert result["additionalProperties"] is False


class TestOutputSchemaToWire:
    def test_simple_schema(self):
        agent = _make_agent(
            outputs=[
                {"name": "answer", "kind": "string", "description": "The answer"},
                {"name": "confidence", "kind": "float", "required": True},
            ]
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        assert result["type"] == "json_schema"
        assert result["json_schema"]["name"] == "structured_output"
        assert result["json_schema"]["strict"] is True
        schema = result["json_schema"]["schema"]
        assert schema["type"] == "object"
        assert "answer" in schema["properties"]
        assert schema["properties"]["answer"]["type"] == "string"
        assert schema["properties"]["answer"]["description"] == "The answer"
        assert schema["properties"]["confidence"]["type"] == "number"
        # strict mode: ALL properties must be in required
        assert schema["required"] == ["answer", "confidence"]
        assert schema["additionalProperties"] is False

    def test_no_output_schema(self):
        agent = _make_agent()
        result = _output_schema_to_wire(agent)
        assert result is None

    def test_nested_object(self):
        agent = _make_agent(
            outputs=[
                {
                    "name": "person",
                    "kind": "object",
                    "properties": [
                        {"name": "name", "kind": "string"},
                        {"name": "age", "kind": "integer"},
                    ],
                }
            ]
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        schema = result["json_schema"]["schema"]
        person = schema["properties"]["person"]
        assert person["type"] == "object"
        assert "name" in person["properties"]
        assert person["additionalProperties"] is False

    def test_array_property(self):
        agent = _make_agent(
            outputs=[
                {
                    "name": "items",
                    "kind": "array",
                    "items": {"name": "item", "kind": "string"},
                }
            ]
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        schema = result["json_schema"]["schema"]
        items_prop = schema["properties"]["items"]
        assert items_prop["type"] == "array"
        assert items_prop["items"]["type"] == "string"

    def test_name_is_fixed(self):
        """Schema name is always 'structured_output' regardless of agent name."""
        agent = _make_agent(
            name="My Cool Agent",
            outputs=[
                {"name": "x", "kind": "string"},
            ],
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        assert result["json_schema"]["name"] == "structured_output"


class TestBuildArgsResponseFormat:
    def test_response_format_included(self):
        agent = _make_agent(
            outputs=[
                {"name": "answer", "kind": "string"},
            ]
        )
        executor = OpenAIExecutor()
        args = executor._build_chat_args(agent, _make_messages())
        assert "response_format" in args
        assert args["response_format"]["type"] == "json_schema"

    def test_no_response_format_without_schema(self):
        agent = _make_agent()
        executor = OpenAIExecutor()
        args = executor._build_chat_args(agent, _make_messages())
        assert "response_format" not in args

    def test_foundry_response_format_included(self):
        agent = _make_foundry_agent(
            outputs=[
                {"name": "result", "kind": "string"},
            ]
        )
        executor = FoundryExecutor()
        args = executor._build_chat_args(agent, _make_messages())
        assert "response_format" in args


# ---------------------------------------------------------------------------
# API Type Dispatch (Embedding + Image)
# ---------------------------------------------------------------------------


def _make_embedding_agent(**kwargs) -> Prompty:
    data = {
        "name": "test-embed",
        "model": {
            "id": "text-embedding-ada-002",
            "provider": "openai",
            "apiType": "embedding",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
    }
    data.update(kwargs)
    return Prompty.load(data)


def _make_image_agent(**kwargs) -> Prompty:
    data = {
        "name": "test-image",
        "model": {
            "id": "dall-e-3",
            "provider": "openai",
            "apiType": "image",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
    }
    data.update(kwargs)
    return Prompty.load(data)


class TestEmbeddingDispatch:
    def test_calls_embeddings_create(self):
        agent = _make_embedding_agent()
        executor = OpenAIExecutor()

        mock_response = MagicMock()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.embeddings.create.return_value = mock_response

            result = executor.execute(agent, "hello world")

        assert result == mock_response
        mock_client.embeddings.create.assert_called_once()
        call_args = mock_client.embeddings.create.call_args
        assert call_args.kwargs["input"] == ["hello world"]
        assert call_args.kwargs["model"] == "text-embedding-ada-002"

    def test_list_input_passthrough(self):
        agent = _make_embedding_agent()
        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.embeddings.create.return_value = MagicMock()

            executor.execute(agent, ["hello", "world"])

        call_args = mock_client.embeddings.create.call_args
        assert call_args.kwargs["input"] == ["hello", "world"]

    def test_foundry_embedding(self):
        agent = _make_embedding_agent(
            model={
                "id": "text-embedding-ada-002",
                "provider": "foundry",
                "apiType": "embedding",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myendpoint.openai.azure.com",
                    "apiKey": "test-key",
                },
            }
        )
        executor = FoundryExecutor()

        with patch("openai.AzureOpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.embeddings.create.return_value = MagicMock()

            executor.execute(agent, "test")

        mock_client.embeddings.create.assert_called_once()


class TestImageDispatch:
    def test_calls_images_generate(self):
        agent = _make_image_agent()
        executor = OpenAIExecutor()

        mock_response = MagicMock()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.images.generate.return_value = mock_response

            result = executor.execute(agent, "a cat sitting on a mat")

        assert result == mock_response
        mock_client.images.generate.assert_called_once()
        call_args = mock_client.images.generate.call_args
        assert call_args.kwargs["prompt"] == "a cat sitting on a mat"
        assert call_args.kwargs["model"] == "dall-e-3"

    def test_foundry_image(self):
        agent = _make_image_agent(
            model={
                "id": "dall-e-3",
                "provider": "foundry",
                "apiType": "image",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myendpoint.openai.azure.com",
                    "apiKey": "test-key",
                },
            }
        )
        executor = FoundryExecutor()

        with patch("openai.AzureOpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.images.generate.return_value = MagicMock()

            executor.execute(agent, "a sunset")

        mock_client.images.generate.assert_called_once()


class TestUnsupportedApiType:
    def test_raises_on_unknown(self):
        import pytest

        agent = _make_agent(
            model={
                "id": "gpt-4",
                "provider": "openai",
                "apiType": "unknown_type",
                "connection": {"kind": "key", "apiKey": "test-key"},
            }
        )
        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            MockClient.return_value = MagicMock()
            with pytest.raises(ValueError, match="Unsupported apiType"):
                executor.execute(agent, _make_messages())
