"""Backward-compatibility re-export shim.

All implementations have moved to focused modules:

- :mod:`prompty.protocols` — ``RendererProtocol``, ``ParserProtocol``, etc.
- :mod:`prompty.discovery` — ``InvokerError``, ``get_renderer``, ``clear_cache``, etc.
- :mod:`prompty.pipeline`  — ``prepare``, ``invoke``, ``process``, ``run``, etc.

Import from those modules directly for new code. This file re-exports
everything so that ``from prompty.invoker import X`` continues to work.
"""

from __future__ import annotations

# --- Connections ---
from .core.connections import clear_connections, get_connection, register_connection

# --- Discovery ---
from .core.discovery import (
    InvokerError,
    clear_cache,
    clear_registry,
    default_provider,
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
    register_default,
    register_default_provider,
    register_executor,
    register_parser,
    register_processor,
    register_provider,
    register_renderer,
    resolve_provider_key,
)

# --- Pipeline ---
from .core.pipeline import (
    invoke,
    invoke_async,
    parse,
    parse_async,
    prepare,
    prepare_async,
    process,
    process_async,
    render,
    render_async,
    run,
    run_async,
    turn,
    turn_async,
    validate_inputs,
)

# --- Protocols ---
from .core.protocols import (
    ExecutorProtocol,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
)

# --- Structured result casting (§8.8) ---
from .core.structured import StructuredResult, cast

__all__ = [
    # Connections
    "register_connection",
    "get_connection",
    "clear_connections",
    # Protocols
    "RendererProtocol",
    "ParserProtocol",
    "ExecutorProtocol",
    "ProcessorProtocol",
    # Discovery
    "InvokerError",
    "get_renderer",
    "get_parser",
    "get_executor",
    "get_processor",
    "register_renderer",
    "register_parser",
    "register_executor",
    "register_processor",
    "register_provider",
    "register_default",
    "register_default_provider",
    "default_provider",
    "resolve_provider_key",
    "clear_cache",
    "clear_registry",
    # Leaf steps
    "render",
    "render_async",
    "parse",
    "parse_async",
    "process",
    "process_async",
    # Composite steps
    "prepare",
    "prepare_async",
    "run",
    "run_async",
    # Top-level orchestrators
    "invoke",
    "invoke_async",
    "turn",
    "turn_async",
    # Validation
    "validate_inputs",
    # Structured result casting (§8.8)
    "StructuredResult",
    "cast",
]
