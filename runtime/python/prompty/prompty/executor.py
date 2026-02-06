"""LLM executor — calls OpenAI / Azure OpenAI chat completions.

Maps abstract ``Message`` objects to the provider's wire format
and sends them to the API. Handles both ``openai`` and ``azure``
providers.

Registered as ``openai`` and ``azure`` in ``prompty.executors``.
"""

from __future__ import annotations

from typing import Any

from agentschema import (
    ApiKeyConnection,
    FunctionTool,
    PromptAgent,
)

from ._version import VERSION
from .tracer import Tracer, trace
from .types import (
    AudioPart,
    ContentPart,
    FilePart,
    ImagePart,
    Message,
    TextPart,
)

__all__ = ["OpenAIExecutor", "AzureExecutor"]


# ---------------------------------------------------------------------------
# Wire format mapping
# ---------------------------------------------------------------------------


def _message_to_wire(msg: Message) -> dict[str, Any]:
    """Convert an abstract Message to OpenAI wire format."""
    wire: dict[str, Any] = {"role": msg.role}

    # Include metadata fields (e.g. name)
    for k, v in msg.metadata.items():
        if k not in ("role", "content"):
            wire[k] = v

    content = msg.to_text_content()
    if isinstance(content, str):
        wire["content"] = content
    else:
        # Multimodal content — convert parts to OpenAI format
        wire_parts: list[dict[str, Any]] = []
        for part in msg.parts:
            wire_parts.append(_part_to_wire(part))
        wire["content"] = wire_parts

    return wire


def _part_to_wire(part: ContentPart) -> dict[str, Any]:
    """Convert a ContentPart to OpenAI wire format."""
    if isinstance(part, TextPart):
        return {"type": "text", "text": part.value}
    elif isinstance(part, ImagePart):
        image_url: dict[str, Any] = {"url": part.source}
        if part.detail:
            image_url["detail"] = part.detail
        return {"type": "image_url", "image_url": image_url}
    elif isinstance(part, AudioPart):
        return {
            "type": "input_audio",
            "input_audio": {
                "data": part.source,
                "format": _audio_format(part.media_type),
            },
        }
    elif isinstance(part, FilePart):
        return {
            "type": "file",
            "file": {"url": part.source},
        }
    else:
        return {"type": "text", "text": str(part)}


def _audio_format(media_type: str | None) -> str:
    """Map MIME type to OpenAI audio format string."""
    if media_type:
        if "wav" in media_type:
            return "wav"
        if "mp3" in media_type:
            return "mp3"
    return "wav"


def _tools_to_wire(agent: PromptAgent) -> list[dict[str, Any]] | None:
    """Convert agent tools to OpenAI function tool format."""
    if not agent.tools:
        return None

    wire_tools: list[dict[str, Any]] = []
    for tool in agent.tools:
        if isinstance(tool, FunctionTool):
            func_def: dict[str, Any] = {
                "name": tool.name,
            }
            if tool.description:
                func_def["description"] = tool.description
            if tool.parameters and tool.parameters.properties:
                func_def["parameters"] = _schema_to_wire(tool.parameters)
            wire_tools.append({"type": "function", "function": func_def})

    return wire_tools if wire_tools else None


def _schema_to_wire(schema) -> dict[str, Any]:
    """Convert a PropertySchema to a JSON Schema dict for OpenAI tools."""
    properties: dict[str, Any] = {}
    required: list[str] = []

    for prop in schema.properties:
        prop_schema: dict[str, Any] = {}
        kind_map = {
            "string": "string",
            "integer": "integer",
            "float": "number",
            "number": "number",
            "boolean": "boolean",
            "array": "array",
            "object": "object",
        }
        prop_schema["type"] = kind_map.get(prop.kind, "string")
        if prop.description:
            prop_schema["description"] = prop.description
        if prop.enumValues:
            prop_schema["enum"] = prop.enumValues
        properties[prop.name] = prop_schema

        if prop.required:
            required.append(prop.name)

    result: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        result["required"] = required
    if schema.strict:
        result["strict"] = True
    return result


def _build_options(agent: PromptAgent) -> dict[str, Any]:
    """Extract model options into kwargs for the API call."""
    opts: dict[str, Any] = {}
    if agent.model.options is None:
        return opts

    mo = agent.model.options

    if mo.temperature is not None:
        opts["temperature"] = mo.temperature
    if mo.maxOutputTokens is not None:
        opts["max_tokens"] = mo.maxOutputTokens
    if mo.topP is not None:
        opts["top_p"] = mo.topP
    if mo.frequencyPenalty is not None:
        opts["frequency_penalty"] = mo.frequencyPenalty
    if mo.presencePenalty is not None:
        opts["presence_penalty"] = mo.presencePenalty
    if mo.seed is not None:
        opts["seed"] = mo.seed
    if mo.stopSequences:
        opts["stop"] = mo.stopSequences

    # Pass through additional properties
    if mo.additionalProperties:
        for k, v in mo.additionalProperties.items():
            if k not in opts:
                opts[k] = v

    return opts


# ---------------------------------------------------------------------------
# OpenAI Executor
# ---------------------------------------------------------------------------


class OpenAIExecutor:
    """Executor for the OpenAI API (non-Azure).

    Registered as ``openai`` in ``prompty.executors``.
    """

    @trace
    def execute(
        self,
        agent: PromptAgent,
        messages: list[Message],
    ) -> Any:
        from openai import OpenAI

        client_kwargs = self._client_kwargs(agent)

        with Tracer.start("OpenAI") as t:
            t("type", "LLM")
            t("signature", "OpenAI.ctor")
            client = OpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **client_kwargs,
            )

        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "OpenAI.chat.completions.create")

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
        from openai import AsyncOpenAI

        client_kwargs = self._client_kwargs(agent)

        with Tracer.start("AsyncOpenAI") as t:
            t("type", "LLM")
            t("signature", "AsyncOpenAI.ctor")
            client = AsyncOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **client_kwargs,
            )

        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "AsyncOpenAI.chat.completions.create")

            args = self._build_args(agent, messages)
            t("inputs", args)
            response = await client.chat.completions.create(**args)
            t("result", response)

        return response

    def _client_kwargs(self, agent: PromptAgent) -> dict[str, Any]:
        """Extract client constructor kwargs from the agent connection."""
        kwargs: dict[str, Any] = {}
        conn = agent.model.connection
        if conn and isinstance(conn, ApiKeyConnection):
            if conn.apiKey:
                kwargs["api_key"] = conn.apiKey
            if conn.endpoint:
                kwargs["base_url"] = conn.endpoint
        return kwargs

    def _build_args(self, agent: PromptAgent, messages: list[Message]) -> dict[str, Any]:
        """Build the full arguments dict for chat.completions.create."""
        model = agent.model.id or "gpt-4"
        wire_messages = [_message_to_wire(m) for m in messages]
        args: dict[str, Any] = {
            "model": model,
            "messages": wire_messages,
            **_build_options(agent),
        }

        tools = _tools_to_wire(agent)
        if tools:
            args["tools"] = tools

        return args


# ---------------------------------------------------------------------------
# Azure OpenAI Executor
# ---------------------------------------------------------------------------


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
                    kwargs["azure_ad_token_provider"] = azure.identity.get_bearer_token_provider(
                        default_credential,
                        "https://cognitiveservices.azure.com/.default",
                    )
                except ImportError:
                    pass  # azure-identity not installed

        # Azure requires api_version
        if "api_version" not in kwargs:
            kwargs.setdefault("api_version", "2024-06-01")

        return kwargs

    def _build_args(self, agent: PromptAgent, messages: list[Message]) -> dict[str, Any]:
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
