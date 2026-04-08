"""Tests for chat_basic.py and chat_pipeline.py examples.

Validates the code examples compile and run with a mocked OpenAI client.
"""
from __future__ import annotations

from pathlib import Path
from unittest import mock

import pytest

from prompty import load, prepare

PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


class TestChatBasicExample:
    """Tests for the basic chat example."""

    def test_load_chat_prompty(self) -> None:
        """The chat-basic.prompty file loads correctly."""
        agent = load(str(PROMPTS_DIR / "chat-basic.prompty"))
        assert agent.name == "openai-chat"
        assert agent.model.id == "gpt-4o-mini"
        assert agent.model.provider == "openai"

    def test_prepare_produces_messages(self) -> None:
        """prepare() with inputs produces a list of messages."""
        agent = load(str(PROMPTS_DIR / "chat-basic.prompty"))
        messages = prepare(agent, inputs={"question": "Hello"})
        assert isinstance(messages, list)
        assert len(messages) >= 2  # system + user at minimum

    def test_invoke_with_mock(self) -> None:
        """invoke() calls OpenAI and returns the response content."""
        from openai.types.chat import ChatCompletion, ChatCompletionMessage
        from openai.types.chat.chat_completion import Choice

        agent = load(str(PROMPTS_DIR / "chat-basic.prompty"))

        mock_response = ChatCompletion(
            id="chatcmpl-test",
            model="gpt-4o-mini",
            object="chat.completion",
            created=0,
            choices=[
                Choice(
                    index=0,
                    finish_reason="stop",
                    message=ChatCompletionMessage(
                        role="assistant",
                        content="Prompty is a prompt asset format.",
                    ),
                )
            ],
            usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},  # type: ignore[arg-type]
        )

        with mock.patch("openai.OpenAI") as MockClient:
            MockClient.return_value.chat.completions.create.return_value = mock_response
            from prompty import invoke
            result = invoke(agent, inputs={"question": "What is Prompty?"})
            assert "Prompty" in result
