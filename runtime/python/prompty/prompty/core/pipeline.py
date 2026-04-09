"""Stateless pipeline functions for prompt execution.

Four-step pipeline with traced boundaries::

    invoke()              →  top-level: load + prepare + executor + process
      ├── prepare()       →  render + parse + thread expansion  →  list[Message]
      │   ├── render()    →  template + inputs  →  rendered string
      │   └── parse()     →  rendered string    →  list[Message]
      ├── executor        →  messages → raw LLM response
      └── process()       →  response → clean result

    turn()                →  conversational round-trip with optional tool loop
      ├── prepare()       →  render + parse + thread expansion
      ├── [executor + tool dispatch loop]  →  if tools provided
      └── process()       →  final response extraction

    run()                 →  standalone building block (executor + process)

Each step is independently traced.  Users can bring their own
Renderer, Parser, Executor, and Processor implementations via the
plugin discovery system.
"""

from __future__ import annotations

import asyncio
import json
import warnings
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..model import Prompty
from ..renderers._common import _thread_nonces_local
from ..tracing.tracer import trace
from .agent_events import EventCallback, emit_event
from .cancellation import CancellationToken, CancelledError
from .context import trim_to_context_window
from .discovery import (
    InvokerError,
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
)
from .guardrails import GuardrailError, Guardrails
from .steering import Steering
from .structured import cast
from .tool_dispatch import dispatch_tool, dispatch_tool_async
from .types import RICH_KINDS, ContentPart, Message, TextPart, ThreadMarker

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
    "invoke",
    "invoke_async",
    "turn",
    "turn_async",
    # Deprecated aliases
    "invoke_agent",
    "invoke_agent_async",
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
    nonces: dict[str, str],
    rich_inputs: dict[str, str],
) -> list[Message | ThreadMarker]:
    """Scan parsed messages for nonce markers emitted by the renderer.

    When a rich-kind input appears as ``{{var}}`` in the template,
    the renderer substitutes a nonce marker string. After parsing, that
    marker ends up inside a ``Message``'s ``TextPart`` content. This
    function finds those markers and:

    - For ``thread`` kind: inserts a ``ThreadMarker`` at the correct position.
    - For ``image``/``file``/``audio`` kinds: inserts a ``RichMarker`` that
      will be resolved during expansion.

    Parameters
    ----------
    messages:
        Parsed message list (no markers yet).
    nonces:
        Mapping from nonce marker strings to input property names,
        provided by the renderer.
    rich_inputs:
        Mapping from input property names to their kinds.

    Returns
    -------
    list[Message | ThreadMarker]
        Messages with markers injected at nonce positions.
    """
    from .types import TextPart

    result: list[Message | ThreadMarker] = []

    for msg in messages:
        text = msg.text
        # Check if any nonce marker appears in this message's text
        found_marker = None
        for marker, name in nonces.items():
            if marker in text:
                found_marker = (marker, name)
                break

        if found_marker is None:
            result.append(msg)
            continue

        marker, name = found_marker
        kind = rich_inputs.get(name, "thread")

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

        if kind == "thread":
            result.append(ThreadMarker(name=name))
        else:
            # image/file/audio — insert a RichMarker with the kind
            result.append(ThreadMarker(name=name, kind=kind))

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
    """Replace marker entries with actual content from inputs.

    - ``thread`` markers expand to ``Message[]`` from conversation history.
    - ``image``/``file``/``audio`` markers resolve to the appropriate
      ``ContentPart`` inserted into the surrounding message.
    """
    from .types import AudioPart, FilePart, ImagePart

    expanded: list[Message] = []
    marker_found = False

    for item in messages:
        if isinstance(item, ThreadMarker):
            marker_found = True
            kind = getattr(item, "kind", None) or rich_inputs.get(item.name, "thread")
            value = inputs.get(item.name)

            if kind == "thread":
                # Thread: expand to Message[]
                if isinstance(value, list):
                    for msg in value:
                        if isinstance(msg, Message):
                            expanded.append(msg)
                        elif isinstance(msg, dict):
                            expanded.append(_dict_to_message(msg))
                # else: skip non-list thread values
            elif kind == "image":
                # Image: insert as ImagePart in a user message
                source = str(value) if value else ""
                part = ImagePart(source=source)
                # Attach to preceding message if same role, else create new
                if expanded and expanded[-1].role == "user":
                    expanded[-1].parts.append(part)
                else:
                    expanded.append(Message(role="user", parts=[part]))
            elif kind == "file":
                source = str(value) if value else ""
                part = FilePart(source=source)
                if expanded and expanded[-1].role == "user":
                    expanded[-1].parts.append(part)
                else:
                    expanded.append(Message(role="user", parts=[part]))
            elif kind == "audio":
                source = str(value) if value else ""
                part = AudioPart(source=source)
                if expanded and expanded[-1].role == "user":
                    expanded[-1].parts.append(part)
                else:
                    expanded.append(Message(role="user", parts=[part]))
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
    nonces: dict[str, str],
    inputs: dict[str, Any],
    rich_inputs: dict[str, str],
) -> list[Message]:
    """Inject rich-kind markers and expand them with actual content."""
    expanded: list[Message | ThreadMarker] = list(messages)
    if nonces:
        expanded = _inject_thread_markers(messages, nonces, rich_inputs)
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
# Top-level orchestrator: invoke() — load + prepare + run
# ---------------------------------------------------------------------------


@trace
def invoke(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    raw: bool = False,
    target_type: type | None = None,
) -> Any:
    """Full pipeline: load → prepare → executor → process.

    This is the top-level orchestrator.  It loads the prompt (if a path),
    prepares messages, then calls the executor and processor directly.

    Parameters
    ----------
    prompt:
        Path to a ``.prompty`` file, or a pre-loaded ``Prompty``.
    inputs:
        Input values for template rendering.
    raw:
        If ``True``, skip processing and return the raw LLM response.
    target_type:
        If provided, cast the result to this type via :func:`cast`.

    Returns
    -------
    Any
        The processed result (or raw response if ``raw=True``).
    """
    from .loader import load

    agent = load(prompt) if isinstance(prompt, str) else prompt
    messages = prepare(agent, inputs)
    response = _invoke_executor(agent, messages)
    if raw:
        return response
    result = process(agent, response)
    if target_type is not None:
        return cast(result, target_type)
    return result


@trace
async def invoke_async(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    raw: bool = False,
    target_type: type | None = None,
) -> Any:
    """Async variant of :func:`invoke`."""
    from .loader import load_async

    if isinstance(prompt, str):
        agent = await load_async(prompt)
    else:
        agent = prompt
    messages = await prepare_async(agent, inputs)
    response = await _invoke_executor_async(agent, messages)
    if raw:
        return response
    result = await process_async(agent, response)
    if target_type is not None:
        return cast(result, target_type)
    return result


# ---------------------------------------------------------------------------
# Conversational round-trip: turn() — prepare + [agent loop] + process
# ---------------------------------------------------------------------------

_DEFAULT_MAX_ITERATIONS = 10


@trace
def turn(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    tools: dict[str, Callable[..., Any]] | None = None,
    max_iterations: int = _DEFAULT_MAX_ITERATIONS,
    raw: bool = False,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    context_budget: int | None = None,
    guardrails: Guardrails | None = None,
    steering: Steering | None = None,
    parallel_tool_calls: bool = False,
    target_type: type | None = None,
) -> Any:
    """Conversational round-trip: prepare → [executor + tool loop] → process.

    Without tools this is equivalent to :func:`invoke` (prepare → executor →
    process, calling executor and process directly — not via :func:`run`).
    With tools it runs an agent loop: call the LLM, execute any requested
    tool calls, feed results back, and repeat until the model stops
    requesting tools or *max_iterations* is reached.

    Supports all agent loop extensions: events, cancellation, context window
    management, guardrails, steering, and parallel tool execution.

    Parameters
    ----------
    prompt:
        Path to a ``.prompty`` file, or a pre-loaded ``Prompty``.
    inputs:
        Input values for template rendering.
    tools:
        Mapping of tool name → callable.  When ``None`` or empty, no
        tool-call loop is executed.
    max_iterations:
        Maximum number of tool-call loop iterations (default 10).
    raw:
        If ``True``, skip processing and return the raw final response.
    on_event:
        Optional callback ``(event_type, data) → None`` for structured events.
    cancel:
        Optional cancellation token for cooperative cancellation.
    context_budget:
        Character budget for context window management. ``None`` = no trimming.
    guardrails:
        Optional validation hooks (input, output, tool).
    steering:
        Optional handle for injecting messages mid-loop.
    parallel_tool_calls:
        If ``True``, execute multiple tool calls concurrently.
    target_type:
        If provided, cast the final result to this type via :func:`cast`.

    Returns
    -------
    Any
        The processed result from the final LLM response.

    Raises
    ------
    CancelledError
        If the cancellation token is triggered.
    GuardrailError
        If an input or output guardrail denies the operation.
    ValueError
        If *max_iterations* is exceeded.
    """
    from ..tracing.tracer import Tracer
    from .loader import load

    agent = load(prompt) if isinstance(prompt, str) else prompt
    tools = tools or {}
    parent_inputs = inputs or {}
    messages = prepare(agent, inputs)

    # Fast path: no tools and no loop extensions — single executor + process call (not via run)
    _has_extensions = on_event is not None or cancel is not None or context_budget is not None or guardrails is not None or steering is not None
    if not tools and not _has_extensions:
        response = _invoke_executor(agent, messages)
        if raw:
            return response
        result = process(agent, response)
        if target_type is not None:
            return cast(result, target_type)
        return result

    # Tool-call loop
    with Tracer.start("AgentLoop") as t:
        t("type", "agent")
        t("tools", list(tools.keys()))

        response = None
        iteration = 0

        while True:
            if cancel is not None and cancel.is_cancelled:
                emit_event(on_event, "cancelled", {})
                raise CancelledError()

            if steering is not None:
                pending = steering.drain()
                if pending:
                    messages.extend(pending)
                    emit_event(on_event, "messages_updated", {"messages": messages})
                    emit_event(on_event, "status", {"message": f"Injected {len(pending)} steering message(s)"})

            if context_budget is not None:
                dropped_count, _ = trim_to_context_window(messages, context_budget)
                if dropped_count > 0:
                    emit_event(on_event, "messages_updated", {"messages": messages})
                    emit_event(on_event, "status", {"message": f"Trimmed {dropped_count} messages for context budget"})

            if guardrails is not None:
                gr_input = guardrails.check_input(messages)
                if not gr_input.allowed:
                    emit_event(on_event, "error", {"message": f"Input guardrail denied: {gr_input.reason}"})
                    raise GuardrailError(gr_input.reason or "Input guardrail denied")
                if gr_input.rewrite is not None:
                    messages = gr_input.rewrite
                    emit_event(on_event, "messages_updated", {"messages": messages})

            if cancel is not None and cancel.is_cancelled:
                emit_event(on_event, "cancelled", {})
                raise CancelledError()

            # Call LLM (directly via executor, not via run)
            response = _invoke_executor(agent, messages)

            # Streaming: consume through processor, extract tool calls
            if _is_stream(response):
                streamed_tool_calls, content = _consume_stream(agent, response, on_event)

                if not streamed_tool_calls:
                    if guardrails is not None and content:
                        assistant_msg = Message(role="assistant", parts=[TextPart(value=content)])
                        gr = guardrails.check_output(assistant_msg)
                        if not gr.allowed:
                            emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
                            raise GuardrailError(gr.reason or "Output guardrail denied")
                        if gr.rewrite is not None:
                            content = gr.rewrite
                    t("iterations", iteration)
                    t("result", content)
                    emit_event(on_event, "done", {"response": content, "messages": messages})
                    return content

                if guardrails is not None and content:
                    assistant_msg = Message(role="assistant", parts=[TextPart(value=content)])
                    gr = guardrails.check_output(assistant_msg)
                    if not gr.allowed:
                        emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
                        raise GuardrailError(gr.reason or "Output guardrail denied")
                    if gr.rewrite is not None:
                        content = gr.rewrite

                iteration += 1
                if iteration > max_iterations:
                    raise ValueError(
                        f"Agent loop exceeded max_iterations ({max_iterations}). "
                        f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                    )

                tool_messages = _build_tool_messages_from_calls_with_extensions(
                    streamed_tool_calls,
                    content,
                    tools,
                    agent,
                    parent_inputs,
                    on_event=on_event,
                    cancel=cancel,
                    guardrails=guardrails,
                    parallel=parallel_tool_calls,
                )
                messages.extend(tool_messages)
                emit_event(on_event, "messages_updated", {"messages": messages})
                continue

            # Non-streaming: check raw response for tool calls
            if not _has_tool_calls(response):
                break

            if guardrails is not None:
                tool_calls_list, text_content = _extract_tool_info(response)
                if text_content:
                    assistant_msg = Message(role="assistant", parts=[TextPart(value=text_content)])
                    gr = guardrails.check_output(assistant_msg)
                    if not gr.allowed:
                        emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
                        raise GuardrailError(gr.reason or "Output guardrail denied")
                    if gr.rewrite is not None:
                        text_content = gr.rewrite

            iteration += 1
            if iteration > max_iterations:
                raise ValueError(
                    f"Agent loop exceeded max_iterations ({max_iterations}). "
                    f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                )

            tool_messages, _ = _build_tool_result_messages_with_extensions(
                response,
                tools,
                agent,
                parent_inputs,
                on_event=on_event,
                cancel=cancel,
                guardrails=guardrails,
                parallel=parallel_tool_calls,
            )
            messages.extend(tool_messages)
            emit_event(on_event, "messages_updated", {"messages": messages})

        t("iterations", iteration)
        t("result", response)

    # Process final response (directly, not via run)
    if raw:
        emit_event(on_event, "done", {"response": response, "messages": messages})
        return response
    processed_result = process(agent, response)
    if guardrails is not None and isinstance(processed_result, str):
        assistant_msg = Message(role="assistant", parts=[TextPart(value=processed_result)])
        gr = guardrails.check_output(assistant_msg)
        if not gr.allowed:
            emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
            raise GuardrailError(gr.reason or "Output guardrail denied")
        if gr.rewrite is not None:
            processed_result = gr.rewrite
    emit_event(on_event, "done", {"response": processed_result, "messages": messages})
    if target_type is not None:
        return cast(processed_result, target_type)
    return processed_result


@trace
async def turn_async(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    tools: dict[str, Callable[..., Any]] | None = None,
    max_iterations: int = _DEFAULT_MAX_ITERATIONS,
    raw: bool = False,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    context_budget: int | None = None,
    guardrails: Guardrails | None = None,
    steering: Steering | None = None,
    parallel_tool_calls: bool = False,
    target_type: type | None = None,
) -> Any:
    """Async variant of :func:`turn`."""
    from ..tracing.tracer import Tracer
    from .loader import load_async

    if isinstance(prompt, str):
        agent = await load_async(prompt)
    else:
        agent = prompt
    tools = tools or {}
    parent_inputs = inputs or {}
    messages = await prepare_async(agent, inputs)

    # Fast path: no tools and no loop extensions — single executor + process call (not via run)
    _has_extensions = on_event is not None or cancel is not None or context_budget is not None or guardrails is not None or steering is not None
    if not tools and not _has_extensions:
        response = await _invoke_executor_async(agent, messages)
        if raw:
            return response
        result = await process_async(agent, response)
        if target_type is not None:
            return cast(result, target_type)
        return result

    # Tool-call loop
    with Tracer.start("AgentLoopAsync") as t:
        t("type", "agent")
        t("tools", list(tools.keys()))

        response = None
        iteration = 0

        while True:
            if cancel is not None and cancel.is_cancelled:
                emit_event(on_event, "cancelled", {})
                raise CancelledError()

            if steering is not None:
                pending = steering.drain()
                if pending:
                    messages.extend(pending)
                    emit_event(on_event, "messages_updated", {"messages": messages})
                    emit_event(on_event, "status", {"message": f"Injected {len(pending)} steering message(s)"})

            if context_budget is not None:
                dropped_count, _ = trim_to_context_window(messages, context_budget)
                if dropped_count > 0:
                    emit_event(on_event, "messages_updated", {"messages": messages})
                    emit_event(on_event, "status", {"message": f"Trimmed {dropped_count} messages for context budget"})

            if guardrails is not None:
                gr_input = guardrails.check_input(messages)
                if not gr_input.allowed:
                    emit_event(on_event, "error", {"message": f"Input guardrail denied: {gr_input.reason}"})
                    raise GuardrailError(gr_input.reason or "Input guardrail denied")
                if gr_input.rewrite is not None:
                    messages = gr_input.rewrite
                    emit_event(on_event, "messages_updated", {"messages": messages})

            if cancel is not None and cancel.is_cancelled:
                emit_event(on_event, "cancelled", {})
                raise CancelledError()

            # Call LLM (directly via executor, not via run)
            response = await _invoke_executor_async(agent, messages)

            # Streaming: consume through processor, extract tool calls
            if _is_stream(response):
                streamed_tool_calls, content = await _consume_stream_async(agent, response, on_event)

                if not streamed_tool_calls:
                    if guardrails is not None and content:
                        assistant_msg = Message(role="assistant", parts=[TextPart(value=content)])
                        gr = guardrails.check_output(assistant_msg)
                        if not gr.allowed:
                            emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
                            raise GuardrailError(gr.reason or "Output guardrail denied")
                        if gr.rewrite is not None:
                            content = gr.rewrite
                    t("iterations", iteration)
                    t("result", content)
                    emit_event(on_event, "done", {"response": content, "messages": messages})
                    return content

                if guardrails is not None and content:
                    assistant_msg = Message(role="assistant", parts=[TextPart(value=content)])
                    gr = guardrails.check_output(assistant_msg)
                    if not gr.allowed:
                        emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
                        raise GuardrailError(gr.reason or "Output guardrail denied")
                    if gr.rewrite is not None:
                        content = gr.rewrite

                iteration += 1
                if iteration > max_iterations:
                    raise ValueError(
                        f"Agent loop exceeded max_iterations ({max_iterations}). "
                        f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                    )

                tool_messages = await _build_tool_messages_from_calls_with_extensions_async(
                    streamed_tool_calls,
                    content,
                    tools,
                    agent,
                    parent_inputs,
                    on_event=on_event,
                    cancel=cancel,
                    guardrails=guardrails,
                    parallel=parallel_tool_calls,
                )
                messages.extend(tool_messages)
                emit_event(on_event, "messages_updated", {"messages": messages})
                continue

            # Non-streaming: check raw response
            if not _has_tool_calls(response):
                break

            if guardrails is not None:
                tool_calls_list, text_content = _extract_tool_info(response)
                if text_content:
                    assistant_msg = Message(role="assistant", parts=[TextPart(value=text_content)])
                    gr = guardrails.check_output(assistant_msg)
                    if not gr.allowed:
                        emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
                        raise GuardrailError(gr.reason or "Output guardrail denied")
                    if gr.rewrite is not None:
                        text_content = gr.rewrite

            iteration += 1
            if iteration > max_iterations:
                raise ValueError(
                    f"Agent loop exceeded max_iterations ({max_iterations}). "
                    f"The model kept requesting tool calls. Increase max_iterations or check your tools."
                )

            tool_messages = await _build_tool_result_messages_with_extensions_async(
                response,
                tools,
                agent,
                parent_inputs,
                on_event=on_event,
                cancel=cancel,
                guardrails=guardrails,
                parallel=parallel_tool_calls,
            )
            messages.extend(tool_messages)
            emit_event(on_event, "messages_updated", {"messages": messages})

        t("iterations", iteration)
        t("result", response)

    # Process final response (directly, not via run)
    if raw:
        emit_event(on_event, "done", {"response": response, "messages": messages})
        return response
    processed_result = await process_async(agent, response)
    if guardrails is not None and isinstance(processed_result, str):
        assistant_msg = Message(role="assistant", parts=[TextPart(value=processed_result)])
        gr = guardrails.check_output(assistant_msg)
        if not gr.allowed:
            emit_event(on_event, "error", {"message": f"Output guardrail denied: {gr.reason}"})
            raise GuardrailError(gr.reason or "Output guardrail denied")
        if gr.rewrite is not None:
            processed_result = gr.rewrite
    emit_event(on_event, "done", {"response": processed_result, "messages": messages})
    if target_type is not None:
        return cast(processed_result, target_type)
    return processed_result


def _resolve_bindings(
    agent: Any,
    fn_name: str,
    fn_args: dict[str, Any],
    parent_inputs: dict[str, Any],
) -> dict[str, Any]:
    """Merge bound values from parent_inputs into tool call arguments.

    For each binding on the matching tool, if the bound input key exists in
    *parent_inputs*, its value is injected into *fn_args* (overriding any
    LLM-provided value, since the LLM shouldn't see bound params at all).

    Returns a new dict — the original *fn_args* is not mutated.
    """
    tools = getattr(agent, "tools", None)
    if not tools or not parent_inputs:
        return fn_args

    # Find the tool definition matching fn_name
    tool = None
    for t in tools:
        if getattr(t, "name", None) == fn_name:
            tool = t
            break

    if tool is None:
        return fn_args

    bindings = getattr(tool, "bindings", None)
    if not bindings:
        return fn_args

    # Merge bound values
    merged = dict(fn_args)
    for binding in bindings:
        input_key = binding.input
        if input_key and input_key in parent_inputs:
            merged[binding.name] = parent_inputs[input_key]

    return merged


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


def _extract_tool_info(response: Any) -> tuple[list[Any], str]:
    """Extract tool calls from any provider's raw response into a normalized format.

    Returns ``(tool_calls, text_content)`` where each tool call object has
    ``.id``, ``.name``, ``.arguments`` (string). For Responses API calls,
    ``.call_id`` is also set.
    """
    from types import SimpleNamespace

    # Anthropic: response.content with tool_use blocks
    if hasattr(response, "stop_reason") and hasattr(response, "content"):
        content = response.content
        tool_calls: list[Any] = []
        text_parts: list[str] = []
        for b in content:
            if getattr(b, "type", None) == "tool_use":
                tool_calls.append(
                    SimpleNamespace(
                        id=b.id,
                        name=b.name,
                        arguments=json.dumps(b.input) if not isinstance(b.input, str) else b.input,
                    )
                )
            elif getattr(b, "type", None) == "text":
                text_parts.append(b.text)
        if tool_calls:
            return tool_calls, "".join(text_parts)

    # Responses API: response.output with function_call items
    if getattr(response, "object", None) == "response" and hasattr(response, "output"):
        func_calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]
        if func_calls:
            tool_calls = []
            for fc in func_calls:
                cid = getattr(fc, "call_id", None) or getattr(fc, "id", "")
                tool_calls.append(
                    SimpleNamespace(
                        id=cid,
                        call_id=cid,
                        name=getattr(fc, "name", ""),
                        arguments=getattr(fc, "arguments", "{}"),
                    )
                )
            return tool_calls, ""

    # OpenAI Chat: response.choices[0].message.tool_calls
    if hasattr(response, "choices") and response.choices:
        msg = response.choices[0].message
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            text_content = getattr(msg, "content", "") or ""
            tool_calls = []
            for tc in msg.tool_calls:
                tool_calls.append(
                    SimpleNamespace(
                        id=tc.id,
                        name=tc.function.name,
                        arguments=tc.function.arguments,
                    )
                )
            return tool_calls, text_content

    return [], ""


def _build_tool_result_messages(
    response: Any,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
) -> tuple[list[Message], bool]:
    """Execute tool calls from the response and build result messages.

    Extracts tool calls, dispatches them, then delegates message formatting
    to the executor's ``format_tool_messages`` method.

    Returns ``(messages_to_append, False)``.
    """
    from .discovery import get_executor

    tool_calls, text_content = _extract_tool_info(response)

    # Dispatch tools
    tool_results: list[str] = []
    for tc in tool_calls:
        result = dispatch_tool(tc.name, tc.arguments, tools, agent, parent_inputs or {})
        tool_results.append(result)

    # Delegate message formatting to executor
    provider = agent.model.provider or ""
    executor = get_executor(provider)
    messages = executor.format_tool_messages(response, tool_calls, tool_results, text_content)

    return messages, False


async def _build_tool_result_messages_async(
    response: Any,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Async variant of :func:`_build_tool_result_messages`."""
    from .discovery import get_executor

    tool_calls, text_content = _extract_tool_info(response)

    # Dispatch tools (async)
    tool_results: list[str] = []
    for tc in tool_calls:
        result = await dispatch_tool_async(tc.name, tc.arguments, tools, agent, parent_inputs or {})
        tool_results.append(result)

    # Delegate message formatting to executor
    provider = agent.model.provider or ""
    executor = get_executor(provider)
    return executor.format_tool_messages(response, tool_calls, tool_results, text_content)


def _is_stream(response: Any) -> bool:
    """Check if a response is a stream (sync or async iterable wrapper)."""
    from .types import AsyncPromptyStream, PromptyStream

    return isinstance(response, (PromptyStream, AsyncPromptyStream))


def _consume_stream(
    agent: Prompty,
    response: Any,
    on_event: EventCallback | None = None,
) -> tuple[list[Any], str]:
    """Consume a streaming response through the processor.

    Returns (tool_calls, content) where tool_calls is a list of ToolCall
    objects and content is the accumulated text.
    Emits ``token`` events for each content chunk when *on_event* is provided.
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
                emit_event(on_event, "token", {"token": item})
    elif isinstance(processed, str):
        text_parts.append(processed)
        emit_event(on_event, "token", {"token": processed})

    return tool_calls, "".join(text_parts)


async def _consume_stream_async(
    agent: Prompty,
    response: Any,
    on_event: EventCallback | None = None,
) -> tuple[list[Any], str]:
    """Async: consume a streaming response through the processor.

    Emits ``token`` events for each content chunk when *on_event* is provided.
    """
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
                emit_event(on_event, "token", {"token": item})
    elif hasattr(processed, "__iter__") and not isinstance(processed, (str, bytes)):
        for item in processed:
            if isinstance(item, ToolCall):
                tool_calls.append(item)
            elif isinstance(item, str):
                text_parts.append(item)
                emit_event(on_event, "token", {"token": item})
    elif isinstance(processed, str):
        text_parts.append(processed)
        emit_event(on_event, "token", {"token": processed})

    return tool_calls, "".join(text_parts)


def _build_tool_messages_from_calls(
    tool_calls: list[Any],
    text_content: str,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Build tool result messages from processed ToolCall objects (streaming path).

    Dispatches tools, then delegates message formatting to the executor.
    """
    from .discovery import get_executor

    # Dispatch tools
    tool_results: list[str] = []
    for tc in tool_calls:
        result = dispatch_tool(tc.name, tc.arguments, tools, agent, parent_inputs or {})
        tool_results.append(result)

    # Delegate message formatting to executor
    provider = agent.model.provider or ""
    executor = get_executor(provider)
    return executor.format_tool_messages(None, tool_calls, tool_results, text_content)


async def _build_tool_messages_from_calls_async(
    tool_calls: list[Any],
    text_content: str,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Async: build tool result messages from processed ToolCall objects."""
    from .discovery import get_executor

    # Dispatch tools (async)
    tool_results: list[str] = []
    for tc in tool_calls:
        result = await dispatch_tool_async(tc.name, tc.arguments, tools, agent, parent_inputs or {})
        tool_results.append(result)

    # Delegate message formatting to executor
    provider = agent.model.provider or ""
    executor = get_executor(provider)
    return executor.format_tool_messages(None, tool_calls, tool_results, text_content)


def invoke_agent(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    tools: dict[str, Callable[..., Any]] | None = None,
    max_iterations: int = _DEFAULT_MAX_ITERATIONS,
    raw: bool = False,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    context_budget: int | None = None,
    guardrails: Guardrails | None = None,
    steering: Steering | None = None,
    parallel_tool_calls: bool = False,
    target_type: type | None = None,
) -> Any:
    """Run a prompt with automatic tool-call execution loop.

    .. deprecated::
        Use :func:`turn` instead.  ``invoke_agent`` will be removed in a
        future release.
    """
    warnings.warn(
        "invoke_agent is deprecated, use turn() instead",
        DeprecationWarning,
        stacklevel=2,
    )
    return turn(
        prompt,
        inputs,
        tools=tools,
        max_iterations=max_iterations,
        raw=raw,
        on_event=on_event,
        cancel=cancel,
        context_budget=context_budget,
        guardrails=guardrails,
        steering=steering,
        parallel_tool_calls=parallel_tool_calls,
        target_type=target_type,
    )


async def invoke_agent_async(
    prompt: str | Prompty,
    inputs: dict[str, Any] | None = None,
    *,
    tools: dict[str, Callable[..., Any]] | None = None,
    max_iterations: int = _DEFAULT_MAX_ITERATIONS,
    raw: bool = False,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    context_budget: int | None = None,
    guardrails: Guardrails | None = None,
    steering: Steering | None = None,
    parallel_tool_calls: bool = False,
    target_type: type | None = None,
) -> Any:
    """Async variant of :func:`invoke_agent`.

    .. deprecated::
        Use :func:`turn_async` instead.
    """
    warnings.warn(
        "invoke_agent_async is deprecated, use turn_async() instead",
        DeprecationWarning,
        stacklevel=2,
    )
    return await turn_async(
        prompt,
        inputs,
        tools=tools,
        max_iterations=max_iterations,
        raw=raw,
        on_event=on_event,
        cancel=cancel,
        context_budget=context_budget,
        guardrails=guardrails,
        steering=steering,
        parallel_tool_calls=parallel_tool_calls,
        target_type=target_type,
    )


# ---------------------------------------------------------------------------
# §13 Extension helpers for tool dispatch
# ---------------------------------------------------------------------------


def _build_tool_result_messages_with_extensions(
    response: Any,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
    *,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    guardrails: Guardrails | None = None,
    parallel: bool = False,
) -> tuple[list[Message], bool]:
    """Tool dispatch with §13 extensions: events, cancellation, guardrails, parallel."""
    from .discovery import get_executor

    tool_calls, text_content = _extract_tool_info(response)

    tool_results = _dispatch_tools_with_extensions(
        tool_calls,
        tools,
        agent,
        parent_inputs or {},
        on_event=on_event,
        cancel=cancel,
        guardrails=guardrails,
        parallel=parallel,
    )

    provider = agent.model.provider or ""
    executor = get_executor(provider)
    messages = executor.format_tool_messages(response, tool_calls, tool_results, text_content)
    return messages, False


async def _build_tool_result_messages_with_extensions_async(
    response: Any,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
    *,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    guardrails: Guardrails | None = None,
    parallel: bool = False,
) -> list[Message]:
    """Async tool dispatch with §13 extensions."""
    from .discovery import get_executor

    tool_calls, text_content = _extract_tool_info(response)

    tool_results = await _dispatch_tools_with_extensions_async(
        tool_calls,
        tools,
        agent,
        parent_inputs or {},
        on_event=on_event,
        cancel=cancel,
        guardrails=guardrails,
        parallel=parallel,
    )

    provider = agent.model.provider or ""
    executor = get_executor(provider)
    return executor.format_tool_messages(response, tool_calls, tool_results, text_content)


def _build_tool_messages_from_calls_with_extensions(
    tool_calls: list[Any],
    text_content: str,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
    *,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    guardrails: Guardrails | None = None,
    parallel: bool = False,
) -> list[Message]:
    """Streaming-path tool dispatch with §13 extensions."""
    from .discovery import get_executor

    tool_results = _dispatch_tools_with_extensions(
        tool_calls,
        tools,
        agent,
        parent_inputs or {},
        on_event=on_event,
        cancel=cancel,
        guardrails=guardrails,
        parallel=parallel,
    )

    provider = agent.model.provider or ""
    executor = get_executor(provider)
    return executor.format_tool_messages(None, tool_calls, tool_results, text_content)


async def _build_tool_messages_from_calls_with_extensions_async(
    tool_calls: list[Any],
    text_content: str,
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any] | None = None,
    *,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    guardrails: Guardrails | None = None,
    parallel: bool = False,
) -> list[Message]:
    """Async streaming-path tool dispatch with §13 extensions."""
    from .discovery import get_executor

    tool_results = await _dispatch_tools_with_extensions_async(
        tool_calls,
        tools,
        agent,
        parent_inputs or {},
        on_event=on_event,
        cancel=cancel,
        guardrails=guardrails,
        parallel=parallel,
    )

    provider = agent.model.provider or ""
    executor = get_executor(provider)
    return executor.format_tool_messages(None, tool_calls, tool_results, text_content)


def _dispatch_tools_with_extensions(
    tool_calls: list[Any],
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any],
    *,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    guardrails: Guardrails | None = None,
    parallel: bool = False,
) -> list[str]:
    """Dispatch tool calls with events, cancellation, guardrails, and optional parallelism."""

    def _dispatch_one(tc: Any) -> str:
        name = getattr(tc, "name", "")
        arguments = getattr(tc, "arguments", "{}")

        # §13.2 — Check cancellation before each tool
        if cancel is not None and cancel.is_cancelled:
            emit_event(on_event, "cancelled", {})
            raise CancelledError()

        # §13.1 — Emit tool_call_start
        emit_event(on_event, "tool_call_start", {"name": name, "arguments": arguments})

        # §13.4 — Tool guardrail
        if guardrails is not None:
            parsed_args = json.loads(arguments) if isinstance(arguments, str) else arguments
            gr = guardrails.check_tool(name, parsed_args if isinstance(parsed_args, dict) else {})
            if not gr.allowed:
                denied_msg = f"Tool denied by guardrail: {gr.reason}"
                emit_event(on_event, "tool_result", {"name": name, "result": denied_msg})
                return denied_msg
            if gr.rewrite is not None:
                arguments = json.dumps(gr.rewrite) if isinstance(gr.rewrite, dict) else gr.rewrite

        # Execute tool
        result = dispatch_tool(name, arguments, tools, agent, parent_inputs)

        # §13.1 — Emit tool_result
        emit_event(on_event, "tool_result", {"name": name, "result": result})
        return result

    # §13.6 — Parallel tool execution
    if parallel and len(tool_calls) > 1:
        with ThreadPoolExecutor() as pool:
            futures = [pool.submit(_dispatch_one, tc) for tc in tool_calls]
            return [f.result() for f in futures]
    else:
        return [_dispatch_one(tc) for tc in tool_calls]


async def _dispatch_tools_with_extensions_async(
    tool_calls: list[Any],
    tools: dict[str, Callable[..., Any]],
    agent: Prompty,
    parent_inputs: dict[str, Any],
    *,
    on_event: EventCallback | None = None,
    cancel: CancellationToken | None = None,
    guardrails: Guardrails | None = None,
    parallel: bool = False,
) -> list[str]:
    """Async dispatch tool calls with events, cancellation, guardrails, and optional parallelism."""

    async def _dispatch_one(tc: Any) -> str:
        name = getattr(tc, "name", "")
        arguments = getattr(tc, "arguments", "{}")

        # §13.2 — Check cancellation before each tool
        if cancel is not None and cancel.is_cancelled:
            emit_event(on_event, "cancelled", {})
            raise CancelledError()

        # §13.1 — Emit tool_call_start
        emit_event(on_event, "tool_call_start", {"name": name, "arguments": arguments})

        # §13.4 — Tool guardrail
        if guardrails is not None:
            parsed_args = json.loads(arguments) if isinstance(arguments, str) else arguments
            gr = guardrails.check_tool(name, parsed_args if isinstance(parsed_args, dict) else {})
            if not gr.allowed:
                denied_msg = f"Tool denied by guardrail: {gr.reason}"
                emit_event(on_event, "tool_result", {"name": name, "result": denied_msg})
                return denied_msg
            if gr.rewrite is not None:
                arguments = json.dumps(gr.rewrite) if isinstance(gr.rewrite, dict) else gr.rewrite

        # Execute tool
        result = await dispatch_tool_async(name, arguments, tools, agent, parent_inputs)

        # §13.1 — Emit tool_result
        emit_event(on_event, "tool_result", {"name": name, "result": result})
        return result

    # §13.6 — Parallel tool execution
    if parallel and len(tool_calls) > 1:
        tasks = [_dispatch_one(tc) for tc in tool_calls]
        return list(await asyncio.gather(*tasks))
    else:
        results: list[str] = []
        for tc in tool_calls:
            results.append(await _dispatch_one(tc))
        return results
