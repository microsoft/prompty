"""Backward-compatibility re-export shim.

All implementations have moved to focused modules:

- :mod:`prompty.protocols` — ``RendererProtocol``, ``ParserProtocol``, etc.
- :mod:`prompty.discovery` — ``InvokerError``, ``get_renderer``, ``clear_cache``, etc.
- :mod:`prompty.pipeline`  — ``prepare``, ``execute``, ``process``, ``run``, etc.

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
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
)

# --- Pipeline ---
from .core.pipeline import (
    execute,
    execute_agent,
    execute_agent_async,
    execute_async,
    headless,
    parse,
    parse_async,
    prepare,
    prepare_async,
    process,
    process_async,
    render,
    render_async,
    run,
    run_agent,
    run_agent_async,
    run_async,
    validate_inputs,
)

# --- Protocols ---
from .core.protocols import (
    ExecutorProtocol,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
)

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
    "clear_cache",
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
    "execute",
    "execute_async",
    "execute_agent",
    "execute_agent_async",
    # Backward-compat aliases
    "run_agent",
    "run_agent_async",
    # Validation
    "validate_inputs",
    # Headless
    "headless",
]
