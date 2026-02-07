"""Azure OpenAI executor — calls Azure OpenAI APIs (chat, embedding, image).

Uses ``AzureOpenAI`` from the ``openai`` package. Falls back to
``DefaultAzureCredential`` when no API key is provided.

Registered as ``azure`` in ``prompty.executors``.
"""

from __future__ import annotations

from typing import Any

from agentschema import (
    ApiKeyConnection,
    PromptAgent,
)

from ..._version import VERSION
from ...core.types import AsyncPromptyStream, Message, PromptyStream
from ...tracing.tracer import Tracer, trace
from ..openai.executor import OpenAIExecutor as _OpenAIExecutor
from ..openai.executor import (
    _build_options,
    _message_to_wire,
    _output_schema_to_wire,
    _tools_to_wire,
)

__all__ = ["AzureExecutor"]


class AzureExecutor:
    """Executor for Azure OpenAI.

    Registered as ``azure`` in ``prompty.executors``.
    Uses ``AzureOpenAI`` from the ``openai`` package. Falls back to
    ``DefaultAzureCredential`` when no API key is provided.

    Delegates the agent loop to OpenAI executor's implementation.
    """

    @trace
    def execute(
        self,
        agent: PromptAgent,
        data: Any,
    ) -> Any:
        from openai import AzureOpenAI

        client_kwargs = self._client_kwargs(agent)

        with Tracer.start("AzureOpenAI") as t:
            t("type", "LLM")
            t("signature", "AzureOpenAI.ctor")
            client = AzureOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **client_kwargs,
            )

        api_type = agent.model.apiType or "chat"

        if api_type == "chat":
            return self._execute_chat(client, agent, data)
        elif api_type == "agent":
            return self._execute_agent(client, agent, data)
        elif api_type == "embedding":
            return self._execute_embedding(client, agent, data)
        elif api_type == "image":
            return self._execute_image(client, agent, data)
        else:
            raise ValueError(f"Unsupported apiType: {api_type}")

    @trace
    async def execute_async(
        self,
        agent: PromptAgent,
        data: Any,
    ) -> Any:
        from openai import AsyncAzureOpenAI

        client_kwargs = self._client_kwargs(agent)

        with Tracer.start("AsyncAzureOpenAI") as t:
            t("type", "LLM")
            t("signature", "AsyncAzureOpenAI.ctor")
            client = AsyncAzureOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **client_kwargs,
            )

        api_type = agent.model.apiType or "chat"

        if api_type == "chat":
            return await self._execute_chat_async(client, agent, data)
        elif api_type == "agent":
            return await self._execute_agent_async(client, agent, data)
        elif api_type == "embedding":
            return await self._execute_embedding_async(client, agent, data)
        elif api_type == "image":
            return await self._execute_image_async(client, agent, data)
        else:
            raise ValueError(f"Unsupported apiType: {api_type}")

    # -- Chat ---------------------------------------------------------------

    def _execute_chat(self, client: Any, agent: PromptAgent, messages: Any) -> Any:
        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "AzureOpenAI.chat.completions.create")
            args = self._build_chat_args(agent, messages)
            t("inputs", args)
            response = client.chat.completions.create(**args)
            if args.get("stream", False):
                return PromptyStream("AzureExecutor", response)
            t("result", response)
        return response

    async def _execute_chat_async(
        self, client: Any, agent: PromptAgent, messages: Any
    ) -> Any:
        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "AsyncAzureOpenAI.chat.completions.create")
            args = self._build_chat_args(agent, messages)
            t("inputs", args)
            response = await client.chat.completions.create(**args)
            if args.get("stream", False):
                return AsyncPromptyStream("AzureExecutor", response)
            t("result", response)
        return response

    # -- Agent loop (delegates to OpenAI implementation) --------------------

    def _execute_agent(self, client: Any, agent: PromptAgent, messages: Any) -> Any:
        return _OpenAIExecutor._execute_agent(self, client, agent, messages)  # type: ignore[arg-type]

    async def _execute_agent_async(
        self, client: Any, agent: PromptAgent, messages: Any
    ) -> Any:
        return await _OpenAIExecutor._execute_agent_async(self, client, agent, messages)  # type: ignore[arg-type]

    # -- Embedding ----------------------------------------------------------

    def _execute_embedding(self, client: Any, agent: PromptAgent, data: Any) -> Any:
        with Tracer.start("embeddings.create") as t:
            t("type", "LLM")
            t("signature", "AzureOpenAI.embeddings.create")
            args = self._build_embedding_args(agent, data)
            t("inputs", args)
            response = client.embeddings.create(**args)
            t("result", response)
        return response

    async def _execute_embedding_async(
        self, client: Any, agent: PromptAgent, data: Any
    ) -> Any:
        with Tracer.start("embeddings.create") as t:
            t("type", "LLM")
            t("signature", "AsyncAzureOpenAI.embeddings.create")
            args = self._build_embedding_args(agent, data)
            t("inputs", args)
            response = await client.embeddings.create(**args)
            t("result", response)
        return response

    # -- Image --------------------------------------------------------------

    def _execute_image(self, client: Any, agent: PromptAgent, data: Any) -> Any:
        with Tracer.start("images.generate") as t:
            t("type", "LLM")
            t("signature", "AzureOpenAI.images.generate")
            args = self._build_image_args(agent, data)
            t("inputs", args)
            response = client.images.generate(**args)
            t("result", response)
        return response

    async def _execute_image_async(
        self, client: Any, agent: PromptAgent, data: Any
    ) -> Any:
        with Tracer.start("images.generate") as t:
            t("type", "LLM")
            t("signature", "AsyncAzureOpenAI.images.generate")
            args = self._build_image_args(agent, data)
            t("inputs", args)
            response = await client.images.generate(**args)
            t("result", response)
        return response

    def _client_kwargs(self, agent: PromptAgent) -> dict[str, Any]:
        """Extract Azure client constructor kwargs."""
        kwargs: dict[str, Any] = {}
        conn = agent.model.connection

        if conn and isinstance(conn, ApiKeyConnection):
            if conn.endpoint:
                kwargs["azure_endpoint"] = conn.endpoint
            if conn.apiKey:
                kwargs["api_key"] = conn.apiKey
            else:
                # No API key — use DefaultAzureCredential
                try:
                    import azure.identity

                    default_credential = azure.identity.DefaultAzureCredential(
                        exclude_shared_token_cache_credential=True
                    )
                    kwargs["azure_ad_token_provider"] = (
                        azure.identity.get_bearer_token_provider(
                            default_credential,
                            "https://cognitiveservices.azure.com/.default",
                        )
                    )
                except ImportError:
                    pass  # azure-identity not installed

        # Azure requires api_version
        if "api_version" not in kwargs:
            kwargs.setdefault("api_version", "2024-06-01")

        return kwargs

    def _build_chat_args(
        self, agent: PromptAgent, messages: list[Message]
    ) -> dict[str, Any]:
        """Build arguments for Azure chat.completions.create."""
        deployment = agent.model.id or "gpt-4"
        wire_messages = [_message_to_wire(m) for m in messages]
        args: dict[str, Any] = {
            "model": deployment,
            "messages": wire_messages,
            **_build_options(agent),
        }

        tools = _tools_to_wire(agent)
        if tools:
            args["tools"] = tools

        response_format = _output_schema_to_wire(agent)
        if response_format:
            args["response_format"] = response_format

        return args

    def _build_embedding_args(self, agent: PromptAgent, data: Any) -> dict[str, Any]:
        """Build arguments for Azure embeddings.create."""
        deployment = agent.model.id or "text-embedding-ada-002"
        args: dict[str, Any] = {
            "input": data if isinstance(data, list) else [data],
            "model": deployment,
            **_build_options(agent),
        }
        return args

    def _build_image_args(self, agent: PromptAgent, data: Any) -> dict[str, Any]:
        """Build arguments for Azure images.generate."""
        deployment = agent.model.id or "dall-e-3"
        args: dict[str, Any] = {
            "prompt": data,
            "model": deployment,
            **_build_options(agent),
        }
        return args
