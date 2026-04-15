"""Protocol definitions for the invoker pipeline stages.

Each stage in the pipeline (render, parse, execute, process) is defined
as a ``Protocol`` so that third-party packages can provide implementations
without inheriting from a base class.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from ..model import Prompty
from .types import Message

__all__ = [
    "RendererProtocol",
    "ParserProtocol",
    "ExecutorProtocol",
    "ProcessorProtocol",
    "_PreRenderable",
]


# ---------------------------------------------------------------------------
# Protocols
# ---------------------------------------------------------------------------


@runtime_checkable
class RendererProtocol(Protocol):
    """Renders a template string with input values.

    Must handle rich input kinds (``thread``, ``image``, ``file``, ``audio``)
    by emitting unique positional markers instead of text interpolation.
    """

    def render(
        self,
        agent: Prompty,
        template: str,
        inputs: dict[str, Any],
    ) -> str: ...

    async def render_async(
        self,
        agent: Prompty,
        template: str,
        inputs: dict[str, Any],
    ) -> str: ...


@runtime_checkable
class ParserProtocol(Protocol):
    """Parses rendered text into an abstract message array.

    Implementations may optionally provide ``pre_render()`` for
    template sanitization (e.g. nonce injection when ``FormatConfig.strict``
    is enabled).
    """

    def parse(
        self,
        agent: Prompty,
        rendered: str,
        **context: Any,
    ) -> list[Message]: ...

    async def parse_async(
        self,
        agent: Prompty,
        rendered: str,
        **context: Any,
    ) -> list[Message]: ...


class _PreRenderable(Protocol):
    """Optional mixin for parsers that need pre-render sanitization."""

    def pre_render(self, template: str) -> tuple[str, dict[str, Any]]: ...


@runtime_checkable
class ExecutorProtocol(Protocol):
    """Calls an LLM provider with messages and returns the raw response.

    The executor is responsible for mapping abstract ``Message`` objects
    to the provider's wire format internally.

    ``format_tool_messages`` formats the assistant tool-call response and
    dispatched tool results into messages for the next agent loop iteration.
    Each provider implements this to match its API's expected wire format,
    keeping the pipeline provider-agnostic.
    """

    def execute(
        self,
        agent: Prompty,
        messages: list[Message],
    ) -> Any: ...

    async def execute_async(
        self,
        agent: Prompty,
        messages: list[Message],
    ) -> Any: ...

    def format_tool_messages(
        self,
        raw_response: Any,
        tool_calls: list[Any],
        tool_results: list[str],
        text_content: str = "",
    ) -> list[Message]:
        """Format tool call results into messages for the next loop iteration.

        Args:
            raw_response: Original LLM response (for content block preservation).
            tool_calls: Tool calls extracted by the processor (ToolCall objects).
            tool_results: Results from dispatching each tool call, parallel to tool_calls.
            text_content: Any non-tool text content from the response.

        Returns:
            Messages to append to the conversation (assistant + tool result messages).
        """
        ...


@runtime_checkable
class ProcessorProtocol(Protocol):
    """Extracts a clean result from a raw LLM response."""

    def process(
        self,
        agent: Prompty,
        response: Any,
    ) -> Any: ...

    async def process_async(
        self,
        agent: Prompty,
        response: Any,
    ) -> Any: ...
