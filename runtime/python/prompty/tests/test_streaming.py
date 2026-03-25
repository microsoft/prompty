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
    chunk.choices[0].delta.tool_calls = None
    chunk.choices[0].delta.refusal = None
    return chunk


def _mock_tool_call_chunk(index: int, tc_id: str | None = None, name: str | None = None, arguments: str | None = None):
    """Create a mock streaming chunk with delta.tool_calls."""
    from unittest.mock import MagicMock

    chunk = MagicMock()
    chunk.choices = [MagicMock()]
    chunk.choices[0].delta.content = None
    chunk.choices[0].delta.refusal = None

    tc_delta = MagicMock()
    tc_delta.index = index
    tc_delta.id = tc_id
    tc_delta.function = MagicMock()
    tc_delta.function.name = name
    tc_delta.function.arguments = arguments

    chunk.choices[0].delta.tool_calls = [tc_delta]
    return chunk


def _mock_refusal_chunk(refusal: str):
    """Create a mock streaming chunk with delta.refusal."""
    from unittest.mock import MagicMock

    chunk = MagicMock()
    chunk.choices = [MagicMock()]
    chunk.choices[0].delta.content = None
    chunk.choices[0].delta.tool_calls = None
    chunk.choices[0].delta.refusal = refusal
    return chunk


def _mock_empty_chunk():
    """Create a mock streaming chunk with no choices (heartbeat)."""
    from unittest.mock import MagicMock

    chunk = MagicMock()
    chunk.choices = []
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
        from prompty.model import Prompty

        agent = Prompty.load({"name": "test", "model": "gpt-4"})
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
        from prompty.model import Prompty

        agent = Prompty.load({"name": "test", "model": "gpt-4"})
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
        from prompty.model import Prompty

        agent = Prompty.load({"name": "test", "model": "gpt-4"})
        result = processor.process(agent, stream)
        # Result should be an async generator
        collected = [item async for item in result]
        assert collected == ["async", " hi"]


# ---------------------------------------------------------------------------
# Streaming: Tool call accumulation
# ---------------------------------------------------------------------------


class TestStreamingToolCalls:
    def test_sync_single_tool_call(self):
        """Tool call deltas are accumulated and yielded as ToolCall at end."""
        from prompty.providers.openai.processor import ToolCall, _stream_generator

        chunks = [
            _mock_tool_call_chunk(0, tc_id="call_1", name="get_weather", arguments='{"ci'),
            _mock_tool_call_chunk(0, arguments='ty": "Seattle"}'),
        ]
        result = list(_stream_generator(iter(chunks)))
        assert len(result) == 1
        assert isinstance(result[0], ToolCall)
        assert result[0].id == "call_1"
        assert result[0].name == "get_weather"
        assert result[0].arguments == '{"city": "Seattle"}'

    def test_sync_multiple_tool_calls(self):
        """Multiple tool calls with different indices are accumulated separately."""
        from prompty.providers.openai.processor import _stream_generator

        chunks = [
            _mock_tool_call_chunk(0, tc_id="call_1", name="get_weather", arguments='{"city":'),
            _mock_tool_call_chunk(1, tc_id="call_2", name="get_time", arguments='{"tz":'),
            _mock_tool_call_chunk(0, arguments=' "NYC"}'),
            _mock_tool_call_chunk(1, arguments=' "EST"}'),
        ]
        result = list(_stream_generator(iter(chunks)))
        assert len(result) == 2
        assert result[0].name == "get_weather"
        assert result[0].arguments == '{"city": "NYC"}'
        assert result[1].name == "get_time"
        assert result[1].arguments == '{"tz": "EST"}'

    def test_sync_content_then_no_tool_calls(self):
        """Content-only stream yields no ToolCall objects."""
        from prompty.providers.openai.processor import ToolCall, _stream_generator

        chunks = [
            _mock_stream_chunk("Hello"),
            _mock_stream_chunk(" world"),
        ]
        result = list(_stream_generator(iter(chunks)))
        assert result == ["Hello", " world"]
        assert not any(isinstance(r, ToolCall) for r in result)

    @pytest.mark.asyncio
    async def test_async_tool_call_accumulation(self):
        """Async variant accumulates tool calls the same way."""
        from prompty.providers.openai.processor import ToolCall, _async_stream_generator

        chunks = [
            _mock_tool_call_chunk(0, tc_id="call_a", name="search", arguments='{"q": "test"}'),
        ]
        result = [item async for item in _async_stream_generator(_AsyncIter(chunks))]
        assert len(result) == 1
        assert isinstance(result[0], ToolCall)
        assert result[0].name == "search"


# ---------------------------------------------------------------------------
# Streaming: Refusal handling
# ---------------------------------------------------------------------------


class TestStreamingRefusal:
    def test_sync_refusal_raises(self):
        """A refusal delta raises ValueError."""
        from prompty.providers.openai.processor import _stream_generator

        chunks = [
            _mock_refusal_chunk("I cannot help with that."),
        ]
        with pytest.raises(ValueError, match="Model refused"):
            list(_stream_generator(iter(chunks)))

    def test_sync_refusal_after_content(self):
        """Refusal mid-stream still raises, content before it is yielded."""
        from prompty.providers.openai.processor import _stream_generator

        chunks = [
            _mock_stream_chunk("Starting"),
            _mock_refusal_chunk("I cannot continue."),
        ]
        gen = _stream_generator(iter(chunks))
        assert next(gen) == "Starting"
        with pytest.raises(ValueError, match="Model refused"):
            next(gen)

    @pytest.mark.asyncio
    async def test_async_refusal_raises(self):
        """Async refusal also raises ValueError."""
        from prompty.providers.openai.processor import _async_stream_generator

        chunks = [
            _mock_refusal_chunk("Not allowed."),
        ]
        with pytest.raises(ValueError, match="Model refused"):
            _ = [item async for item in _async_stream_generator(_AsyncIter(chunks))]


# ---------------------------------------------------------------------------
# Streaming: Empty / heartbeat chunks
# ---------------------------------------------------------------------------


class TestStreamingEmptyChunks:
    def test_sync_empty_chunks_skipped(self):
        """Chunks with no choices (heartbeats) are silently skipped."""
        from prompty.providers.openai.processor import _stream_generator

        chunks = [
            _mock_empty_chunk(),
            _mock_stream_chunk("Hello"),
            _mock_empty_chunk(),
            _mock_stream_chunk(" world"),
            _mock_empty_chunk(),
        ]
        result = list(_stream_generator(iter(chunks)))
        assert result == ["Hello", " world"]

    @pytest.mark.asyncio
    async def test_async_empty_chunks_skipped(self):
        """Async: chunks with no choices are silently skipped."""
        from prompty.providers.openai.processor import _async_stream_generator

        chunks = [
            _mock_empty_chunk(),
            _mock_stream_chunk("hi"),
            _mock_empty_chunk(),
        ]
        result = [item async for item in _async_stream_generator(_AsyncIter(chunks))]
        assert result == ["hi"]

    def test_all_empty_chunks(self):
        """Stream of only empty chunks yields nothing."""
        from prompty.providers.openai.processor import _stream_generator

        chunks = [_mock_empty_chunk(), _mock_empty_chunk()]
        result = list(_stream_generator(iter(chunks)))
        assert result == []
