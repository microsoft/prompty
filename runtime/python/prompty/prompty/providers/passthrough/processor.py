"""Passthrough processor — the processor-axis default (NOOP).

Registered as the default under the ``prompty.processors`` axis. Returns the raw
provider response unchanged. Used when a provider registers an ``Executor`` but
no ``Processor``, so callers that want the raw response need zero boilerplate.
Any explicitly registered or entry-point-discovered processor for a given
provider key shadows this default.
"""

from __future__ import annotations

from typing import Any

from ...model import Agent
from ...tracing.tracer import trace


class PassthroughProcessor:
    """A NOOP processor that returns the raw response unchanged."""

    @trace
    def process(self, agent: Agent, response: Any) -> Any:
        """Return *response* unchanged."""
        return response

    async def process_async(self, agent: Agent, response: Any) -> Any:
        """Return *response* unchanged (async variant)."""
        return response
