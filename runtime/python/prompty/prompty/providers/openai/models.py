"""OpenAI model discovery — list available models from the OpenAI API.

Provides :func:`list_models` and :func:`list_models_async` which call
``client.models.list()`` and map the results to :class:`ModelInfo` objects,
enriching sparse API responses with a built-in lookup table of known models.
"""

from __future__ import annotations

from typing import Any

from ...model import ApiKeyConnection, Connection, ModelInfo, ReferenceConnection

__all__ = ["list_models", "list_models_async"]

# ---------------------------------------------------------------------------
# Built-in knowledge of well-known OpenAI models
# ---------------------------------------------------------------------------

_KNOWN_MODELS: dict[str, dict[str, Any]] = {
    "gpt-4o": {
        "context_window": 128_000,
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
    },
    "gpt-4o-mini": {
        "context_window": 128_000,
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
    },
    "gpt-4-turbo": {
        "context_window": 128_000,
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
    },
    "gpt-4": {
        "context_window": 8_192,
        "input_modalities": ["text"],
        "output_modalities": ["text"],
    },
    "gpt-3.5-turbo": {
        "context_window": 16_385,
        "input_modalities": ["text"],
        "output_modalities": ["text"],
    },
    "text-embedding-3-small": {
        "context_window": 8_191,
        "input_modalities": ["text"],
        "output_modalities": [],
    },
    "text-embedding-3-large": {
        "context_window": 8_191,
        "input_modalities": ["text"],
        "output_modalities": [],
    },
    "dall-e-3": {
        "context_window": None,
        "input_modalities": ["text"],
        "output_modalities": ["image"],
    },
}


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


def _enrich(model_id: str, info: ModelInfo) -> ModelInfo:
    """Enrich a ModelInfo with data from the built-in lookup table."""
    known = _KNOWN_MODELS.get(model_id)
    if known is None:
        return info

    if info.context_window is None and known.get("context_window") is not None:
        info.context_window = known["context_window"]
    if not info.input_modalities and known.get("input_modalities"):
        info.input_modalities = known["input_modalities"]
    if not info.output_modalities and known.get("output_modalities"):
        info.output_modalities = known["output_modalities"]

    return info


def _map_model(m: Any) -> ModelInfo:
    """Map an OpenAI SDK model object to ModelInfo."""
    return ModelInfo(
        id=m.id,
        owned_by=getattr(m, "owned_by", None),
    )


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
    return [_enrich(m.id, _map_model(m)) for m in response]


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
    return [_enrich(m.id, _map_model(m)) for m in response]
