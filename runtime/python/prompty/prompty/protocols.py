"""Protocol definitions for the invoker pipeline stages.

Each stage in the pipeline (render, parse, execute, process) is defined
as a ``Protocol`` so that third-party packages can provide implementations
without inheriting from a base class.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from agentschema import PromptAgent

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
        agent: PromptAgent,
        template: str,
        inputs: dict[str, Any],
    ) -> str: ...

    async def render_async(
        self,
        agent: PromptAgent,
        template: str,
        inputs: dict[str, Any],
    ) -> str: ...


@runtime_checkable
class ParserProtocol(Protocol):
    """Parses rendered text into an abstract message array.

    Implementations may optionally provide ``pre_render()`` for
    template sanitization (e.g. nonce injection when ``Format.strict``
    is enabled).
    """

    def parse(
        self,
        agent: PromptAgent,
        rendered: str,
        **context: Any,
    ) -> list[Message]: ...

    async def parse_async(
        self,
        agent: PromptAgent,
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
    """

    def execute(
        self,
        agent: PromptAgent,
        messages: list[Message],
    ) -> Any: ...

    async def execute_async(
        self,
        agent: PromptAgent,
        messages: list[Message],
    ) -> Any: ...


@runtime_checkable
class ProcessorProtocol(Protocol):
    """Extracts a clean result from a raw LLM response."""

    def process(
        self,
        agent: PromptAgent,
        response: Any,
    ) -> Any: ...

    async def process_async(
        self,
        agent: PromptAgent,
        response: Any,
    ) -> Any: ...
