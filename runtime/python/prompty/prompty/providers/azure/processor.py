"""Azure OpenAI response processor.

Identical logic to OpenAIProcessor — Azure uses the same response types
via the OpenAI SDK.

Registered as ``azure`` in ``prompty.processors``.
"""

from __future__ import annotations

from typing import Any

from agentschema import PromptAgent

from ...tracing.tracer import trace
from ..openai.processor import _process_response

__all__ = ["AzureProcessor"]


class AzureProcessor:
    """Processor for Azure OpenAI responses.

    Identical logic to OpenAIProcessor — Azure uses the same response types.
    Registered as ``azure`` in ``prompty.processors``.
    """

    @trace
    def process(
        self,
        agent: PromptAgent,
        response: Any,
    ) -> Any:
        return _process_response(response)

    @trace
    async def process_async(
        self,
        agent: PromptAgent,
        response: Any,
    ) -> Any:
        return _process_response(response)
