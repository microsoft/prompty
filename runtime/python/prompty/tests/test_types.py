"""Verify handwritten runtime extensions for generated conversation types."""

from __future__ import annotations

from prompty.core.types import Message, TextPart


def test_message_text_parts_are_joined_by_newline() -> None:
    """Join multiple text parts according to the canonical method contract."""
    message = Message(role="user", parts=[TextPart(value="first"), TextPart(value="second")])

    assert message.text == "first\nsecond"
    assert message.to_text_content() == "first\nsecond"


def test_empty_message_text_content_is_empty_string() -> None:
    """Represent an empty all-text message as an empty string."""
    message = Message(role="user", parts=[])

    assert message.text == ""
    assert message.to_text_content() == ""
