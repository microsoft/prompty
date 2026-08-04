"""Tests for provider list_models() — OpenAI and Foundry (Azure).

Enrichment-table-specific behavior (longest-prefix matching, token-boundary rules,
fill-only-missing semantics) is covered by ``tests/test_model_capabilities.py``. This file
focuses on the provider wire-mapping functions and the ``list_models``/``list_models_async``
client-orchestration behavior.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from prompty import clear_connections, register_connection
from prompty.model import ApiKeyConnection, ModelInfo, ReferenceConnection
from prompty.providers.foundry.models import (
    _map_model as foundry_map_model,
)
from prompty.providers.foundry.models import (
    catalog_model_to_model_info,
    deployment_to_model_info,
)
from prompty.providers.foundry.models import (
    list_models as foundry_list_models,
)
from prompty.providers.foundry.models import (
    list_models_async as foundry_list_models_async,
)
from prompty.providers.openai.models import (
    list_models as openai_list_models,
)
from prompty.providers.openai.models import (
    list_models_async as openai_list_models_async,
)
from prompty.providers.openai.models import model_info_from_wire

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


class TestOpenAIModelInfoFromWire:
    """Test model_info_from_wire produces correct, enriched ModelInfo from raw dicts."""

    def test_basic_mapping(self) -> None:
        info = model_info_from_wire({"id": "gpt-4o", "owned_by": "openai"})
        assert isinstance(info, ModelInfo)
        assert info.id == "gpt-4o"
        assert info.owned_by == "openai"

    def test_missing_owned_by(self) -> None:
        info = model_info_from_wire({"id": "custom-model"})
        assert info.id == "custom-model"
        assert info.owned_by is None

    def test_enriches_known_model(self) -> None:
        info = model_info_from_wire({"id": "gpt-4o", "owned_by": "openai"})
        assert info.context_window == 128_000
        assert info.input_modalities == ["text", "image"]
        assert info.output_modalities == ["text"]

    def test_unknown_model_not_enriched(self) -> None:
        info = model_info_from_wire({"id": "ft:gpt-4o:my-org:custom", "owned_by": "user-org"})
        assert info.context_window is None
        assert info.input_modalities is None
        assert info.output_modalities is None

    def test_additional_properties_preserves_raw_payload(self) -> None:
        raw = {"id": "gpt-4o", "owned_by": "openai", "created": 12345}
        info = model_info_from_wire(raw)
        assert info.additional_properties == raw

    def test_rejects_non_rust_scalar_field_types(self) -> None:
        info = model_info_from_wire({"id": 42, "owned_by": ["openai"]})
        assert info.id == ""
        assert info.owned_by is None


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

    def test_modalities_default_to_none_when_not_supplied(self) -> None:
        # Foundry has no dataset entries in spec/data/model_capabilities.json, so
        # enrichment is a guaranteed no-op and unset fields stay None (not the buggy `[]`
        # default the generated ModelInfo constructor would otherwise apply).
        m = _fake_model("gpt-4o", "azure", max_context_length=128_000)
        info = foundry_map_model(m)
        assert info.input_modalities is None
        assert info.output_modalities is None


class TestFoundryCatalogModelToModelInfo:
    """Test catalog_model_to_model_info produces correct ModelInfo from raw catalog dicts."""

    def test_basic_mapping(self) -> None:
        info = catalog_model_to_model_info({"id": "gpt-4", "owned_by": "openai", "maxContextLength": 8192})
        assert info.id == "gpt-4"
        assert info.owned_by == "openai"
        assert info.context_window == 8192

    def test_additional_properties_preserves_raw_payload(self) -> None:
        raw = {"id": "gpt-4", "owned_by": "openai", "maxContextLength": 8192, "status": "succeeded"}
        info = catalog_model_to_model_info(raw)
        assert info.additional_properties == raw

    def test_rejects_non_rust_catalog_field_types(self) -> None:
        info = catalog_model_to_model_info({"id": 42, "owned_by": ["openai"], "maxContextLength": "8192"})
        assert info.id == ""
        assert info.owned_by is None
        assert info.context_window is None


class TestFoundryDeploymentToModelInfo:
    """Test deployment_to_model_info handles both flat and nested-ARM deployment shapes."""

    def test_flat_shape(self) -> None:
        raw = {
            "name": "chat-prod",
            "modelName": "gpt-4o",
            "modelPublisher": "OpenAI",
            "capabilities": {"chatCompletion": "true"},
        }
        info = deployment_to_model_info(raw)
        assert info.id == "chat-prod"
        assert info.display_name == "gpt-4o"
        assert info.owned_by == "OpenAI"

    def test_nested_arm_shape(self) -> None:
        raw = {
            "name": "my-gpt4",
            "properties": {
                "model": {"name": "gpt-4", "publisher": "OpenAI", "maxContextLength": 8192},
                "capabilities": {
                    "supportedInputModalities": ["text"],
                    "supportedOutputModalities": ["text"],
                },
            },
        }
        info = deployment_to_model_info(raw)
        assert info.id == "my-gpt4"
        assert info.display_name == "gpt-4"
        assert info.owned_by == "OpenAI"
        assert info.context_window == 8192
        assert info.input_modalities == ["text"]
        assert info.output_modalities == ["text"]

    def test_matches_rust_coercion_and_fallback_semantics(self) -> None:
        raw = {
            "name": "deployment",
            "modelName": "",
            "modelPublisher": "",
            "maxContextLength": 4096,
            "properties": {
                "model": {"name": "fallback-name", "publisher": "fallback-publisher", "maxContextLength": 2048},
                "capabilities": {
                    "maxContextLength": 8.5,
                    "contextWindow": "not-an-integer",
                    "inputModalities": ["text", 7, None],
                    "outputModalities": [],
                },
            },
        }

        info = deployment_to_model_info(raw)

        assert info.display_name == ""
        assert info.owned_by == ""
        assert info.context_window == 2048
        assert info.input_modalities == ["text"]
        assert info.output_modalities == []

    def test_preserves_zero_context_window(self) -> None:
        info = deployment_to_model_info(
            {
                "name": "deployment",
                "maxContextLength": 4096,
                "capabilities": {"maxContextLength": 0},
            }
        )
        assert info.context_window == 0

    def test_matches_rust_whitespace_and_empty_string_parsing(self) -> None:
        info = deployment_to_model_info(
            {
                "name": "deployment",
                "properties": {
                    "model": {"maxContextLength": 2048},
                    "capabilities": {
                        "maxContextLength": " 8192 ",
                        "inputModalities": "",
                        "input_modalities": ["text"],
                    },
                },
            }
        )
        assert info.context_window == 2048
        assert info.input_modalities == []


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

    @patch("urllib.request.urlopen")
    def test_list_models_foundry_reference_returns_deployments_with_capabilities(self, mock_urlopen: MagicMock) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"""
        {
          "value": [
            {
              "name": "chat-prod",
              "properties": {
                "model": {"name": "gpt-4o", "publisher": "Microsoft"},
                "capabilities": {
                  "maxContextLength": 128000,
                  "inputModalities": ["text", "image"],
                  "outputModalities": "text, json"
                }
              }
            }
          ]
        }
        """
        mock_urlopen.return_value = response
        register_connection(
            "foundry-project",
            client={
                "project_endpoint": "https://example.services.ai.azure.com/api/projects/demo/",
                "get_token": lambda: "test-token",
            },
        )

        result = foundry_list_models(ReferenceConnection(name="foundry-project"))

        request = mock_urlopen.call_args.args[0]
        assert request.full_url == "https://example.services.ai.azure.com/api/projects/demo/deployments?api-version=v1"
        assert request.headers["Authorization"] == "Bearer test-token"
        assert len(result) == 1
        assert result[0].id == "chat-prod"
        assert result[0].display_name == "gpt-4o"
        assert result[0].owned_by == "Microsoft"
        assert result[0].context_window == 128_000
        assert result[0].input_modalities == ["text", "image"]
        assert result[0].output_modalities == ["text", "json"]
        assert result[0].additional_properties is not None
        assert result[0].additional_properties["name"] == "chat-prod"
        clear_connections()


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
