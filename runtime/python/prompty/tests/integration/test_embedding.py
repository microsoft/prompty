"""Integration tests — embeddings against real OpenAI / Azure OpenAI."""

from __future__ import annotations

import pytest

from prompty.providers.azure.executor import AzureExecutor
from prompty.providers.azure.processor import AzureProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import (
    _AZURE_EMBEDDING_DEPLOYMENT,
    make_azure_agent,
    make_openai_agent,
    skip_azure_embedding,
    skip_openai,
)

# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@skip_openai
class TestOpenAIEmbedding:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_single_embedding(self):
        agent = make_openai_agent(api_type="embedding", model="text-embedding-3-small")
        response = self.executor.execute(agent, "Hello world")
        result = self.processor.process(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0
        assert isinstance(result[0], float)

    def test_batch_embedding(self):
        agent = make_openai_agent(api_type="embedding", model="text-embedding-3-small")
        response = self.executor.execute(agent, ["Hello", "World"])
        result = self.processor.process(agent, response)
        # Batch returns list of lists
        assert isinstance(result, list)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_async_embedding(self):
        agent = make_openai_agent(api_type="embedding", model="text-embedding-3-small")
        response = await self.executor.execute_async(agent, "Hello world")
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0


# ---------------------------------------------------------------------------
# Azure OpenAI
# ---------------------------------------------------------------------------


@skip_azure_embedding
class TestAzureEmbedding:
    executor = AzureExecutor()
    processor = AzureProcessor()

    def test_single_embedding(self):
        agent = make_azure_agent(
            api_type="embedding", deployment=_AZURE_EMBEDDING_DEPLOYMENT
        )
        response = self.executor.execute(agent, "Hello world")
        result = self.processor.process(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0
        assert isinstance(result[0], float)

    @pytest.mark.asyncio
    async def test_async_embedding(self):
        agent = make_azure_agent(
            api_type="embedding", deployment=_AZURE_EMBEDDING_DEPLOYMENT
        )
        response = await self.executor.execute_async(agent, "Hello world")
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0
