"""Stateless pipeline functions for prompt execution.

Pipeline stages:
    prepare()  →  render + parse + expand  →  list[Message]
    execute()  →  single LLM call          →  raw response
    process()  →  response extraction      →  clean result
    run()      →  load + prepare + execute + process
"""

from __future__ import annotations

from typing import Any

from agentschema import PromptAgent

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
    "prepare",
    "prepare_async",
    "execute",
    "execute_async",
    "process",
    "process_async",
    "run",
    "run_async",
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
    agent: PromptAgent,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Validate and fill defaults for inputs against ``agent.inputSchema``.

    Parameters
    ----------
    agent:
        The loaded PromptAgent.
    inputs:
        User-provided input values.

    Returns
    -------
    dict
        Validated inputs with defaults applied.

    Raises
    ------
    ValueError
        If required inputs are missing or unknown inputs are provided
        in strict mode.
    """
    if agent.inputSchema is None:
        return dict(inputs)

    schema = agent.inputSchema
    props = {p.name: p for p in schema.properties}
    result = dict(inputs)

    # Apply defaults for missing inputs
    for name, prop in props.items():
        if name not in result:
            if prop.default is not None:
                result[name] = prop.default
            elif prop.example is not None:
                result[name] = prop.example
            elif prop.required:
                raise ValueError(
                    f"Required input '{name}' not provided and has no default value."
                )

    # Strict mode: reject unknown keys
    if schema.strict:
        unknown = set(result.keys()) - set(props.keys())
        if unknown:
            raise ValueError(
                f"Unknown input(s) in strict mode: {', '.join(sorted(unknown))}. "
                f"Declared inputs: {', '.join(sorted(props.keys()))}"
            )

    return result


# ---------------------------------------------------------------------------
# Thread-marker helpers
# ---------------------------------------------------------------------------


def _get_rich_input_names(agent: PromptAgent) -> dict[str, str]:
    """Return {property_name: kind} for all rich-kind inputs."""
    if agent.inputSchema is None:
        return {}
    return {
        p.name: p.kind for p in agent.inputSchema.properties if p.kind in RICH_KINDS
    }


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
            source = (
                url_data.get("url", "") if isinstance(url_data, dict) else str(url_data)
            )
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
# Pipeline: prepare()
# ---------------------------------------------------------------------------


@trace
def prepare(
    agent: PromptAgent,
    inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Render, parse, and expand a prompt into a message array.

    Pipeline:
        1. Validate inputs against ``agent.inputSchema``
        2. Discover parser; if ``Format.strict``, call ``pre_render()``
        3. Discover renderer; call ``render()``
        4. Call ``parser.parse()``
        5. Expand thread markers with structured messages from inputs

    Parameters
    ----------
    agent:
        A loaded ``PromptAgent``.
    inputs:
        Input values for template rendering.

    Returns
    -------
    list[Message]
        Model-agnostic message array ready for execution.
    """
    inputs = validate_inputs(agent, inputs or {})
    rich_inputs = _get_rich_input_names(agent)

    # Determine format and parser kinds
    format_kind = "jinja2"  # default
    parser_kind = "prompty"  # default
    is_strict = True  # default: enforce sanitization

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
        if (
            agent.template.format is not None
            and agent.template.format.strict is not None
        ):
            is_strict = agent.template.format.strict

    template = agent.instructions or ""

    # Discover parser
    parser = get_parser(parser_kind)

    # Pre-render sanitization (if strict and parser supports it)
    parse_context: dict[str, Any] = {}
    if is_strict and hasattr(parser, "pre_render"):
        template, parse_context = parser.pre_render(template)  # type: ignore[union-attr]

    # Discover renderer and render
    # The renderer replaces thread-kind inputs with nonce markers
    # and stashes the nonce→name mapping on _last_thread_nonces
    renderer = get_renderer(format_kind)
    rendered = renderer.render(agent, template, inputs)

    # Retrieve thread nonces emitted by the renderer
    thread_nonces: dict[str, str] = getattr(renderer, "_last_thread_nonces", {})

    # Parse into abstract messages
    messages = parser.parse(agent, rendered, **parse_context)

    # Inject ThreadMarker objects where the renderer placed nonce markers
    expanded: list[Message | ThreadMarker] = list(messages)
    if thread_nonces:
        expanded = _inject_thread_markers(messages, thread_nonces)

    # Expand thread markers with actual conversation messages
    return _expand_thread_markers(expanded, inputs, rich_inputs)


@trace
async def prepare_async(
    agent: PromptAgent,
    inputs: dict[str, Any] | None = None,
) -> list[Message]:
    """Async variant of :func:`prepare`."""
    inputs = validate_inputs(agent, inputs or {})
    rich_inputs = _get_rich_input_names(agent)

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
        if (
            agent.template.format is not None
            and agent.template.format.strict is not None
        ):
            is_strict = agent.template.format.strict

    template = agent.instructions or ""

    parser = get_parser(parser_kind)

    parse_context: dict[str, Any] = {}
    if is_strict and hasattr(parser, "pre_render"):
        template, parse_context = parser.pre_render(template)  # type: ignore[union-attr]

    renderer = get_renderer(format_kind)
    rendered = await renderer.render_async(agent, template, inputs)

    thread_nonces: dict[str, str] = getattr(renderer, "_last_thread_nonces", {})

    messages = await parser.parse_async(agent, rendered, **parse_context)

    expanded: list[Message | ThreadMarker] = list(messages)
    if thread_nonces:
        expanded = _inject_thread_markers(messages, thread_nonces)

    return _expand_thread_markers(expanded, inputs, rich_inputs)


# ---------------------------------------------------------------------------
# Pipeline: execute()
# ---------------------------------------------------------------------------


@trace
def execute(
    agent: PromptAgent,
    messages: list[Message],
) -> Any:
    """Execute a single LLM call with the given messages.

    The executor is discovered via entry point using
    ``agent.model.provider``. It maps abstract messages to the
    provider's wire format internally.

    Parameters
    ----------
    agent:
        A loaded ``PromptAgent`` with model configuration.
    messages:
        Abstract message array from :func:`prepare`.

    Returns
    -------
    Any
        Raw LLM response (provider-specific).
    """
    provider = agent.model.provider or ""
    if not provider:
        raise InvokerError("prompty.executors", "(no provider set)")
    executor = get_executor(provider)
    return executor.execute(agent, messages)


@trace
async def execute_async(
    agent: PromptAgent,
    messages: list[Message],
) -> Any:
    """Async variant of :func:`execute`."""
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
    agent: PromptAgent,
    response: Any,
) -> Any:
    """Extract a clean result from a raw LLM response.

    Parameters
    ----------
    agent:
        The ``PromptAgent`` used for the call.
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
    agent: PromptAgent,
    response: Any,
) -> Any:
    """Async variant of :func:`process`."""
    provider = agent.model.provider or ""
    if not provider:
        raise InvokerError("prompty.processors", "(no provider set)")
    processor = get_processor(provider)
    return await processor.process_async(agent, response)


# ---------------------------------------------------------------------------
# Pipeline: run()
# ---------------------------------------------------------------------------


@trace
def run(
    prompt: str | PromptAgent,
    inputs: dict[str, Any] | None = None,
    *,
    raw: bool = False,
) -> Any:
    """Full pipeline: load → prepare → execute → process.

    Parameters
    ----------
    prompt:
        Path to a ``.prompty`` file, or a pre-loaded ``PromptAgent``.
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
    response = execute(agent, messages)
    if raw:
        return response
    return process(agent, response)


@trace
async def run_async(
    prompt: str | PromptAgent,
    inputs: dict[str, Any] | None = None,
    *,
    raw: bool = False,
) -> Any:
    """Async variant of :func:`run`."""
    from .loader import load_async

    if isinstance(prompt, str):
        agent = await load_async(prompt)
    else:
        agent = prompt
    messages = await prepare_async(agent, inputs)
    response = await execute_async(agent, messages)
    if raw:
        return response
    return await process_async(agent, response)
