"""OpenAI response processor — extracts clean results from raw LLM responses.

Handles ChatCompletion, Completion, embedding responses, and streaming.
Registered as ``openai`` in ``prompty.processors``.

Also provides shared processing logic used by the Azure processor.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any

from ...model import Prompty
from ...tracing.tracer import trace

__all__ = ["OpenAIProcessor", "ToolCall"]


@dataclass
class ToolCall:
    """Represents a tool call extracted from an LLM response."""

    id: str
    name: str
    arguments: str


class OpenAIProcessor:
    """Processor for OpenAI responses.

    Extracts content, tool calls, or embeddings from raw API responses.
    Registered as ``openai`` in ``prompty.processors``.
    """

    @trace
    def process(
        self,
        agent: Prompty,
        response: Any,
    ) -> Any:
        return _process_response(response, agent)

    @trace
    async def process_async(
        self,
        agent: Prompty,
        response: Any,
    ) -> Any:
        return _process_response(response, agent)


# ---------------------------------------------------------------------------
# Shared extraction logic (also used by Azure processor)
# ---------------------------------------------------------------------------


def _process_response(response: Any, agent: Prompty | None = None) -> Any:
    """Extract clean result from a raw LLM response object.

    Supports:
    - ``ChatCompletion`` → content string or list of ToolCall
    - ``Completion`` → text string
    - ``CreateEmbeddingResponse`` → embedding vector(s)
    - Iterators (streaming) → generator of content chunks
    - Passthrough for unknown types

    When *agent* has an ``outputSchema`` with properties, a string result
    from a ``ChatCompletion`` is automatically JSON-parsed.
    """
    # Import response types lazily to keep the module importable
    # even without openai installed
    try:
        from openai.types.chat.chat_completion import ChatCompletion
        from openai.types.completion import Completion
        from openai.types.create_embedding_response import CreateEmbeddingResponse
        from openai.types.images_response import ImagesResponse
    except ImportError:
        # If openai isn't installed, just pass through
        return response

    if isinstance(response, ChatCompletion):
        result = _process_chat_completion(response)
        # JSON-parse structured output when outputSchema is defined
        if agent is not None and agent.outputSchema and agent.outputSchema.properties and isinstance(result, str):
            try:
                result = json.loads(result)
            except json.JSONDecodeError:
                pass  # Fall back to raw string
        return result
    elif isinstance(response, Completion):
        return response.choices[0].text
    elif isinstance(response, CreateEmbeddingResponse):
        return _process_embedding(response)
    elif isinstance(response, ImagesResponse):
        return _process_image(response)
    else:
        # Check for streaming iterators (sync and async)
        if isinstance(response, Iterator):
            return _stream_generator(response)
        if isinstance(response, AsyncIterator):
            return _async_stream_generator(response)
        return response


def _process_chat_completion(response: Any) -> Any:
    """Extract from a ChatCompletion response."""
    choice = response.choices[0]
    message = choice.message

    # Tool calls
    if message.tool_calls:
        return [
            ToolCall(
                id=tc.id,
                name=tc.function.name,
                arguments=tc.function.arguments,
            )
            for tc in message.tool_calls
        ]

    return message.content


def _process_embedding(response: Any) -> Any:
    """Extract from an embedding response."""
    if len(response.data) == 0:
        raise ValueError("Empty embedding response")
    elif len(response.data) == 1:
        return response.data[0].embedding
    else:
        return [item.embedding for item in response.data]


def _process_image(response: Any) -> Any:
    """Extract from an image generation response."""
    if not response.data:
        raise ValueError("Empty image response")
    elif len(response.data) == 1:
        return response.data[0].url or response.data[0].b64_json
    else:
        return [d.url or d.b64_json for d in response.data]


def _stream_generator(response: Any) -> Iterator[str | ToolCall]:
    """Yield content chunks, tool calls, or refusals from a streaming response.

    Handles three types of streaming deltas:
    - ``delta.content`` — yields content strings
    - ``delta.tool_calls`` — accumulates partial tool call chunks,
      yields ``ToolCall`` objects when the stream ends
    - ``delta.refusal`` — raises ``ValueError`` with the refusal message
    """
    tool_call_acc: dict[int, dict[str, str]] = {}

    for chunk in response:
        if not hasattr(chunk, "choices") or not chunk.choices:
            continue

        delta = chunk.choices[0].delta

        # Content
        if hasattr(delta, "content") and delta.content is not None:
            yield delta.content

        # Tool call deltas — accumulate index-keyed partial chunks
        if hasattr(delta, "tool_calls") and delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index
                if idx not in tool_call_acc:
                    tool_call_acc[idx] = {"id": "", "name": "", "arguments": ""}
                if tc_delta.id:
                    tool_call_acc[idx]["id"] = tc_delta.id
                if hasattr(tc_delta, "function") and tc_delta.function:
                    if tc_delta.function.name:
                        tool_call_acc[idx]["name"] = tc_delta.function.name
                    if tc_delta.function.arguments:
                        tool_call_acc[idx]["arguments"] += tc_delta.function.arguments

        # Refusal
        if hasattr(delta, "refusal") and delta.refusal is not None:
            raise ValueError(f"Model refused: {delta.refusal}")

    # Yield accumulated tool calls at the end of the stream
    for idx in sorted(tool_call_acc):
        tc = tool_call_acc[idx]
        yield ToolCall(id=tc["id"], name=tc["name"], arguments=tc["arguments"])


async def _async_stream_generator(response: Any) -> AsyncIterator[str | ToolCall]:
    """Yield content chunks, tool calls, or refusals from an async streaming response.

    Async variant of :func:`_stream_generator`.
    """
    tool_call_acc: dict[int, dict[str, str]] = {}

    async for chunk in response:
        if not hasattr(chunk, "choices") or not chunk.choices:
            continue

        delta = chunk.choices[0].delta

        if hasattr(delta, "content") and delta.content is not None:
            yield delta.content

        if hasattr(delta, "tool_calls") and delta.tool_calls:
            for tc_delta in delta.tool_calls:
                idx = tc_delta.index
                if idx not in tool_call_acc:
                    tool_call_acc[idx] = {"id": "", "name": "", "arguments": ""}
                if tc_delta.id:
                    tool_call_acc[idx]["id"] = tc_delta.id
                if hasattr(tc_delta, "function") and tc_delta.function:
                    if tc_delta.function.name:
                        tool_call_acc[idx]["name"] = tc_delta.function.name
                    if tc_delta.function.arguments:
                        tool_call_acc[idx]["arguments"] += tc_delta.function.arguments

        if hasattr(delta, "refusal") and delta.refusal is not None:
            raise ValueError(f"Model refused: {delta.refusal}")

    for idx in sorted(tool_call_acc):
        tc = tool_call_acc[idx]
        yield ToolCall(id=tc["id"], name=tc["name"], arguments=tc["arguments"])
