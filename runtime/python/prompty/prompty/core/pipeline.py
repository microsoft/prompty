"""Stateless pipeline functions for prompt execution.

Four-step pipeline with traced boundaries::

    execute()             →  top-level: load + prepare + run
      ├── prepare()       →  render + parse + thread expansion  →  list[Message]
      │   ├── render()    →  template + inputs  →  rendered string
      │   └── parse()     →  rendered string    →  list[Message]
      └── run()           →  LLM call + result extraction       →  clean result
          ├── executor    →  messages → raw LLM response
          └── process()   →  response → clean result

    execute_agent()       →  like execute(), but with a tool-call loop in run()

Each step is independently traced.  Users can bring their own
Renderer, Parser, Executor, and Processor implementations via the
plugin discovery system.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import Callable
from typing import Any

from ..model import Prompty
from ..renderers._common import _thread_nonces_local
from ..tracing.tracer import trace
from .discovery import (
    InvokerError,
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
)
from .types import RICH_KINDS, ContentPart, Message, ThreadMarker

__all__ = [
    "validate_inputs",
    # Leaf steps
    "render",
    "render_async",
    "parse",
    "parse_async",
    "process",
    "process_async",
    # Composite steps
    "prepare",
    "prepare_async",
    "run",
    "run_async",
    # Top-level orchestrators
    "execute",
    "execute_async",
    "execute_agent",
    "execute_agent_async",
    # Backward-compat aliases
    "run_agent",
    "run_agent_async",
    "headless",
    # Helpers (used by tests)
    "_get_rich_input_names",
    "_inject_thread_markers",
    "_expand_thread_markers",
    "_dict_to_message",
    "_dict_content_to_part",
]


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def validate_inputs(
    agent: Prompty,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Validate and fill defaults for inputs against ``agent.inputs``.

    Parameters
    ----------
    agent:
        The loaded Prompty.
    inputs:
        User-provided input values.

    Returns
    -------
    dict
        Validated inputs with defaults applied.

    Raises
    ------
    ValueError
        If required inputs are missing.
    """
    if not agent.inputs:
        return dict(inputs)

    props = {p.name: p for p in agent.inputs}
    result = dict(inputs)

    # Apply defaults for missing inputs
    for name, prop in props.items():
        if name not in result:
            if prop.default is not None:
                result[name] = prop.default
            elif prop.required:
                raise ValueError(f"Required input '{name}' not provided and has no default value.")

    return result


# ---------------------------------------------------------------------------
# Thread-marker helpers
# ---------------------------------------------------------------------------


def _get_rich_input_names(agent: Prompty) -> dict[str, str]:
    """Return {property_name: kind} for all rich-kind inputs."""
    if not agent.inputs:
        return {}
    return {p.name: p.kind for p in agent.inputs if p.kind in RICH_KINDS}


def _inject_thread_markers(
    messages: list[Message],
    thread_nonces: dict[str, str],
) -> list[Message | ThreadMarker]:
    """Scan parsed messages for nonce markers emitted by the renderer.

    When a thread-kind input appears as ``{{thread_var}}`` in the template,
    the renderer substitutes a nonce marker string. After parsing, that
    marker ends up inside a ``Message``'s ``TextPart`` content. This
    function finds those markers, splits the message, and inserts a
    ``ThreadMarker`` at the correct position.

    Parameters
    ----------
    messages:
        Parsed message list (no ThreadMarkers yet).
    thread_nonces:
        Mapping from nonce marker strings to input property names,
        provided by the renderer.

    Returns
    -------
    list[Message | ThreadMarker]
        Messages with ``ThreadMarker`` objects injected at nonce positions.
    """
    from .types import TextPart

    result: list[Message | ThreadMarker] = []

    for msg in messages:
        text = msg.text
        # Check if any nonce marker appears in this message's text
        found_marker = None
        for marker, name in thread_nonces.items():
            if marker in text:
                found_marker = (marker, name)
                break

        if found_marker is None:
            result.append(msg)
            continue

        marker, name = found_marker

        # Split the message text at the nonce marker
        before, _, after = text.partition(marker)
        before = before.strip()
        after = after.strip()

        if before:
            result.append(
                Message(
                    role=msg.role,
                    parts=[TextPart(value=before)],
                    metadata=dict(msg.metadata),
                )
            )

        result.append(ThreadMarker(name=name))

        if after:
            result.append(
                Message(
                    role=msg.role,
                    parts=[TextPart(value=after)],
                    metadata=dict(msg.metadata),
                )
            )

    return result


def _expand_thread_markers(
    messages: list[Message | ThreadMarker],
    inputs: dict[str, Any],
    rich_inputs: dict[str, str],
) -> list[Message]:
    """Replace ThreadMarker entries with actual messages from inputs.

    If no markers exist but thread-kind inputs are provided, append
    thread messages at the end.
    """
    expanded: list[Message] = []
    marker_found = False

    for item in messages:
        if isinstance(item, ThreadMarker):
            marker_found = True
            thread_data = inputs.get(item.name, [])
            if isinstance(thread_data, list):
                for msg in thread_data:
                    if isinstance(msg, Message):
                        expanded.append(msg)
                    elif isinstance(msg, dict):
                        expanded.append(_dict_to_message(msg))
            # else: skip non-list thread values
        else:
            expanded.append(item)

    # If no markers but thread inputs exist, append at end
    if not marker_found:
        for name, kind in rich_inputs.items():
            if kind == "thread" and name in inputs:
                thread_data = inputs[name]
                if isinstance(thread_data, list):
                    for msg in thread_data:
                        if isinstance(msg, Message):
                            expanded.append(msg)
                        elif isinstance(msg, dict):
                            expanded.append(_dict_to_message(msg))

    return expanded


def _dict_to_message(d: dict[str, Any]) -> Message:
    """Convert a plain dict to a Message, preserving structure."""
    from .types import TextPart

    role = d.get("role", "user")
    content = d.get("content", "")

    parts: list[ContentPart] = []
    if isinstance(content, str):
        parts = [TextPart(value=content)]
    elif isinstance(content, list):
        # Already structured content parts — preserve as-is
        for item in content:
            if isinstance(item, ContentPart):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(_dict_content_to_part(item))
            else:
                parts.append(TextPart(value=str(item)))
    else:
        parts = [TextPart(value=str(content))]

    # Collect metadata (everything except role and content)
    metadata = {k: v for k, v in d.items() if k not in ("role", "content", "parts")}

    return Message(role=role, parts=parts, metadata=metadata)


def _dict_content_to_part(d: dict[str, Any]) -> ContentPart:
    """Convert a dict content item to a ContentPart."""
    from .types import AudioPart, FilePart, ImagePart, TextPart

    kind = d.get("kind", d.get("type", "text"))
    if kind == "text":
        return TextPart(value=d.get("value", d.get("text", "")))
    elif kind == "image" or kind == "image_url":
        source = d.get("source", "")
        if not source and "image_url" in d:
            url_data = d["image_url"]
            source = url_data.get("url", "") if isinstance(url_data, dict) else str(url_data)
        return ImagePart(
            source=source,
            detail=d.get("detail"),
            media_type=d.get("mediaType", d.get("media_type")),
        )
    elif kind == "file":
        return FilePart(
            source=d.get("source", ""),
            media_type=d.get("mediaType", d.get("media_type")),
        )
    elif kind == "audio":
        return AudioPart(
            source=d.get("source", ""),
            media_type=d.get("mediaType", d.get("media_type")),
        )
    else:
        return TextPart(value=str(d))


# ---------------------------------------------------------------------------
# Pipeline: prepare() — shared config resolution
# ---------------------------------------------------------------------------


def _resolve_prepare_config(
    agent: Prompty,
) -> tuple[str, str, bool]:
    """Extract format kind, parser kind, and strict flag from an agent's template config."""
    format_kind = "jinja2"
    parser_kind = "prompty"
    is_strict = True

    if agent.template is not None:
        if agent.template.format is not None and agent.template.format.kind not in (
            "",
            "*",
        ):
            format_kind = agent.template.format.kind
        if agent.template.parser is not None and agent.template.parser.kind not in (
            "",
            "*",
        ):
            parser_kind = agent.template.parser.kind
        if agent.template.format is not None and agent.template.format.strict is not None:
            is_strict = agent.template.format.strict

    return format_kind, parser_kind, is_strict


def _finalize_messages(
    messages: list[Message],
    thread_nonces: dict[str, str],
    inputs: dict[str, Any],
    rich_inputs: dict[str, str],
) -> list[Message]:
    """Inject thread markers and expand them with actual conversation messages."""
    expanded: list[Message | ThreadMarker] = list(messages)
    if thread_nonces:
        expanded = _inject_thread_markers(messages, thread_nonces)
    return _expand_thread_markers(expanded, inputs, rich_inputs)


# ---------------------------------------------------------------------------
# Leaf step: render()
# ---------------------------------------------------------------------------


@trace
def render(
    agent: Prompty,
    inputs: dict[str, Any] | None = None,
) -> str:
    """Render the agent's template with the given inputs.

    Discovers the appropriate renderer via ``agent.template.format.kind``
    and calls it.  This is one of the four leaf steps in the pipeline,
    independently traced for observability.

    Parameters
    ----------
    agent:
        A loaded ``Prompty``.
    inputs:
        Input values for template rendering.

    Returns
    -------
    str
        The rendered template string (before parsing into messages).
    """
    inputs = validate_inputs(agent, inputs or {})
    format_kind, _, _ = _resolve_prepare_config(agent)
    template = agent.instructions or ""
    renderer = get_renderer(format_kind)
    return renderer.render(agent, template, inputs)


@trace
async def render_async(
    agent: Prompty,
    inputs: dict[str, Any] | None = None,
) -> str:
    """Async variant of :func:`render`."""
    inputs = validate_inputs(agent, inputs or {})
    format_kind, _, _ = _resolve_prepare_config(agent)
    template = agent.instructions or ""
    renderer = get_renderer(format_kind)
    return await renderer.render_async(agent, template, inputs)


# ---------------------------------------------------------------------------
# Leaf step: parse()
# ---------------------------------------------------------------------------


@trace
def parse(
    agent: Prompty,
    rendered: str,
) -> list[Message]:
    """Parse a rendered template string into an abstract message array.

    Discovers the appropriate parser via ``agent.template.parser.kind``
    and calls it.  This is one of the four leaf steps in the pipeline,
    independently traced for observability.

    Parameters
    ----------
    agent:
        A loaded ``Prompty``.
    rendered:
        The rendered template string (output from :func:`render`).

    Returns
    -------
    list[Message]
        Parsed message array.
    """
    _, parser_kind, is_strict = _resolve_prepare_config(agent)
    parser = get_parser(parser_kind)
    context: dict[str, Any] = {}
    if is_strict and hasattr(parser, "pre_render"):
        _, context = parser.pre_render(agent.instructions or "")  # type: ignore[union-attr]
    return parser.parse(agent, rendered, **context)


@trace
async def parse_async(
    agent: Prompty,
    rendered: str,
) -> list[Message]:
    """Async variant of :func:`parse`."""
    _, parser_kind, is_strict = _resolve_prepare_config(agent)
    parser = get_parser(parser_kind)
    context: dict[str, Any] = {}
    if is_strict and hasattr(parser, "pre_render"):
        _, context = parser.pre_render(agent.instructions or "")  # type: ignore[union-attr]
    return await parser.parse_async(agent, rendered, **context)


# ---------------------------------------------------------------------------
# Composite step: prepare() — render + parse + thread expansion
# ---------------------------------------------------------------------------


@trace
def prepare(
    agent: Prompty,
    inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Render, parse, and expand a prompt into a message array.

    Pipeline:
        1. Validate inputs against ``agent.inputs``
        2. Discover parser; if ``FormatConfig.strict``, call ``pre_render()``
        3. Discover renderer; call ``render()``
        4. Call ``parser.parse()``
        5. Expand thread markers with structured messages from inputs

    Parameters
    ----------
    agent:
        A loaded ``Prompty``.
    inputs:
        Input values for template rendering.

    Returns
    -------
    list[Message]
        Model-agnostic message array ready for execution.
    """
    inputs = validate_inputs(agent, inputs or {})
    rich_inputs = _get_rich_input_names(agent)
    format_kind, parser_kind, is_strict = _resolve_prepare_config(agent)
    template = agent.instructions or ""

    parser = get_parser(parser_kind)

    parse_context: dict[str, Any] = {}
    if is_strict and hasattr(parser, "pre_render"):
        template, parse_context = parser.pre_render(template)  # type: ignore[union-attr]

    renderer = get_renderer(format_kind)
    rendered = renderer.render(agent, template, inputs)

    thread_nonces: dict[str, str] = getattr(_thread_nonces_local, "nonces", {})
    _thread_nonces_local.nonces = {}

    messages = parser.parse(agent, rendered, **parse_context)
    return _finalize_messages(messages, thread_nonces, inputs, rich_inputs)


@trace
async def prepare_async(
    agent: Prompty,
    inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Async variant of :func:`prepare`."""
    inputs = validate_inputs(agent, inputs or {})
    rich_inputs = _get_rich_input_names(agent)
    format_kind, parser_kind, is_strict = _resolve_prepare_config(agent)
    template = agent.instructions or ""

    parser = get_parser(parser_kind)

    parse_context: dict[str, Any] = {}
    if is_strict and hasattr(parser, "pre_render"):
        template, parse_context = parser.pre_render(template)  # type: ignore[union-attr]

    renderer = get_renderer(format_kind)
    rendered = await renderer.render_async(agent, template, inputs)

    thread_nonces: dict[str, str] = getattr(_thread_nonces_local, "nonces", {})
    _thread_nonces_local.nonces = {}

    messages = await parser.parse_async(agent, rendered, **parse_context)
    return _finalize_messages(messages, thread_nonces, inputs, rich_inputs)


# ---------------------------------------------------------------------------
# Internal: _invoke_executor / _invoke_executor_async
# ---------------------------------------------------------------------------


def _invoke_executor(
    agent: Prompty,
    messages: list[Message],
) -> Any:
    """Discover and call the executor for the agent's provider.

    This is the internal leaf step that makes the actual LLM call.
    It is called by :func:`run` and traced via the executor implementation's
    own ``@trace`` decorator.
    """
    provider = agent.model.provider or ""
    if not provider:
        raise InvokerError("prompty.executors", "(no provider set)")
    executor = get_executor(provider)
    return executor.execute(agent, messages)


async def _invoke_executor_async(
    agent: Prompty,
    messages: list[Message],
) -> Any:
    """Async variant of :func:`_invoke_executor`."""
    provider = agent.model.provider or ""
    if not provider:
        raise InvokerError("prompty.executors", "(no provider set)")
    executor = get_executor(provider)
    return await executor.execute_async(agent, messages)


# ---------------------------------------------------------------------------
# Pipeline: process()
# ---------------------------------------------------------------------------


@trace
def process(
    agent: Prompty,
    response: Any,
) -> Any:
    """Extract a clean result from a raw LLM response.

    Parameters
    ----------
    agent:
        The ``Prompty`` used for the call.
    response:
        Raw response from :func:`execute`.

    Returns
    -------
    Any
        Clean result (``str``, tool calls, parsed JSON, etc.).
    """
    provider = agent.model.provider or ""
    if not provider:
        raise InvokerError("prompty.processors", "(no provider set)")
    processor = get_processor(provider)
    return processor.process(agent, response)


@trace
async def process_async(
    agent: Prompty,
    response: Any,
) -> Any:
    """Async variant of :func:`process`."""
    provider = agent.model.provider or ""
    if not provider:
        raise InvokerError("prompty.processors", "(no provider set)")
    processor = get_processor(provider)
    return await processor.process_async(agent, response)


# ---------------------------------------------------------------------------
# Composite step: run() — executor + process
# ---------------------------------------------------------------------------


@trace
def run(
    agent: Prompty,
    messages: list[Message],
    *,
    raw: bool = False,
) -> Any:
    """Execute messages against the LLM and process the response.

    This is the "run" composite step: it calls the executor (LLM call)
    then the processor (result extraction).  Each sub-step is
    independently traced via the implementation's ``@trace`` decorator.

    Parameters
    ----------
    agent:
        A loaded ``Prompty`` with model configuration.
    messages:
        Abstract message array from :func:`prepare`.
    raw:
        If ``True``, skip processing and return the raw LLM response.

    Returns
    -------
    Any
        The processed result (or raw response if ``raw=True``).
    """
    response = _invoke_executor(agent, messages)
    if raw:
        return response
    return process(agent, response)


@trace
async def run_async(
    agent: Prompty,
    messages: list[Message],
    *,
    raw: bool = False,
) -> Any:
    """Async variant of :func:`run`."""
    response = await _invoke_executor_async(agent, messages)
    if raw:
        return response
    return await process_async(agent, response)


# ---------------------------------------------------------------------------
# Top-level orchestrator: execute() — load + prepare + run
# ---------------------------------------------------------------------------


@trace
def execute(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    raw: bool = False,
) -> Any:
    """Full pipeline: load → prepare → run.

    This is the top-level orchestrator matching the v1 ``execute()``
    signature.  It loads the prompt (if a path), prepares messages,
    then runs them through the LLM and processor.

    Parameters
    ----------
    prompt:
        Path to a ``.prompty`` file, or a pre-loaded ``Prompty``.
    inputs:
        Input values for template rendering.
    raw:
        If ``True``, skip processing and return the raw LLM response.

    Returns
    -------
    Any
        The processed result (or raw response if ``raw=True``).
    """
    from .loader import load

    agent = load(prompt) if isinstance(prompt, str) else prompt
    messages = prepare(agent, inputs)
    return run(agent, messages, raw=raw)


@trace
async def execute_async(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    raw: bool = False,
) -> Any:
    """Async variant of :func:`execute`."""
    from .loader import load_async

    if isinstance(prompt, str):
        agent = await load_async(prompt)
    else:
        agent = prompt
    messages = await prepare_async(agent, inputs)
    return await run_async(agent, messages, raw=raw)


# ---------------------------------------------------------------------------
# Pipeline: run_agent() — agent loop with tool execution
# ---------------------------------------------------------------------------

_DEFAULT_MAX_ITERATIONS = 10


def _execute_tool(
    fn: Callable[..., Any],
    fn_name: str,
    arguments_json: str,
) -> str:
    """Execute a tool function with JSON arguments, handling errors gracefully.

    Returns the tool result as a string. On JSON parse error or tool
    function exception, returns an error message so the model can self-correct.
    """
    try:
        fn_args = json.loads(arguments_json)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON arguments for '{fn_name}': {e}"

    try:
        result = fn(**fn_args)
    except Exception as e:
        return f"Error calling '{fn_name}': {type(e).__name__}: {e}"

    return str(result)


async def _execute_tool_async(
    fn: Callable[..., Any],
    fn_name: str,
    arguments_json: str,
) -> str:
    """Async variant of :func:`_execute_tool`."""
    try:
        fn_args = json.loads(arguments_json)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON arguments for '{fn_name}': {e}"

    try:
        if inspect.iscoroutinefunction(fn):
            result = await fn(**fn_args)
        else:
            result = fn(**fn_args)
    except Exception as e:
        return f"Error calling '{fn_name}': {type(e).__name__}: {e}"

    return str(result)


def _has_tool_calls(response: Any) -> bool:
    """Check if an LLM response contains tool calls (OpenAI, Anthropic, or Responses API)."""
    # OpenAI format: response.choices[0].finish_reason == "tool_calls"
    if (
        hasattr(response, "choices")
        and response.choices
        and response.choices[0].finish_reason == "tool_calls"
        and response.choices[0].message.tool_calls
    ):
        return True

    # Anthropic format: response.stop_reason == "tool_use" with tool_use content blocks
    if (
        hasattr(response, "stop_reason")
        and response.stop_reason == "tool_use"
        and hasattr(response, "content")
        and any(getattr(block, "type", None) == "tool_use" for block in response.content)
    ):
        return True

    # OpenAI Responses API: output[].type == "function_call"
    if (
        hasattr(response, "output")
        and getattr(response, "object", None) == "response"
        and any(getattr(item, "type", None) == "function_call" for item in response.output)
    ):
        return True

    return False


def _is_anthropic_response(response: Any) -> bool:
    """Check if a response is from Anthropic (has stop_reason, not choices)."""
    return hasattr(response, "stop_reason") and not hasattr(response, "choices")


def _is_responses_api(response: Any) -> bool:
    """Check if a response is from the OpenAI Responses API."""
    return getattr(response, "object", None) == "response" and hasattr(response, "output")


def _build_tool_result_messages(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> tuple[list[Message], bool]:
    """Execute tool calls from the response and build result messages.

    Returns (messages_to_append, had_missing_tool). The messages include
    the assistant's tool-call message and each tool result.

    Dispatches between OpenAI, Anthropic, and Responses API formats.
    """
    if _is_anthropic_response(response):
        return _build_anthropic_tool_result_messages(response, tools), False
    if _is_responses_api(response):
        return _build_responses_tool_result_messages(response, tools)
    return _build_openai_tool_result_messages(response, tools)


def _build_openai_tool_result_messages(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> tuple[list[Message], bool]:
    """Handle OpenAI tool call responses."""
    from .types import TextPart

    tool_calls = response.choices[0].message.tool_calls
    result_messages: list[Message] = []

    # Assistant message with tool_calls metadata
    result_messages.append(
        Message(
            role="assistant",
            parts=[],
            metadata={"tool_calls": [tc.model_dump() for tc in tool_calls]},
        )
    )

    for tc in tool_calls:
        fn_name = tc.function.name
        fn = tools.get(fn_name)
        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        elif inspect.iscoroutinefunction(fn):
            tool_result = f"Error: async tool '{fn_name}' cannot be called in sync mode"
        else:
            tool_result = _execute_tool(fn, fn_name, tc.function.arguments)

        result_messages.append(
            Message(
                role="tool",
                parts=[TextPart(value=tool_result)],
                metadata={"tool_call_id": tc.id, "name": fn_name},
            )
        )

    return result_messages, False


def _build_anthropic_tool_result_messages(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> list[Message]:
    """Handle Anthropic tool_use content blocks.

    Returns two messages:
    1. Assistant message with the full raw content (including tool_use blocks)
    2. A single tool message with all tool_result blocks (Anthropic requires
       tool_results in a single user message following the assistant)
    """
    import json as _json

    from .types import TextPart

    content = response.content
    tool_use_blocks = [b for b in content if getattr(b, "type", None) == "tool_use"]
    text_blocks = [b for b in content if getattr(b, "type", None) == "text"]

    result_messages: list[Message] = []

    # Assistant message must preserve the raw content blocks for wire format
    # so Anthropic sees the tool_use blocks it generated
    text_parts = [TextPart(value=b.text) for b in text_blocks]
    raw_content = []
    for b in content:
        block_dict: dict[str, Any] = {"type": getattr(b, "type", "")}
        if getattr(b, "type", None) == "text":
            block_dict["text"] = b.text
        elif getattr(b, "type", None) == "tool_use":
            block_dict["id"] = b.id
            block_dict["name"] = b.name
            block_dict["input"] = b.input
        raw_content.append(block_dict)

    result_messages.append(
        Message(
            role="assistant",
            parts=text_parts,
            metadata={"raw_content": raw_content},
        )
    )

    # All tool results go in a single message
    tool_results: list[dict[str, Any]] = []
    for block in tool_use_blocks:
        fn_name = block.name
        fn = tools.get(fn_name)
        tool_input = block.input
        arguments = _json.dumps(tool_input) if not isinstance(tool_input, str) else tool_input

        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        elif inspect.iscoroutinefunction(fn):
            tool_result = f"Error: async tool '{fn_name}' cannot be called in sync mode"
        else:
            tool_result = _execute_tool(fn, fn_name, arguments)

        tool_results.append(
            {
                "tool_use_id": block.id,
                "name": fn_name,
                "result": tool_result,
            }
        )

    # Single tool message with all results
    result_messages.append(
        Message(
            role="tool",
            parts=[TextPart(value=r["result"]) for r in tool_results],
            metadata={"tool_results": tool_results},
        )
    )

    return result_messages


async def _build_tool_result_messages_async(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> list[Message]:
    """Async variant of :func:`_build_tool_result_messages`."""
    if _is_anthropic_response(response):
        return await _build_anthropic_tool_result_messages_async(response, tools)
    if _is_responses_api(response):
        return await _build_responses_tool_result_messages_async(response, tools)
    return await _build_openai_tool_result_messages_async(response, tools)


async def _build_openai_tool_result_messages_async(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> list[Message]:
    """Async: handle OpenAI tool call responses."""
    from .types import TextPart

    tool_calls = response.choices[0].message.tool_calls
    result_messages: list[Message] = []

    result_messages.append(
        Message(
            role="assistant",
            parts=[],
            metadata={"tool_calls": [tc.model_dump() for tc in tool_calls]},
        )
    )

    for tc in tool_calls:
        fn_name = tc.function.name
        fn = tools.get(fn_name)
        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        else:
            tool_result = await _execute_tool_async(fn, fn_name, tc.function.arguments)

        result_messages.append(
            Message(
                role="tool",
                parts=[TextPart(value=tool_result)],
                metadata={"tool_call_id": tc.id, "name": fn_name},
            )
        )

    return result_messages


async def _build_anthropic_tool_result_messages_async(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> list[Message]:
    """Async: handle Anthropic tool_use content blocks."""
    import json as _json

    from .types import TextPart

    content = response.content
    tool_use_blocks = [b for b in content if getattr(b, "type", None) == "tool_use"]
    text_blocks = [b for b in content if getattr(b, "type", None) == "text"]

    result_messages: list[Message] = []

    text_parts = [TextPart(value=b.text) for b in text_blocks]
    raw_content = []
    for b in content:
        block_dict: dict[str, Any] = {"type": getattr(b, "type", "")}
        if getattr(b, "type", None) == "text":
            block_dict["text"] = b.text
        elif getattr(b, "type", None) == "tool_use":
            block_dict["id"] = b.id
            block_dict["name"] = b.name
            block_dict["input"] = b.input
        raw_content.append(block_dict)

    result_messages.append(
        Message(
            role="assistant",
            parts=text_parts,
            metadata={"raw_content": raw_content},
        )
    )

    tool_results: list[dict[str, Any]] = []
    for block in tool_use_blocks:
        fn_name = block.name
        fn = tools.get(fn_name)
        tool_input = block.input
        arguments = _json.dumps(tool_input) if not isinstance(tool_input, str) else tool_input

        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        else:
            tool_result = await _execute_tool_async(fn, fn_name, arguments)

        tool_results.append(
            {
                "tool_use_id": block.id,
                "name": fn_name,
                "result": tool_result,
            }
        )

    result_messages.append(
        Message(
            role="tool",
            parts=[TextPart(value=r["result"]) for r in tool_results],
            metadata={"tool_results": tool_results},
        )
    )

    return result_messages


def _build_responses_tool_result_messages(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> tuple[list[Message], bool]:
    """Handle OpenAI Responses API tool calls: output[].type == 'function_call'.

    Returns (messages_to_append, had_missing_tool).
    """
    from .types import TextPart

    output = response.output
    func_calls = [item for item in output if getattr(item, "type", None) == "function_call"]

    result_messages: list[Message] = []
    had_missing = False

    for fc in func_calls:
        fn_name = getattr(fc, "name", "")
        call_id = getattr(fc, "call_id", None) or getattr(fc, "id", None) or ""
        arguments = getattr(fc, "arguments", None) or "{}"

        # Include original function_call item so the Responses API can match
        # function_call_output items to their origin
        result_messages.append(
            Message(
                role="assistant",
                parts=[],
                metadata={
                    "responses_function_call": {
                        "type": "function_call",
                        "call_id": call_id,
                        "name": fn_name,
                        "arguments": arguments,
                    }
                },
            )
        )

        fn = tools.get(fn_name)
        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
            had_missing = True
        elif inspect.iscoroutinefunction(fn):
            tool_result = f"Error: async tool '{fn_name}' cannot be called in sync mode"
        else:
            tool_result = _execute_tool(fn, fn_name, arguments)

        result_messages.append(
            Message(
                role="tool",
                parts=[TextPart(value=tool_result)],
                metadata={"tool_call_id": call_id, "name": fn_name},
            )
        )

    return result_messages, had_missing


async def _build_responses_tool_result_messages_async(
    response: Any,
    tools: dict[str, Callable[..., Any]],
) -> list[Message]:
    """Async: handle OpenAI Responses API tool calls."""
    from .types import TextPart

    output = response.output
    func_calls = [item for item in output if getattr(item, "type", None) == "function_call"]

    result_messages: list[Message] = []

    for fc in func_calls:
        fn_name = getattr(fc, "name", "")
        call_id = getattr(fc, "call_id", None) or getattr(fc, "id", None) or ""
        arguments = getattr(fc, "arguments", None) or "{}"

        # Include original function_call item
        result_messages.append(
            Message(
                role="assistant",
                parts=[],
                metadata={
                    "responses_function_call": {
                        "type": "function_call",
                        "call_id": call_id,
                        "name": fn_name,
                        "arguments": arguments,
                    }
                },
            )
        )

        fn = tools.get(fn_name)
        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        else:
            tool_result = await _execute_tool_async(fn, fn_name, arguments)

        result_messages.append(
            Message(
                role="tool",
                parts=[TextPart(value=tool_result)],
                metadata={"tool_call_id": call_id, "name": fn_name},
            )
        )

    return result_messages


def _is_stream(response: Any) -> bool:
    """Check if a response is a stream (sync or async iterable wrapper)."""
    from .types import AsyncPromptyStream, PromptyStream

    return isinstance(response, (PromptyStream, AsyncPromptyStream))


def _consume_stream(agent: Prompty, response: Any) -> tuple[list[Any], str]:
    """Consume a streaming response through the processor.

    Returns (tool_calls, content) where tool_calls is a list of ToolCall
    objects and content is the accumulated text.
    """
    from ..providers.openai.processor import ToolCall

    processed = process(agent, response)

    tool_calls: list[Any] = []
    text_parts: list[str] = []

    if hasattr(processed, "__iter__") and not isinstance(processed, (str, bytes)):
        for item in processed:
            if isinstance(item, ToolCall):
                tool_calls.append(item)
            elif isinstance(item, str):
                text_parts.append(item)
    elif isinstance(processed, str):
        text_parts.append(processed)

    return tool_calls, "".join(text_parts)


async def _consume_stream_async(agent: Prompty, response: Any) -> tuple[list[Any], str]:
    """Async: consume a streaming response through the processor."""
    from ..providers.openai.processor import ToolCall

    processed = await process_async(agent, response)

    tool_calls: list[Any] = []
    text_parts: list[str] = []

    if hasattr(processed, "__aiter__"):
        async for item in processed:
            if isinstance(item, ToolCall):
                tool_calls.append(item)
            elif isinstance(item, str):
                text_parts.append(item)
    elif hasattr(processed, "__iter__") and not isinstance(processed, (str, bytes)):
        for item in processed:
            if isinstance(item, ToolCall):
                tool_calls.append(item)
            elif isinstance(item, str):
                text_parts.append(item)
    elif isinstance(processed, str):
        text_parts.append(processed)

    return tool_calls, "".join(text_parts)


def _build_tool_messages_from_calls(
    tool_calls: list[Any],
    text_content: str,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
) -> list[Message]:
    """Build tool result messages from processed ToolCall objects (streaming path).

    Dispatches to the correct wire format based on provider and apiType.
    """
    from .types import TextPart

    provider = agent.model.provider or ""
    api_type = agent.model.apiType or "chat"
    result_messages: list[Message] = []

    # --- Assistant message with provider-appropriate metadata ---
    if provider == "anthropic":
        raw_content: list[dict[str, Any]] = []
        if text_content:
            raw_content.append({"type": "text", "text": text_content})
        for tc in tool_calls:
            raw_content.append(
                {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": json.loads(tc.arguments),
                }
            )
        result_messages.append(
            Message(
                role="assistant",
                parts=[TextPart(value=text_content)] if text_content else [],
                metadata={"raw_content": raw_content},
            )
        )
    elif api_type == "responses":
        for tc in tool_calls:
            result_messages.append(
                Message(
                    role="assistant",
                    parts=[],
                    metadata={
                        "responses_function_call": {
                            "type": "function_call",
                            "call_id": tc.id,
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                    },
                )
            )
    else:
        # OpenAI Chat format
        raw_tool_calls = [
            {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": tc.arguments}}
            for tc in tool_calls
        ]
        result_messages.append(
            Message(
                role="assistant",
                parts=[TextPart(value=text_content)] if text_content else [],
                metadata={"tool_calls": raw_tool_calls},
            )
        )

    # --- Execute tools and build result messages ---
    tool_result_blocks: list[dict[str, Any]] = []

    for tc in tool_calls:
        fn_name = tc.name
        fn = tools.get(fn_name)
        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        elif inspect.iscoroutinefunction(fn):
            tool_result = f"Error: async tool '{fn_name}' cannot be called in sync mode"
        else:
            tool_result = _execute_tool(fn, fn_name, tc.arguments)

        if provider == "anthropic":
            tool_result_blocks.append(
                {
                    "tool_use_id": tc.id,
                    "name": fn_name,
                    "result": tool_result,
                }
            )
        else:
            result_messages.append(
                Message(
                    role="tool",
                    parts=[TextPart(value=tool_result)],
                    metadata={"tool_call_id": tc.id, "name": fn_name},
                )
            )

    # Anthropic: batch all tool results in single user message
    if provider == "anthropic" and tool_result_blocks:
        result_messages.append(
            Message(
                role="tool",
                parts=[TextPart(value=r["result"]) for r in tool_result_blocks],
                metadata={"tool_results": tool_result_blocks},
            )
        )

    return result_messages


async def _build_tool_messages_from_calls_async(
    tool_calls: list[Any],
    text_content: str,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
) -> list[Message]:
    """Async: build tool result messages from processed ToolCall objects."""
    from .types import TextPart

    provider = agent.model.provider or ""
    api_type = agent.model.apiType or "chat"
    result_messages: list[Message] = []

    # --- Assistant message (same as sync) ---
    if provider == "anthropic":
        raw_content: list[dict[str, Any]] = []
        if text_content:
            raw_content.append({"type": "text", "text": text_content})
        for tc in tool_calls:
            raw_content.append(
                {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": json.loads(tc.arguments),
                }
            )
        result_messages.append(
            Message(
                role="assistant",
                parts=[TextPart(value=text_content)] if text_content else [],
                metadata={"raw_content": raw_content},
            )
        )
    elif api_type == "responses":
        for tc in tool_calls:
            result_messages.append(
                Message(
                    role="assistant",
                    parts=[],
                    metadata={
                        "responses_function_call": {
                            "type": "function_call",
                            "call_id": tc.id,
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                    },
                )
            )
    else:
        raw_tool_calls = [
            {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": tc.arguments}}
            for tc in tool_calls
        ]
        result_messages.append(
            Message(
                role="assistant",
                parts=[TextPart(value=text_content)] if text_content else [],
                metadata={"tool_calls": raw_tool_calls},
            )
        )

    # --- Execute tools ---
    tool_result_blocks: list[dict[str, Any]] = []

    for tc in tool_calls:
        fn_name = tc.name
        fn = tools.get(fn_name)
        if fn is None:
            tool_result = (
                f"Error: tool function '{fn_name}' not registered. Available: {', '.join(sorted(tools)) or '(none)'}"
            )
        else:
            tool_result = await _execute_tool_async(fn, fn_name, tc.arguments)

        if provider == "anthropic":
            tool_result_blocks.append(
                {
                    "tool_use_id": tc.id,
                    "name": fn_name,
                    "result": tool_result,
                }
            )
        else:
            result_messages.append(
                Message(
                    role="tool",
                    parts=[TextPart(value=tool_result)],
                    metadata={"tool_call_id": tc.id, "name": fn_name},
                )
            )

    if provider == "anthropic" and tool_result_blocks:
        result_messages.append(
            Message(
                role="tool",
                parts=[TextPart(value=r["result"]) for r in tool_result_blocks],
                metadata={"tool_results": tool_result_blocks},
            )
        )

    return result_messages


@trace
def execute_agent(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    tools: dict[str, Callable[..., Any]] | None = None,
    max_iterations: int = _DEFAULT_MAX_ITERATIONS,
    raw: bool = False,
) -> Any:
    """Run a prompt with automatic tool-call execution loop.

    Similar to :func:`execute`, but when the LLM returns tool calls, the
    specified tool functions are executed and their results are sent back
    to the model. This repeats until the model returns a normal response
    or *max_iterations* is reached.

    If the agent has streaming enabled, each response is consumed through
    the processor to extract tool calls from the buffered chunks. This
    preserves streaming tracing while still enabling tool-call detection.

    Parameters
    ----------
    prompt:
        Path to a ``.prompty`` file, or a pre-loaded ``Prompty``.
    inputs:
        Input values for template rendering.
    tools:
        Mapping of tool name → callable. Tool names must match the
        ``name`` field in the ``.prompty`` frontmatter ``tools:`` list.
    max_iterations:
        Maximum number of tool-call loop iterations (default 10).
    raw:
        If ``True``, skip processing and return the raw final response.

    Returns
    -------
    Any
        The processed result from the final LLM response.

    Raises
    ------
    ValueError
        If *max_iterations* is exceeded.
    """
    from ..tracing.tracer import Tracer
    from .loader import load

    agent = load(prompt) if isinstance(prompt, str) else prompt
    tools = tools or {}
    messages = prepare(agent, inputs)

    with Tracer.start("AgentLoop") as t:
        t("type", "agent")
        t("tools", list(tools.keys()))

        response = _invoke_executor(agent, messages)
        iteration = 0

        while True:
            # Streaming: consume through processor, extract tool calls
            if _is_stream(response):
                streamed_tool_calls, content = _consume_stream(agent, response)

                if not streamed_tool_calls:
                    # Final answer — return collected content
                    t("iterations", iteration)
                    t("result", content)
                    return content

                iteration += 1
                if iteration > max_iterations:
                    raise ValueError(
                        f"Agent loop exceeded max_iterations ({max_iterations}). "
                        f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                    )

                tool_messages = _build_tool_messages_from_calls(
                    streamed_tool_calls,
                    content,
                    tools,
                    agent,
                )
                messages.extend(tool_messages)
                response = _invoke_executor(agent, messages)
                continue

            # Non-streaming: check raw response for tool calls
            if not _has_tool_calls(response):
                break

            iteration += 1
            if iteration > max_iterations:
                raise ValueError(
                    f"Agent loop exceeded max_iterations ({max_iterations}). "
                    f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                )

            tool_messages, _ = _build_tool_result_messages(response, tools)
            messages.extend(tool_messages)
            response = _invoke_executor(agent, messages)

        t("iterations", iteration)
        t("result", response)

    if raw:
        return response
    return process(agent, response)


@trace
async def execute_agent_async(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    tools: dict[str, Callable[..., Any]] | None = None,
    max_iterations: int = _DEFAULT_MAX_ITERATIONS,
    raw: bool = False,
) -> Any:
    """Async variant of :func:`execute_agent`."""
    from ..tracing.tracer import Tracer
    from .loader import load_async

    if isinstance(prompt, str):
        agent = await load_async(prompt)
    else:
        agent = prompt
    tools = tools or {}
    messages = await prepare_async(agent, inputs)

    with Tracer.start("AgentLoopAsync") as t:
        t("type", "agent")
        t("tools", list(tools.keys()))

        response = await _invoke_executor_async(agent, messages)
        iteration = 0

        while True:
            # Streaming: consume through processor, extract tool calls
            if _is_stream(response):
                streamed_tool_calls, content = await _consume_stream_async(agent, response)

                if not streamed_tool_calls:
                    t("iterations", iteration)
                    t("result", content)
                    return content

                iteration += 1
                if iteration > max_iterations:
                    raise ValueError(
                        f"Agent loop exceeded max_iterations ({max_iterations}). "
                        f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                    )

                tool_messages = await _build_tool_messages_from_calls_async(
                    streamed_tool_calls,
                    content,
                    tools,
                    agent,
                )
                messages.extend(tool_messages)
                response = await _invoke_executor_async(agent, messages)
                continue

            # Non-streaming: check raw response
            if not _has_tool_calls(response):
                break

            iteration += 1
            if iteration > max_iterations:
                raise ValueError(
                    f"Agent loop exceeded max_iterations ({max_iterations}). "
                    f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                )

            tool_messages = await _build_tool_result_messages_async(response, tools)
            messages.extend(tool_messages)
            response = await _invoke_executor_async(agent, messages)

        t("iterations", iteration)
        t("result", response)

    if raw:
        return response
    return await process_async(agent, response)


# Backward-compatibility aliases
run_agent = execute_agent
run_agent_async = execute_agent_async


# ---------------------------------------------------------------------------


def headless(
    api: str = "chat",
    content: str | list | dict = "",
    *,
    model: str = "",
    provider: str = "openai",
    connection: dict[str, Any] | None = None,
    options: dict[str, Any] | None = None,
) -> Prompty:
    """Create a ``Prompty`` programmatically without a ``.prompty`` file.

    Useful for embedding calls, one-off completions, or cases where a file
    isn't needed.  The returned agent can be passed to :func:`execute` and
    :func:`process`.

    Parameters
    ----------
    api:
        The API type: ``"chat"``, ``"embedding"``, ``"image"``, ``"agent"``.
    content:
        Content to attach — for embeddings this is the input text/list,
        for images this is the prompt string. Stored in
        ``agent.metadata["content"]``.
    model:
        Model identifier (e.g. ``"gpt-4"``, ``"text-embedding-ada-002"``).
    provider:
        Provider name (``"openai"`` or ``"foundry"``).
    connection:
        Connection config dict (``kind``, ``apiKey``, ``endpoint``, etc.).
    options:
        Model options dict (``temperature``, ``maxOutputTokens``, etc.).

    Returns
    -------
    Prompty
        A fully typed agent ready for :func:`run` / :func:`execute`.

    Examples
    --------
    >>> from prompty import headless, run
    >>> agent = headless(
    ...     api="embedding",
    ...     model="text-embedding-ada-002",
    ...     provider="foundry",
    ...     connection={
    ...         "kind": "key",
    ...         "endpoint": "https://my.openai.azure.com",
    ...         "apiKey": "sk-...",
    ...     },
    ...     content="hello world",
    ... )
    >>> result = run(agent, agent.metadata["content"])
    """

    data: dict[str, Any] = {
        "name": "headless",
        "model": {
            "id": model,
            "provider": provider,
            "apiType": api,
        },
        "metadata": {
            "content": content,
        },
    }

    if connection:
        data["model"]["connection"] = connection
    if options:
        data["model"]["options"] = options

    agent = Prompty.load(data)
    return agent
