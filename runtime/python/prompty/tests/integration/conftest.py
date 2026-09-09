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
_FOUNDRY_PROJECT_ENDPOINT = os.environ.get("FOUNDRY_PROJECT_ENDPOINT", "")  # for keyless deployment listing
_ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
_DIRECT_OPENAI_KEY = os.environ.get("DIRECT_OPENAI_API_KEY", "")
_DIRECT_OPENAI_MODEL = os.environ.get("DIRECT_OPENAI_MODEL", "gpt-4o-mini")

has_openai = bool(_OPENAI_KEY)
has_foundry_key = bool(_AZURE_KEY and _AZURE_ENDPOINT and _AZURE_CHAT_DEPLOYMENT)
has_azure = has_foundry_key  # backward-compat alias (key-auth Azure)
has_entra = bool(_AZURE_ENDPOINT and _AZURE_CHAT_DEPLOYMENT)  # Entra ID: endpoint + deployment, no API key needed
# Live Azure is reachable via EITHER key auth or Entra (az login). When no key is
# present, the Foundry vectors run keyless through DefaultAzureCredential so `az
# login` alone drives them.
has_foundry = has_foundry_key or has_entra
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
skip_entra = pytest.mark.skipif(
    not has_entra,
    reason="AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_CHAT_DEPLOYMENT not set (Entra ID tests)",
)

# ---------------------------------------------------------------------------
# Mock-fallback markers
# ---------------------------------------------------------------------------
#
# Value-path tests (chat / embedding / image / streaming / structured / agent)
# always run: with real credentials they hit the live service, without them an
# autouse fixture (below) patches the SDK constructors so the same test bodies
# drive the full executor -> processor pipeline against deterministic mocks.
#
# A ``run_*`` marker therefore never skips in mock mode. It only skips in *live*
# mode when a provider is configured but a specific sub-resource deployment
# (embedding / image) is not, since a real call needs that deployment name.

_never_skip = pytest.mark.skipif(False, reason="")

run_openai = _never_skip
run_openai_image = _never_skip
run_openai_embedding = _never_skip
run_foundry = _never_skip
run_foundry_embedding = pytest.mark.skipif(
    has_foundry and not _AZURE_EMBEDDING_DEPLOYMENT,
    reason="live Azure OpenAI configured but AZURE_OPENAI_EMBEDDING_DEPLOYMENT not set",
)
run_foundry_image = pytest.mark.skipif(
    has_foundry and not _AZURE_IMAGE_DEPLOYMENT,
    reason="live Azure OpenAI configured but AZURE_OPENAI_IMAGE_DEPLOYMENT not set",
)
run_anthropic = _never_skip

# True when a provider will be served by mocks (its credentials are absent).
mock_openai = not has_openai
mock_foundry = not has_foundry
mock_anthropic = not has_anthropic


@pytest.fixture(autouse=True)
def _mock_absent_services(monkeypatch: pytest.MonkeyPatch) -> None:
    """Install deterministic mock SDK clients for any provider lacking credentials.

    Executors import the SDK constructor lazily inside ``_resolve_client`` (e.g.
    ``from openai import OpenAI``), so patching the module attribute here is picked
    up at call time. Providers whose credentials *are* present are left untouched
    and continue to exercise the real service.
    """
    import openai

    from .mock_clients import MockAnthropicClient, MockOpenAIClient

    if mock_openai:
        monkeypatch.setenv("OPENAI_API_KEY", _OPENAI_KEY or "mock-openai-key")
        monkeypatch.setattr(openai, "OpenAI", lambda *a, **k: MockOpenAIClient(is_async=False, b64_images=False))
        monkeypatch.setattr(openai, "AsyncOpenAI", lambda *a, **k: MockOpenAIClient(is_async=True, b64_images=False))
    if mock_foundry:
        monkeypatch.setenv("AZURE_OPENAI_API_KEY", _AZURE_KEY or "mock-azure-key")
        monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", _AZURE_ENDPOINT or "https://mock.local/")
        # Azure image generation returns base64 payloads; the foundry image test
        # decodes them, so its mock must emit b64_json rather than a URL.
        monkeypatch.setattr(openai, "AzureOpenAI", lambda *a, **k: MockOpenAIClient(is_async=False, b64_images=True))
        monkeypatch.setattr(
            openai, "AsyncAzureOpenAI", lambda *a, **k: MockOpenAIClient(is_async=True, b64_images=True)
        )
    if mock_anthropic:
        monkeypatch.setenv("ANTHROPIC_API_KEY", _ANTHROPIC_KEY or "mock-anthropic-key")
        try:
            import anthropic
        except ImportError:
            anthropic = None
        if anthropic is not None:
            monkeypatch.setattr(anthropic, "Anthropic", lambda *a, **k: MockAnthropicClient(is_async=False))
            monkeypatch.setattr(anthropic, "AsyncAnthropic", lambda *a, **k: MockAnthropicClient(is_async=True))


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
    """Build a Agent for direct OpenAI.

    When ``OPENAI_BASE_URL`` is set, the OpenAI client is pointed at that
    endpoint (e.g. Azure's ``/openai/v1/`` compat path), allowing Azure
    credentials to drive the OpenAI code path.
    """
    from prompty.model import Agent

    if model is None:
        model = _OPENAI_MODEL

    connection: dict[str, Any] = {
        "kind": "key",
        "apiKey": _OPENAI_KEY or "mock-openai-key",
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
    return Agent.load(data)


def make_direct_openai_agent(
    *,
    api_type: str = "chat",
    model: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Agent for direct OpenAI (api.openai.com, no proxy).

    Uses ``DIRECT_OPENAI_API_KEY`` — no base URL override.
    """
    from prompty.model import Agent

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
    return Agent.load(data)


def make_foundry_agent(
    *,
    api_type: str = "chat",
    deployment: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Agent for Azure OpenAI via the Foundry provider."""
    from prompty.model import Agent

    if deployment is None:
        deployment = _AZURE_CHAT_DEPLOYMENT

    # Keyless Entra (az login) when no API key is configured; key auth otherwise.
    # With no live Azure creds at all, fall back to a dummy key so the autouse
    # mock fixture (which patches AzureOpenAI) can serve deterministic responses.
    connection: dict[str, Any]
    if _AZURE_KEY:
        connection = {
            "kind": "key",
            "endpoint": _AZURE_ENDPOINT or "https://mock.local/",
            "apiKey": _AZURE_KEY,
        }
    elif has_entra:
        connection = {
            "kind": "foundry",
            "endpoint": _AZURE_ENDPOINT,
        }
    else:
        connection = {
            "kind": "key",
            "endpoint": _AZURE_ENDPOINT or "https://mock.local/",
            "apiKey": "mock-azure-key",
        }

    data: dict[str, Any] = {
        "name": "integration-test-foundry",
        "model": {
            "id": deployment,
            "provider": "foundry",
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
    return Agent.load(data)


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
    """Build a Agent for Anthropic Messages API."""
    from prompty.model import Agent

    data: dict[str, Any] = {
        "name": "integration-test-anthropic",
        "model": {
            "id": model,
            "provider": "anthropic",
            "apiType": api_type,
            "connection": {
                "kind": "key",
                "apiKey": _ANTHROPIC_KEY or "mock-anthropic-key",
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
    return Agent.load(data)


def make_entra_agent(
    *,
    api_type: str = "chat",
    deployment: str | None = None,
    options: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Build a Agent for Azure OpenAI via Entra ID (DefaultAzureCredential).

    Uses ``FoundryConnection`` (``kind: foundry``) with no API key — authenticates
    via ``DefaultAzureCredential`` from ``azure-identity``.
    """
    from prompty.model import Agent

    if deployment is None:
        deployment = _AZURE_CHAT_DEPLOYMENT

    data: dict[str, Any] = {
        "name": "integration-test-entra",
        "model": {
            "id": deployment,
            "provider": "foundry",
            "apiType": api_type,
            "connection": {
                "kind": "foundry",
                "endpoint": _AZURE_ENDPOINT,
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
    return Agent.load(data)
