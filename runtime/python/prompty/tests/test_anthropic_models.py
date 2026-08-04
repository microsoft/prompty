"""Tests for the Anthropic provider's model discovery — list_models()/list_models_async().

Mirrors ``tests/test_models.py``'s OpenAI/Foundry coverage: wire mapping via
``model_info_from_wire`` and client-orchestration via ``list_models``/``list_models_async`` with
a mocked Anthropic SDK client.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from prompty import clear_connections, register_connection
from prompty.model import ApiKeyConnection, ModelInfo, ReferenceConnection
from prompty.providers.anthropic.models import (
    list_models,
    list_models_async,
    model_info_from_wire,
)


def _fake_model(id: str, **extra: object) -> SimpleNamespace:
    """Create a fake model object mimicking the Anthropic SDK's ModelInfo response."""
    obj = SimpleNamespace(id=id, type="model")
    for k, v in extra.items():
        setattr(obj, k, v)
    return obj


def _make_connection(api_key: str = "sk-ant-test") -> ApiKeyConnection:
    return ApiKeyConnection.load({"kind": "key", "apiKey": api_key})


# ===========================================================================
# Wire mapping
# ===========================================================================


class TestModelInfoFromWire:
    def test_full_mapping(self) -> None:
        info = model_info_from_wire(
            {
                "id": "claude-sonnet-4-20250514",
                "display_name": "Claude Sonnet 4",
                "context_length": 200_000,
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"],
                "type": "model",
            }
        )
        assert isinstance(info, ModelInfo)
        assert info.id == "claude-sonnet-4-20250514"
        assert info.display_name == "Claude Sonnet 4"
        assert info.owned_by == "anthropic"
        assert info.context_window == 200_000
        assert info.input_modalities == ["text", "image"]
        assert info.output_modalities == ["text"]

    def test_minimal_mapping_owned_by_is_always_anthropic(self) -> None:
        info = model_info_from_wire({"id": "claude-3-haiku-20240307", "type": "model"})
        assert info.id == "claude-3-haiku-20240307"
        assert info.owned_by == "anthropic"
        assert info.display_name is None
        assert info.context_window is None
        assert info.input_modalities is None
        assert info.output_modalities is None

    def test_additional_properties_preserves_raw_payload(self) -> None:
        raw = {"id": "claude-3-haiku-20240307", "type": "model"}
        info = model_info_from_wire(raw)
        assert info.additional_properties == raw

    def test_no_dataset_entry_leaves_capability_fields_none(self) -> None:
        # spec/data/model_capabilities.json has no "anthropic" provider key today, so enrichment
        # is a guaranteed no-op — this is intentional, not a bug (see enrichment_vectors.json's
        # anthropic_enrich_no_dataset_entry_is_noop vector).
        info = model_info_from_wire({"id": "claude-sonnet-4-20250514"})
        assert info.context_window is None
        assert info.input_modalities is None
        assert info.output_modalities is None

    def test_rejects_non_rust_scalar_field_types(self) -> None:
        info = model_info_from_wire(
            {
                "id": 42,
                "display_name": ["Claude"],
                "context_length": True,
                "input_modalities": ["text", 7],
            }
        )
        assert info.id == ""
        assert info.display_name is None
        assert info.context_window is None
        assert info.input_modalities == ["text"]


# ===========================================================================
# list_models / list_models_async
# ===========================================================================


class TestListModels:
    @patch("anthropic.Anthropic")
    def test_list_models_returns_mapped_results(self, mock_anthropic_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.models.list.return_value = [
            _fake_model("claude-sonnet-4-20250514", display_name="Claude Sonnet 4"),
            _fake_model("claude-3-haiku-20240307"),
        ]

        result = list_models(_make_connection())

        assert len(result) == 2
        assert result[0].id == "claude-sonnet-4-20250514"
        assert result[0].display_name == "Claude Sonnet 4"
        assert result[0].owned_by == "anthropic"
        assert result[1].id == "claude-3-haiku-20240307"
        mock_client.models.list.assert_called_once_with(limit=100)

    @patch("anthropic.Anthropic")
    def test_list_models_passes_api_key(self, mock_anthropic_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.models.list.return_value = []

        list_models(_make_connection("sk-ant-mykey"))

        mock_anthropic_cls.assert_called_once_with(api_key="sk-ant-mykey")

    @patch("anthropic.Anthropic")
    def test_list_models_empty_response(self, mock_anthropic_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.models.list.return_value = []

        result = list_models(_make_connection())
        assert result == []

    @patch("anthropic.Anthropic")
    def test_list_models_reference_connection(self, mock_anthropic_cls: MagicMock) -> None:
        registered_client = MagicMock()
        registered_client.models.list.return_value = [_fake_model("claude-3-haiku-20240307")]
        register_connection("anthropic-conn", client=registered_client)

        result = list_models(ReferenceConnection(name="anthropic-conn"))

        assert len(result) == 1
        assert result[0].id == "claude-3-haiku-20240307"
        mock_anthropic_cls.assert_not_called()
        clear_connections()

    @patch("anthropic.Anthropic")
    def test_list_models_consumes_auto_paginated_response(self, mock_anthropic_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        response = MagicMock()
        response.__iter__.return_value = iter(
            [
                _fake_model("claude-first"),
                _fake_model("claude-second"),
            ]
        )
        mock_client.models.list.return_value = response

        result = list_models(_make_connection())

        assert [model.id for model in result] == ["claude-first", "claude-second"]


class TestListModelsAsync:
    @pytest.mark.asyncio
    @patch("anthropic.AsyncAnthropic")
    async def test_list_models_async(self, mock_async_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_async_cls.return_value = mock_client
        mock_client.models.list = AsyncMock(
            return_value=[
                _fake_model("claude-sonnet-4-20250514"),
            ]
        )

        result = await list_models_async(_make_connection())

        assert len(result) == 1
        assert result[0].id == "claude-sonnet-4-20250514"
        assert result[0].owned_by == "anthropic"
        mock_client.models.list.assert_awaited_once_with(limit=100)

    @pytest.mark.asyncio
    @patch("anthropic.AsyncAnthropic")
    async def test_list_models_async_consumes_auto_paginated_response(self, mock_async_cls: MagicMock) -> None:
        mock_client = MagicMock()
        mock_async_cls.return_value = mock_client

        class AsyncModels:
            def __aiter__(self) -> AsyncModels:
                self._items = iter([_fake_model("claude-first"), _fake_model("claude-second")])
                return self

            async def __anext__(self) -> SimpleNamespace:
                try:
                    return next(self._items)
                except StopIteration:
                    raise StopAsyncIteration from None

        mock_client.models.list = AsyncMock(return_value=AsyncModels())

        result = await list_models_async(_make_connection())

        assert [model.id for model in result] == ["claude-first", "claude-second"]
