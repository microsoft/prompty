"""Integration tests — streaming chat completions against real endpoints."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

import pytest

from prompty.core.types import AsyncPromptyStream, Message, PromptyStream, TextPart
from prompty.providers.azure.executor import AzureExecutor
from prompty.providers.azure.processor import AzureProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import make_azure_agent, make_openai_agent, skip_azure, skip_openai


def _chat_messages() -> list[Message]:
    return [
        Message(
            role="system",
            parts=[TextPart(value="You are a helpful assistant. Be brief.")],
        ),
        Message(role="user", parts=[TextPart(value="Say exactly: hello world")]),
    ]


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@skip_openai
class TestOpenAIStreaming:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_streaming_chat(self):
        agent = make_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 50},
        )
        # Force streaming by setting the stream option
        assert agent.model is not None
        assert agent.model.options is not None
        if agent.model.options.additionalProperties is None:
            agent.model.options.additionalProperties = {}
        agent.model.options.additionalProperties["stream"] = True

        messages = _chat_messages()
        response = self.executor.execute(agent, messages)
        # Executor should wrap in PromptyStream
        assert isinstance(response, PromptyStream)
        result = self.processor.process(agent, response)
        # Result from streaming is an iterator of content deltas
        assert isinstance(result, Iterator)
        chunks = list(result)
        assert len(chunks) > 0
        full_text = "".join(c for c in chunks if isinstance(c, str))
        assert "hello" in full_text.lower()

    @pytest.mark.asyncio
    async def test_async_streaming_chat(self):
        agent = make_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 50},
        )
        assert agent.model is not None
        assert agent.model.options is not None
        if agent.model.options.additionalProperties is None:
            agent.model.options.additionalProperties = {}
        agent.model.options.additionalProperties["stream"] = True

        messages = _chat_messages()
        response = await self.executor.execute_async(agent, messages)
        assert isinstance(response, AsyncPromptyStream)
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, AsyncIterator)
        chunks = [c async for c in result]
        assert len(chunks) > 0
        full_text = "".join(c for c in chunks if isinstance(c, str))
        assert "hello" in full_text.lower()


# ---------------------------------------------------------------------------
# Azure OpenAI
# ---------------------------------------------------------------------------


@skip_azure
class TestAzureStreaming:
    executor = AzureExecutor()
    processor = AzureProcessor()

    def test_streaming_chat(self):
        agent = make_azure_agent(
            options={"temperature": 0, "maxOutputTokens": 50},
        )
        assert agent.model is not None
        assert agent.model.options is not None
        if agent.model.options.additionalProperties is None:
            agent.model.options.additionalProperties = {}
        agent.model.options.additionalProperties["stream"] = True

        messages = _chat_messages()
        response = self.executor.execute(agent, messages)
        assert isinstance(response, PromptyStream)
        result = self.processor.process(agent, response)
        assert isinstance(result, Iterator)
        chunks = list(result)
        assert len(chunks) > 0
        full_text = "".join(c for c in chunks if isinstance(c, str))
        assert "hello" in full_text.lower()
