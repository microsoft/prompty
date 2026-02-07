"""Tests for PromptyStream and AsyncPromptyStream wrappers."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from prompty.core.types import AsyncPromptyStream, PromptyStream

# ---------------------------------------------------------------------------
# PromptyStream (sync)
# ---------------------------------------------------------------------------


class TestPromptyStream:
    def test_iterates_all_items(self):
        source = iter([1, 2, 3])
        stream = PromptyStream("test", source)
        result = list(stream)
        assert result == [1, 2, 3]

    def test_accumulates_items(self):
        source = iter(["a", "b", "c"])
        stream = PromptyStream("test", source)
        list(stream)  # exhaust
        assert stream.items == ["a", "b", "c"]

    def test_empty_iterator(self):
        source: Iterator = iter([])
        stream = PromptyStream("test", source)
        result = list(stream)
        assert result == []
        assert stream.items == []

    def test_partial_consumption(self):
        source = iter([1, 2, 3])
        stream = PromptyStream("test", source)
        first = next(stream)
        assert first == 1
        assert stream.items == [1]

    def test_is_iterator(self):
        from collections.abc import Iterator

        stream = PromptyStream("test", iter([]))
        assert isinstance(stream, Iterator)

    def test_name_stored(self):
        stream = PromptyStream("my_executor", iter([]))
        assert stream.name == "my_executor"

    def test_reusable_as_for_loop(self):
        source = iter(range(5))
        stream = PromptyStream("test", source)
        collected = []
        for item in stream:
            collected.append(item)
        assert collected == [0, 1, 2, 3, 4]
        assert stream.items == [0, 1, 2, 3, 4]


# ---------------------------------------------------------------------------
# AsyncPromptyStream
# ---------------------------------------------------------------------------


class _AsyncIter:
    """Simple async iterator for testing."""

    def __init__(self, items: list):
        self._items = items
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._items):
            raise StopAsyncIteration
        value = self._items[self._index]
        self._index += 1
        return value


class TestAsyncPromptyStream:
    @pytest.mark.asyncio
    async def test_iterates_all_items(self):
        source = _AsyncIter([10, 20, 30])
        stream = AsyncPromptyStream("test", source)
        result = [item async for item in stream]
        assert result == [10, 20, 30]

    @pytest.mark.asyncio
    async def test_accumulates_items(self):
        source = _AsyncIter(["x", "y"])
        stream = AsyncPromptyStream("test", source)
        _ = [item async for item in stream]
        assert stream.items == ["x", "y"]

    @pytest.mark.asyncio
    async def test_empty_async_iterator(self):
        source = _AsyncIter([])
        stream = AsyncPromptyStream("test", source)
        result = [item async for item in stream]
        assert result == []
        assert stream.items == []

    @pytest.mark.asyncio
    async def test_partial_async_consumption(self):
        source = _AsyncIter([1, 2, 3])
        stream = AsyncPromptyStream("test", source)
        first = await stream.__anext__()
        assert first == 1
        assert stream.items == [1]

    def test_is_async_iterator(self):
        from collections.abc import AsyncIterator

        stream = AsyncPromptyStream("test", _AsyncIter([]))
        assert isinstance(stream, AsyncIterator)

    def test_name_stored(self):
        stream = AsyncPromptyStream("my_executor", _AsyncIter([]))
        assert stream.name == "my_executor"


# ---------------------------------------------------------------------------
# Streaming in Processor
# ---------------------------------------------------------------------------


def _mock_stream_chunk(content: str | None):
    """Create a mock streaming chunk with delta.content."""
    from unittest.mock import MagicMock

    chunk = MagicMock()
    chunk.choices = [MagicMock()]
    chunk.choices[0].delta.content = content
    return chunk


class TestProcessorStreaming:
    def test_sync_stream_processed(self):
        from prompty.providers.openai.processor import OpenAIProcessor

        chunks = [
            _mock_stream_chunk("Hello"),
            _mock_stream_chunk(" "),
            _mock_stream_chunk("world"),
        ]
        stream = PromptyStream("test", iter(chunks))

        processor = OpenAIProcessor()
        from typing import cast

        from agentschema import AgentDefinition, PromptAgent

        agent = cast(
            PromptAgent,
            AgentDefinition.load({"kind": "prompt", "name": "test", "model": "gpt-4"}),
        )
        result = processor.process(agent, stream)
        # Result should be a generator
        collected = list(result)
        assert collected == ["Hello", " ", "world"]

    def test_sync_stream_skips_none_content(self):
        from prompty.providers.openai.processor import OpenAIProcessor

        chunks = [
            _mock_stream_chunk("Hello"),
            _mock_stream_chunk(None),
            _mock_stream_chunk("world"),
        ]
        stream = PromptyStream("test", iter(chunks))

        processor = OpenAIProcessor()
        from typing import cast

        from agentschema import AgentDefinition, PromptAgent

        agent = cast(
            PromptAgent,
            AgentDefinition.load({"kind": "prompt", "name": "test", "model": "gpt-4"}),
        )
        result = processor.process(agent, stream)
        collected = list(result)
        assert collected == ["Hello", "world"]

    @pytest.mark.asyncio
    async def test_async_stream_processed(self):
        from prompty.providers.openai.processor import OpenAIProcessor

        chunks = [
            _mock_stream_chunk("async"),
            _mock_stream_chunk(" hi"),
        ]
        stream = AsyncPromptyStream("test", _AsyncIter(chunks))

        processor = OpenAIProcessor()
        from typing import cast

        from agentschema import AgentDefinition, PromptAgent

        agent = cast(
            PromptAgent,
            AgentDefinition.load({"kind": "prompt", "name": "test", "model": "gpt-4"}),
        )
        result = processor.process(agent, stream)
        # Result should be an async generator
        collected = [item async for item in result]
        assert collected == ["async", " hi"]
