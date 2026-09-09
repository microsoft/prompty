"""Invoker registry and entry-point discovery.

Renderers, parsers, executors, and processors are resolved through a single
per-axis choke point. Resolution order per key (LIFO override wins):

    imperative register_*() LIFO stack  ->  entry-point discovery  ->  axis default  ->  InvokerError

- **Tier 1 — discovery (base):** entry points seed built-ins + installed plugins.
  Third-party packages register implementations in ``pyproject.toml``:

  .. code-block:: toml

      [project.entry-points."prompty.renderers"]
      jinja2 = "prompty.renderers:Jinja2Renderer"

      [project.entry-points."prompty.executors"]
      openai = "prompty.openai:OpenAIExecutor"

- **Tier 2 — imperative stack (override):** :func:`register_executor` and friends
  push onto a per-key LIFO stack that always shadows discovery. Last push wins, so
  a downstream consumer can override a built-in without touching entry points.
- **Tier 3 — axis default:** the processor axis defaults to
  :class:`~prompty.providers.passthrough.processor.PassthroughProcessor`, so a
  provider that registers only an executor gets passthrough processing for free.
  Renderer/parser/executor axes have no default and raise on an unknown key.

An empty/absent key always raises :class:`InvokerError` — there is no dispatch
key to resolve.

**Provider-key default (a separate dimension).** The tiers above resolve an
*implementation* once a dispatch key is known. A bare ``model: "gpt-4"``
shorthand coerces to ``{id}`` only and carries *no* provider, so there is no
key to dispatch on at all. :func:`register_default_provider` supplies a global
fallback provider *key* (LIFO), consulted by :func:`resolve_provider_key` when
``agent.model.provider`` is absent. Resolution of the effective provider key is
therefore ``explicit provider  ->  registered default provider  ->  InvokerError``;
the resulting key then flows through the per-axis tiers above.
"""

from __future__ import annotations

import importlib
import importlib.metadata
import threading
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
]

# Entry-point group names, one per pluggable axis.
RENDERERS = "prompty.renderers"
PARSERS = "prompty.parsers"
EXECUTORS = "prompty.executors"
PROCESSORS = "prompty.processors"

# The wildcard discriminator value emitted by the ``Custom*`` catch-all subtypes.
WILDCARD = "*"

# Built-in axis defaults, imported lazily to avoid an import cycle
# (providers import from ``prompty.core``).
_BUILTIN_DEFAULTS: dict[str, str] = {
    PROCESSORS: "prompty.providers.passthrough.processor:PassthroughProcessor",
}


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
            f"uv pip install prompty[{key}]"
        )
        self.group = group
        self.key = key


# ---------------------------------------------------------------------------
# Registry state
# ---------------------------------------------------------------------------

_lock = threading.RLock()

# Entry-point discovery cache: (group, key) -> loaded instance.
_cache: dict[tuple[str, str], Any] = {}

# Imperative LIFO override stacks: group -> key -> [oldest, ..., newest].
_overrides: dict[str, dict[str, list[Any]]] = {}

# Resolved axis defaults: group -> instance. Seeded lazily from
# ``_BUILTIN_DEFAULTS`` and overridable via :func:`register_default`.
_defaults: dict[str, Any] = {}

# Global default-provider key stack (LIFO). Consulted by
# :func:`resolve_provider_key` when a model names no provider. This is the
# provider *dimension* default (which provider to dispatch on), distinct from a
# per-axis default *implementation* (:func:`register_default`).
_default_provider_keys: list[str] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _instantiate(impl: Any) -> Any:
    """Instantiate *impl* if it is a class; otherwise return it unchanged."""
    return impl() if isinstance(impl, type) else impl


def _load_default(group: str) -> Any | None:
    """Resolve (and cache) the axis default for *group*, or ``None`` if none."""
    with _lock:
        if group in _defaults:
            return _defaults[group]
        factory = _BUILTIN_DEFAULTS.get(group)
    if factory is None:
        return None
    module_name, _, attr = factory.partition(":")
    module = importlib.import_module(module_name)
    instance = _instantiate(getattr(module, attr))
    with _lock:
        # Another thread may have seeded it meanwhile; keep the first winner.
        return _defaults.setdefault(group, instance)


def _discover(group: str, key: str) -> Any:
    """Load an invoker via entry points, caching the instantiated result.

    Raises
    ------
    InvokerError
        If no entry point matches ``(group, key)``.
    """
    cache_key = (group, key)
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]

    eps = importlib.metadata.entry_points(group=group, name=key)
    first = next(iter(eps), None)
    if first is None:
        raise InvokerError(group, key)

    loaded = _instantiate(first.load())
    with _lock:
        _cache[cache_key] = loaded
    return loaded


def _resolve(group: str, key: str) -> Any:
    """Resolve an invoker for ``(group, key)`` through the full tier order.

    LIFO override -> entry-point discovery -> axis default -> ``InvokerError``.
    An empty/``None`` key always raises (no dispatch key to resolve).
    """
    if not key:
        raise InvokerError(group, key or "")

    # Tier 2 — imperative LIFO override (always shadows discovery).
    with _lock:
        stack = _overrides.get(group, {}).get(key)
        if stack:
            return stack[-1]

    # The wildcard catch-all never has a literal entry point; route it straight
    # to the axis default (an explicit "*" override was handled above).
    if key != WILDCARD:
        # Tier 1 — entry-point discovery (base).
        try:
            return _discover(group, key)
        except InvokerError:
            pass

    # Tier 3 — axis default.
    default = _load_default(group)
    if default is not None:
        return default
    raise InvokerError(group, key)


# ---------------------------------------------------------------------------
# Public getters (single choke point per axis)
# ---------------------------------------------------------------------------


def get_renderer(key: str) -> RendererProtocol:
    """Get a renderer by format kind (e.g. ``"jinja2"``)."""
    return _resolve(RENDERERS, key)


def get_parser(key: str) -> ParserProtocol:
    """Get a parser by parser kind (e.g. ``"prompty"``)."""
    return _resolve(PARSERS, key)


def get_executor(key: str) -> ExecutorProtocol:
    """Get an executor by provider name (e.g. ``"openai"``)."""
    return _resolve(EXECUTORS, key)


def get_processor(key: str) -> ProcessorProtocol:
    """Get a processor by provider name.

    Falls back to the passthrough processor default when a provider key has no
    registered or discovered processor of its own.
    """
    return _resolve(PROCESSORS, key)


def resolve_provider_key(provider: str | None, group: str = EXECUTORS) -> str:
    """Resolve the effective provider dispatch *key*.

    Returns *provider* when set, else the registered global default provider
    (see :func:`register_default_provider`). Raises :class:`InvokerError` for
    *group* when neither is available — a bare ``model: "gpt-4"`` shorthand
    carries no provider and no fallback was registered, so there is no provider
    dimension value to dispatch on.
    """
    key = provider or default_provider()
    if not key:
        raise InvokerError(group, "(no provider set)")
    return key


# ---------------------------------------------------------------------------
# Imperative registration (LIFO override tier)
# ---------------------------------------------------------------------------


def _register(group: str, key: str, impl: Any) -> None:
    if not key:
        raise ValueError("Invoker key must not be empty.")
    if impl is None:
        raise ValueError("Invoker implementation must not be None.")
    instance = _instantiate(impl)
    with _lock:
        _overrides.setdefault(group, {}).setdefault(key, []).append(instance)
        # Bust any stale discovery cache so the override is visible immediately.
        _cache.pop((group, key), None)


def register_renderer(key: str, impl: Any) -> None:
    """Register a renderer under *key*, shadowing discovery (LIFO)."""
    _register(RENDERERS, key, impl)


def register_parser(key: str, impl: Any) -> None:
    """Register a parser under *key*, shadowing discovery (LIFO)."""
    _register(PARSERS, key, impl)


def register_executor(key: str, impl: Any) -> None:
    """Register an executor under a provider *key*, shadowing discovery (LIFO)."""
    _register(EXECUTORS, key, impl)


def register_processor(key: str, impl: Any) -> None:
    """Register a processor under a provider *key*, shadowing discovery (LIFO)."""
    _register(PROCESSORS, key, impl)


def register_provider(
    key: str,
    *,
    executor: Any | None = None,
    processor: Any | None = None,
) -> None:
    """Register an executor and/or processor for a provider *key* in one call.

    Thin sugar over :func:`register_executor` / :func:`register_processor`; the
    axes stay independent. Omitting *processor* leaves the provider on the
    passthrough default.
    """
    if executor is None and processor is None:
        raise ValueError("register_provider requires an executor and/or a processor.")
    if executor is not None:
        register_executor(key, executor)
    if processor is not None:
        register_processor(key, processor)


def register_default(group: str, impl: Any) -> None:
    """Override the axis default for *group* (e.g. ``"prompty.processors"``)."""
    instance = _instantiate(impl)
    with _lock:
        _defaults[group] = instance


def register_default_provider(key: str) -> None:
    """Push a global fallback provider *key* onto the LIFO default stack.

    Consulted by :func:`resolve_provider_key` when a model names no provider
    (bare ``model: "gpt-4"`` shorthand). The most recent push wins, mirroring
    the imperative override tier; :func:`clear_registry` resets the stack.
    """
    if not key:
        raise ValueError("Default provider key must not be empty.")
    with _lock:
        _default_provider_keys.append(key)


def default_provider() -> str | None:
    """Return the current global fallback provider key, or ``None`` if unset."""
    with _lock:
        return _default_provider_keys[-1] if _default_provider_keys else None


# ---------------------------------------------------------------------------
# Reset helpers (testing)
# ---------------------------------------------------------------------------


def clear_cache() -> None:
    """Clear the entry-point discovery cache.

    Does not touch imperative overrides or axis defaults.
    """
    with _lock:
        _cache.clear()


def clear_registry() -> None:
    """Reset the full registry: discovery cache, overrides, and axis defaults.

    Built-in defaults re-seed lazily on next resolve. Primarily for tests.
    """
    with _lock:
        _cache.clear()
        _overrides.clear()
        _defaults.clear()
        _default_provider_keys.clear()
