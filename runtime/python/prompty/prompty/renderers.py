"""Template renderers — Jinja2 and Mustache implementations.

Each renderer conforms to :class:`~prompty.invoker.RendererProtocol`
and is discovered via the ``prompty.renderers`` entry point group.

Thread-kind inputs are handled specially: instead of rendering the
input value directly (which is a list of messages, not text), the
renderer emits a unique nonce marker at the variable's position.
Downstream, the parser treats these markers as plain text; then
``prepare()`` scans the parsed messages for nonce markers and
injects ``ThreadMarker`` objects so the thread is inserted exactly
where the template variable appeared.
"""

from __future__ import annotations

import secrets
from typing import Any

from agentschema import PromptAgent

from .tracer import trace

__all__ = ["Jinja2Renderer", "MustacheRenderer", "THREAD_NONCE_PREFIX"]

# Prefix used to identify thread nonce markers in rendered output.
THREAD_NONCE_PREFIX = "__PROMPTY_THREAD_"


def _prepare_render_inputs(
    agent: PromptAgent,
    inputs: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Replace thread-kind input values with nonce markers.

    Returns ``(render_inputs, thread_nonces)`` where *render_inputs*
    has thread values replaced by unique marker strings, and
    *thread_nonces* maps each marker to the input property name.
    """
    if agent.inputSchema is None:
        return dict(inputs), {}

    thread_props = {p.name for p in agent.inputSchema.properties if p.kind == "thread"}

    if not thread_props:
        return dict(inputs), {}

    render_inputs = dict(inputs)
    thread_nonces: dict[str, str] = {}

    for name in thread_props:
        nonce = secrets.token_hex(8)
        marker = f"{THREAD_NONCE_PREFIX}{nonce}_{name}__"
        thread_nonces[marker] = name
        render_inputs[name] = marker

    return render_inputs, thread_nonces


class Jinja2Renderer:
    """Renders Jinja2 templates in a sandboxed environment.

    Registered as ``jinja2`` in ``prompty.renderers``.

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


class MustacheRenderer:
    """Renders Mustache templates via Chevron.

    Registered as ``mustache`` in ``prompty.renderers``.
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
