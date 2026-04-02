"""Foundry response processor for Azure OpenAI.

Identical logic to OpenAIProcessor — Azure OpenAI uses the same response types
via the OpenAI SDK.

Registered as ``foundry`` in ``prompty.processors``.
"""

from __future__ import annotations

from typing import Any

from ...model import Prompty
from ...tracing.tracer import trace
from ..openai.processor import _process_response

__all__ = ["FoundryProcessor"]


class FoundryProcessor:
    """Processor for Azure OpenAI responses via the Foundry provider.

    Identical logic to OpenAIProcessor — Azure uses the same response types.
    Registered as ``foundry`` in ``prompty.processors``.
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
