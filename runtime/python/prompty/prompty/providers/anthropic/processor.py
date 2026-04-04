"""Anthropic processor — extracts clean results from Anthropic Messages API responses.

Handles:
- Text content from ``content[]`` blocks
- Tool use blocks → ToolCall objects
- Streaming responses (content_block_delta events)
- Structured output (JSON parse when outputSchema present)

Registered as ``anthropic`` in ``prompty.processors``.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

from ...tracing.tracer import trace

__all__ = ["AnthropicProcessor"]


class AnthropicProcessor:
    """Processor for Anthropic Messages API responses."""

    @trace
    def process(self, agent: Any, data: Any) -> Any:
        return _process_response(agent, data)

    @trace
    async def process_async(self, agent: Any, data: Any) -> Any:
        return _process_response(agent, data)


def _process_response(agent: Any, response: Any) -> Any:
    """Extract clean content from an Anthropic Messages API response."""
    # Check for Anthropic Messages response shape first (has content + role).
    # This must come before the Iterator check because mock objects
    # and some SDK types may satisfy Iterator checks.
    content = None
    role = None
    stop_reason = None

    if isinstance(response, dict):
        content = response.get("content")
        role = response.get("role")
        stop_reason = response.get("stop_reason")
    elif hasattr(response, "content") and hasattr(response, "role"):
        content = getattr(response, "content", None)
        role = getattr(response, "role", None)
        stop_reason = getattr(response, "stop_reason", None)

    if content is not None and role == "assistant":
        return _process_messages(agent, content, stop_reason)

    # Streaming — sync or async iterator (raw SDK stream, not a response object)
    if isinstance(response, Iterator):
        return _stream_generator(response)
    if isinstance(response, AsyncIterator):
        return _async_stream_generator(response)

    return response


# ---------------------------------------------------------------------------
# Non-streaming response processing
# ---------------------------------------------------------------------------


def _process_messages(agent: Any, content: list[Any], stop_reason: str | None) -> Any:
    """Process content blocks from an Anthropic response."""
    from ..openai.processor import ToolCall

    tool_calls: list[ToolCall] = []
    text_parts: list[str] = []

    for block in content:
        block_type = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)

        if block_type == "tool_use":
            block_id = block.get("id") if isinstance(block, dict) else getattr(block, "id", "")
            block_name = block.get("name") if isinstance(block, dict) else getattr(block, "name", "")
            block_input = block.get("input") if isinstance(block, dict) else getattr(block, "input", {})

            tool_calls.append(
                ToolCall(
                    id=block_id,
                    name=block_name,
                    arguments=json.dumps(block_input, separators=(",", ":"))
                    if not isinstance(block_input, str)
                    else block_input,
                )
            )
        elif block_type == "text":
            block_text = block.get("text") if isinstance(block, dict) else getattr(block, "text", "")
            text_parts.append(block_text)

    # If tool calls present, return them (pipeline handles the loop)
    if tool_calls:
        return tool_calls

    # Text content
    text = "".join(text_parts)
    if not text:
        return None

    # Structured output — JSON parse when outputs schema exists
    outputs = getattr(agent, "outputs", None)
    if outputs:
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            return text

    return text


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


def _stream_generator(response: Iterator) -> Iterator[str | Any]:
    """Yield content chunks from an Anthropic streaming response.

    Handles streaming event types:
    - ``content_block_delta`` with ``delta.type == "text_delta"`` → yield text
    - ``content_block_start`` with ``content_block.type == "tool_use"`` → accumulate tool call
    - ``input_json_delta`` → accumulate partial JSON for tool arguments
    - Tool calls are yielded at the end of the stream.
    """
    from ..openai.processor import ToolCall

    tool_call_acc: dict[int, dict[str, str]] = {}

    for event in response:
        e = event if isinstance(event, dict) else getattr(event, "__dict__", {})
        event_type = e.get("type") if isinstance(e, dict) else getattr(event, "type", None)

        if event_type == "content_block_delta":
            delta = e.get("delta") if isinstance(e, dict) else getattr(event, "delta", None)
            if not delta:
                continue
            delta_type = delta.get("type") if isinstance(delta, dict) else getattr(delta, "type", None)

            if delta_type == "text_delta":
                text = delta.get("text") if isinstance(delta, dict) else getattr(delta, "text", "")
                yield text
            elif delta_type == "input_json_delta":
                idx = e.get("index") if isinstance(e, dict) else getattr(event, "index", 0)
                acc = tool_call_acc.get(idx)
                if acc:
                    partial = (
                        delta.get("partial_json", "") if isinstance(delta, dict) else getattr(delta, "partial_json", "")
                    )
                    acc["arguments"] += partial

        elif event_type == "content_block_start":
            block = e.get("content_block") if isinstance(e, dict) else getattr(event, "content_block", None)
            if not block:
                continue
            block_type = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
            if block_type == "tool_use":
                idx = e.get("index") if isinstance(e, dict) else getattr(event, "index", 0)
                block_id = block.get("id", "") if isinstance(block, dict) else getattr(block, "id", "")
                block_name = block.get("name", "") if isinstance(block, dict) else getattr(block, "name", "")
                tool_call_acc[idx] = {"id": block_id, "name": block_name, "arguments": ""}

    # Yield accumulated tool calls at end of stream
    for idx in sorted(tool_call_acc):
        tc = tool_call_acc[idx]
        yield ToolCall(id=tc["id"], name=tc["name"], arguments=tc["arguments"])


async def _async_stream_generator(response: AsyncIterator) -> AsyncIterator[str | Any]:
    """Async variant of :func:`_stream_generator`."""
    from ..openai.processor import ToolCall

    tool_call_acc: dict[int, dict[str, str]] = {}

    async for event in response:
        e = event if isinstance(event, dict) else getattr(event, "__dict__", {})
        event_type = e.get("type") if isinstance(e, dict) else getattr(event, "type", None)

        if event_type == "content_block_delta":
            delta = e.get("delta") if isinstance(e, dict) else getattr(event, "delta", None)
            if not delta:
                continue
            delta_type = delta.get("type") if isinstance(delta, dict) else getattr(delta, "type", None)

            if delta_type == "text_delta":
                text = delta.get("text") if isinstance(delta, dict) else getattr(delta, "text", "")
                yield text
            elif delta_type == "input_json_delta":
                idx = e.get("index") if isinstance(e, dict) else getattr(event, "index", 0)
                acc = tool_call_acc.get(idx)
                if acc:
                    partial = (
                        delta.get("partial_json", "") if isinstance(delta, dict) else getattr(delta, "partial_json", "")
                    )
                    acc["arguments"] += partial

        elif event_type == "content_block_start":
            block = e.get("content_block") if isinstance(e, dict) else getattr(event, "content_block", None)
            if not block:
                continue
            block_type = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
            if block_type == "tool_use":
                idx = e.get("index") if isinstance(e, dict) else getattr(event, "index", 0)
                block_id = block.get("id", "") if isinstance(block, dict) else getattr(block, "id", "")
                block_name = block.get("name", "") if isinstance(block, dict) else getattr(block, "name", "")
                tool_call_acc[idx] = {"id": block_id, "name": block_name, "arguments": ""}

    for idx in sorted(tool_call_acc):
        tc = tool_call_acc[idx]
        yield ToolCall(id=tc["id"], name=tc["name"], arguments=tc["arguments"])
