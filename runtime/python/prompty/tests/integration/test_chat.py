"""Integration tests — chat completions against real OpenAI / Azure OpenAI."""

from __future__ import annotations

import pytest

from prompty.core.types import Message, TextPart
from prompty.providers.azure.executor import AzureExecutor
from prompty.providers.azure.processor import AzureProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import make_azure_agent, make_openai_agent, skip_azure, skip_openai


def _hello_messages() -> list[Message]:
    return [
        Message(
            role="system",
            parts=[
                TextPart(
                    value="You are a helpful assistant. Reply in one short sentence."
                )
            ],
        ),
        Message(role="user", parts=[TextPart(value="Say hello.")]),
    ]


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@skip_openai
class TestOpenAIChat:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_basic_chat(self):
        agent = make_openai_agent(options={"maxOutputTokens": 50, "temperature": 0})
        messages = _hello_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_chat_with_temperature(self):
        agent = make_openai_agent(options={"temperature": 1.0, "maxOutputTokens": 50})
        messages = _hello_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        assert isinstance(result, str)

    @pytest.mark.asyncio
    async def test_async_chat(self):
        agent = make_openai_agent(options={"maxOutputTokens": 50, "temperature": 0})
        messages = _hello_messages()
        response = await self.executor.execute_async(agent, messages)
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, str)
        assert len(result) > 0


# ---------------------------------------------------------------------------
# Azure OpenAI
# ---------------------------------------------------------------------------


@skip_azure
class TestAzureChat:
    executor = AzureExecutor()
    processor = AzureProcessor()

    def test_basic_chat(self):
        agent = make_azure_agent(options={"maxOutputTokens": 50, "temperature": 0})
        messages = _hello_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.asyncio
    async def test_async_chat(self):
        agent = make_azure_agent(options={"maxOutputTokens": 50, "temperature": 0})
        messages = _hello_messages()
        response = await self.executor.execute_async(agent, messages)
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, str)
        assert len(result) > 0
