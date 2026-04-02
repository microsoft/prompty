"""Integration tests — structured output (outputs → response_format) against real endpoints."""

from __future__ import annotations

import pytest

from prompty.core.types import Message, TextPart
from prompty.providers.foundry.executor import FoundryExecutor
from prompty.providers.foundry.processor import FoundryProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import make_foundry_agent, make_openai_agent, skip_foundry, skip_openai

_OUTPUT_SCHEMA = {
    "properties": [
        {"name": "city", "kind": "string", "description": "The city name"},
        {
            "name": "population",
            "kind": "integer",
            "description": "Approximate population",
        },
        {"name": "country", "kind": "string", "description": "The country"},
    ]
}


def _structured_messages() -> list[Message]:
    return [
        Message(
            role="system",
            parts=[TextPart(value="You are a data assistant. Always respond with the requested JSON structure.")],
        ),
        Message(
            role="user",
            parts=[TextPart(value="Give me information about Tokyo.")],
        ),
    ]


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@skip_openai
class TestOpenAIStructuredOutput:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_structured_output(self):
        agent = make_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 200},
            output_schema=_OUTPUT_SCHEMA,
        )
        messages = _structured_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        # Processor should JSON-parse when outputs is present
        assert isinstance(result, dict)
        assert "city" in result
        assert "population" in result
        assert "country" in result
        assert isinstance(result["city"], str)
        assert isinstance(result["population"], int)

    @pytest.mark.asyncio
    async def test_async_structured_output(self):
        agent = make_openai_agent(
            options={"temperature": 0, "maxOutputTokens": 200},
            output_schema=_OUTPUT_SCHEMA,
        )
        messages = _structured_messages()
        response = await self.executor.execute_async(agent, messages)
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, dict)
        assert "city" in result


# ---------------------------------------------------------------------------
# Azure OpenAI (Foundry)
# ---------------------------------------------------------------------------


@skip_foundry
class TestFoundryStructuredOutput:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_structured_output(self):
        agent = make_foundry_agent(
            options={"temperature": 0, "maxOutputTokens": 200},
            output_schema=_OUTPUT_SCHEMA,
        )
        messages = _structured_messages()
        response = self.executor.execute(agent, messages)
        result = self.processor.process(agent, response)
        assert isinstance(result, dict)
        assert "city" in result
        assert "population" in result
        assert "country" in result

    @pytest.mark.asyncio
    async def test_async_structured_output(self):
        agent = make_foundry_agent(
            options={"temperature": 0, "maxOutputTokens": 200},
            output_schema=_OUTPUT_SCHEMA,
        )
        messages = _structured_messages()
        response = await self.executor.execute_async(agent, messages)
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, dict)
        assert "city" in result
