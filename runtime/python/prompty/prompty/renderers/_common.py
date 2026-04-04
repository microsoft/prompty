"""Shared renderer utilities — thread-kind nonce handling."""

from __future__ import annotations

import secrets
import threading
from typing import Any

from ..model import Prompty

__all__ = ["THREAD_NONCE_PREFIX", "_prepare_render_inputs", "_thread_nonces_local"]

# Prefix used to identify thread nonce markers in rendered output.
THREAD_NONCE_PREFIX = "__PROMPTY_THREAD_"

# Thread-local storage for nonce mappings, avoiding race conditions
# when a renderer singleton is used concurrently from multiple threads.
_thread_nonces_local = threading.local()


def _prepare_render_inputs(
    agent: Prompty,
    inputs: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Replace thread-kind input values with nonce markers.

    Returns ``(render_inputs, thread_nonces)`` where *render_inputs*
    has thread values replaced by unique marker strings, and
    *thread_nonces* maps each marker to the input property name.
    """
    if not agent.inputs:
        return dict(inputs), {}

    thread_props = {p.name for p in agent.inputs if p.kind == "thread"}

    if not thread_props:
        return dict(inputs), {}

    render_inputs = dict(inputs)
    thread_nonces: dict[str, str] = {}

    for name in thread_props:
        nonce = secrets.token_hex(4)
        marker = f"{THREAD_NONCE_PREFIX}{nonce}_{name}__"
        thread_nonces[marker] = name
        render_inputs[name] = marker

    return render_inputs, thread_nonces
