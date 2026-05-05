"""Foundry (Azure OpenAI) model discovery — list deployments or models.

Provides :func:`list_models` and :func:`list_models_async` which call
Foundry project deployments or Azure OpenAI model catalog APIs and map the
results to :class:`ModelInfo` objects.

Foundry project endpoints return deployments; Azure OpenAI resource endpoints
return model catalog entries. Deployment payloads are preserved in
``additional_properties`` and capability fields are mapped when present.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from collections.abc import Callable
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
_AI_SCOPE = "https://ai.azure.com/.default"


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


def _is_foundry_deployment_client(client: Any) -> bool:
    """Return True when a registered reference can list Foundry deployments."""
    if isinstance(client, dict):
        return isinstance(client.get("project_endpoint"), str) and callable(client.get("get_token"))
    return isinstance(getattr(client, "project_endpoint", None), str) and callable(getattr(client, "get_token", None))


def _get_project_endpoint(client: Any) -> str:
    if isinstance(client, dict):
        return str(client["project_endpoint"])
    return str(client.project_endpoint)


def _get_token_callback(client: Any) -> Callable[[], str]:
    if isinstance(client, dict):
        return client["get_token"]
    return client.get_token


def _extract_capabilities(deployment: dict[str, Any]) -> dict[str, Any]:
    properties = deployment.get("properties") or {}
    model = properties.get("model") or {}
    return properties.get("capabilities") or model.get("capabilities") or {}


def _get_number(source: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, int | float):
            return int(value)
        if isinstance(value, str) and value.strip():
            try:
                return int(float(value))
            except ValueError:
                continue
    return None


def _get_str_list(source: dict[str, Any], *keys: str) -> list[str]:
    for key in keys:
        value = source.get(key)
        if isinstance(value, list):
            return [str(item) for item in value]
        if isinstance(value, str) and value.strip():
            return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _map_deployment(deployment: dict[str, Any]) -> ModelInfo:
    """Map a Foundry deployment object to ModelInfo."""
    properties = deployment.get("properties") or {}
    model = properties.get("model") or {}
    capabilities = _extract_capabilities(deployment)
    return ModelInfo(
        id=str(deployment.get("name", "")),
        display_name=model.get("name"),
        owned_by=model.get("publisher") or "azure",
        context_window=_get_number(capabilities, "maxContextLength", "contextWindow", "context_length")
        or _get_number(model, "maxContextLength"),
        input_modalities=_get_str_list(capabilities, "inputModalities", "input_modalities", "supportedInputModalities"),
        output_modalities=_get_str_list(
            capabilities, "outputModalities", "output_modalities", "supportedOutputModalities"
        ),
        additional_properties=deployment,
    )


def _list_foundry_deployments(project_endpoint: str, get_token: Callable[[], str]) -> list[ModelInfo]:
    """List deployments from the Foundry project deployments endpoint."""
    endpoint = project_endpoint.rstrip("/")
    token = get_token()
    request = urllib.request.Request(
        f"{endpoint}/deployments?api-version=v1",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:  # noqa: S310 - endpoint is explicit user configuration
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"Failed to list Foundry deployments: {exc.code} {exc.reason} — {detail}") from exc

    data = json.loads(body)
    return [_map_deployment(item) for item in data.get("value", [])]


def _build_foundry_deployment_client(connection: FoundryConnection) -> dict[str, Any]:
    if not connection.endpoint:
        raise ValueError("FoundryConnection requires a non-empty endpoint to list deployments.")
    from azure.identity import DefaultAzureCredential

    credential = DefaultAzureCredential()

    def get_token() -> str:
        token = credential.get_token(_AI_SCOPE)
        if not token or not token.token:
            raise ValueError("DefaultAzureCredential did not return an access token.")
        return token.token

    return {"project_endpoint": connection.endpoint, "get_token": get_token}


def _map_model(m: Any) -> ModelInfo:
    """Map an Azure OpenAI SDK model object to ModelInfo."""
    context_window = getattr(m, "max_context_length", None)
    return ModelInfo(
        id=m.id,
        owned_by=getattr(m, "owned_by", None),
        context_window=context_window,
    )


def _model_items(response: Any) -> list[Any]:
    """Return model objects from Azure OpenAI SDK list responses."""
    data = getattr(response, "data", None)
    if data is not None:
        return list(data)
    return list(response)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_models(connection: Connection) -> list[ModelInfo]:
    """List deployments for Foundry projects or models from Azure OpenAI endpoints.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection``, ``FoundryConnection``, or ``ReferenceConnection``.

    Returns
    -------
    list[ModelInfo]
        Deployments/models with capability fields populated when available.
    """
    if isinstance(connection, FoundryConnection):
        client = _build_foundry_deployment_client(connection)
        return _list_foundry_deployments(_get_project_endpoint(client), _get_token_callback(client))
    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        registered = get_connection(connection.name)
        if _is_foundry_deployment_client(registered):
            return _list_foundry_deployments(_get_project_endpoint(registered), _get_token_callback(registered))

    client = _build_sync_client(connection)
    response = client.models.list()
    return [_map_model(m) for m in _model_items(response)]


async def list_models_async(connection: Connection) -> list[ModelInfo]:
    """Async variant of :func:`list_models`.

    Parameters
    ----------
    connection : Connection
        An ``ApiKeyConnection``, ``FoundryConnection``, or ``ReferenceConnection``.

    Returns
    -------
    list[ModelInfo]
        Deployments/models with capability fields populated when available.
    """
    if isinstance(connection, FoundryConnection):
        client = _build_foundry_deployment_client(connection)
        return await asyncio.to_thread(
            _list_foundry_deployments, _get_project_endpoint(client), _get_token_callback(client)
        )
    if isinstance(connection, ReferenceConnection):
        from ...core.connections import get_connection

        registered = get_connection(connection.name)
        if _is_foundry_deployment_client(registered):
            return await asyncio.to_thread(
                _list_foundry_deployments,
                _get_project_endpoint(registered),
                _get_token_callback(registered),
            )

    client = _build_async_client(connection)
    response = await client.models.list()
    return [_map_model(m) for m in _model_items(response)]
