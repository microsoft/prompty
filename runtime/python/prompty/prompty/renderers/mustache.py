"""Mustache template renderer.

Renders Mustache templates via Chevron.
Registered as ``mustache`` in ``prompty.renderers``.
"""

from __future__ import annotations

from typing import Any

from agentschema import PromptAgent

from ..tracing.tracer import trace
from ._common import _prepare_render_inputs

__all__ = ["MustacheRenderer"]


class MustacheRenderer:
    """Renders Mustache templates via Chevron.

    When thread-kind inputs are present, emits nonce markers at
    the template variable positions so that ``prepare()`` can
    insert ``ThreadMarker`` objects at the correct location.
    """

    @trace
    def render(
        self,
        agent: PromptAgent,
        template: str,
        inputs: dict[str, Any],
    ) -> str:
        return self._render(agent, template, inputs)

    def _render(
        self,
        agent: PromptAgent,
        template: str,
        inputs: dict[str, Any],
    ) -> str:
        import chevron  # type: ignore[import-untyped]

        render_inputs, thread_nonces = _prepare_render_inputs(agent, inputs)
        rendered = chevron.render(template, render_inputs)

        self._last_thread_nonces = thread_nonces

        return rendered

    @trace
    async def render_async(
        self,
        agent: PromptAgent,
        template: str,
        inputs: dict[str, Any],
    ) -> str:
        return self._render(agent, template, inputs)
