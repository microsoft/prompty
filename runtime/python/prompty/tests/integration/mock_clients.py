"""Deterministic, request-aware mock SDK clients for offline integration runs.

The integration suite runs against real services when credentials are present and
against these mocks when they are not (see ``conftest.py``). The goal is coverage,
not fidelity: the same test bodies drive the real executor wire-building and the
real processor extraction path in both modes. To do that faithfully the mocks
return genuine SDK type instances (``ChatCompletion``, ``CreateEmbeddingResponse``,
``ImagesResponse``, ``ChatCompletionChunk``) so the processor's ``isinstance``
dispatch runs exactly as it does live. Anthropic responses are returned as plain
dicts, which its duck-typed processor accepts.

Responses are shaped by the request so tool-call loops, structured output,
streaming, embeddings and image generation each exercise their real code path:

* ``tools`` present and no prior tool result  -> assistant message with a tool call
* a prior ``role: tool`` message present       -> final answer echoing the tool output
* ``response_format`` present                  -> JSON matching the requested schema
* ``stream=True``                              -> an iterator/async-iterator of chunks
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

# ---------------------------------------------------------------------------
# SDK type builders (real instances so processor isinstance dispatch runs)
# ---------------------------------------------------------------------------


def _usage() -> Any:
    from openai.types import CompletionUsage

    return CompletionUsage(prompt_tokens=11, completion_tokens=7, total_tokens=18)


def build_chat_completion(
    *,
    content: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    model: str = "mock-model",
) -> Any:
    """Build a real ``ChatCompletion`` with a single choice."""
    from openai.types.chat import ChatCompletion, ChatCompletionMessage
    from openai.types.chat.chat_completion import Choice
    from openai.types.chat.chat_completion_message_tool_call import (
        ChatCompletionMessageToolCall,
        Function,
    )

    sdk_tool_calls = None
    finish_reason = "stop"
    if tool_calls:
        sdk_tool_calls = [
            ChatCompletionMessageToolCall(
                id=tc["id"],
                type="function",
                function=Function(name=tc["name"], arguments=tc["arguments"]),
            )
            for tc in tool_calls
        ]
        finish_reason = "tool_calls"

    message = ChatCompletionMessage(
        role="assistant",
        content=content,
        tool_calls=sdk_tool_calls,
    )
    choice = Choice(index=0, finish_reason=finish_reason, message=message)
    return ChatCompletion(
        id="chatcmpl-mock",
        object="chat.completion",
        created=0,
        model=model,
        choices=[choice],
        usage=_usage(),
    )


def build_chunks(text: str, *, model: str = "mock-model") -> list[Any]:
    """Split ``text`` into a sequence of real ``ChatCompletionChunk`` deltas."""
    from openai.types.chat import ChatCompletionChunk
    from openai.types.chat.chat_completion_chunk import Choice as ChunkChoice
    from openai.types.chat.chat_completion_chunk import ChoiceDelta

    words = text.split(" ")
    pieces = [(w + " " if i < len(words) - 1 else w) for i, w in enumerate(words)]
    chunks: list[Any] = []
    for piece in pieces:
        chunks.append(
            ChatCompletionChunk(
                id="chatcmpl-mock",
                object="chat.completion.chunk",
                created=0,
                model=model,
                choices=[ChunkChoice(index=0, delta=ChoiceDelta(content=piece), finish_reason=None)],
            )
        )
    chunks.append(
        ChatCompletionChunk(
            id="chatcmpl-mock",
            object="chat.completion.chunk",
            created=0,
            model=model,
            choices=[ChunkChoice(index=0, delta=ChoiceDelta(), finish_reason="stop")],
        )
    )
    return chunks


def build_embedding(inputs: Any, *, dims: int = 8) -> Any:
    """Build a real ``CreateEmbeddingResponse`` with one vector per input."""
    from openai.types import CreateEmbeddingResponse, Embedding
    from openai.types.create_embedding_response import Usage

    if isinstance(inputs, str):
        count = 1
    elif isinstance(inputs, list):
        count = max(1, len(inputs))
    else:
        count = 1

    data = [
        Embedding(
            index=i,
            object="embedding",
            embedding=[round(0.1 * (i + j + 1), 4) for j in range(dims)],
        )
        for i in range(count)
    ]
    return CreateEmbeddingResponse(
        data=data,
        model="mock-embedding",
        object="list",
        usage=Usage(prompt_tokens=4, total_tokens=4),
    )


def build_image(*, b64: bool = False) -> Any:
    """Build a real ``ImagesResponse`` — URL by default, base64 when requested."""
    from openai.types import Image, ImagesResponse

    if b64:
        payload = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 2048).decode("ascii")
        image = Image(b64_json=payload, url=None)
    else:
        image = Image(url="https://mock.local/generated-image.png", b64_json=None)
    return ImagesResponse(created=0, data=[image])


# ---------------------------------------------------------------------------
# Request-aware response synthesis
# ---------------------------------------------------------------------------


def _synthesize_from_schema(schema: dict[str, Any]) -> dict[str, Any]:
    props = schema.get("properties", {}) or {}
    out: dict[str, Any] = {}
    for name, spec in props.items():
        t = spec.get("type")
        if isinstance(t, list):
            t = next((x for x in t if x != "null"), "string")
        if t == "integer":
            out[name] = 123
        elif t == "number":
            out[name] = 1.5
        elif t == "boolean":
            out[name] = True
        elif t == "array":
            out[name] = []
        elif t == "object":
            out[name] = {}
        else:
            out[name] = f"mock-{name}"
    return out


def _structured_content(response_format: dict[str, Any]) -> str:
    schema: dict[str, Any] = {}
    if isinstance(response_format, dict):
        js = response_format.get("json_schema")
        if isinstance(js, dict):
            schema = js.get("schema", {}) or {}
    return json.dumps(_synthesize_from_schema(schema))


def _first_tool_call(tools: list[dict[str, Any]]) -> dict[str, Any]:
    tool = tools[0]
    fn = tool.get("function", tool)
    name = fn.get("name", "tool")
    # OpenAI tools carry ``parameters``; Anthropic tools carry ``input_schema``.
    schema = fn.get("parameters") or fn.get("input_schema") or {}
    params = schema.get("properties", {}) or {}
    args = {k: "Seattle" if v.get("type") in (None, "string") else 1 for k, v in params.items()}
    return {"id": "call_mock_1", "name": name, "arguments": json.dumps(args)}


def _last_tool_output(messages: list[Any]) -> str | None:
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "tool":
            content = msg.get("content")
            return content if isinstance(content, str) else json.dumps(content)
    return None


def _anthropic_tool_result(messages: list[Any]) -> str | None:
    """Return the text of the most recent Anthropic ``tool_result`` block, if any."""
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                inner = block.get("content")
                if isinstance(inner, str):
                    return inner
                return json.dumps(inner)
    return None


def _collect_user_text(messages: list[Any]) -> str:
    """Concatenate the plain text of every user message (wire form)."""
    parts: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict) or msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
    return " ".join(p for p in parts if p)


def chat_response_for(kwargs: dict[str, Any]) -> Any:
    """Choose a ``ChatCompletion`` (or chunk stream) based on the request."""
    messages = kwargs.get("messages") or []
    tools = kwargs.get("tools")
    response_format = kwargs.get("response_format")
    streaming = bool(kwargs.get("stream"))

    if streaming:
        return build_chunks("hello world")

    tool_output = _last_tool_output(messages)
    if tool_output is not None:
        return build_chat_completion(content=f"The weather result is: {tool_output}")

    if tools:
        return build_chat_completion(tool_calls=[_first_tool_call(tools)])

    if response_format:
        return build_chat_completion(content=_structured_content(response_format))

    return build_chat_completion(content="Hello! This is a mock assistant reply.")


def _anthropic_stream_events(text: str) -> list[dict[str, Any]]:
    """Anthropic Messages streaming events whose text_deltas concatenate to ``text``."""
    events: list[dict[str, Any]] = [
        {"type": "message_start", "message": {"role": "assistant", "content": []}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    ]
    for word in text.split(" "):
        events.append({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": word + " "}})
    events.append({"type": "content_block_stop", "index": 0})
    events.append({"type": "message_stop"})
    return events


def anthropic_response_for(kwargs: dict[str, Any]) -> Any:
    """Anthropic Messages API response as a dict (its processor accepts dicts).

    When ``stream`` is set, returns a list of streaming event dicts instead.
    """
    if kwargs.get("stream"):
        return _anthropic_stream_events("hello world")

    messages = kwargs.get("messages") or []
    tools = kwargs.get("tools")
    output_config = kwargs.get("output_config")

    tool_output = _anthropic_tool_result(messages) or _last_tool_output(messages)
    if tool_output is not None:
        blocks: list[dict[str, Any]] = [{"type": "text", "text": f"The weather result is: {tool_output}"}]
        stop = "end_turn"
    elif tools:
        tc = _first_tool_call(tools)
        blocks = [
            {
                "type": "tool_use",
                "id": tc["id"],
                "name": tc["name"],
                "input": json.loads(tc["arguments"]),
            }
        ]
        stop = "tool_use"
    elif output_config:
        schema = {}
        fmt = output_config.get("format") if isinstance(output_config, dict) else None
        if isinstance(fmt, dict):
            schema = fmt.get("schema", {}) or {}
        blocks = [{"type": "text", "text": json.dumps(_synthesize_from_schema(schema))}]
        stop = "end_turn"
    else:
        # Echo user context so multi-turn "remembers" earlier turns.
        context = _collect_user_text(messages)
        text = "Hello! This is a mock assistant reply."
        if context:
            text = f"{text} You said: {context}"
        blocks = [{"type": "text", "text": text}]
        stop = "end_turn"

    return {
        "id": "msg_mock",
        "type": "message",
        "role": "assistant",
        "model": kwargs.get("model", "mock-claude"),
        "content": blocks,
        "stop_reason": stop,
        "stop_sequence": None,
        "usage": {"input_tokens": 11, "output_tokens": 7},
    }


def _anthropic_message_object(payload: dict[str, Any]) -> Any:
    """Wrap the Anthropic response dict as attribute-access objects.

    The real Anthropic SDK returns objects, and the pipeline agent loop inspects
    responses via attribute access (``response.stop_reason``, ``block.type``), so
    the mock must expose the same shape for the tool-call loop to iterate.
    """
    from types import SimpleNamespace

    blocks = []
    for block in payload["content"]:
        # ``input`` stays a plain dict, matching the SDK's tool_use blocks.
        blocks.append(SimpleNamespace(**block))
    return SimpleNamespace(
        id=payload["id"],
        type=payload["type"],
        role=payload["role"],
        model=payload["model"],
        content=blocks,
        stop_reason=payload["stop_reason"],
        stop_sequence=payload["stop_sequence"],
        usage=SimpleNamespace(**payload["usage"]),
    )


# ---------------------------------------------------------------------------
# Iterators for streaming
# ---------------------------------------------------------------------------


class _SyncChunkStream(Iterator):
    def __init__(self, chunks: list[Any]) -> None:
        self._it = iter(chunks)

    def __iter__(self) -> _SyncChunkStream:
        return self

    def __next__(self) -> Any:
        return next(self._it)


class _AsyncChunkStream(AsyncIterator):
    def __init__(self, chunks: list[Any]) -> None:
        self._chunks = chunks
        self._i = 0

    def __aiter__(self) -> _AsyncChunkStream:
        return self

    async def __anext__(self) -> Any:
        if self._i >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._i]
        self._i += 1
        return chunk


# ---------------------------------------------------------------------------
# Mock client objects mimicking the openai / anthropic client surface
# ---------------------------------------------------------------------------


class _ChatCompletions:
    def __init__(self, is_async: bool) -> None:
        self._is_async = is_async

    def create(self, **kwargs: Any) -> Any:
        result = chat_response_for(kwargs)
        if kwargs.get("stream"):
            chunks = result if isinstance(result, list) else list(result)
            if self._is_async:
                return _wrap_async(_AsyncChunkStream(chunks))
            return _SyncChunkStream(chunks)
        if self._is_async:
            return _wrap_async(result)
        return result


class _Embeddings:
    def __init__(self, is_async: bool) -> None:
        self._is_async = is_async

    def create(self, **kwargs: Any) -> Any:
        result = build_embedding(kwargs.get("input"))
        return _wrap_async(result) if self._is_async else result


class _Images:
    def __init__(self, is_async: bool, *, b64: bool) -> None:
        self._is_async = is_async
        self._b64 = b64

    def generate(self, **kwargs: Any) -> Any:
        result = build_image(b64=self._b64)
        return _wrap_async(result) if self._is_async else result


class _Chat:
    def __init__(self, is_async: bool) -> None:
        self.completions = _ChatCompletions(is_async)


class MockOpenAIClient:
    """Mimics ``openai.OpenAI`` / ``openai.AzureOpenAI`` (and their async peers).

    ``b64_images`` controls whether image generation returns base64 (Azure-style)
    or a URL (OpenAI-style), matching what each provider's tests expect.
    """

    def __init__(self, *args: Any, is_async: bool = False, b64_images: bool = False, **kwargs: Any) -> None:
        self.chat = _Chat(is_async)
        self.embeddings = _Embeddings(is_async)
        self.images = _Images(is_async, b64=b64_images)


class _AnthropicMessages:
    def __init__(self, is_async: bool) -> None:
        self._is_async = is_async

    def create(self, **kwargs: Any) -> Any:
        result = anthropic_response_for(kwargs)
        if kwargs.get("stream"):
            events = result if isinstance(result, list) else list(result)
            if self._is_async:
                return _wrap_async(_AsyncChunkStream(events))
            return _SyncChunkStream(events)
        # Non-streaming: the pipeline agent loop inspects the response via
        # attribute access, so wrap the dict as objects like the real SDK.
        message = _anthropic_message_object(result)
        return _wrap_async(message) if self._is_async else message


class MockAnthropicClient:
    """Mimics ``anthropic.Anthropic`` / ``anthropic.AsyncAnthropic``."""

    def __init__(self, *args: Any, is_async: bool = False, **kwargs: Any) -> None:
        self.messages = _AnthropicMessages(is_async)


# ---------------------------------------------------------------------------
# Async helper — a coroutine yielding the given value
# ---------------------------------------------------------------------------


async def _identity(value: Any) -> Any:
    return value


def _wrap_async(value: Any) -> Any:
    """Return an awaitable that resolves to ``value`` (async ``create`` returns this)."""
    return _identity(value)
