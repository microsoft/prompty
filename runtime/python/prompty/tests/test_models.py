"""Tests for provider list_models() — OpenAI and Foundry (Azure)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from prompty.model import ApiKeyConnection, ModelInfo
from prompty.providers.foundry.models import (
    _map_model as foundry_map_model,
)
from prompty.providers.foundry.models import (
    list_models as foundry_list_models,
)
from prompty.providers.foundry.models import (
    list_models_async as foundry_list_models_async,
)
from prompty.providers.openai.models import (
    _KNOWN_MODELS,
    _enrich,
    _map_model,
)
from prompty.providers.openai.models import (
    list_models as openai_list_models,
)
from prompty.providers.openai.models import (
    list_models_async as openai_list_models_async,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fake_model(id: str, owned_by: str = "openai", **extra: object) -> SimpleNamespace:
    """Create a fake model object mimicking the OpenAI SDK response."""
    obj = SimpleNamespace(id=id, owned_by=owned_by)
    for k, v in extra.items():
        setattr(obj, k, v)
    return obj


def _make_connection(api_key: str = "sk-test") -> ApiKeyConnection:
    return ApiKeyConnection.load({"kind": "key", "apiKey": api_key})


# ===========================================================================
# OpenAI list_models tests
# ===========================================================================


class TestOpenAIMapModel:
    """Test _map_model produces correct ModelInfo from SDK objects."""

    def test_basic_mapping(self) -> None:
        m = _fake_model("gpt-4o", "openai")
        info = _map_model(m)
        assert isinstance(info, ModelInfo)
        assert info.id == "gpt-4o"
        assert info.owned_by == "openai"

    def test_missing_owned_by(self) -> None:
        m = SimpleNamespace(id="custom-model")
        info = _map_model(m)
        assert info.id == "custom-model"
        assert info.owned_by is None


class TestOpenAIEnrich:
    """Test enrichment from the built-in KNOWN_MODELS table."""

    def test_enriches_known_model(self) -> None:
        info = ModelInfo(id="gpt-4o")
        enriched = _enrich("gpt-4o", info)
        assert enriched.context_window == 128_000
        assert enriched.input_modalities == ["text", "image"]
        assert enriched.output_modalities == ["text"]

    def test_enriches_embedding_model(self) -> None:
        info = ModelInfo(id="text-embedding-3-small")
        enriched = _enrich("text-embedding-3-small", info)
        assert enriched.context_window == 8_191
        assert enriched.input_modalities == ["text"]
        assert enriched.output_modalities == []

    def test_enriches_image_model(self) -> None:
        info = ModelInfo(id="dall-e-3")
        enriched = _enrich("dall-e-3", info)
        assert enriched.context_window is None
        assert enriched.output_modalities == ["image"]

    def test_unknown_model_not_enriched(self) -> None:
        info = ModelInfo(id="ft:gpt-4o:my-org:custom")
        enriched = _enrich("ft:gpt-4o:my-org:custom", info)
        assert enriched.context_window is None
        assert enriched.input_modalities == []
        assert enriched.output_modalities == []

    def test_does_not_overwrite_existing_values(self) -> None:
        info = ModelInfo(id="gpt-4o", context_window=999, input_modalities=["audio"])
        enriched = _enrich("gpt-4o", info)
        assert enriched.context_window == 999
        assert enriched.input_modalities == ["audio"]

    def test_known_models_table_has_expected_entries(self) -> None:
        expected = [
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-turbo",
            "gpt-4",
            "gpt-3.5-turbo",
            "text-embedding-3-small",
            "text-embedding-3-large",
            "dall-e-3",
        ]
        for model_id in expected:
            assert model_id in _KNOWN_MODELS, f"{model_id} missing from KNOWN_MODELS"


class TestOpenAIListModels:
    """Test list_models with mocked OpenAI client."""

    @patch("openai.OpenAI")
    def test_list_models_returns_enriched_results(self, mock_openai_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.models.list.return_value = [
            _fake_model("gpt-4o", "openai"),
            _fake_model("custom-finetune", "user-org"),
        ]

        conn = _make_connection()
        result = openai_list_models(conn)

        assert len(result) == 2
        assert result[0].id == "gpt-4o"
        assert result[0].context_window == 128_000
        assert result[1].id == "custom-finetune"
        assert result[1].context_window is None
        assert result[1].owned_by == "user-org"

    @patch("openai.OpenAI")
    def test_list_models_passes_api_key(self, mock_openai_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.models.list.return_value = []

        conn = _make_connection("sk-mykey")
        openai_list_models(conn)

        mock_openai_cls.assert_called_once_with(api_key="sk-mykey")

    @patch("openai.OpenAI")
    def test_list_models_empty_response(self, mock_openai_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.models.list.return_value = []

        result = openai_list_models(_make_connection())
        assert result == []


class TestOpenAIListModelsAsync:
    """Test list_models_async with mocked AsyncOpenAI client."""

    @pytest.mark.asyncio
    @patch("openai.AsyncOpenAI")
    async def test_list_models_async(self, mock_async_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_async_cls.return_value = mock_client
        mock_client.models.list = AsyncMock(
            return_value=[
                _fake_model("gpt-4o-mini", "openai"),
            ]
        )

        result = await openai_list_models_async(_make_connection())

        assert len(result) == 1
        assert result[0].id == "gpt-4o-mini"
        assert result[0].context_window == 128_000


# ===========================================================================
# Foundry (Azure) list_models tests
# ===========================================================================


class TestFoundryMapModel:
    """Test _map_model produces correct ModelInfo from Azure SDK objects."""

    def test_basic_mapping_with_context_length(self) -> None:
        m = _fake_model("gpt-4o", "azure", max_context_length=128_000)
        info = foundry_map_model(m)
        assert info.id == "gpt-4o"
        assert info.owned_by == "azure"
        assert info.context_window == 128_000

    def test_missing_context_length(self) -> None:
        m = _fake_model("custom-deploy", "azure")
        # Remove max_context_length to simulate missing attr
        if hasattr(m, "max_context_length"):
            delattr(m, "max_context_length")
        info = foundry_map_model(m)
        assert info.context_window is None

    def test_modalities_are_empty(self) -> None:
        m = _fake_model("gpt-4o", "azure", max_context_length=128_000)
        info = foundry_map_model(m)
        assert info.input_modalities == []
        assert info.output_modalities == []


class TestFoundryListModels:
    """Test list_models with mocked AzureOpenAI client."""

    @patch("openai.AzureOpenAI")
    def test_list_models_returns_results(self, mock_azure_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_azure_cls.return_value = mock_client
        mock_client.models.list.return_value = [
            _fake_model("gpt-4o", "azure", max_context_length=128_000),
            _fake_model("text-embedding-ada-002", "azure", max_context_length=8_191),
        ]

        conn = ApiKeyConnection.load({"kind": "key", "apiKey": "az-key", "endpoint": "https://test.openai.azure.com/"})
        result = foundry_list_models(conn)

        assert len(result) == 2
        assert result[0].id == "gpt-4o"
        assert result[0].context_window == 128_000
        assert result[1].id == "text-embedding-ada-002"
        assert result[1].context_window == 8_191

    @patch("openai.AzureOpenAI")
    def test_list_models_empty(self, mock_azure_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_azure_cls.return_value = mock_client
        mock_client.models.list.return_value = []

        conn = ApiKeyConnection.load({"kind": "key", "apiKey": "az-key", "endpoint": "https://test.openai.azure.com/"})
        result = foundry_list_models(conn)
        assert result == []


class TestFoundryListModelsAsync:
    """Test list_models_async with mocked AsyncAzureOpenAI client."""

    @pytest.mark.asyncio
    @patch("openai.AsyncAzureOpenAI")
    async def test_list_models_async(self, mock_async_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_async_cls.return_value = mock_client
        mock_client.models.list = AsyncMock(
            return_value=[
                _fake_model("gpt-4o", "azure", max_context_length=128_000),
            ]
        )

        conn = ApiKeyConnection.load({"kind": "key", "apiKey": "az-key", "endpoint": "https://test.openai.azure.com/"})
        result = await foundry_list_models_async(conn)

        assert len(result) == 1
        assert result[0].id == "gpt-4o"
        assert result[0].context_window == 128_000
