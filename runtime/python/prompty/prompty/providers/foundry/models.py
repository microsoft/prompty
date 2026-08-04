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

from ...core.model_capabilities import enrich
from ...model import (
    ApiKeyConnection,
    Connection,
    FoundryConnection,
    ModelInfo,
    ReferenceConnection,
)

__all__ = [
    "catalog_model_to_model_info",
    "deployment_to_model_info",
    "list_models",
    "list_models_async",
]


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
    properties = deployment.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    model = properties.get("model")
    model = model if isinstance(model, dict) else {}
    for source in (properties, model, deployment):
        if "capabilities" in source:
            capabilities = source["capabilities"]
            return capabilities if isinstance(capabilities, dict) else {}
    return {}


def _get_number(source: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, str):
            signless = value[1:] if value.startswith(("+", "-")) else value
            if not signless or any(character < "0" or character > "9" for character in signless):
                continue
            try:
                return int(value)
            except ValueError:
                continue
    return None


def _get_string(source: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str):
            return value
    return None


def _get_str_list(source: dict[str, Any], *keys: str) -> list[str] | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, str)]
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
    return None


def _map_deployment(deployment: dict[str, Any]) -> ModelInfo:
    """Map a Foundry deployment object to ModelInfo.

    Handles both the flat ``/deployments?api-version=v1`` data-plane shape and the nested ARM
    management-plane shape. This is the single source of truth for the Foundry deployment wire ->
    ``ModelInfo`` mapping and is exercised by the shared ``spec/vectors/discovery`` vectors.
    """
    properties = deployment.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    model = properties.get("model")
    model = model if isinstance(model, dict) else {}
    capabilities = _extract_capabilities(deployment)
    display_name = _get_string(deployment, "modelName")
    if display_name is None:
        display_name = _get_string(model, "name")
    owned_by = _get_string(deployment, "modelPublisher")
    if owned_by is None:
        owned_by = _get_string(model, "publisher")
    if owned_by is None:
        owned_by = "azure"
    context_window = _get_number(capabilities, "maxContextLength", "contextWindow", "context_length")
    if context_window is None:
        context_window = _get_number(model, "maxContextLength")
    if context_window is None:
        context_window = _get_number(deployment, "maxContextLength")
    info = ModelInfo(
        id=_get_string(deployment, "name") or "",
        display_name=display_name,
        owned_by=owned_by,
        context_window=context_window,
        input_modalities=_get_str_list(capabilities, "inputModalities", "input_modalities", "supportedInputModalities"),
        output_modalities=_get_str_list(
            capabilities, "outputModalities", "output_modalities", "supportedOutputModalities"
        ),
        additional_properties=dict(deployment),
    )
    enrich("foundry", info)
    return info


def deployment_to_model_info(raw: dict[str, Any]) -> ModelInfo:
    """Map one raw Foundry data-plane/ARM deployment object into the provider-neutral ``ModelInfo``.

    Exercised by the shared ``spec/vectors/discovery`` vectors so every runtime converges on the
    same canonical mapping.
    """
    return _map_deployment(raw)


def catalog_model_to_model_info(raw: dict[str, Any]) -> ModelInfo:
    """Map one raw Azure OpenAI model-catalog entry into the provider-neutral ``ModelInfo``.

    Exercised by the shared ``spec/vectors/discovery`` vectors.
    """
    context_window = raw.get("maxContextLength")
    if not isinstance(context_window, int) or isinstance(context_window, bool):
        context_window = None
    info = ModelInfo(
        id=_get_string(raw, "id") or "",
        owned_by=_get_string(raw, "owned_by"),
        context_window=context_window,
        additional_properties=dict(raw),
    )
    enrich("foundry", info)
    return info


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


def _model_to_dict(m: Any) -> dict[str, Any]:
    """Normalize an Azure OpenAI SDK model object (or plain dict/test double) into a raw dict."""
    if isinstance(m, dict):
        return dict(m)
    if hasattr(m, "model_dump"):
        return m.model_dump(mode="json")
    return dict(vars(m))


def _map_model(m: Any) -> ModelInfo:
    """Map an Azure OpenAI SDK model object to ModelInfo.

    The SDK exposes ``max_context_length`` as a Python attribute (unlike the raw wire's
    ``maxContextLength`` used by :func:`catalog_model_to_model_info` / discovery vectors), so this
    reads SDK attributes directly rather than delegating to the raw-dict mapper.
    """
    info = ModelInfo(
        id=m.id,
        owned_by=getattr(m, "owned_by", None),
        context_window=getattr(m, "max_context_length", None),
        additional_properties=_model_to_dict(m),
    )
    enrich("foundry", info)
    return info


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
