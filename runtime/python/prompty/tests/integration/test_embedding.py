"""Integration tests — embeddings against real OpenAI / Azure OpenAI."""

from __future__ import annotations

import pytest

from prompty.providers.foundry.executor import FoundryExecutor
from prompty.providers.foundry.processor import FoundryProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import (
    _AZURE_EMBEDDING_DEPLOYMENT,
    _OPENAI_EMBEDDING_MODEL,
    make_foundry_agent,
    make_openai_agent,
    run_foundry_embedding,
    run_openai_embedding,
)

# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


@run_openai_embedding
class TestOpenAIEmbedding:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_single_embedding(self):
        agent = make_openai_agent(api_type="embedding", model=_OPENAI_EMBEDDING_MODEL)
        response = self.executor.execute(agent, "Hello world")
        result = self.processor.process(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0
        assert isinstance(result[0], float)

    def test_batch_embedding(self):
        agent = make_openai_agent(api_type="embedding", model=_OPENAI_EMBEDDING_MODEL)
        response = self.executor.execute(agent, ["Hello", "World"])
        result = self.processor.process(agent, response)
        # Batch returns list of lists
        assert isinstance(result, list)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_async_embedding(self):
        agent = make_openai_agent(api_type="embedding", model=_OPENAI_EMBEDDING_MODEL)
        response = await self.executor.execute_async(agent, "Hello world")
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0


# ---------------------------------------------------------------------------
# Azure OpenAI (Foundry)
# ---------------------------------------------------------------------------


@run_foundry_embedding
class TestFoundryEmbedding:
    executor = FoundryExecutor()
    processor = FoundryProcessor()

    def test_single_embedding(self):
        agent = make_foundry_agent(api_type="embedding", deployment=_AZURE_EMBEDDING_DEPLOYMENT)
        response = self.executor.execute(agent, "Hello world")
        result = self.processor.process(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0
        assert isinstance(result[0], float)

    @pytest.mark.asyncio
    async def test_async_embedding(self):
        agent = make_foundry_agent(api_type="embedding", deployment=_AZURE_EMBEDDING_DEPLOYMENT)
        response = await self.executor.execute_async(agent, "Hello world")
        result = await self.processor.process_async(agent, response)
        assert isinstance(result, list)
        assert len(result) > 0
