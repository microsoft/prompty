"""Tests for PromptyChatParser."""

from __future__ import annotations

import pytest
from agentschema import PromptAgent

from prompty.parsers import PromptyChatParser
from prompty.types import ImagePart, Message, TextPart

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent(**kwargs) -> PromptAgent:
    data = {"kind": "prompt", "name": "test", "model": "gpt-4"}
    data.update(kwargs)
    return PromptAgent.load(data)


def _text(msg: Message) -> str:
    return msg.text


# ---------------------------------------------------------------------------
# Basic parsing
# ---------------------------------------------------------------------------


class TestBasicParsing:
    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def test_single_system_message(self):
        rendered = "system:\nYou are a helpful assistant."
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        assert isinstance(result[0], Message)
        assert result[0].role == "system"
        assert _text(result[0]) == "You are a helpful assistant."

    def test_implicit_system_role(self):
        """Content before any role marker defaults to system."""
        rendered = "You are a helpful assistant."
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        assert result[0].role == "system"
        assert _text(result[0]) == "You are a helpful assistant."

    def test_two_roles(self):
        rendered = "system:\nYou are helpful.\n\nuser:\nWhat is 2+2?"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 2
        assert result[0].role == "system"
        assert result[1].role == "user"
        assert "helpful" in _text(result[0])
        assert "2+2" in _text(result[1])

    def test_three_roles(self):
        rendered = "system:\nHelper\n\nuser:\nHello\n\nassistant:\nHi there!"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 3
        assert [m.role for m in result] == ["system", "user", "assistant"]

    def test_developer_role(self):
        rendered = "developer:\nYou have access to tools."
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        assert result[0].role == "developer"

    def test_case_insensitive_roles(self):
        rendered = "System:\nHello\n\nUSER:\nWorld"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 2
        assert result[0].role == "system"
        assert result[1].role == "user"

    def test_preserves_content_formatting(self):
        rendered = "system:\nLine 1\nLine 2\n\nParagraph 2"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        text = _text(result[0])
        assert "Line 1\nLine 2" in text
        assert "Paragraph 2" in text

    def test_empty_content(self):
        rendered = ""
        result = self.parser.parse(self.agent, rendered)
        # Empty content should still produce a system message (empty)
        assert len(result) == 0 or _text(result[0]) == ""

    def test_multiple_user_messages(self):
        rendered = "user:\nFirst\n\nuser:\nSecond"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 2
        assert all(m.role == "user" for m in result)


# ---------------------------------------------------------------------------
# Thread markers
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
        # All results should be Message objects, no ThreadMarker
        assert all(isinstance(m, Message) for m in result)

    def test_nonce_marker_treated_as_text(self):
        """Nonce markers from renderer are just text to the parser."""
        rendered = "system:\nBefore __PROMPTY_THREAD_abc123_conv__ After\n\nuser:\nHello"
        result = self.parser.parse(self.agent, rendered)
        assert all(isinstance(m, Message) for m in result)
        assert "__PROMPTY_THREAD_" in _text(result[0])


# ---------------------------------------------------------------------------
# Role boundary attributes
# ---------------------------------------------------------------------------


class TestRoleAttributes:
    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def test_name_attribute(self):
        rendered = 'user[name="Alice"]:\nHello!'
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        assert result[0].role == "user"
        assert result[0].metadata.get("name") == "Alice"

    def test_multiple_attributes(self):
        rendered = 'assistant[name="Bot",temperature=0.5]:\nResponse'
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        assert result[0].metadata.get("name") == "Bot"
        assert result[0].metadata.get("temperature") == 0.5


# ---------------------------------------------------------------------------
# Pre-render sanitization (nonce)
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

        # Simulate rendering
        from prompty.renderers import Jinja2Renderer

        renderer = Jinja2Renderer()
        rendered = renderer.render(
            self.agent,
            sanitized,
            {"role": "a helper", "question": "Why?"},
        )

        # Parse with nonce context
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
# Inline images
# ---------------------------------------------------------------------------


class TestInlineImages:
    def setup_method(self):
        self.parser = PromptyChatParser()
        self.agent = _make_agent()

    def test_url_image(self):
        rendered = "user:\n![photo](https://example.com/image.png)"
        result = self.parser.parse(self.agent, rendered)
        assert len(result) == 1
        parts = result[0].parts
        assert any(isinstance(p, ImagePart) for p in parts)
        img = [p for p in parts if isinstance(p, ImagePart)][0]
        assert img.source == "https://example.com/image.png"

    def test_text_and_image_mixed(self):
        rendered = "user:\nLook at this: ![photo](https://example.com/img.png) and this text."
        result = self.parser.parse(self.agent, rendered)
        parts = result[0].parts
        text_parts = [p for p in parts if isinstance(p, TextPart)]
        img_parts = [p for p in parts if isinstance(p, ImagePart)]
        assert len(text_parts) >= 1
        assert len(img_parts) == 1

    def test_data_uri_passthrough(self):
        data_uri = "data:image/png;base64,iVBORw0KGgo="
        rendered = f"user:\n![img]({data_uri})"
        result = self.parser.parse(self.agent, rendered)
        img = [p for p in result[0].parts if isinstance(p, ImagePart)][0]
        assert img.source == data_uri

    def test_no_images_all_text(self):
        rendered = "user:\nJust plain text, no images."
        result = self.parser.parse(self.agent, rendered)
        assert len(result[0].parts) == 1
        assert isinstance(result[0].parts[0], TextPart)


# ---------------------------------------------------------------------------
# Async
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
