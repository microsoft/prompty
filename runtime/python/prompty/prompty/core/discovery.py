"""Entry-point discovery for invoker implementations.

Renderers, parsers, executors, and processors are discovered lazily via
Python entry points (``importlib.metadata.entry_points``). Third-party
packages register their implementations in ``pyproject.toml``:

.. code-block:: toml

    [project.entry-points."prompty.renderers"]
    jinja2 = "prompty.renderers:Jinja2Renderer"

    [project.entry-points."prompty.executors"]
    openai = "prompty.openai:OpenAIExecutor"
"""

from __future__ import annotations

import importlib.metadata
from typing import Any

from .protocols import (
    ExecutorProtocol,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
)

__all__ = [
    "InvokerError",
    "get_renderer",
    "get_parser",
    "get_executor",
    "get_processor",
    "clear_cache",
]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class InvokerError(Exception):
    """Raised when an invoker cannot be found or loaded.

    Provides a helpful message suggesting the correct ``pip install``
    command for the missing provider.
    """

    def __init__(self, group: str, key: str) -> None:
        stage = group.removeprefix("prompty.")
        super().__init__(
            f"No {stage.rstrip('s')} found for '{key}'. "
            f"Install the appropriate package, e.g.: "
            f"pip install prompty[{key}]"
        )
        self.group = group
        self.key = key


# ---------------------------------------------------------------------------
# Entry point discovery
# ---------------------------------------------------------------------------

# Module-level cache: (group, key) → loaded object
_cache: dict[tuple[str, str], Any] = {}


def _discover(group: str, key: str) -> Any:
    """Lazily discover and cache an invoker via entry points.

    Parameters
    ----------
    group:
        Entry point group (e.g. ``"prompty.renderers"``).
    key:
        Entry point name (e.g. ``"jinja2"``).

    Returns
    -------
    The loaded object (class or instance).

    Raises
    ------
    InvokerError
        If no entry point matches ``(group, key)``.
    """
    cache_key = (group, key)
    if cache_key in _cache:
        return _cache[cache_key]

    eps = importlib.metadata.entry_points(group=group, name=key)
    ep_list = list(eps) if not isinstance(eps, list) else eps

    if not ep_list:
        raise InvokerError(group, key)

    loaded = ep_list[0].load()
    # If it's a class, instantiate it (protocols expect instances)
    if isinstance(loaded, type):
        loaded = loaded()

    _cache[cache_key] = loaded
    return loaded


def get_renderer(key: str) -> RendererProtocol:
    """Get a renderer by format kind (e.g. ``"jinja2"``)."""
    return _discover("prompty.renderers", key)


def get_parser(key: str) -> ParserProtocol:
    """Get a parser by parser kind (e.g. ``"prompty"``)."""
    return _discover("prompty.parsers", key)


def get_executor(key: str) -> ExecutorProtocol:
    """Get an executor by provider name (e.g. ``"openai"``)."""
    return _discover("prompty.executors", key)


def get_processor(key: str) -> ProcessorProtocol:
    """Get a processor by provider name."""
    return _discover("prompty.processors", key)


def clear_cache() -> None:
    """Clear the discovery cache (useful for testing)."""
    _cache.clear()
