"""Foundry executor — calls Azure OpenAI APIs (chat, embedding, image).

Uses ``AzureOpenAI`` from the ``openai`` package. Supports two connection modes:

- ``kind: key`` with ``apiKey`` — direct API key authentication.
- ``kind: reference`` with ``name`` — looks up a pre-registered client via
  :func:`prompty.register_connection`.

The old implicit ``DefaultAzureCredential`` fallback has been removed.
Use ``kind: reference`` with an explicitly registered client instead.

Registered as ``foundry`` in ``prompty.executors``.
"""

from __future__ import annotations

from typing import Any

from ..._version import VERSION
from ...core.connections import get_connection
from ...model import (
    ApiKeyConnection,
    Prompty,
    ReferenceConnection,
)
from ...tracing.tracer import Tracer, trace
from ..openai.executor import _BaseExecutor

__all__ = ["FoundryExecutor"]


class FoundryExecutor(_BaseExecutor):
    """Executor for Azure OpenAI via the Foundry provider.

    Registered as ``foundry`` in ``prompty.executors``.

    Connection handling:

    - ``kind: key`` + ``apiKey`` → builds ``AzureOpenAI`` with the API key.
    - ``kind: key`` without ``apiKey`` → raises ``ValueError``.
    - ``kind: reference`` → looks up a pre-registered client by name.
    """

    _trace_prefix = "AzureOpenAI"

    @trace
    def execute(self, agent: Prompty, data: Any) -> Any:
        client = self._resolve_client(agent)
        api_type = agent.model.apiType or "chat"

        if api_type == "chat":
            return self._execute_chat(client, agent, data)
        elif api_type == "embedding":
            return self._execute_embedding(client, agent, data)
        elif api_type == "image":
            return self._execute_image(client, agent, data)
        elif api_type == "responses":
            return self._execute_responses(client, agent, data)
        else:
            raise ValueError(f"Unsupported apiType: {api_type}")

    @trace
    async def execute_async(self, agent: Prompty, data: Any) -> Any:
        client = self._resolve_client_async(agent)
        api_type = agent.model.apiType or "chat"

        if api_type == "chat":
            return await self._execute_chat_async(client, agent, data)
        elif api_type == "embedding":
            return await self._execute_embedding_async(client, agent, data)
        elif api_type == "image":
            return await self._execute_image_async(client, agent, data)
        elif api_type == "responses":
            return await self._execute_responses_async(client, agent, data)
        else:
            raise ValueError(f"Unsupported apiType: {api_type}")

    def _resolve_client(self, agent: Prompty) -> Any:
        """Resolve the sync Azure OpenAI client from connection config."""
        conn = agent.model.connection

        if isinstance(conn, ReferenceConnection):
            return get_connection(conn.name)

        if isinstance(conn, ApiKeyConnection):
            return self._build_client_from_key(conn)

        raise ValueError(f"Foundry executor requires connection kind 'key' or 'reference', got: {type(conn).__name__}")

    def _resolve_client_async(self, agent: Prompty) -> Any:
        """Resolve the async Azure OpenAI client from connection config."""
        conn = agent.model.connection

        if isinstance(conn, ReferenceConnection):
            return get_connection(conn.name)

        if isinstance(conn, ApiKeyConnection):
            return self._build_async_client_from_key(conn)

        raise ValueError(f"Foundry executor requires connection kind 'key' or 'reference', got: {type(conn).__name__}")

    def _build_client_from_key(self, conn: ApiKeyConnection) -> Any:
        """Build a sync AzureOpenAI client from an ApiKeyConnection."""
        from openai import AzureOpenAI

        if not conn.apiKey:
            raise ValueError(
                "Foundry connection has kind 'key' but no apiKey. "
                "Either provide an apiKey (e.g., apiKey: ${env:AZURE_OPENAI_API_KEY}), "
                "or use kind 'reference' with a registered client:\n"
                "  connection:\n"
                "    kind: reference\n"
                "    name: my-foundry\n"
                "Then call: prompty.register_connection('my-foundry', client=AzureOpenAI(...))"
            )

        kwargs: dict[str, Any] = {"api_key": conn.apiKey, "api_version": "2024-12-01-preview"}
        if conn.endpoint:
            kwargs["azure_endpoint"] = conn.endpoint

        with Tracer.start("AzureOpenAI") as t:
            t("type", "LLM")
            t("signature", "AzureOpenAI.ctor")
            client = AzureOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **kwargs,
            )
        return client

    def _build_async_client_from_key(self, conn: ApiKeyConnection) -> Any:
        """Build an async AsyncAzureOpenAI client from an ApiKeyConnection."""
        from openai import AsyncAzureOpenAI

        if not conn.apiKey:
            raise ValueError(
                "Foundry connection has kind 'key' but no apiKey. "
                "Either provide an apiKey (e.g., apiKey: ${env:AZURE_OPENAI_API_KEY}), "
                "or use kind 'reference' with a registered client:\n"
                "  connection:\n"
                "    kind: reference\n"
                "    name: my-foundry\n"
                "Then call: prompty.register_connection('my-foundry', client=AsyncAzureOpenAI(...))"
            )

        kwargs: dict[str, Any] = {"api_key": conn.apiKey, "api_version": "2024-12-01-preview"}
        if conn.endpoint:
            kwargs["azure_endpoint"] = conn.endpoint

        with Tracer.start("AsyncAzureOpenAI") as t:
            t("type", "LLM")
            t("signature", "AsyncAzureOpenAI.ctor")
            client = AsyncAzureOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **kwargs,
            )
        return client
