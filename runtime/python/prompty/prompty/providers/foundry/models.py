"""Foundry (Azure OpenAI) model discovery — list available models.

Provides :func:`list_models` and :func:`list_models_async` which call
``client.models.list()`` on an Azure OpenAI endpoint and map the results
to :class:`ModelInfo` objects.

Azure's model listing API returns ``max_context_length`` which maps to
``context_window``. Modality information is not available from the API
and is left as empty.
"""

from __future__ import annotations

from typing import Any

from ...model import (
    ApiKeyConnection,
    Connection,
    FoundryConnection,
    ModelInfo,
    ReferenceConnection,
)

__all__ = ["list_models", "list_models_async"]


# ---------------------------------------------------------------------------
# Client construction helpers (mirror foundry executor pattern)
# ---------------------------------------------------------------------------

_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default"


def _build_sync_client(connection: Connection) -> Any:
    """Build a sync AzureOpenAI client from a connection."""
    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        return get_connection(connection.name)

    if isinstance(connection, FoundryConnection):
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider
        from openai import AzureOpenAI

        credential = DefaultAzureCredential()
        token_provider = get_bearer_token_provider(credential, _COGNITIVE_SERVICES_SCOPE)
        kwargs: dict[str, Any] = {"azure_ad_token_provider": token_provider, "api_version": "2024-12-01-preview"}
        if connection.endpoint:
            kwargs["azure_endpoint"] = connection.endpoint
        return AzureOpenAI(**kwargs)

    if isinstance(connection, ApiKeyConnection):
        from openai import AzureOpenAI

        if not connection.api_key:
            raise ValueError("Foundry connection has kind 'key' but no apiKey.")
        kwargs = {"api_key": connection.api_key, "api_version": "2024-12-01-preview"}
        if connection.endpoint:
            kwargs["azure_endpoint"] = connection.endpoint
        return AzureOpenAI(**kwargs)

    kind = getattr(connection, "kind", type(connection).__name__)
    raise ValueError(f"Unsupported connection kind for Foundry models: {kind}")


def _build_async_client(connection: Connection) -> Any:
    """Build an async AsyncAzureOpenAI client from a connection."""
    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        return get_connection(connection.name)

    if isinstance(connection, FoundryConnection):
        from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
        from openai import AsyncAzureOpenAI

        credential = DefaultAzureCredential()
        token_provider = get_bearer_token_provider(credential, _COGNITIVE_SERVICES_SCOPE)
        kwargs: dict[str, Any] = {"azure_ad_token_provider": token_provider, "api_version": "2024-12-01-preview"}
        if connection.endpoint:
            kwargs["azure_endpoint"] = connection.endpoint
        return AsyncAzureOpenAI(**kwargs)

    if isinstance(connection, ApiKeyConnection):
        from openai import AsyncAzureOpenAI

        if not connection.api_key:
            raise ValueError("Foundry connection has kind 'key' but no apiKey.")
        kwargs = {"api_key": connection.api_key, "api_version": "2024-12-01-preview"}
        if connection.endpoint:
            kwargs["azure_endpoint"] = connection.endpoint
        return AsyncAzureOpenAI(**kwargs)

    kind = getattr(connection, "kind", type(connection).__name__)
    raise ValueError(f"Unsupported connection kind for Foundry models: {kind}")


def _map_model(m: Any) -> ModelInfo:
    """Map an Azure OpenAI SDK model object to ModelInfo."""
    context_window = getattr(m, "max_context_length", None)
    return ModelInfo(
        id=m.id,
        owned_by=getattr(m, "owned_by", None),
        context_window=context_window,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_models(connection: Connection) -> list[ModelInfo]:
    """List models available from an Azure OpenAI endpoint.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection``, ``FoundryConnection``, or ``ReferenceConnection``.

    Returns
    -------
    list[ModelInfo]
        Available models with ``context_window`` populated from the API.
    """
    client = _build_sync_client(connection)
    response = client.models.list()
    return [_map_model(m) for m in response]


async def list_models_async(connection: Connection) -> list[ModelInfo]:
    """Async variant of :func:`list_models`.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection``, ``FoundryConnection``, or ``ReferenceConnection``.

    Returns
    -------
    list[ModelInfo]
        Available models with ``context_window`` populated from the API.
    """
    client = _build_async_client(connection)
    response = await client.models.list()
    return [_map_model(m) for m in response]
