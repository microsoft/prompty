"""Shared fixtures for docs example tests.

Provides mock LLM clients so examples can be tested without real API calls.
"""
from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

import pytest

# Directory containing shared .prompty files
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

# Dummy environment variables for ${env:} resolution in .prompty files
MOCK_ENV = {
    "OPENAI_API_KEY": "sk-test-docs-example",
    "AZURE_OPENAI_ENDPOINT": "https://test.openai.azure.com/",
    "AZURE_OPENAI_API_KEY": "test-azure-key",
    "AZURE_OPENAI_CHAT_DEPLOYMENT": "gpt-4o-mini",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-small",
    "ANTHROPIC_API_KEY": "test-anthropic-key",
}


@pytest.fixture(autouse=True)
def mock_env():
    """Inject dummy env vars so .prompty files with ${env:} load cleanly."""
    with mock.patch.dict(os.environ, MOCK_ENV):
        yield


@pytest.fixture
def prompts_dir() -> Path:
    """Path to the shared prompts/ directory."""
    return PROMPTS_DIR


def make_mock_chat_response(content: str = "Hello! I'm an AI assistant."):
    """Create a mock OpenAI ChatCompletion response."""
    response = mock.MagicMock()
    choice = mock.MagicMock()
    choice.finish_reason = "stop"
    message = mock.MagicMock()
    message.role = "assistant"
    message.content = content
    message.tool_calls = None
    choice.message = message
    response.choices = [choice]
    response.model = "gpt-4o-mini"
    response.usage = mock.MagicMock(prompt_tokens=10, completion_tokens=20, total_tokens=30)
    return response


def make_mock_embedding_response(dimensions: int = 1536):
    """Create a mock OpenAI embedding response."""
    response = mock.MagicMock()
    embedding = mock.MagicMock()
    embedding.embedding = [0.001] * dimensions
    embedding.index = 0
    response.data = [embedding]
    response.model = "text-embedding-3-small"
    response.usage = mock.MagicMock(prompt_tokens=5, total_tokens=5)
    return response
