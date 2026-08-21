"""Non-vector parser guards for PromptyChatParser.

Behavioral parse conformance (role markers, implicit system role, multi-turn,
developer role, empty/multiline content, quoted/unquoted role attributes,
inline-markdown-image-preserved-as-text, thread-nonce expansion, etc.) is owned
by the ``Parser.parse`` @vector set in
``schema/tsp-output/.typra-generated/vectors.json`` and driven against this
runtime by ``tests/model/test_vector_conformance.py`` via the wired
``Parser.parse`` adapter in ``tests/model/vector_adapters.py`` — so the organic
per-case parsing tests were removed to defer to the vectors.

Only checks the vector format cannot express (or behavior not in the shared
vector set) are retained here:

* case-insensitive role markers — a Python-specific leniency not part of the
  cross-runtime vector contract (kept as a documented runtime extension),
* the ``pre_render`` nonce-injection API contract + nonce-mismatch error,
* the parser/renderer thread-responsibility split (parser emits no ThreadMarker),
* the ReDoS role-boundary performance regression guard (issue #446, timing),
* the sync/async API surface smoke test.
"""

from __future__ import annotations

import time

import pytest

from prompty.core.types import Message
from prompty.model import Agent
from prompty.parsers import PromptyChatParser


def _make_agent(**kwargs) -> Agent:
    data = {"name": "test", "model": "gpt-4"}
    data.update(kwargs)
    return Agent.load(data)


def _text(msg: Message) -> str:
    return msg.text


# ---------------------------------------------------------------------------
# Python-specific role leniency (not part of the shared parse vector contract)
# ---------------------------------------------------------------------------


class TestCaseInsensitiveRoles:
    """Case-insensitive role markers are a Python runtime leniency.

    The shared ``Parser.parse`` vectors only exercise lowercase role markers,
    so this behavior is intentionally not promoted to a cross-runtime vector
    (doing so would force the leniency on runtimes that may treat role markers
    case-sensitively). Retained here as an explicit record of Python behavior.
    """

    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def test_case_insensitive_roles(self):
        rendered = "System:\nHello\n\nUSER:\nWorld"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 2
        assert result[0].role == "system"
        assert result[1].role == "user"


# ---------------------------------------------------------------------------
# Thread markers — parser/renderer responsibility split
# ---------------------------------------------------------------------------


class TestNoThreadInParser:
    """Parser should NOT produce ThreadMarker — thread handling is done
    by the renderer (nonce emission) and prepare() (nonce injection)."""

    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def test_thread_text_is_not_special(self):
        """![thread] in rendered text is just treated as regular content."""
        rendered = "system:\nYou are helpful.\n\n![thread]\n\nuser:\nHello"
        result = self.parser.parse(self.agent, rendered)
        assert all(isinstance(m, Message) for m in result)

    def test_nonce_marker_treated_as_text(self):
        """Nonce markers from renderer are just text to the parser."""
        rendered = "system:\nBefore __PROMPTY_THREAD_abc123_conv__ After\n\nuser:\nHello"
        result = self.parser.parse(self.agent, rendered)
        assert all(isinstance(m, Message) for m in result)
        assert "__PROMPTY_THREAD_" in _text(result[0])


# ---------------------------------------------------------------------------
# Pre-render sanitization (nonce) — internal API contract
# ---------------------------------------------------------------------------


class TestPreRender:
    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def test_pre_render_injects_nonces(self):
        template = "system:\nYou are helpful.\n\nuser:\n{{question}}"
        sanitized, context = self.parser.pre_render(template)
        assert "nonce" in context
        nonce = context["nonce"]
        assert f'nonce="{nonce}"' in sanitized

    def test_pre_render_does_not_alter_nonce_markers(self):
        template = "system:\nHello __PROMPTY_THREAD_abc__\n\nuser:\n{{q}}"
        sanitized, context = self.parser.pre_render(template)
        assert "__PROMPTY_THREAD_" in sanitized

    def test_nonce_roundtrip(self):
        """pre_render → render → parse should succeed."""
        template = "system:\nYou are {{role}}.\n\nuser:\n{{question}}"
        sanitized, context = self.parser.pre_render(template)

        from prompty.renderers import Jinja2Renderer

        renderer = Jinja2Renderer()
        rendered = renderer.render(
            self.agent,
            sanitized,
            {"role": "a helper", "question": "Why?"},
        )

        messages = self.parser.parse(self.agent, rendered, **context)
        assert len(messages) == 2
        assert messages[0].role == "system"
        assert messages[1].role == "user"
        assert "a helper" in _text(messages[0])
        assert "Why?" in _text(messages[1])

    def test_nonce_mismatch_raises(self):
        """Injected role markers with wrong nonce should raise."""
        rendered = 'system[nonce="wrong"]:\nHello'
        with pytest.raises(ValueError, match="Nonce mismatch"):
            self.parser.parse(self.agent, rendered, nonce="correct_nonce")

    def test_no_nonce_skips_validation(self):
        """Without nonce context, validation is skipped."""
        rendered = "system:\nHello"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        assert result[0].role == "system"


# ---------------------------------------------------------------------------
# ReDoS regression (issue #446) — performance, not vector-expressible
# ---------------------------------------------------------------------------


class TestRoleBoundaryReDoS:
    """Parsing must stay roughly linear in input size on adversarial input.

    Unquoted, unterminated attributes used to let the value class overlap
    with the `,` separator and closing `]`, giving the backtracking engine
    an exponential number of equivalent splits to try before failing.
    The assertion is mostly relative (runtime at 40 reps vs. 20 reps) so it
    stays robust on a slow/contended CI runner; the small absolute floor
    only keeps the relative bound from collapsing to noise when `small`
    itself measures near zero on a very fast run — it is not the budget
    being enforced.
    """

    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def _time_adversarial_parse(self, reps: int, samples: int = 20) -> float:
        """Best-of-`samples` timing to smooth out scheduler/CPU jitter."""
        payload = "user[" + "a=b," * reps + "!"
        best = float("inf")
        for _ in range(samples):
            start = time.perf_counter()
            self.parser.parse(self.agent, payload)
            best = min(best, time.perf_counter() - start)
        return best

    def test_doubling_input_does_not_blow_up_runtime(self):
        small = self._time_adversarial_parse(20)
        large = self._time_adversarial_parse(40)
        # Exponential (catastrophic-backtracking) behavior would roughly
        # square the runtime when the repeat count doubles; linear-time
        # matching keeps it within a small constant factor.
        assert large < max(small * 20, 0.1)


# ---------------------------------------------------------------------------
# Async API surface
# ---------------------------------------------------------------------------


class TestAsync:
    @pytest.mark.asyncio
    async def test_async_parse(self):
        parser = PromptyChatParser()
        agent = _make_agent()
        rendered = "system:\nHello\n\nuser:\nWorld"
        result = await parser.parse_async(agent, rendered)
        assert len(result) == 2
        assert result[0].role == "system"
        assert result[1].role == "user"
