"""Anthropic executor — calls Anthropic Messages API.

Maps abstract ``Message`` objects to the Anthropic wire format
and sends them to the API. Only supports ``chat`` apiType
(Anthropic has no embedding or image APIs).

The agent loop (tool-call iteration) is handled by the pipeline,
not the executor.

Registered as ``anthropic`` in ``prompty.executors``.
"""

from __future__ import annotations

from typing import Any

from ...core.connections import get_connection
from ...core.types import (
    AsyncPromptyStream,
    ContentPart,
    ImagePart,
    Message,
    PromptyStream,
    TextPart,
)
from ...model import (
    ApiKeyConnection,
    Prompty,
    ReferenceConnection,
)
from ...tracing.tracer import trace

__all__ = ["AnthropicExecutor"]

DEFAULT_MAX_TOKENS = 4096


# ---------------------------------------------------------------------------
# Wire format mapping
# ---------------------------------------------------------------------------


def _message_to_wire(msg: Message) -> dict[str, Any]:
    """Convert an abstract Message to Anthropic wire format.

    Anthropic always uses array content format: ``[{type: "text", text: "..."}]``.
    """
    wire: dict[str, Any] = {"role": msg.role}

    # Assistant message with raw_content from tool-call pipeline
    raw_content = msg.metadata.get("raw_content")
    if raw_content and msg.role == "assistant":
        wire["content"] = raw_content
        return wire

    # Tool result messages with batched results from pipeline
    tool_results = msg.metadata.get("tool_results")
    if tool_results:
        wire["role"] = "user"
        wire["content"] = [
            {
                "type": "tool_result",
                "tool_use_id": r["tool_use_id"],
                "content": r["result"],
            }
            for r in tool_results
        ]
        return wire

    # Single tool result message (legacy / direct usage)
    tool_use_id = msg.metadata.get("tool_use_id") or msg.metadata.get("tool_call_id")
    if tool_use_id:
        wire["role"] = "user"
        wire["content"] = [
            {
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": msg.to_text_content(),
            }
        ]
        return wire

    # Always use array content format for Anthropic
    wire["content"] = [_part_to_wire(part) for part in msg.parts]

    return wire


def _part_to_wire(part: ContentPart) -> dict[str, Any]:
    """Convert a ContentPart to Anthropic wire format."""
    if isinstance(part, TextPart):
        return {"type": "text", "text": part.value}
    elif isinstance(part, ImagePart):
        # Data URI: data:image/png;base64,...
        if part.source.startswith("data:"):
            header, _, data = part.source.partition(",")
            import re

            match = re.search(r"data:(.*?);", header)
            media_type = match.group(1) if match else "image/png"
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": data,
                },
            }
        # Raw base64 data with media_type set on the part
        if part.media_type:
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": part.media_type,
                    "data": part.source,
                },
            }
        # URL
        return {
            "type": "image",
            "source": {"type": "url", "url": part.source},
        }
    return {"type": "text", "text": str(part)}


def _build_options(agent: Prompty) -> dict[str, Any]:
    """Map ModelOptions to Anthropic API parameters."""
    opts = agent.model.options
    if opts is None:
        return {}

    result: dict[str, Any] = {}

    if opts.temperature is not None:
        result["temperature"] = opts.temperature
    if opts.topP is not None:
        result["top_p"] = opts.topP
    if opts.topK is not None:
        result["top_k"] = opts.topK
    if opts.stopSequences:
        result["stop_sequences"] = opts.stopSequences

    # Pass through additionalProperties
    if opts.additionalProperties:
        for k, v in opts.additionalProperties.items():
            if k not in result and k != "max_tokens":
                result[k] = v

    return result


# Kind → JSON Schema type mapping
_KIND_TO_JSON_TYPE: dict[str, str] = {
    "string": "string",
    "integer": "integer",
    "float": "number",
    "number": "number",
    "boolean": "boolean",
    "array": "array",
    "object": "object",
}


def _property_to_json_schema(prop: Any) -> dict[str, Any]:
    """Convert a Property to JSON Schema format."""
    schema: dict[str, Any] = {
        "type": _KIND_TO_JSON_TYPE.get(getattr(prop, "kind", "string") or "string", "string"),
    }

    if hasattr(prop, "description") and prop.description:
        schema["description"] = prop.description
    if hasattr(prop, "enumValues") and prop.enumValues:
        schema["enum"] = prop.enumValues

    if getattr(prop, "kind", None) == "array":
        items = getattr(prop, "items", None)
        schema["items"] = _property_to_json_schema(items) if items else {"type": "string"}

    if getattr(prop, "kind", None) == "object":
        props = getattr(prop, "properties", None)
        if props:
            nested: dict[str, Any] = {}
            req: list[str] = []
            for p in props:
                name = getattr(p, "name", None)
                if not name:
                    continue
                nested[name] = _property_to_json_schema(p)
                req.append(name)
            schema["properties"] = nested
            schema["required"] = req
        else:
            schema["properties"] = {}
            schema["required"] = []
        schema["additionalProperties"] = False

    return schema


def _schema_to_wire(properties: list[Any]) -> dict[str, Any]:
    """Convert a Property list to JSON Schema object."""
    props: dict[str, Any] = {}
    required: list[str] = []

    for p in properties:
        name = getattr(p, "name", None)
        if not name:
            continue
        schema: dict[str, Any] = {
            "type": _KIND_TO_JSON_TYPE.get(getattr(p, "kind", "string") or "string", "string"),
        }
        if hasattr(p, "description") and p.description:
            schema["description"] = p.description
        if hasattr(p, "enumValues") and p.enumValues:
            schema["enum"] = p.enumValues
        props[name] = schema
        if getattr(p, "required", False):
            required.append(name)

    result: dict[str, Any] = {"type": "object", "properties": props}
    if required:
        result["required"] = required
    return result


def _tools_to_wire(agent: Prompty) -> list[dict[str, Any]]:
    """Convert agent tools to Anthropic format: {name, description, input_schema}."""
    if not agent.tools:
        return []

    result: list[dict[str, Any]] = []
    for tool in agent.tools:
        if getattr(tool, "kind", None) != "function":
            continue

        tool_def: dict[str, Any] = {"name": tool.name}
        if tool.description:
            tool_def["description"] = tool.description

        params = getattr(tool, "parameters", None)
        if params and isinstance(params, list):
            tool_def["input_schema"] = _schema_to_wire(params)
        else:
            tool_def["input_schema"] = {"type": "object", "properties": {}}

        result.append(tool_def)
    return result


def _output_schema_to_wire(agent: Prompty) -> dict[str, Any] | None:
    """Convert outputSchema to Anthropic output_config.format.

    Anthropic format: ``output_config: { format: { type: "json_schema", schema: {...} } }``
    """
    outputs = agent.outputs
    if not outputs:
        return None

    properties: dict[str, Any] = {}
    required: list[str] = []

    for prop in outputs:
        name = getattr(prop, "name", None)
        if not name:
            continue
        properties[name] = _property_to_json_schema(prop)
        required.append(name)

    if not properties:
        return None

    return {
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


def _build_chat_args(agent: Prompty, messages: list[Message]) -> dict[str, Any]:
    """Build Anthropic Messages API arguments."""
    model = agent.model.id or "claude-sonnet-4-5-20250929"

    system_parts: list[str] = []
    conversation: list[dict[str, Any]] = []

    for msg in messages:
        if msg.role == "system":
            system_parts.append(msg.text)
        else:
            conversation.append(_message_to_wire(msg))

    max_tokens = DEFAULT_MAX_TOKENS
    if agent.model.options and agent.model.options.maxOutputTokens is not None:
        max_tokens = agent.model.options.maxOutputTokens

    args: dict[str, Any] = {
        "model": model,
        "messages": conversation,
        "max_tokens": max_tokens,
        **_build_options(agent),
    }

    if system_parts:
        args["system"] = "\n\n".join(system_parts)

    tools = _tools_to_wire(agent)
    if tools:
        args["tools"] = tools

    output_config = _output_schema_to_wire(agent)
    if output_config:
        args["output_config"] = output_config

    return args


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------


class AnthropicExecutor:
    """Executor for Anthropic Messages API.

    Supports:
    - ``apiType: chat`` → ``messages.create()``
    - Streaming when ``additionalProperties.stream`` is set
    - Reference and API key connections

    The agent loop (tool-call iteration) is handled by the pipeline.
    """

    @trace
    def execute(self, agent: Prompty, data: Any) -> Any:
        client = self._resolve_client(agent)
        api_type = agent.model.apiType or "chat"

        if api_type == "chat":
            return self._execute_chat(client, agent, data)
        else:
            raise ValueError(
                f"Unsupported apiType '{api_type}' for Anthropic. Anthropic only supports 'chat' (Messages API)."
            )

    @trace
    async def execute_async(self, agent: Prompty, data: Any) -> Any:
        client = self._resolve_client_async(agent)
        api_type = agent.model.apiType or "chat"

        if api_type == "chat":
            return await self._execute_chat_async(client, agent, data)
        else:
            raise ValueError(
                f"Unsupported apiType '{api_type}' for Anthropic. Anthropic only supports 'chat' (Messages API)."
            )

    def _execute_chat(self, client: Any, agent: Prompty, data: Any) -> Any:
        args = _build_chat_args(agent, data)
        is_streaming = args.pop("stream", False) or (
            agent.model.options
            and agent.model.options.additionalProperties
            and agent.model.options.additionalProperties.get("stream", False)
        )

        if is_streaming:
            args["stream"] = True
            response = client.messages.create(**args)
            return PromptyStream("AnthropicExecutor", response)

        return client.messages.create(**args)

    async def _execute_chat_async(self, client: Any, agent: Prompty, data: Any) -> Any:
        args = _build_chat_args(agent, data)
        is_streaming = args.pop("stream", False) or (
            agent.model.options
            and agent.model.options.additionalProperties
            and agent.model.options.additionalProperties.get("stream", False)
        )

        if is_streaming:
            args["stream"] = True
            response = await client.messages.create(**args)
            return AsyncPromptyStream("AnthropicExecutor", response)

        return await client.messages.create(**args)

    def _resolve_client(self, agent: Prompty) -> Any:
        """Resolve the sync Anthropic client from connection config."""
        from anthropic import Anthropic

        conn = agent.model.connection

        if isinstance(conn, ReferenceConnection):
            return get_connection(conn.name)

        kwargs = self._client_kwargs(agent)
        return Anthropic(**kwargs)

    def _resolve_client_async(self, agent: Prompty) -> Any:
        """Resolve the async Anthropic client from connection config."""
        from anthropic import AsyncAnthropic

        conn = agent.model.connection

        if isinstance(conn, ReferenceConnection):
            return get_connection(conn.name)

        kwargs = self._client_kwargs(agent)
        return AsyncAnthropic(**kwargs)

    def _client_kwargs(self, agent: Prompty) -> dict[str, Any]:
        kwargs: dict[str, Any] = {}
        conn = agent.model.connection

        if isinstance(conn, ApiKeyConnection):
            if conn.apiKey:
                kwargs["api_key"] = conn.apiKey
            if conn.endpoint:
                kwargs["base_url"] = conn.endpoint

        return kwargs
