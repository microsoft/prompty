"""OpenAI executor — calls OpenAI APIs (chat, embedding, image).

Maps abstract ``Message`` objects to the OpenAI wire format
and sends them to the API. Dispatches on ``agent.model.apiType``.

Registered as ``openai`` in ``prompty.executors``.

Also provides shared wire-format helpers used by the Azure executor.
"""

from __future__ import annotations

from typing import Any

from ..._version import VERSION
from ...core.connections import get_connection
from ...core.types import (
    AsyncPromptyStream,
    AudioPart,
    ContentPart,
    FilePart,
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
from ...tracing.tracer import Tracer, trace

__all__ = ["OpenAIExecutor", "_BaseExecutor"]


# ---------------------------------------------------------------------------
# Wire format mapping (shared with Azure executor)
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
        if "mp3" in media_type or media_type == "audio/mpeg":
            return "mp3"
    return "wav"


def _tools_to_wire(agent: Prompty) -> list[dict[str, Any]] | None:
    """Convert agent tools to OpenAI function tool format."""
    if not agent.tools:
        return None

    wire_tools: list[dict[str, Any]] = []
    for tool in agent.tools:
        if getattr(tool, "kind", None) == "function":
            func_def: dict[str, Any] = {
                "name": tool.name,
            }
            if tool.description:
                func_def["description"] = tool.description
            if hasattr(tool, "parameters") and tool.parameters:
                bound_names = {b.name for b in tool.bindings} if tool.bindings else set()
                params = [p for p in tool.parameters if p.name not in bound_names]
                func_def["parameters"] = _schema_to_wire(params)
            if hasattr(tool, "strict") and tool.strict:
                func_def["strict"] = True
                if "parameters" in func_def:
                    func_def["parameters"]["additionalProperties"] = False
            wire_tools.append({"type": "function", "function": func_def})

    return wire_tools if wire_tools else None


def _schema_to_wire(properties: list) -> dict[str, Any]:
    """Convert a list of Property instances to a JSON Schema dict for OpenAI tools."""
    props_dict: dict[str, Any] = {}
    required: list[str] = []

    for prop in properties:
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
        props_dict[prop.name] = prop_schema

        if prop.required:
            required.append(prop.name)

    result: dict[str, Any] = {"type": "object", "properties": props_dict}
    if required:
        result["required"] = required
    return result


def _property_to_json_schema(prop) -> dict[str, Any]:
    """Convert a Property to a JSON Schema dict for structured output."""
    kind_map = {
        "string": "string",
        "integer": "integer",
        "float": "number",
        "number": "number",
        "boolean": "boolean",
        "array": "array",
        "object": "object",
    }

    schema: dict[str, Any] = {"type": kind_map.get(prop.kind, "string")}

    if prop.description:
        schema["description"] = prop.description
    if prop.enumValues:
        schema["enum"] = prop.enumValues

    # Array items — default to string if unspecified
    if prop.kind == "array":
        if hasattr(prop, "items") and prop.items is not None:
            schema["items"] = _property_to_json_schema(prop.items)
        else:
            schema["items"] = {"type": "string"}

    # Object properties (with strict additionalProperties: False)
    if prop.kind == "object":
        if hasattr(prop, "properties") and prop.properties:
            props: dict[str, Any] = {}
            required: list[str] = []
            for p in prop.properties:
                props[p.name] = _property_to_json_schema(p)
                required.append(p.name)
            schema["properties"] = props
            schema["required"] = required
        else:
            schema["properties"] = {}
            schema["required"] = []
        schema["additionalProperties"] = False

    return schema


def _output_schema_to_wire(agent: Prompty) -> dict[str, Any] | None:
    """Convert ``agent.outputs`` to OpenAI ``response_format``.

    Returns ``None`` when no output schema is defined.  When present,
    produces a ``json_schema`` response format with ``strict: True``
    and ``additionalProperties: False`` at each object level.
    """
    if not agent.outputs:
        return None

    properties: dict[str, Any] = {}
    required: list[str] = []

    for prop in agent.outputs:
        properties[prop.name] = _property_to_json_schema(prop)
        required.append(prop.name)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
        "required": required,
    }

    name = "structured_output"

    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": schema,
        },
    }


def _build_options(agent: Prompty) -> dict[str, Any]:
    """Extract model options into kwargs for the chat completions API call."""
    opts: dict[str, Any] = {}
    if agent.model.options is None:
        return opts

    mo = agent.model.options

    if mo.temperature is not None:
        opts["temperature"] = mo.temperature
    if mo.maxOutputTokens is not None:
        opts["max_completion_tokens"] = mo.maxOutputTokens
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
# Responses API wire format helpers
# ---------------------------------------------------------------------------


def _build_responses_options(agent: Prompty) -> dict[str, Any]:
    """Extract model options for the Responses API (different param names)."""
    opts: dict[str, Any] = {}
    if agent.model.options is None:
        return opts

    mo = agent.model.options

    if mo.temperature is not None:
        opts["temperature"] = mo.temperature
    if mo.maxOutputTokens is not None:
        opts["max_output_tokens"] = mo.maxOutputTokens
    if mo.topP is not None:
        opts["top_p"] = mo.topP

    # Pass through additional properties
    if mo.additionalProperties:
        for k, v in mo.additionalProperties.items():
            if k not in opts:
                opts[k] = v

    return opts


def _responses_tools_to_wire(agent: Prompty) -> list[dict[str, Any]] | None:
    """Convert agent tools to Responses API flat tool format.

    Unlike Chat Completions (``{type: "function", function: {...}}``),
    the Responses API uses a flat structure: ``{type: "function", name: ..., parameters: ...}``.
    """
    if not agent.tools:
        return None

    wire_tools: list[dict[str, Any]] = []
    for tool in agent.tools:
        if getattr(tool, "kind", None) == "function":
            tool_def: dict[str, Any] = {
                "type": "function",
                "name": tool.name,
            }
            if tool.description:
                tool_def["description"] = tool.description
            if hasattr(tool, "parameters") and tool.parameters:
                tool_def["parameters"] = _schema_to_wire(tool.parameters)
            if hasattr(tool, "strict") and tool.strict:
                tool_def["strict"] = True
                if "parameters" in tool_def:
                    tool_def["parameters"]["additionalProperties"] = False
            wire_tools.append(tool_def)

    return wire_tools if wire_tools else None


def _output_schema_to_responses_wire(agent: Prompty) -> dict[str, Any] | None:
    """Convert ``agent.outputs`` to Responses API ``text.format`` config.

    Returns ``None`` when no output schema is defined. The Responses API
    uses ``text: {format: {type: "json_schema", ...}}`` instead of
    Chat Completions' ``response_format``.
    """
    if not agent.outputs:
        return None

    properties: dict[str, Any] = {}
    required: list[str] = []

    for prop in agent.outputs:
        properties[prop.name] = _property_to_json_schema(prop)
        required.append(prop.name)

    name = "structured_output"

    return {
        "format": {
            "type": "json_schema",
            "name": name,
            "strict": True,
            "schema": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


def _message_to_responses_input(msg: Message) -> dict[str, Any]:
    """Convert a Message to Responses API input format.

    Tool result messages are converted to ``function_call_output`` items.
    Pass-through ``responses_function_call`` metadata for the agent loop.
    Other messages become ``EasyInputMessage`` dicts.
    """
    content = msg.to_text_content()

    # Pass-through original function_call items from the agent loop
    if msg.metadata.get("responses_function_call"):
        return msg.metadata["responses_function_call"]

    # Tool result messages → function_call_output
    if msg.metadata.get("tool_call_id"):
        return {
            "type": "function_call_output",
            "call_id": msg.metadata["tool_call_id"],
            "output": content if isinstance(content, str) else str(content),
        }

    role = "user" if msg.role == "tool" else msg.role
    return {"role": role, "content": content}


# ---------------------------------------------------------------------------
# OpenAI Executor
# ---------------------------------------------------------------------------
# Base Executor (shared logic for OpenAI and Azure)
# ---------------------------------------------------------------------------


class _BaseExecutor:
    """Shared implementation for OpenAI-SDK-based executors.

    Subclasses must define ``_trace_prefix`` and ``_client_kwargs()``.
    """

    _trace_prefix: str = "OpenAI"

    # -- Chat ---------------------------------------------------------------

    def _execute_chat(self, client: Any, agent: Prompty, messages: Any) -> Any:
        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", f"{self._trace_prefix}.chat.completions.create")
            args = self._build_chat_args(agent, messages)
            t("inputs", args)
            response = client.chat.completions.create(**args)
            if args.get("stream", False):
                return PromptyStream(f"{self._trace_prefix}Executor", response)
            t("result", response)
        return response

    async def _execute_chat_async(self, client: Any, agent: Prompty, messages: Any) -> Any:
        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", f"Async{self._trace_prefix}.chat.completions.create")
            args = self._build_chat_args(agent, messages)
            t("inputs", args)
            response = await client.chat.completions.create(**args)
            if args.get("stream", False):
                return AsyncPromptyStream(f"{self._trace_prefix}Executor", response)
            t("result", response)
        return response

    # -- Embedding ----------------------------------------------------------

    def _execute_embedding(self, client: Any, agent: Prompty, data: Any) -> Any:
        with Tracer.start("embeddings.create") as t:
            t("type", "LLM")
            t("signature", f"{self._trace_prefix}.embeddings.create")
            args = self._build_embedding_args(agent, data)
            t("inputs", args)
            response = client.embeddings.create(**args)
            t("result", response)
        return response

    async def _execute_embedding_async(self, client: Any, agent: Prompty, data: Any) -> Any:
        with Tracer.start("embeddings.create") as t:
            t("type", "LLM")
            t("signature", f"Async{self._trace_prefix}.embeddings.create")
            args = self._build_embedding_args(agent, data)
            t("inputs", args)
            response = await client.embeddings.create(**args)
            t("result", response)
        return response

    # -- Image --------------------------------------------------------------

    def _execute_image(self, client: Any, agent: Prompty, data: Any) -> Any:
        with Tracer.start("images.generate") as t:
            t("type", "LLM")
            t("signature", f"{self._trace_prefix}.images.generate")
            args = self._build_image_args(agent, data)
            t("inputs", args)
            response = client.images.generate(**args)
            t("result", response)
        return response

    async def _execute_image_async(self, client: Any, agent: Prompty, data: Any) -> Any:
        with Tracer.start("images.generate") as t:
            t("type", "LLM")
            t("signature", f"Async{self._trace_prefix}.images.generate")
            args = self._build_image_args(agent, data)
            t("inputs", args)
            response = await client.images.generate(**args)
            t("result", response)
        return response

    # -- Arg builders -------------------------------------------------------

    def _build_chat_args(self, agent: Prompty, messages: list[Message]) -> dict[str, Any]:
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

        response_format = _output_schema_to_wire(agent)
        if response_format:
            args["response_format"] = response_format

        return args

    def _build_embedding_args(self, agent: Prompty, data: Any) -> dict[str, Any]:
        """Build arguments dict for embeddings.create."""
        model = agent.model.id or "text-embedding-ada-002"
        args: dict[str, Any] = {
            "input": data if isinstance(data, list) else [data],
            "model": model,
        }
        # Only pass through additional properties — standard chat options
        # (temperature, top_p, etc.) are not valid for the embeddings API.
        if agent.model.options and agent.model.options.additionalProperties:
            for k, v in agent.model.options.additionalProperties.items():
                args[k] = v
        return args

    def _build_image_args(self, agent: Prompty, data: Any) -> dict[str, Any]:
        """Build arguments dict for images.generate."""
        model = agent.model.id or "dall-e-3"
        args: dict[str, Any] = {
            "prompt": data,
            "model": model,
        }
        # Only pass through additional properties — standard chat options
        # (temperature, top_p, etc.) are not valid for the images API.
        if agent.model.options and agent.model.options.additionalProperties:
            for k, v in agent.model.options.additionalProperties.items():
                args[k] = v
        return args

    # -- Responses API -------------------------------------------------------

    def _execute_responses(self, client: Any, agent: Prompty, messages: Any) -> Any:
        with Tracer.start("responses.create") as t:
            t("type", "LLM")
            t("signature", f"{self._trace_prefix}.responses.create")
            args = self._build_responses_args(agent, messages)
            t("inputs", args)
            response = client.responses.create(**args)
            if args.get("stream", False):
                return PromptyStream(f"{self._trace_prefix}Executor", response)
            t("result", response)
        return response

    async def _execute_responses_async(self, client: Any, agent: Prompty, messages: Any) -> Any:
        with Tracer.start("responses.create") as t:
            t("type", "LLM")
            t("signature", f"Async{self._trace_prefix}.responses.create")
            args = self._build_responses_args(agent, messages)
            t("inputs", args)
            response = await client.responses.create(**args)
            if args.get("stream", False):
                return AsyncPromptyStream(f"{self._trace_prefix}Executor", response)
            t("result", response)
        return response

    def _build_responses_args(self, agent: Prompty, messages: list[Message]) -> dict[str, Any]:
        """Build the full arguments dict for responses.create.

        Key differences from chat.completions.create:
        - System messages → ``instructions`` parameter
        - Other messages → ``input`` as EasyInputMessage list
        - ``maxOutputTokens`` → ``max_output_tokens``
        - Tools use flat format (not nested ``function:``)
        - Structured output → ``text.format`` (not ``response_format``)
        """
        model = agent.model.id or "gpt-4o"

        system_parts: list[str] = []
        input_messages: list[dict[str, Any]] = []

        for msg in messages:
            if msg.role in ("system", "developer"):
                system_parts.append(msg.text)
            else:
                input_messages.append(_message_to_responses_input(msg))

        args: dict[str, Any] = {
            "model": model,
            "input": input_messages,
        }

        if system_parts:
            args["instructions"] = "\n\n".join(system_parts)

        # Model options (Responses-specific mapping)
        args.update(_build_responses_options(agent))

        # Tools (flat format)
        tools = _responses_tools_to_wire(agent)
        if tools:
            args["tools"] = tools

        # Structured output (text.format)
        text_config = _output_schema_to_responses_wire(agent)
        if text_config:
            args["text"] = text_config

        return args


# ---------------------------------------------------------------------------
# OpenAI Executor
# ---------------------------------------------------------------------------


class OpenAIExecutor(_BaseExecutor):
    """Executor for the OpenAI API (non-Azure).

    Registered as ``openai`` in ``prompty.executors``.

    Supports ``kind: key`` (direct API key) and ``kind: reference``
    (pre-registered client via :func:`prompty.register_connection`).
    """

    _trace_prefix = "OpenAI"

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
        """Resolve the sync OpenAI client from connection config."""
        from openai import OpenAI

        conn = agent.model.connection

        if isinstance(conn, ReferenceConnection):
            return get_connection(conn.name)

        kwargs = self._client_kwargs(agent)
        with Tracer.start("OpenAI") as t:
            t("type", "LLM")
            t("signature", "OpenAI.ctor")
            client = OpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **kwargs,
            )
        return client

    def _resolve_client_async(self, agent: Prompty) -> Any:
        """Resolve the async OpenAI client from connection config."""
        from openai import AsyncOpenAI

        conn = agent.model.connection

        if isinstance(conn, ReferenceConnection):
            return get_connection(conn.name)

        kwargs = self._client_kwargs(agent)
        with Tracer.start("AsyncOpenAI") as t:
            t("type", "LLM")
            t("signature", "AsyncOpenAI.ctor")
            client = AsyncOpenAI(
                default_headers={
                    "User-Agent": f"prompty/{VERSION}",
                    "x-ms-useragent": f"prompty/{VERSION}",
                },
                **kwargs,
            )
        return client

    def _client_kwargs(self, agent: Prompty) -> dict[str, Any]:
        """Extract client constructor kwargs from an ApiKeyConnection."""
        kwargs: dict[str, Any] = {}
        conn = agent.model.connection
        if conn and isinstance(conn, ApiKeyConnection):
            if conn.apiKey:
                kwargs["api_key"] = conn.apiKey
            if conn.endpoint:
                kwargs["base_url"] = conn.endpoint
        return kwargs
