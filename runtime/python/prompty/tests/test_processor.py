"""Tests for OpenAIProcessor and AzureProcessor."""

from __future__ import annotations

from typing import cast
from unittest.mock import MagicMock

import pytest
from agentschema import AgentDefinition, PromptAgent

from prompty.providers.azure.processor import AzureProcessor
from prompty.providers.openai.processor import (
    OpenAIProcessor,
    ToolCall,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent() -> PromptAgent:
    return cast(
        PromptAgent,
        AgentDefinition.load({"kind": "prompt", "name": "test", "model": "gpt-4"}),
    )


def _mock_chat_completion(content: str | None = "Hello!", tool_calls=None):  # type: ignore[assignment]
    """Create a mock ChatCompletion."""
    from openai.types.chat.chat_completion import ChatCompletion

    response = MagicMock(spec=ChatCompletion)
    choice = MagicMock()
    choice.message.content = content
    choice.message.tool_calls = tool_calls
    response.choices = [choice]
    return response


def _mock_completion(text: str = "Hello!"):
    """Create a mock Completion."""
    from openai.types.completion import Completion

    response = MagicMock(spec=Completion)
    choice = MagicMock()
    choice.text = text
    response.choices = [choice]
    return response


def _mock_embedding(vectors: list[list[float]] | None = None):
    """Create a mock CreateEmbeddingResponse."""
    from openai.types.create_embedding_response import CreateEmbeddingResponse

    if vectors is None:
        vectors = [[0.1, 0.2, 0.3]]

    response = MagicMock(spec=CreateEmbeddingResponse)
    data_items = []
    for vec in vectors:
        item = MagicMock()
        item.embedding = vec
        data_items.append(item)
    response.data = data_items
    return response


def _mock_tool_call(id: str, name: str, arguments: str):
    """Create a mock tool call."""
    tc = MagicMock()
    tc.id = id
    tc.function.name = name
    tc.function.arguments = arguments
    return tc


# ---------------------------------------------------------------------------
# OpenAIProcessor
# ---------------------------------------------------------------------------


class TestOpenAIProcessor:
    def setup_method(self):
        self.processor = OpenAIProcessor()
        self.agent = _make_agent()

    def test_chat_completion_content(self):
        response = _mock_chat_completion("Hi there!")
        result = self.processor.process(self.agent, response)
        assert result == "Hi there!"

    def test_chat_completion_tool_calls(self):
        tc = _mock_tool_call("call_1", "get_weather", '{"location": "NYC"}')
        response = _mock_chat_completion(tool_calls=[tc])
        result = self.processor.process(self.agent, response)
        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], ToolCall)
        assert result[0].name == "get_weather"
        assert result[0].id == "call_1"
        assert result[0].arguments == '{"location": "NYC"}'

    def test_multiple_tool_calls(self):
        tc1 = _mock_tool_call("call_1", "func_a", "{}")
        tc2 = _mock_tool_call("call_2", "func_b", '{"x": 1}')
        response = _mock_chat_completion(tool_calls=[tc1, tc2])
        result = self.processor.process(self.agent, response)
        assert len(result) == 2

    def test_completion_text(self):
        response = _mock_completion("Generated text")
        result = self.processor.process(self.agent, response)
        assert result == "Generated text"

    def test_single_embedding(self):
        response = _mock_embedding([[0.1, 0.2, 0.3]])
        result = self.processor.process(self.agent, response)
        assert result == [0.1, 0.2, 0.3]

    def test_multiple_embeddings(self):
        response = _mock_embedding([[0.1, 0.2], [0.3, 0.4]])
        result = self.processor.process(self.agent, response)
        assert len(result) == 2
        assert result[0] == [0.1, 0.2]
        assert result[1] == [0.3, 0.4]

    def test_empty_embedding_raises(self):
        response = _mock_embedding([])
        # Empty data list
        response.data = []
        with pytest.raises(ValueError, match="Empty embedding"):
            self.processor.process(self.agent, response)

    def test_unknown_type_passthrough(self):
        """Unknown response types should pass through unchanged."""
        result = self.processor.process(self.agent, "raw string")
        assert result == "raw string"

    def test_none_content(self):
        response = _mock_chat_completion(content=None)
        result = self.processor.process(self.agent, response)
        assert result is None


# ---------------------------------------------------------------------------
# AzureProcessor
# ---------------------------------------------------------------------------


class TestAzureProcessor:
    def setup_method(self):
        self.processor = AzureProcessor()
        self.agent = _make_agent()

    def test_chat_completion(self):
        response = _mock_chat_completion("Azure response")
        result = self.processor.process(self.agent, response)
        assert result == "Azure response"

    def test_tool_calls(self):
        tc = _mock_tool_call("call_1", "search", '{"q": "test"}')
        response = _mock_chat_completion(tool_calls=[tc])
        result = self.processor.process(self.agent, response)
        assert isinstance(result, list)
        assert result[0].name == "search"


# ---------------------------------------------------------------------------
# ToolCall dataclass
# ---------------------------------------------------------------------------


class TestToolCall:
    def test_attributes(self):
        tc = ToolCall(id="123", name="func", arguments='{"x": 1}')
        assert tc.id == "123"
        assert tc.name == "func"
        assert tc.arguments == '{"x": 1}'


# ---------------------------------------------------------------------------
# Async
# ---------------------------------------------------------------------------


class TestAsync:
    @pytest.mark.asyncio
    async def test_async_process(self):
        processor = OpenAIProcessor()
        agent = _make_agent()
        response = _mock_chat_completion("Async result")
        result = await processor.process_async(agent, response)
        assert result == "Async result"


# ---------------------------------------------------------------------------
# Structured Output (JSON parsing with outputSchema)
# ---------------------------------------------------------------------------


def _make_agent_with_schema(**schema_properties) -> PromptAgent:
    """Create an agent with an outputSchema."""
    props = schema_properties.get("properties", [])
    return cast(
        PromptAgent,
        AgentDefinition.load(
            {
                "kind": "prompt",
                "name": "test",
                "model": "gpt-4",
                "outputSchema": {"properties": props},
            }
        ),
    )


class TestStructuredOutput:
    def setup_method(self):
        self.processor = OpenAIProcessor()

    def test_json_parsed_when_output_schema(self):
        agent = _make_agent_with_schema(
            properties=[
                {"name": "answer", "kind": "string"},
                {"name": "confidence", "kind": "float"},
            ]
        )
        response = _mock_chat_completion('{"answer": "yes", "confidence": 0.95}')
        result = self.processor.process(agent, response)
        assert isinstance(result, dict)
        assert result["answer"] == "yes"
        assert result["confidence"] == 0.95

    def test_raw_string_when_no_output_schema(self):
        agent = _make_agent()
        response = _mock_chat_completion('{"answer": "yes"}')
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert result == '{"answer": "yes"}'

    def test_invalid_json_falls_back(self):
        agent = _make_agent_with_schema(
            properties=[{"name": "answer", "kind": "string"}]
        )
        response = _mock_chat_completion("not valid json {")
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert result == "not valid json {"

    def test_tool_calls_not_json_parsed(self):
        """Tool calls should not be affected by outputSchema."""
        agent = _make_agent_with_schema(
            properties=[{"name": "answer", "kind": "string"}]
        )
        tc = _mock_tool_call("call_1", "func", "{}")
        response = _mock_chat_completion(tool_calls=[tc])
        result = self.processor.process(agent, response)
        assert isinstance(result, list)
        assert isinstance(result[0], ToolCall)

    def test_none_content_not_json_parsed(self):
        """None content should not be affected by outputSchema."""
        agent = _make_agent_with_schema(
            properties=[{"name": "answer", "kind": "string"}]
        )
        response = _mock_chat_completion(content=None)
        result = self.processor.process(agent, response)
        assert result is None

    @pytest.mark.asyncio
    async def test_async_json_parsed(self):
        agent = _make_agent_with_schema(
            properties=[{"name": "value", "kind": "integer"}]
        )
        response = _mock_chat_completion('{"value": 42}')
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, dict)
        assert result["value"] == 42

    def test_azure_processor_json_parsed(self):
        agent = _make_agent_with_schema(
            properties=[{"name": "answer", "kind": "string"}]
        )
        processor = AzureProcessor()
        response = _mock_chat_completion('{"answer": "hello"}')
        result = processor.process(agent, response)
        assert isinstance(result, dict)
        assert result["answer"] == "hello"


# ---------------------------------------------------------------------------
# Image Response Processing
# ---------------------------------------------------------------------------


def _mock_image_data(url: str | None = None, b64_json: str | None = None):
    """Create a mock image data item."""
    data = MagicMock()
    data.url = url
    data.b64_json = b64_json
    return data


def _mock_images_response(data_items: list):
    """Create a mock ImagesResponse."""
    response = MagicMock()
    response.__class__.__name__ = "ImagesResponse"
    response.data = data_items

    # Make isinstance checks work with our mock
    from openai.types.images_response import ImagesResponse

    response.__class__ = ImagesResponse  # type: ignore[assignment]  # pyright: ignore[reportAttributeAccessIssue]
    return response


class TestImageProcessing:
    processor = OpenAIProcessor()

    def test_single_image_url(self):
        img = _mock_image_data(url="https://example.com/image.png")
        response = _mock_images_response([img])
        result = self.processor.process(_make_agent(), response)
        assert result == "https://example.com/image.png"

    def test_single_image_b64(self):
        img = _mock_image_data(b64_json="iVBORw0KGgo=")
        response = _mock_images_response([img])
        result = self.processor.process(_make_agent(), response)
        assert result == "iVBORw0KGgo="

    def test_multiple_images(self):
        imgs = [
            _mock_image_data(url="https://example.com/1.png"),
            _mock_image_data(url="https://example.com/2.png"),
        ]
        response = _mock_images_response(imgs)
        result = self.processor.process(_make_agent(), response)
        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0] == "https://example.com/1.png"
        assert result[1] == "https://example.com/2.png"

    def test_empty_image_response(self):
        response = _mock_images_response([])
        with pytest.raises(ValueError, match="Empty image response"):
            self.processor.process(_make_agent(), response)

    def test_azure_image_processing(self):
        img = _mock_image_data(url="https://example.com/azure.png")
        response = _mock_images_response([img])
        processor = AzureProcessor()
        result = processor.process(_make_agent(), response)
        assert result == "https://example.com/azure.png"


# ---------------------------------------------------------------------------
# Embedding Response Processing
# ---------------------------------------------------------------------------


def _mock_embedding_data(embedding: list[float], index: int = 0):
    """Create a mock embedding data item."""
    data = MagicMock()
    data.embedding = embedding
    data.index = index
    return data


def _mock_embedding_response(data_items: list):
    """Create a mock CreateEmbeddingResponse."""
    from openai.types.create_embedding_response import CreateEmbeddingResponse

    response = MagicMock()
    response.data = data_items
    response.__class__ = CreateEmbeddingResponse  # type: ignore[assignment]  # pyright: ignore[reportAttributeAccessIssue]
    return response


class TestEmbeddingProcessing:
    processor = OpenAIProcessor()

    def test_single_embedding(self):
        emb = _mock_embedding_data([0.1, 0.2, 0.3])
        response = _mock_embedding_response([emb])
        result = self.processor.process(_make_agent(), response)
        assert result == [0.1, 0.2, 0.3]

    def test_multiple_embeddings(self):
        embs = [
            _mock_embedding_data([0.1, 0.2], index=0),
            _mock_embedding_data([0.3, 0.4], index=1),
        ]
        response = _mock_embedding_response(embs)
        result = self.processor.process(_make_agent(), response)
        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0] == [0.1, 0.2]
        assert result[1] == [0.3, 0.4]

    def test_empty_embedding_response(self):
        response = _mock_embedding_response([])
        with pytest.raises(ValueError, match="Empty embedding response"):
            self.processor.process(_make_agent(), response)
