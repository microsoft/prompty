"""Reference tests for the live-provider capability guard seam.

These tests pin the Python side of the cross-runtime capability guard contract
shipped in the Typra emitter (>= 1.1.0). They exercise:

* the ``VECTOR_CAPABILITIES`` predicates in ``vector_adapters`` (present/absent),
* a faithful LOCAL REPLICA of the emitter's two-pass guard so the skip/hard-fail
  semantics are verified without waiting for a regenerated harness, and
* the structure-not-content ``_live_chat_normalize`` projection.

The generated harness (``test_vector_conformance.py``) only invokes the guard
once a schema vector declares ``requires`` AND the emitter pin is bumped to
1.1.0. Until then, ``_reference_guard`` below stands in for that emitted logic so
the semantics stay locked and testable.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from _pytest.outcomes import Skipped

# Load the sibling adapter module by path so the test is independent of sys.path
# quirks (tests/model has no __init__.py; the harness itself loads it by path).
_SPEC = importlib.util.spec_from_file_location("vector_adapters_ref", Path(__file__).with_name("vector_adapters.py"))
assert _SPEC is not None and _SPEC.loader is not None
va = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(va)


# ---------------------------------------------------------------------------
# Local replica of the emitted guard (mirrors the Typra >= 1.1.0 contract).
# ---------------------------------------------------------------------------

_UNKNOWN_TOKEN_MESSAGE = (
    'No capability predicate registered for requirement token "{token}". '
    'Register VECTOR_CAPABILITIES["{token}"] in the module referenced by '
    "'vector-adapter-path'. @vector conformance never skips silently."
)


def _reference_guard(requires: list[str], context: dict, capabilities: dict[str, Any]) -> None:
    """Two-pass guard identical in spirit to the emitted harness code.

    Pass 1 (registration): every token must be registered, else HARD failure.
    Pass 2 (availability): first falsy predicate -> ``pytest.skip`` with the
    canonical reason. Both passes walk ``requires`` in author order, never sorted.
    """
    for token in requires:
        if token not in capabilities:
            raise AssertionError(_UNKNOWN_TOKEN_MESSAGE.format(token=token))
    for token in requires:
        if not capabilities[token](context):
            pytest.skip(f"requirement unavailable: {token}")


def _context(**overrides: Any) -> dict:
    base: dict[str, Any] = {
        "contract": "LiveChatConformance",
        "operation": "complete",
        "vector": {},
        "provider": "openai",
        "targetApi": None,
        "doubles": {},
        "baseDir": ".",
        "resolveInput": lambda value: value,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# VECTOR_CAPABILITIES registration
# ---------------------------------------------------------------------------


class TestCapabilitiesTable:
    def test_expected_tokens_registered(self) -> None:
        caps = va.VECTOR_CAPABILITIES
        for token in (
            "provider:openai",
            "provider:anthropic",
            "provider:azure",
            "provider:foundry",
            "entra:foundry-project",
            "var:live-enabled",
        ):
            assert token in caps, f"missing capability token: {token}"
            assert callable(caps[token])

    def test_tokens_follow_grammar(self) -> None:
        import re

        pattern = re.compile(r"^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$")
        for token in va.VECTOR_CAPABILITIES:
            assert pattern.match(token), f"token violates namespace:name grammar: {token}"


# ---------------------------------------------------------------------------
# Individual predicate behavior (absent by default, present when env is set)
# ---------------------------------------------------------------------------


class TestProviderPredicates:
    def test_openai_absent_then_present(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        assert va._cap_provider_openai(_context()) is False
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        assert va._cap_provider_openai(_context()) is True

    def test_anthropic_absent_then_present(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        assert va._cap_provider_anthropic(_context()) is False
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        assert va._cap_provider_anthropic(_context()) is True

    def test_azure_requires_all_three(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("AZURE_OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
        monkeypatch.delenv("AZURE_OPENAI_CHAT_DEPLOYMENT", raising=False)
        assert va._cap_provider_azure(_context()) is False

        monkeypatch.setenv("AZURE_OPENAI_API_KEY", "key")
        assert va._cap_provider_azure(_context()) is False  # endpoint + deployment still missing
        monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://x.openai.azure.com/")
        assert va._cap_provider_azure(_context()) is False  # deployment still missing
        monkeypatch.setenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-4o-mini")
        assert va._cap_provider_azure(_context()) is True

    def test_var_live_enabled_toggle(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("PROMPTY_LIVE_VECTORS", raising=False)
        assert va._cap_var_live_enabled(_context()) is False
        for truthy in ("1", "true", "TRUE", "yes", "on"):
            monkeypatch.setenv("PROMPTY_LIVE_VECTORS", truthy)
            assert va._cap_var_live_enabled(_context()) is True
        for falsy in ("0", "false", "no", "off", ""):
            monkeypatch.setenv("PROMPTY_LIVE_VECTORS", falsy)
            assert va._cap_var_live_enabled(_context()) is False

    def test_entra_probe_false_without_endpoint(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # No endpoint anywhere -> probe short-circuits to False without needing
        # azure-identity or a signed-in identity.
        monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
        assert va._cap_entra_foundry_project(_context(vector={})) is False


# ---------------------------------------------------------------------------
# Guard semantics (via the local replica)
# ---------------------------------------------------------------------------


class TestGuardSemantics:
    def test_unknown_token_hard_fails(self) -> None:
        with pytest.raises(AssertionError) as exc:
            _reference_guard(["bogus:token"], _context(), va.VECTOR_CAPABILITIES)
        message = str(exc.value)
        assert 'No capability predicate registered for requirement token "bogus:token".' in message
        assert "@vector conformance never skips silently." in message

    def test_absent_capability_skips_with_canonical_reason(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(Skipped) as exc:
            _reference_guard(["provider:openai"], _context(), va.VECTOR_CAPABILITIES)
        assert exc.value.msg == "requirement unavailable: provider:openai"

    def test_present_capability_proceeds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        # No skip, no error -> returns None.
        assert _reference_guard(["provider:openai"], _context(), va.VECTOR_CAPABILITIES) is None

    def test_author_order_first_falsy_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Both absent; the FIRST token in author order must be the skip reason.
        monkeypatch.delenv("PROMPTY_LIVE_VECTORS", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(Skipped) as exc:
            _reference_guard(["var:live-enabled", "provider:openai"], _context(), va.VECTOR_CAPABILITIES)
        assert exc.value.msg == "requirement unavailable: var:live-enabled"

    def test_registration_pass_precedes_availability(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # An unknown token AFTER an absent-but-known token must still HARD fail:
        # registration (pass 1) runs fully before availability (pass 2).
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(AssertionError):
            _reference_guard(["provider:openai", "bogus:token"], _context(), va.VECTOR_CAPABILITIES)


# ---------------------------------------------------------------------------
# Structure-not-content normalization
# ---------------------------------------------------------------------------


def _openai_response(role: str = "assistant", content: str = "Hello", finish: str = "stop") -> Any:
    message = MagicMock()
    message.role = role
    message.content = content
    choice = MagicMock()
    choice.message = message
    choice.finish_reason = finish
    response = MagicMock()
    response.choices = [choice]
    return response


class TestLiveChatNormalize:
    def test_openai_shape_reduces_to_structure(self) -> None:
        result = va._live_chat_normalize(_openai_response(), _context())
        assert result == {
            "role": "assistant",
            "contentNonEmpty": True,
            "finishReasonInEnum": True,
        }

    def test_empty_content_flags_false(self) -> None:
        result = va._live_chat_normalize(_openai_response(content="   "), _context())
        assert result["contentNonEmpty"] is False

    def test_finish_reason_outside_enum_flags_false(self) -> None:
        result = va._live_chat_normalize(_openai_response(finish="explode"), _context())
        assert result["finishReasonInEnum"] is False

    @pytest.mark.parametrize(
        "finish",
        ["stop", "length", "tool_calls", "content_filter", "function_call"],
    )
    def test_all_canonical_finish_reasons_pass(self, finish: str) -> None:
        result = va._live_chat_normalize(_openai_response(finish=finish), _context())
        assert result["finishReasonInEnum"] is True

    def test_anthropic_shape_maps_stop_reason(self) -> None:
        block = MagicMock()
        block.text = "Hi there"
        response = MagicMock(spec=["role", "content", "stop_reason"])
        response.role = "assistant"
        response.content = [block]
        response.stop_reason = "end_turn"
        result = va._live_chat_normalize(response, _context())
        assert result == {
            "role": "assistant",
            "contentNonEmpty": True,
            "finishReasonInEnum": True,
        }


# ---------------------------------------------------------------------------
# Live end-to-end (deselected by default; real network call when keys present)
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestLiveChatEndToEnd:
    def test_openai_live_chat_structure(self) -> None:
        import os

        if not os.environ.get("OPENAI_API_KEY"):
            pytest.skip("requirement unavailable: provider:openai")
        resolved = {
            "provider": "openai",
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "apiKey": os.environ["OPENAI_API_KEY"],
            "messages": [{"role": "user", "content": "Say hello in exactly one word."}],
            "options": {"temperature": 0, "maxOutputTokens": 16},
        }
        context = _context(vector={"input": resolved})
        observed = va._live_chat_invoke(resolved, context)
        structure = va._live_chat_normalize(observed, context)
        assert structure["role"] == "assistant"
        assert structure["contentNonEmpty"] is True
        assert structure["finishReasonInEnum"] is True
