"""Anthropic model discovery — list available models from the Anthropic API.

Provides :func:`list_models` and :func:`list_models_async` which call
``client.models.list()`` and map the results to :class:`ModelInfo` objects.

Anthropic supplies capability fields directly (when present), so enrichment
from the shared ``spec/data/model_capabilities.json`` dataset is applied only
as a fill-only-missing fallback (provider-supplied fields always win).
Mirrors ``runtime/rust/prompty-anthropic/src/models.rs``.
"""

from __future__ import annotations

from typing import Any

from ...core.model_capabilities import enrich
from ...model import ApiKeyConnection, Connection, ModelInfo, ReferenceConnection

__all__ = ["list_models", "list_models_async", "model_info_from_wire"]


# ---------------------------------------------------------------------------
# Wire mapping
# ---------------------------------------------------------------------------


def _string_array(raw: dict[str, Any], key: str) -> list[str] | None:
    value = raw.get(key)
    if not isinstance(value, list):
        return None
    return [item for item in value if isinstance(item, str)]


def model_info_from_wire(raw: dict[str, Any]) -> ModelInfo:
    """Map one raw Anthropic ``/v1/models`` entry into the provider-neutral ``ModelInfo`` contract.

    This is the single source of truth for the Anthropic wire -> ``ModelInfo`` mapping and is
    exercised by the shared ``spec/vectors/discovery`` vectors so every runtime converges on the
    same canonical shape.
    """
    model_id = raw.get("id")
    display_name = raw.get("display_name")
    context_window = raw.get("context_length")
    info = ModelInfo(
        id=model_id if isinstance(model_id, str) else "",
        display_name=display_name if isinstance(display_name, str) else None,
        owned_by="anthropic",
        context_window=context_window
        if isinstance(context_window, int) and not isinstance(context_window, bool)
        else None,
        input_modalities=_string_array(raw, "input_modalities"),
        output_modalities=_string_array(raw, "output_modalities"),
        additional_properties=dict(raw),
    )
    enrich("anthropic", info)
    return info


# ---------------------------------------------------------------------------
# Client construction helpers (mirror executor pattern)
# ---------------------------------------------------------------------------


def _build_client_kwargs(connection: Connection) -> dict[str, Any]:
    """Extract kwargs for ``Anthropic(...)`` from a connection."""
    kwargs: dict[str, Any] = {}
    if isinstance(connection, ApiKeyConnection):
        if connection.api_key:
            kwargs["api_key"] = connection.api_key
        if connection.endpoint:
            kwargs["base_url"] = connection.endpoint
    return kwargs


def _model_to_dict(m: Any) -> dict[str, Any]:
    """Normalize an Anthropic SDK model object (or plain dict/test double) into a raw dict."""
    if isinstance(m, dict):
        return dict(m)
    if hasattr(m, "model_dump"):
        return m.model_dump(mode="json")
    return dict(vars(m))


def _model_items(response: Any) -> list[Any]:
    """Return model objects from Anthropic SDK list responses (auto-paginating iterables)."""
    return list(response)


async def _model_items_async(response: Any) -> list[Any]:
    """Return all model objects from an async auto-paginating SDK response."""
    if hasattr(response, "__aiter__"):
        return [item async for item in response]
    return list(response)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_models(connection: Connection) -> list[ModelInfo]:
    """List models available from the Anthropic API.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection`` or ``ReferenceConnection`` for auth.

    Returns
    -------
    list[ModelInfo]
        Available models, enriched with known metadata where possible.
    """
    from anthropic import Anthropic

    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        client = get_connection(connection.name)
    else:
        client = Anthropic(**_build_client_kwargs(connection))

    response = client.models.list(limit=100)
    return [model_info_from_wire(_model_to_dict(m)) for m in _model_items(response)]


async def list_models_async(connection: Connection) -> list[ModelInfo]:
    """Async variant of :func:`list_models`.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection`` or ``ReferenceConnection`` for auth.

    Returns
    -------
    list[ModelInfo]
        Available models, enriched with known metadata where possible.
    """
    from anthropic import AsyncAnthropic

    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        client = get_connection(connection.name)
    else:
        client = AsyncAnthropic(**_build_client_kwargs(connection))

    response = await client.models.list(limit=100)
    return [model_info_from_wire(_model_to_dict(m)) for m in await _model_items_async(response)]
