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
    if not isinstance(response, dict) and not hasattr(response, "content"):
        return response

    # Duck-type check for Anthropic response shape
    r = response if isinstance(response, dict) else response.__dict__

    # Check for Anthropic Messages shape: has content array and role
    content = r.get("content") if isinstance(r, dict) else getattr(response, "content", None)
    role = r.get("role") if isinstance(r, dict) else getattr(response, "role", None)
    stop_reason = r.get("stop_reason") if isinstance(r, dict) else getattr(response, "stop_reason", None)

    if not content or role != "assistant":
        return response

    return _process_messages(agent, content, stop_reason)


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
                    arguments=json.dumps(block_input) if not isinstance(block_input, str) else block_input,
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
