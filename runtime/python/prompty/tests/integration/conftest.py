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
_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "")  # optional: proxy via Azure
_OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")  # override default chat model
_OPENAI_EMBEDDING_MODEL = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
_OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "dall-e-2")
_AZURE_KEY = os.environ.get("AZURE_OPENAI_API_KEY", "")
_AZURE_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
_AZURE_CHAT_DEPLOYMENT = os.environ.get("AZURE_OPENAI_CHAT_DEPLOYMENT", "")
_AZURE_EMBEDDING_DEPLOYMENT = os.environ.get("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "")
_AZURE_IMAGE_DEPLOYMENT = os.environ.get("AZURE_OPENAI_IMAGE_DEPLOYMENT", "")
_ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
_DIRECT_OPENAI_KEY = os.environ.get("DIRECT_OPENAI_API_KEY", "")
_DIRECT_OPENAI_MODEL = os.environ.get("DIRECT_OPENAI_MODEL", "gpt-4o-mini")

has_openai = bool(_OPENAI_KEY)
has_azure = bool(_AZURE_KEY and _AZURE_ENDPOINT and _AZURE_CHAT_DEPLOYMENT)
has_foundry = has_azure  # Foundry uses Azure OpenAI credentials
has_anthropic = bool(_ANTHROPIC_KEY)
has_direct_openai = bool(_DIRECT_OPENAI_KEY)

skip_openai = pytest.mark.skipif(not has_openai, reason="OPENAI_API_KEY not set")
skip_openai_image = pytest.mark.skipif(
    not has_openai,
    reason="OPENAI_API_KEY not set",
)
skip_foundry = pytest.mark.skipif(not has_foundry, reason="Azure OpenAI env vars not set")
skip_azure = skip_foundry  # backward-compat alias
skip_foundry_embedding = pytest.mark.skipif(
    not (has_foundry and _AZURE_EMBEDDING_DEPLOYMENT),
    reason="AZURE_OPENAI_EMBEDDING_DEPLOYMENT not set",
)
skip_azure_embedding = skip_foundry_embedding  # backward-compat alias
skip_foundry_image = pytest.mark.skipif(
    not (has_foundry and _AZURE_IMAGE_DEPLOYMENT),
    reason="AZURE_OPENAI_IMAGE_DEPLOYMENT not set",
)
skip_azure_image = skip_foundry_image  # backward-compat alias
skip_anthropic = pytest.mark.skipif(not has_anthropic, reason="ANTHROPIC_API_KEY not set")
skip_direct_openai = pytest.mark.skipif(not has_direct_openai, reason="DIRECT_OPENAI_API_KEY not set")


# ---------------------------------------------------------------------------
# Agent helpers shared across test files
# ---------------------------------------------------------------------------


def make_openai_agent(
    *,
    api_type: str = "chat",
    model: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Prompty for direct OpenAI.

    When ``OPENAI_BASE_URL`` is set, the OpenAI client is pointed at that
    endpoint (e.g. Azure's ``/openai/v1/`` compat path), allowing Azure
    credentials to drive the OpenAI code path.
    """
    from prompty.model import Prompty

    if model is None:
        model = _OPENAI_MODEL

    connection: dict[str, Any] = {
        "kind": "key",
        "apiKey": _OPENAI_KEY,
    }
    if _OPENAI_BASE_URL:
        connection["endpoint"] = _OPENAI_BASE_URL

    data: dict[str, Any] = {
        "name": "integration-test",
        "model": {
            "id": model,
            "provider": "openai",
            "apiType": api_type,
            "connection": connection,
        },
    }
    if options:
        data["model"]["options"] = options
    if tools:
        data["tools"] = tools
    if output_schema:
        data["outputs"] = (
            output_schema.get("properties", output_schema) if isinstance(output_schema, dict) else output_schema
        )
    if metadata is not None:
        data["metadata"] = metadata
    return Prompty.load(data)


def make_direct_openai_agent(
    *,
    api_type: str = "chat",
    model: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Prompty for direct OpenAI (api.openai.com, no proxy).

    Uses ``DIRECT_OPENAI_API_KEY`` — no base URL override.
    """
    from prompty.model import Prompty

    if model is None:
        model = _DIRECT_OPENAI_MODEL

    data: dict[str, Any] = {
        "name": "integration-test-direct-openai",
        "model": {
            "id": model,
            "provider": "openai",
            "apiType": api_type,
            "connection": {
                "kind": "key",
                "apiKey": _DIRECT_OPENAI_KEY,
                # Explicit endpoint overrides any OPENAI_BASE_URL env var
                "endpoint": "https://api.openai.com/v1",
            },
        },
    }
    if options:
        data["model"]["options"] = options
    if tools:
        data["tools"] = tools
    if output_schema:
        data["outputs"] = (
            output_schema.get("properties", output_schema) if isinstance(output_schema, dict) else output_schema
        )
    if metadata is not None:
        data["metadata"] = metadata
    return Prompty.load(data)


def make_foundry_agent(
    *,
    api_type: str = "chat",
    deployment: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Prompty for Azure OpenAI via the Foundry provider."""
    from prompty.model import Prompty

    if deployment is None:
        deployment = _AZURE_CHAT_DEPLOYMENT

    data: dict[str, Any] = {
        "name": "integration-test-foundry",
        "model": {
            "id": deployment,
            "provider": "foundry",
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
        data["outputs"] = (
            output_schema.get("properties", output_schema) if isinstance(output_schema, dict) else output_schema
        )
    if metadata is not None:
        data["metadata"] = metadata
    return Prompty.load(data)


# Backward-compat alias
make_azure_agent = make_foundry_agent


def make_anthropic_agent(
    *,
    api_type: str = "chat",
    model: str = "claude-sonnet-4-5-20250929",
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Prompty for Anthropic Messages API."""
    from prompty.model import Prompty

    data: dict[str, Any] = {
        "name": "integration-test-anthropic",
        "model": {
            "id": model,
            "provider": "anthropic",
            "apiType": api_type,
            "connection": {
                "kind": "key",
                "apiKey": _ANTHROPIC_KEY,
            },
        },
    }
    if options:
        data["model"]["options"] = options
    if tools:
        data["tools"] = tools
    if output_schema:
        data["outputs"] = (
            output_schema.get("properties", output_schema) if isinstance(output_schema, dict) else output_schema
        )
    if metadata is not None:
        data["metadata"] = metadata
    return Prompty.load(data)
