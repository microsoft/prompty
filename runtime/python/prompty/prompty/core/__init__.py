"""Core infrastructure — loading, types, protocols, discovery, pipeline, connections, and tool dispatch."""

from __future__ import annotations

from .agent_events import AgentEvent, EventCallback, emit_event
from .cancellation import CancellationToken, CancelledError
from .connections import clear_connections, get_connection, register_connection
from .context import estimate_chars, summarize_dropped, trim_to_context_window
from .discovery import (
    InvokerError,
    clear_cache,
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
)
from .guardrails import GuardrailError, GuardrailResult, Guardrails
from .loader import default_save_context, load, load_async
from .pipeline import (
    invoke,
    invoke_agent,
    invoke_agent_async,
    invoke_async,
    prepare,
    prepare_async,
    process,
    process_async,
    run,
    run_async,
    validate_inputs,
)
from .protocols import (
    ExecutorProtocol,
    ParserProtocol,
    ProcessorProtocol,
    RendererProtocol,
)
from .steering import Steering
from .tool_decorator import tool
from .tool_dispatch import (
    ToolHandler,
    ToolHandlerError,
    clear_tool_handlers,
    clear_tools,
    dispatch_tool,
    dispatch_tool_async,
    get_tool,
    get_tool_handler,
    register_tool,
    register_tool_handler,
)
from .types import (
    RICH_KINDS,
    ROLES,
    AsyncPromptyStream,
    AudioPart,
    ContentPart,
    FilePart,
    ImagePart,
    Message,
    PromptyStream,
    TextPart,
    ThreadMarker,
)
