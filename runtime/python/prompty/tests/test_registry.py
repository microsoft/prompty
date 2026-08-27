"""Tests for the LIFO provider registry (``core/discovery.py``).

Covers the imperative override tier layered over entry-point discovery:
- LIFO override precedence and cache-busting
- ``register_provider`` sugar over the executor/processor axes
- The processor-axis passthrough default
- Wildcard (``"*"``) routing to the axis default
- Preserved error contracts (empty/unknown keys)
"""

from __future__ import annotations

from typing import Any
from unittest import mock

import pytest

from prompty.core.discovery import (
    EXECUTORS,
    PROCESSORS,
    InvokerError,
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
from prompty.providers.passthrough import PassthroughProcessor


@pytest.fixture(autouse=True)
def _clear_registry():
    """Fully reset the registry (cache + overrides + defaults) around each test."""
    clear_registry()
    yield
    clear_registry()


# ---------------------------------------------------------------------------
# Dummy implementations
# ---------------------------------------------------------------------------


class _ExecA:
    pass


class _ExecB:
    pass


class _Proc:
    def process(self, agent: Any, response: Any) -> Any:
        return response

    async def process_async(self, agent: Any, response: Any) -> Any:
        return response


# ---------------------------------------------------------------------------
# Registration + LIFO
# ---------------------------------------------------------------------------


def test_register_executor_class_is_instantiated():
    register_executor("prov", _ExecA)
    assert isinstance(get_executor("prov"), _ExecA)


def test_register_executor_instance_used_directly():
    inst = _ExecA()
    register_executor("prov", inst)
    assert get_executor("prov") is inst


def test_lifo_last_registration_wins():
    register_executor("prov", _ExecA)
    assert isinstance(get_executor("prov"), _ExecA)
    register_executor("prov", _ExecB)
    assert isinstance(get_executor("prov"), _ExecB)


def test_register_empty_key_raises():
    with pytest.raises(ValueError):
        register_executor("", _ExecA)


def test_register_none_impl_raises():
    with pytest.raises(ValueError):
        register_executor("prov", None)


def test_override_shadows_discovery_and_busts_cache():
    """An override must win over a previously discovered entry point."""
    discovered = _ExecA()
    ep = mock.Mock()
    ep.load.return_value = discovered
    with mock.patch("prompty.core.discovery.importlib.metadata.entry_points", return_value=[ep]):
        # Seed the discovery cache.
        assert get_executor("prov") is discovered
        # Register an override; it must shadow the cached discovery result.
        override = _ExecB()
        register_executor("prov", override)
        assert get_executor("prov") is override


# ---------------------------------------------------------------------------
# register_provider sugar
# ---------------------------------------------------------------------------


def test_register_provider_both_axes():
    register_provider("prov", executor=_ExecA, processor=_Proc)
    assert isinstance(get_executor("prov"), _ExecA)
    assert isinstance(get_processor("prov"), _Proc)


def test_register_provider_executor_only_keeps_passthrough():
    register_provider("prov", executor=_ExecA)
    assert isinstance(get_executor("prov"), _ExecA)
    assert isinstance(get_processor("prov"), PassthroughProcessor)


def test_register_processor_override():
    register_processor("prov", _Proc)
    assert isinstance(get_processor("prov"), _Proc)


def test_register_provider_requires_something():
    with pytest.raises(ValueError):
        register_provider("prov")


# ---------------------------------------------------------------------------
# Processor passthrough default
# ---------------------------------------------------------------------------


def test_processor_unknown_key_falls_back_to_passthrough():
    assert isinstance(get_processor("no-such-provider"), PassthroughProcessor)


def test_passthrough_returns_response_unchanged():
    proc = get_processor("no-such-provider")
    sentinel = object()
    assert proc.process(None, sentinel) is sentinel  # type: ignore[arg-type]


def test_register_default_overrides_axis_default():
    register_default(PROCESSORS, _Proc)
    assert isinstance(get_processor("no-such-provider"), _Proc)


# ---------------------------------------------------------------------------
# Wildcard routing
# ---------------------------------------------------------------------------


def test_wildcard_processor_routes_to_default():
    assert isinstance(get_processor("*"), PassthroughProcessor)


def test_wildcard_executor_has_no_default_and_raises():
    with pytest.raises(InvokerError):
        get_executor("*")


def test_explicit_wildcard_override_wins():
    register_executor("*", _ExecA)
    assert isinstance(get_executor("*"), _ExecA)


# ---------------------------------------------------------------------------
# Preserved error contracts
# ---------------------------------------------------------------------------


def test_empty_executor_key_raises():
    with pytest.raises(InvokerError):
        get_executor("")


def test_empty_processor_key_raises():
    with pytest.raises(InvokerError):
        get_processor("")


def test_unknown_executor_raises_no_default():
    with pytest.raises(InvokerError):
        get_executor("nope")


def test_unknown_renderer_raises_no_default():
    with pytest.raises(InvokerError):
        get_renderer("nope")


def test_unknown_parser_raises_no_default():
    with pytest.raises(InvokerError):
        get_parser("nope")


# ---------------------------------------------------------------------------
# Renderer / parser override axes
# ---------------------------------------------------------------------------


def test_register_renderer_override():
    class _Rend:
        def render(self, *a: Any, **k: Any) -> str:
            return ""

    register_renderer("custom-fmt", _Rend)
    assert isinstance(get_renderer("custom-fmt"), _Rend)


def test_register_parser_override():
    class _Parse:
        def parse(self, *a: Any, **k: Any) -> Any:
            return []

    register_parser("custom-parser", _Parse)
    assert isinstance(get_parser("custom-parser"), _Parse)


# ---------------------------------------------------------------------------
# Global default-provider key (provider dimension default)
# ---------------------------------------------------------------------------


def test_default_provider_unset_is_none():
    assert default_provider() is None


def test_register_default_provider_returns_key():
    register_default_provider("openai")
    assert default_provider() == "openai"


def test_register_default_provider_is_lifo():
    register_default_provider("openai")
    register_default_provider("azure")
    assert default_provider() == "azure"


def test_register_default_provider_empty_raises():
    with pytest.raises(ValueError):
        register_default_provider("")


def test_resolve_provider_key_prefers_explicit():
    register_default_provider("openai")
    assert resolve_provider_key("azure", EXECUTORS) == "azure"


def test_resolve_provider_key_falls_back_to_default():
    register_default_provider("openai")
    assert resolve_provider_key(None, EXECUTORS) == "openai"
    assert resolve_provider_key("", PROCESSORS) == "openai"


def test_resolve_provider_key_no_default_raises():
    with pytest.raises(InvokerError):
        resolve_provider_key(None, EXECUTORS)


def test_resolve_provider_key_error_carries_group():
    with pytest.raises(InvokerError) as exc:
        resolve_provider_key("", PROCESSORS)
    assert exc.value.group == PROCESSORS


def test_default_provider_resolves_executor_impl():
    """The default key flows through the per-axis tiers to an implementation."""
    register_executor("openai", _ExecA)
    register_default_provider("openai")
    assert isinstance(get_executor(resolve_provider_key(None, EXECUTORS)), _ExecA)


def test_clear_registry_resets_default_provider():
    register_default_provider("openai")
    assert default_provider() == "openai"
    clear_registry()
    assert default_provider() is None


# ---------------------------------------------------------------------------
# clear_registry isolation
# ---------------------------------------------------------------------------


def test_clear_registry_removes_overrides():
    register_executor("prov", _ExecA)
    assert isinstance(get_executor("prov"), _ExecA)
    clear_registry()
    with pytest.raises(InvokerError):
        get_executor("prov")


def test_clear_registry_resets_axis_default_override():
    register_default(PROCESSORS, _Proc)
    assert isinstance(get_processor("x"), _Proc)
    clear_registry()
    # Built-in default re-seeds lazily.
    assert isinstance(get_processor("x"), PassthroughProcessor)


def test_executors_group_constant():
    assert EXECUTORS == "prompty.executors"
