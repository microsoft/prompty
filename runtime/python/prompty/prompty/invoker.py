"""Backward-compatibility re-export shim.

All implementations have moved to focused modules:

- :mod:`prompty.protocols` — ``RendererProtocol``, ``ParserProtocol``, etc.
- :mod:`prompty.discovery` — ``InvokerError``, ``get_renderer``, ``clear_cache``, etc.
- :mod:`prompty.pipeline`  — ``prepare``, ``execute``, ``process``, ``run``, etc.

Import from those modules directly for new code. This file re-exports
everything so that ``from prompty.invoker import X`` continues to work.
"""

from __future__ import annotations

# --- Protocols ---
from .protocols import (
    ExecutorProtocol,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
    _PreRenderable,
)

# --- Discovery ---
from .discovery import (
    InvokerError,
    clear_cache,
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
)

# --- Pipeline ---
from .pipeline import (
    _dict_content_to_part,
    _dict_to_message,
    _expand_thread_markers,
    _get_rich_input_names,
    _inject_thread_markers,
    execute,
    execute_async,
    prepare,
    prepare_async,
    process,
    process_async,
    run,
    run_async,
    validate_inputs,
)

__all__ = [
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
    # Pipeline functions
    "prepare",
    "prepare_async",
    "execute",
    "execute_async",
    "process",
    "process_async",
    "run",
    "run_async",
    # Validation
    "validate_inputs",
]
