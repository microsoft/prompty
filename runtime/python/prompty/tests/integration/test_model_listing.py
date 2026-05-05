"""Integration tests — provider model listing against real endpoints."""

from __future__ import annotations

import pytest

from prompty.model import ApiKeyConnection
from prompty.providers.foundry.models import list_models as foundry_list_models
from prompty.providers.foundry.models import list_models_async as foundry_list_models_async
from prompty.providers.openai.models import list_models as openai_list_models
from prompty.providers.openai.models import list_models_async as openai_list_models_async

from .conftest import (
    _AZURE_ENDPOINT,
    _AZURE_KEY,
    _DIRECT_OPENAI_KEY,
    _OPENAI_BASE_URL,
    _OPENAI_KEY,
    has_direct_openai,
    has_foundry,
    has_openai,
)


def _assert_models(models: list[object]) -> None:
    assert len(models) > 0
    first = models[0]
    assert getattr(first, "id")


def _api_key_connection(api_key: str, endpoint: str = "") -> ApiKeyConnection:
    data = {"kind": "key", "apiKey": api_key}
    if endpoint:
        data["endpoint"] = endpoint
    return ApiKeyConnection.load(data)


@pytest.mark.skipif(not has_openai, reason="OPENAI_API_KEY not set")
class TestOpenAIModelListing:
    def test_list_models(self) -> None:
        connection = _api_key_connection(_OPENAI_KEY, _OPENAI_BASE_URL)
        _assert_models(openai_list_models(connection))

    @pytest.mark.asyncio
    async def test_list_models_async(self) -> None:
        connection = _api_key_connection(_OPENAI_KEY, _OPENAI_BASE_URL)
        _assert_models(await openai_list_models_async(connection))


@pytest.mark.skipif(not has_direct_openai, reason="DIRECT_OPENAI_API_KEY not set")
class TestDirectOpenAIModelListing:
    def test_list_models(self) -> None:
        connection = _api_key_connection(_DIRECT_OPENAI_KEY, "https://api.openai.com/v1")
        _assert_models(openai_list_models(connection))


@pytest.mark.skipif(not has_foundry, reason="Azure OpenAI env vars not set")
class TestFoundryModelListing:
    def test_list_models(self) -> None:
        connection = _api_key_connection(_AZURE_KEY, _AZURE_ENDPOINT)
        _assert_models(foundry_list_models(connection))

    @pytest.mark.asyncio
    async def test_list_models_async(self) -> None:
        connection = _api_key_connection(_AZURE_KEY, _AZURE_ENDPOINT)
        _assert_models(await foundry_list_models_async(connection))
