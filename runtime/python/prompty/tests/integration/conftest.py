"""Shared fixtures and skip logic for integration tests.

Integration tests hit real OpenAI / Azure OpenAI endpoints and
require API keys configured via environment variables (or ``.env``).

Run with::

    pytest tests/integration/ -v

Or via the marker::

    pytest -m integration

Tests are automatically skipped when the required env vars are
missing, so they are safe to include in CI without secrets.
"""

from __future__ import annotations

import os
from typing import Any

import pytest
from dotenv import load_dotenv

# Load .env from the package root (runtime/python/prompty/.env)
load_dotenv()

# ---------------------------------------------------------------------------
# Markers
# ---------------------------------------------------------------------------


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Auto-add the ``integration`` marker to every test in this directory."""
    for item in items:
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------

_OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
_AZURE_KEY = os.environ.get("AZURE_OPENAI_API_KEY", "")
_AZURE_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
_AZURE_CHAT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_CHAT_DEPLOYMENT", "")
_AZURE_EMBEDDING_DEPLOYMENT = os.environ.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "")

has_openai = bool(_OPENAI_KEY)
has_azure = bool(_AZURE_KEY and _AZURE_ENDPOINT and _AZURE_CHAT_DEPLOYMENT)

skip_openai = pytest.mark.skipif(not has_openai, reason="OPENAI_API_KEY not set")
skip_azure = pytest.mark.skipif(not has_azure, reason="Azure OpenAI env vars not set")
skip_azure_embedding = pytest.mark.skipif(
    not (has_azure and _AZURE_EMBEDDING_DEPLOYMENT),
    reason="AZURE_OPENAI_EMBEDDING_DEPLOYMENT not set",
)


# ---------------------------------------------------------------------------
# Agent helpers shared across test files
# ---------------------------------------------------------------------------


def make_openai_agent(
    *,
    api_type: str = "chat",
    model: str = "gpt-4o-mini",
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a PromptAgent for direct OpenAI."""
    from agentschema import AgentDefinition

    data: dict[str, Any] = {
        "kind": "prompt",
        "name": "integration-test",
        "model": {
            "id": model,
            "provider": "openai",
            "apiType": api_type,
            "connection": {
                "kind": "key",
                "apiKey": _OPENAI_KEY,
            },
        },
    }
    if options:
        data["model"]["options"] = options
    if tools:
        data["tools"] = tools
    if output_schema:
        data["outputSchema"] = output_schema
    if metadata is not None:
        data["metadata"] = metadata
    return AgentDefinition.load(data)


def make_azure_agent(
    *,
    api_type: str = "chat",
    deployment: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a PromptAgent for Azure OpenAI."""
    from agentschema import AgentDefinition

    if deployment is None:
        deployment = _AZURE_CHAT_DEPLOYMENT

    data: dict[str, Any] = {
        "kind": "prompt",
        "name": "integration-test-azure",
        "model": {
            "id": deployment,
            "provider": "azure",
            "apiType": api_type,
            "connection": {
                "kind": "key",
                "endpoint": _AZURE_ENDPOINT,
                "apiKey": _AZURE_KEY,
            },
        },
    }
    if options:
        data["model"]["options"] = options
    if tools:
        data["tools"] = tools
    if output_schema:
        data["outputSchema"] = output_schema
    if metadata is not None:
        data["metadata"] = metadata
    return AgentDefinition.load(data)
