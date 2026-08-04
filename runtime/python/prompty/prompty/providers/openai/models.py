"""OpenAI model discovery — list available models from the OpenAI API.

Provides :func:`list_models` and :func:`list_models_async` which call
``client.models.list()`` and map the results to :class:`ModelInfo` objects.

OpenAI's ``/v1/models`` returns only ``id``/``owned_by``, so capability fields
(context window, modalities) are filled from the shared
``spec/data/model_capabilities.json`` dataset via
:func:`prompty.core.model_capabilities.enrich`. That primitive applies the
cross-runtime fill-only-missing rule: any field OpenAI *did* supply is
preserved. Mirrors ``runtime/rust/prompty-openai/src/models.rs``.
"""

from __future__ import annotations

from typing import Any

from ...core.model_capabilities import enrich
from ...model import ApiKeyConnection, Connection, ModelInfo, ReferenceConnection

__all__ = ["list_models", "list_models_async", "model_info_from_wire"]


# ---------------------------------------------------------------------------
# Wire mapping
# ---------------------------------------------------------------------------


def model_info_from_wire(raw: dict[str, Any]) -> ModelInfo:
    """Map one raw OpenAI ``/v1/models`` entry into the provider-neutral ``ModelInfo`` contract.

    This is the single source of truth for the OpenAI wire -> ``ModelInfo`` mapping and is
    exercised by the shared ``spec/vectors/discovery`` vectors so every runtime converges on the
    same canonical shape. Enrichment from the shared capability dataset is applied here; discovery
    vectors deliberately use ids outside that dataset to assert the pure wire mapping.
    """
    model_id = raw.get("id")
    owned_by = raw.get("owned_by")
    info = ModelInfo(
        id=model_id if isinstance(model_id, str) else "",
        owned_by=owned_by if isinstance(owned_by, str) else None,
        additional_properties=dict(raw),
    )
    enrich("openai", info)
    return info


# ---------------------------------------------------------------------------
# Client construction helpers (mirror executor pattern)
# ---------------------------------------------------------------------------


def _build_client_kwargs(connection: Connection) -> dict[str, Any]:
    """Extract kwargs for ``OpenAI(...)`` from a connection."""
    kwargs: dict[str, Any] = {}
    if isinstance(connection, ApiKeyConnection):
        if connection.api_key:
            kwargs["api_key"] = connection.api_key
        if connection.endpoint:
            kwargs["base_url"] = connection.endpoint
    return kwargs


def _model_to_dict(m: Any) -> dict[str, Any]:
    """Normalize an OpenAI SDK model object (or plain dict/test double) into a raw dict."""
    if isinstance(m, dict):
        return dict(m)
    if hasattr(m, "model_dump"):
        return m.model_dump(mode="json")
    return dict(vars(m))


def _model_items(response: Any) -> list[Any]:
    """Return model objects from OpenAI SDK list responses."""
    data = getattr(response, "data", None)
    if data is not None:
        return list(data)
    return list(response)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_models(connection: Connection) -> list[ModelInfo]:
    """List models available from the OpenAI API.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection`` or ``ReferenceConnection`` for auth.

    Returns
    -------
    list[ModelInfo]
        Available models, enriched with known metadata where possible.
    """
    from openai import OpenAI

    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        client = get_connection(connection.name)
    else:
        client = OpenAI(**_build_client_kwargs(connection))

    response = client.models.list()
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
    from openai import AsyncOpenAI

    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        client = get_connection(connection.name)
    else:
        client = AsyncOpenAI(**_build_client_kwargs(connection))

    response = await client.models.list()
    return [model_info_from_wire(_model_to_dict(m)) for m in _model_items(response)]
