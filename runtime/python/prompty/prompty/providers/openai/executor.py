"""OpenAI executor — calls OpenAI APIs (chat, embedding, image).

Maps abstract ``Message`` objects to the OpenAI wire format
and sends them to the API. Dispatches on ``agent.model.apiType``.

Registered as ``openai`` in ``prompty.executors``.

Also provides shared wire-format helpers used by the Azure executor.
"""

from __future__ import annotations

import inspect
import json
from typing import Any

from agentschema import (
    ApiKeyConnection,
    FunctionTool,
    PromptAgent,
)

from ..._version import VERSION
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
from ...tracing.tracer import Tracer, trace

__all__ = ["OpenAIExecutor"]


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
            if hasattr(tool, "strict") and tool.strict:
                func_def["strict"] = True
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
        result["additionalProperties"] = False
    return result


def _property_to_json_schema(prop) -> dict[str, Any]:
    """Convert an agentschema Property to a JSON Schema dict for structured output."""
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

    # Array items
    if prop.kind == "array" and hasattr(prop, "items") and prop.items is not None:
        schema["items"] = _property_to_json_schema(prop.items)

    # Object properties (with strict additionalProperties: False)
    if prop.kind == "object" and hasattr(prop, "properties") and prop.properties:
        props: dict[str, Any] = {}
        required: list[str] = []
        for p in prop.properties:
            props[p.name] = _property_to_json_schema(p)
            if p.required:
                required.append(p.name)
        schema["properties"] = props
        if required:
            schema["required"] = required
        schema["additionalProperties"] = False

    return schema


def _output_schema_to_wire(agent: PromptAgent) -> dict[str, Any] | None:
    """Convert ``agent.outputSchema`` to OpenAI ``response_format``.

    Returns ``None`` when no output schema is defined.  When present,
    produces a ``json_schema`` response format with ``strict: True``
    and ``additionalProperties: False`` at each object level.
    """
    if not agent.outputSchema or not agent.outputSchema.properties:
        return None

    properties: dict[str, Any] = {}
    required: list[str] = []

    for prop in agent.outputSchema.properties:
        properties[prop.name] = _property_to_json_schema(prop)
        if prop.required:
            required.append(prop.name)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        schema["required"] = required

    name = (agent.name or "response").lower().replace(" ", "_").replace("-", "_")

    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": schema,
        },
    }


def _build_options(agent: PromptAgent) -> dict[str, Any]:
    """Extract model options into kwargs for the API call."""
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
        data: Any,
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
            t("signature", "OpenAI.chat.completions.create")
            args = self._build_chat_args(agent, messages)
            t("inputs", args)
            response = client.chat.completions.create(**args)
            if args.get("stream", False):
                return PromptyStream("OpenAIExecutor", response)
            t("result", response)
        return response

    async def _execute_chat_async(
        self, client: Any, agent: PromptAgent, messages: Any
    ) -> Any:
        with Tracer.start("chat.completions.create") as t:
            t("type", "LLM")
            t("signature", "AsyncOpenAI.chat.completions.create")
            args = self._build_chat_args(agent, messages)
            t("inputs", args)
            response = await client.chat.completions.create(**args)
            if args.get("stream", False):
                return AsyncPromptyStream("OpenAIExecutor", response)
            t("result", response)
        return response

    # -- Agent loop ---------------------------------------------------------

    def _execute_agent(self, client: Any, agent: PromptAgent, messages: Any) -> Any:
        """Execute a chat completion loop with automatic tool-call handling.

        When the LLM returns ``tool_calls``, the registered tool functions from
        ``agent.metadata["tool_functions"]`` are invoked and their results are
        appended to the conversation. The loop repeats until the LLM returns a
        normal response (no tool calls).
        """
        _meta = agent.metadata if agent.metadata is not None else {}
        tool_fns: dict[str, Any] = _meta.get("tool_functions", {})
        wire_messages = [_message_to_wire(m) for m in messages]

        with Tracer.start("AgentLoop") as t:
            t("type", "agent")
            t("signature", "OpenAIExecutor.AgentLoop")

            args = self._build_chat_args(agent, messages)
            t("inputs", args)

            response = client.chat.completions.create(**args)

            while (
                hasattr(response, "choices")
                and response.choices
                and response.choices[0].finish_reason == "tool_calls"
                and response.choices[0].message.tool_calls
            ):
                tool_calls = response.choices[0].message.tool_calls

                # Append assistant message with tool calls
                wire_messages.append(
                    {
                        "role": "assistant",
                        "tool_calls": [tc.model_dump() for tc in tool_calls],
                    }
                )

                for tc in tool_calls:
                    fn_name = tc.function.name
                    fn = tool_fns.get(fn_name)
                    if fn is None:
                        raise ValueError(
                            f"Tool function '{fn_name}' not found in agent.metadata['tool_functions']"
                        )
                    if inspect.iscoroutinefunction(fn):
                        raise ValueError(
                            f"Cannot execute async tool '{fn_name}' in sync mode"
                        )

                    fn_args = json.loads(tc.function.arguments)
                    result = fn(**fn_args)

                    wire_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "name": fn_name,
                            "content": str(result),
                        }
                    )

                # Rebuild args with updated messages
                model = agent.model.id or "gpt-4"
                loop_args: dict[str, Any] = {
                    "model": model,
                    "messages": wire_messages,
                    **_build_options(agent),
                }
                tools = _tools_to_wire(agent)
                if tools:
                    loop_args["tools"] = tools

                response = client.chat.completions.create(**loop_args)

            t("result", response)
        return response

    async def _execute_agent_async(
        self, client: Any, agent: PromptAgent, messages: Any
    ) -> Any:
        """Async variant of the agent loop."""
        _meta = agent.metadata if agent.metadata is not None else {}
        tool_fns: dict[str, Any] = _meta.get("tool_functions", {})
        wire_messages = [_message_to_wire(m) for m in messages]

        with Tracer.start("AgentLoopAsync") as t:
            t("type", "agent")
            t("signature", "OpenAIExecutor.AgentLoopAsync")

            args = self._build_chat_args(agent, messages)
            t("inputs", args)

            response = await client.chat.completions.create(**args)

            while (
                hasattr(response, "choices")
                and response.choices
                and response.choices[0].finish_reason == "tool_calls"
                and response.choices[0].message.tool_calls
            ):
                tool_calls = response.choices[0].message.tool_calls

                wire_messages.append(
                    {
                        "role": "assistant",
                        "tool_calls": [tc.model_dump() for tc in tool_calls],
                    }
                )

                for tc in tool_calls:
                    fn_name = tc.function.name
                    fn = tool_fns.get(fn_name)
                    if fn is None:
                        raise ValueError(
                            f"Tool function '{fn_name}' not found in agent.metadata['tool_functions']"
                        )

                    fn_args = json.loads(tc.function.arguments)
                    if inspect.iscoroutinefunction(fn):
                        result = await fn(**fn_args)
                    else:
                        result = fn(**fn_args)

                    wire_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "name": fn_name,
                            "content": str(result),
                        }
                    )

                model = agent.model.id or "gpt-4"
                loop_args: dict[str, Any] = {
                    "model": model,
                    "messages": wire_messages,
                    **_build_options(agent),
                }
                tools = _tools_to_wire(agent)
                if tools:
                    loop_args["tools"] = tools

                response = await client.chat.completions.create(**loop_args)

            t("result", response)
        return response

    # -- Embedding ----------------------------------------------------------

    def _execute_embedding(self, client: Any, agent: PromptAgent, data: Any) -> Any:
        with Tracer.start("embeddings.create") as t:
            t("type", "LLM")
            t("signature", "OpenAI.embeddings.create")
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
            t("signature", "AsyncOpenAI.embeddings.create")
            args = self._build_embedding_args(agent, data)
            t("inputs", args)
            response = await client.embeddings.create(**args)
            t("result", response)
        return response

    # -- Image --------------------------------------------------------------

    def _execute_image(self, client: Any, agent: PromptAgent, data: Any) -> Any:
        with Tracer.start("images.generate") as t:
            t("type", "LLM")
            t("signature", "OpenAI.images.generate")
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
            t("signature", "AsyncOpenAI.images.generate")
            args = self._build_image_args(agent, data)
            t("inputs", args)
            response = await client.images.generate(**args)
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

    def _build_chat_args(
        self, agent: PromptAgent, messages: list[Message]
    ) -> dict[str, Any]:
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

    def _build_embedding_args(self, agent: PromptAgent, data: Any) -> dict[str, Any]:
        """Build arguments dict for embeddings.create."""
        model = agent.model.id or "text-embedding-ada-002"
        args: dict[str, Any] = {
            "input": data if isinstance(data, list) else [data],
            "model": model,
            **_build_options(agent),
        }
        return args

    def _build_image_args(self, agent: PromptAgent, data: Any) -> dict[str, Any]:
        """Build arguments dict for images.generate."""
        model = agent.model.id or "dall-e-3"
        args: dict[str, Any] = {
            "prompt": data,
            "model": model,
            **_build_options(agent),
        }
        return args
