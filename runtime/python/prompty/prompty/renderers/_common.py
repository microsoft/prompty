"""Shared renderer utilities — thread-kind nonce handling."""

from __future__ import annotations

import secrets
from typing import Any

from agentschema import PromptAgent

__all__ = ["THREAD_NONCE_PREFIX", "_prepare_render_inputs"]

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
