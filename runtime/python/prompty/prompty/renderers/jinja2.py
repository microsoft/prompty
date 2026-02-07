"""Jinja2 template renderer.

Renders Jinja2 templates in a sandboxed environment.
Registered as ``jinja2`` in ``prompty.renderers``.
"""

from __future__ import annotations

from typing import Any

from agentschema import PromptAgent

from ..tracing.tracer import trace
from ._common import _prepare_render_inputs

__all__ = ["Jinja2Renderer"]


class Jinja2Renderer:
    """Renders Jinja2 templates in a sandboxed environment.

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
        from jinja2 import DictLoader
        from jinja2.sandbox import ImmutableSandboxedEnvironment

        render_inputs, thread_nonces = _prepare_render_inputs(agent, inputs)

        env = ImmutableSandboxedEnvironment(
            loader=DictLoader({"prompt": template}),
            keep_trailing_newline=True,
        )
        t = env.get_template("prompt")
        rendered = t.render(**render_inputs)

        # Stash the nonce mapping for prepare() to retrieve
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
