"""Shared renderer utilities — rich-kind nonce handling."""

from __future__ import annotations

import secrets
import threading
from typing import Any

from ..core.types import RICH_KINDS
from ..model import Prompty

__all__ = ["THREAD_NONCE_PREFIX", "_prepare_render_inputs", "_thread_nonces_local"]

# Prefix used to identify nonce markers in rendered output.
THREAD_NONCE_PREFIX = "__PROMPTY_THREAD_"

# Thread-local storage for nonce mappings, avoiding race conditions
# when a renderer singleton is used concurrently from multiple threads.
_thread_nonces_local = threading.local()


def _prepare_render_inputs(
    agent: Prompty,
    inputs: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Replace rich-kind input values with nonce markers.

    Rich kinds (thread, image, file, audio) contain structured data that
    cannot be directly interpolated into a template string.  This function
    substitutes them with unique nonce markers so the template engine
    doesn't corrupt the values.

    Returns ``(render_inputs, nonces)`` where *render_inputs* has rich
    values replaced by unique marker strings, and *nonces* maps each
    marker to the input property name.
    """
    if not agent.inputs:
        return dict(inputs), {}

    rich_props = {p.name for p in agent.inputs if p.kind in RICH_KINDS}

    if not rich_props:
        return dict(inputs), {}

    render_inputs = dict(inputs)
    nonces: dict[str, str] = {}

    for name in rich_props:
        nonce = secrets.token_hex(4)
        marker = f"{THREAD_NONCE_PREFIX}{nonce}_{name}__"
        nonces[marker] = name
        render_inputs[name] = marker

    return render_inputs, nonces
