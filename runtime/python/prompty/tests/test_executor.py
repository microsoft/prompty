"""Tests for OpenAIExecutor and AzureExecutor.

All tests mock the OpenAI API — no real API calls are made.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import MagicMock, patch

from agentschema import AgentDefinition, PromptAgent

from prompty.core.types import AudioPart, FilePart, ImagePart, Message, TextPart
from prompty.providers.azure.executor import AzureExecutor
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
    return cast(PromptAgent, AgentDefinition.load(data))


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
    return cast(PromptAgent, AgentDefinition.load(data))


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

    def test_strict_on_function_def(self):
        """strict should appear at the function definition level, not inside parameters."""
        agent = _make_agent(
            tools=[
                {
                    "name": "strict_fn",
                    "kind": "function",
                    "strict": True,
                    "parameters": {
                        "properties": [
                            {"name": "x", "kind": "string"},
                        ],
                        "strict": True,
                    },
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
        assert result["additionalProperties"] is False


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


# ---------------------------------------------------------------------------
# Structured Output (outputSchema → response_format)
# ---------------------------------------------------------------------------


class TestPropertyToJsonSchema:
    def test_string_property(self):
        from agentschema import Property

        prop = Property.load(
            {"name": "answer", "kind": "string", "description": "The answer"}
        )
        result = _property_to_json_schema(prop)
        assert result == {"type": "string", "description": "The answer"}

    def test_integer_property(self):
        from agentschema import Property

        prop = Property.load({"name": "count", "kind": "integer"})
        result = _property_to_json_schema(prop)
        assert result == {"type": "integer"}

    def test_float_to_number(self):
        from agentschema import Property

        prop = Property.load({"name": "score", "kind": "float"})
        result = _property_to_json_schema(prop)
        assert result["type"] == "number"

    def test_enum_values(self):
        from agentschema import Property

        prop = Property.load(
            {"name": "status", "kind": "string", "enumValues": ["ok", "error"]}
        )
        result = _property_to_json_schema(prop)
        assert result["enum"] == ["ok", "error"]

    def test_array_with_items(self):
        from agentschema import Property

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
        from agentschema import Property

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
        assert result["required"] == ["age"]
        assert result["additionalProperties"] is False


class TestOutputSchemaToWire:
    def test_simple_schema(self):
        agent = _make_agent(
            outputSchema={
                "properties": [
                    {"name": "answer", "kind": "string", "description": "The answer"},
                    {"name": "confidence", "kind": "float", "required": True},
                ]
            }
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        assert result["type"] == "json_schema"
        assert result["json_schema"]["name"] == "test"
        assert result["json_schema"]["strict"] is True
        schema = result["json_schema"]["schema"]
        assert schema["type"] == "object"
        assert "answer" in schema["properties"]
        assert schema["properties"]["answer"]["type"] == "string"
        assert schema["properties"]["answer"]["description"] == "The answer"
        assert schema["properties"]["confidence"]["type"] == "number"
        assert "confidence" in schema["required"]
        assert schema["additionalProperties"] is False

    def test_no_output_schema(self):
        agent = _make_agent()
        result = _output_schema_to_wire(agent)
        assert result is None

    def test_nested_object(self):
        agent = _make_agent(
            outputSchema={
                "properties": [
                    {
                        "name": "person",
                        "kind": "object",
                        "properties": [
                            {"name": "name", "kind": "string"},
                            {"name": "age", "kind": "integer"},
                        ],
                    }
                ]
            }
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
            outputSchema={
                "properties": [
                    {
                        "name": "items",
                        "kind": "array",
                        "items": {"name": "item", "kind": "string"},
                    }
                ]
            }
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        schema = result["json_schema"]["schema"]
        items_prop = schema["properties"]["items"]
        assert items_prop["type"] == "array"
        assert items_prop["items"]["type"] == "string"

    def test_name_from_agent(self):
        agent = _make_agent(
            name="My Cool Agent",
            outputSchema={
                "properties": [
                    {"name": "x", "kind": "string"},
                ]
            },
        )
        result = _output_schema_to_wire(agent)
        assert result is not None
        assert result["json_schema"]["name"] == "my_cool_agent"


class TestBuildArgsResponseFormat:
    def test_response_format_included(self):
        agent = _make_agent(
            outputSchema={
                "properties": [
                    {"name": "answer", "kind": "string"},
                ]
            }
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

    def test_azure_response_format_included(self):
        agent = _make_azure_agent(
            outputSchema={
                "properties": [
                    {"name": "result", "kind": "string"},
                ]
            }
        )
        executor = AzureExecutor()
        args = executor._build_chat_args(agent, _make_messages())
        assert "response_format" in args


# ---------------------------------------------------------------------------
# API Type Dispatch (Embedding + Image)
# ---------------------------------------------------------------------------


def _make_embedding_agent(**kwargs) -> PromptAgent:
    data = {
        "kind": "prompt",
        "name": "test-embed",
        "model": {
            "id": "text-embedding-ada-002",
            "provider": "openai",
            "apiType": "embedding",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
    }
    data.update(kwargs)
    return cast(PromptAgent, AgentDefinition.load(data))


def _make_image_agent(**kwargs) -> PromptAgent:
    data = {
        "kind": "prompt",
        "name": "test-image",
        "model": {
            "id": "dall-e-3",
            "provider": "openai",
            "apiType": "image",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
    }
    data.update(kwargs)
    return cast(PromptAgent, AgentDefinition.load(data))


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

    def test_azure_embedding(self):
        agent = _make_embedding_agent(
            model={
                "id": "text-embedding-ada-002",
                "provider": "azure",
                "apiType": "embedding",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myendpoint.openai.azure.com",
                    "apiKey": "test-key",
                },
            }
        )
        executor = AzureExecutor()

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

    def test_azure_image(self):
        agent = _make_image_agent(
            model={
                "id": "dall-e-3",
                "provider": "azure",
                "apiType": "image",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myendpoint.openai.azure.com",
                    "apiKey": "test-key",
                },
            }
        )
        executor = AzureExecutor()

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


# ---------------------------------------------------------------------------
# Agent Loop (apiType: agent)
# ---------------------------------------------------------------------------


def _make_agent_type_agent(**kwargs) -> PromptAgent:
    data = {
        "kind": "prompt",
        "name": "test-agent",
        "metadata": {},
        "model": {
            "id": "gpt-4",
            "provider": "openai",
            "apiType": "agent",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
        "tools": [
            {
                "name": "get_weather",
                "kind": "function",
                "description": "Get weather",
                "parameters": {
                    "properties": [
                        {"name": "location", "kind": "string", "description": "City"},
                    ]
                },
            }
        ],
    }
    data.update(kwargs)
    return cast(PromptAgent, AgentDefinition.load(data))


def _mock_tool_call_response(fn_name: str, fn_args: str, call_id: str = "call_1"):
    """Mock a ChatCompletion with tool_calls."""
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


def _mock_final_response(content: str = "The weather is sunny."):
    """Mock a normal ChatCompletion (no tool calls)."""
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].finish_reason = "stop"
    response.choices[0].message.tool_calls = None
    response.choices[0].message.content = content
    return response


class TestAgentLoop:
    def test_single_tool_call_loop(self):
        agent = _make_agent_type_agent()
        assert agent.metadata is not None
        agent.metadata["tool_functions"] = {
            "get_weather": lambda location: f"Sunny in {location}"
        }

        tool_response = _mock_tool_call_response(
            "get_weather", '{"location": "Seattle"}'
        )
        final_response = _mock_final_response()

        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.side_effect = [
                tool_response,
                final_response,
            ]

            result = executor.execute(agent, _make_messages())

        assert result == final_response
        assert mock_client.chat.completions.create.call_count == 2

    def test_multiple_iterations(self):
        agent = _make_agent_type_agent()
        assert agent.metadata is not None
        agent.metadata["tool_functions"] = {
            "get_weather": lambda location: f"Sunny in {location}"
        }

        tool_resp_1 = _mock_tool_call_response(
            "get_weather", '{"location": "Seattle"}', call_id="call_1"
        )
        tool_resp_2 = _mock_tool_call_response(
            "get_weather", '{"location": "Portland"}', call_id="call_2"
        )
        final_response = _mock_final_response()

        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.side_effect = [
                tool_resp_1,
                tool_resp_2,
                final_response,
            ]

            result = executor.execute(agent, _make_messages())

        assert result == final_response
        assert mock_client.chat.completions.create.call_count == 3

    def test_missing_tool_function_raises(self):
        import pytest

        agent = _make_agent_type_agent()
        # No tool_functions registered
        assert agent.metadata is not None
        agent.metadata["tool_functions"] = {}

        tool_response = _mock_tool_call_response(
            "get_weather", '{"location": "Seattle"}'
        )

        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.return_value = tool_response

            with pytest.raises(
                ValueError, match="Tool function 'get_weather' not found"
            ):
                executor.execute(agent, _make_messages())

    def test_no_tool_calls_returns_immediately(self):
        agent = _make_agent_type_agent()
        assert agent.metadata is not None
        agent.metadata["tool_functions"] = {}

        final_response = _mock_final_response()

        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.return_value = final_response

            result = executor.execute(agent, _make_messages())

        assert result == final_response
        assert mock_client.chat.completions.create.call_count == 1

    def test_tool_result_appended_as_string(self):
        """Tool results are converted to strings."""
        agent = _make_agent_type_agent()
        assert agent.metadata is not None  # pyright: ignore[reportPossiblyUnbound]
        agent.metadata["tool_functions"] = {  # pyright: ignore[reportOptionalSubscript]
            "get_weather": lambda location: {"temp": 72, "condition": "sunny"}
        }

        tool_response = _mock_tool_call_response(
            "get_weather", '{"location": "Seattle"}'
        )
        final_response = _mock_final_response()

        executor = OpenAIExecutor()

        with patch("openai.OpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.side_effect = [
                tool_response,
                final_response,
            ]

            executor.execute(agent, _make_messages())

        # Second call should have the tool result as a string
        second_call_args = mock_client.chat.completions.create.call_args_list[1]
        messages = second_call_args.kwargs["messages"]
        tool_msg = [m for m in messages if m.get("role") == "tool"][0]
        assert tool_msg["content"] == "{'temp': 72, 'condition': 'sunny'}"

    def test_azure_agent_loop(self):
        agent = _make_agent_type_agent(
            model={
                "id": "gpt-4",
                "provider": "azure",
                "apiType": "agent",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myendpoint.openai.azure.com",
                    "apiKey": "test-key",
                },
            }
        )
        assert agent.metadata is not None  # pyright: ignore[reportPossiblyUnbound]
        agent.metadata["tool_functions"] = {  # pyright: ignore[reportOptionalSubscript]
            "get_weather": lambda location: f"Rainy in {location}"
        }

        tool_response = _mock_tool_call_response(
            "get_weather", '{"location": "London"}'
        )
        final_response = _mock_final_response()

        executor = AzureExecutor()

        with patch("openai.AzureOpenAI") as MockClient:
            mock_client = MagicMock()
            MockClient.return_value = mock_client
            mock_client.chat.completions.create.side_effect = [
                tool_response,
                final_response,
            ]

            result = executor.execute(agent, _make_messages())

        assert result == final_response
        assert mock_client.chat.completions.create.call_count == 2
