"""Tests for OpenAIProcessor and AzureProcessor."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from agentschema import PromptAgent

from prompty.processor import (
    AzureProcessor,
    OpenAIProcessor,
    ToolCall,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent() -> PromptAgent:
    return PromptAgent.load({"kind": "prompt", "name": "test", "model": "gpt-4"})


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
