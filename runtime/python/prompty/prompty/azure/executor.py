"""Azure OpenAI executor — calls Azure OpenAI chat completions.

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

from .._version import VERSION
from ..core.types import Message
from ..openai.executor import _build_options, _message_to_wire, _tools_to_wire
from ..tracing.tracer import Tracer, trace

__all__ = ["AzureExecutor"]


class AzureExecutor:
    """Executor for Azure OpenAI.

    Registered as ``azure`` in ``prompty.executors``.
    Uses ``AzureOpenAI`` from the ``openai`` package. Falls back to
    ``DefaultAzureCredential`` when no API key is provided.
    """

    @trace
    def execute(
        self,
        agent: PromptAgent,
        messages: list[Message],
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

        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "AzureOpenAI.chat.completions.create")

            args = self._build_args(agent, messages)
            t("inputs", args)
            response = client.chat.completions.create(**args)
            t("result", response)

        return response

    @trace
    async def execute_async(
        self,
        agent: PromptAgent,
        messages: list[Message],
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

        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "AsyncAzureOpenAI.chat.completions.create")

            args = self._build_args(agent, messages)
            t("inputs", args)
            response = await client.chat.completions.create(**args)
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

    def _build_args(
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

        return args
