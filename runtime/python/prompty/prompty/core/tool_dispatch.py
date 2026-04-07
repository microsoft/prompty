"""Two-layer tool dispatch for the agent loop (spec §11.2).

Layer 1 — **Name registry**: per-tool handlers keyed by tool name.
Explicit overrides and user-provided function callables live here.
API: ``register_tool()``, ``get_tool()``, ``clear_tools()``.

Layer 2 — **Kind handlers**: per-kind handlers keyed by tool kind
(``"function"``, ``"prompty"``, ``"mcp"``, ``"openapi"``, ``"*"``).
Extensible fallbacks that handle entire categories of tools.
API: ``register_tool_handler()``, ``get_tool_handler()``,
``clear_tool_handlers()``.

Dispatch order (in ``dispatch_tool()`` / ``dispatch_tool_async()``):

1. User-provided ``tools`` dict (per-call override, highest priority)
2. Global name registry (``get_tool(name)``)
3. Kind handler fallback (``get_tool_handler(kind)``)

Built-in kind handlers are auto-registered at import time.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

__all__ = [
    "ToolHandler",
    "ToolHandlerError",
    "register_tool",
    "get_tool",
    "clear_tools",
    "register_tool_handler",
    "get_tool_handler",
    "clear_tool_handlers",
    "FunctionToolHandler",
    "PromptyToolHandler",
    "McpToolHandler",
    "OpenApiToolHandler",
    "CustomToolHandler",
    "dispatch_tool",
    "dispatch_tool_async",
]


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ToolHandler(Protocol):
    """Protocol for tool dispatch handlers.

    Each handler knows how to execute a specific kind of tool (e.g.
    ``"prompty"``, ``"mcp"``, ``"openapi"``).  Both sync and async
    methods must be implemented.
    """

    def execute_tool(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Execute *tool* synchronously with the given *args*.

        Returns the tool result as a string.
        """
        ...

    async def execute_tool_async(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Async variant of :meth:`execute_tool`."""
        ...


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ToolHandlerError(Exception):
    """Raised when no tool handler is registered for a given kind."""

    def __init__(self, kind: str) -> None:
        super().__init__(f"No tool handler registered for kind '{kind}'. Register one with register_tool_handler().")
        self.kind = kind


# ---------------------------------------------------------------------------
# Layer 1: Name Registry (spec §11.2 — per-tool handlers by name)
# ---------------------------------------------------------------------------

_name_registry: dict[str, Callable[..., Any]] = {}


def register_tool(name: str, handler: Callable[..., Any]) -> None:
    """Register a per-name tool handler (spec §11.2 Layer 1).

    The handler is a callable that takes keyword arguments and returns a
    result.  Name-registered tools take priority over kind handlers.
    """
    _name_registry[name] = handler


def get_tool(name: str) -> Callable[..., Any] | None:
    """Look up a per-name handler; return ``None`` if absent."""
    return _name_registry.get(name)


def clear_tools() -> None:
    """Remove all per-name registrations (for testing)."""
    _name_registry.clear()


# ---------------------------------------------------------------------------
# Layer 2: Kind Handler Registry (spec §11.2 — per-kind handlers)
# ---------------------------------------------------------------------------

_handlers: dict[str, ToolHandler] = {}


def register_tool_handler(kind: str, handler: ToolHandler) -> None:
    """Register a ``ToolHandler`` for *kind* (e.g. ``"prompty"``)."""
    _handlers[kind] = handler


def get_tool_handler(kind: str) -> ToolHandler:
    """Return the handler for *kind*, or raise :class:`ToolHandlerError`."""
    handler = _handlers.get(kind)
    if handler is None:
        raise ToolHandlerError(kind)
    return handler


def clear_tool_handlers() -> None:
    """Remove all registered handlers (useful for testing)."""
    _handlers.clear()


# ---------------------------------------------------------------------------
# Built-in handlers
# ---------------------------------------------------------------------------


class FunctionToolHandler:
    """Handler for ``kind: "function"`` tools.

    Function tools require a user-provided callable, which should be in
    the name registry or user_tools dict.  If the dispatch reaches this
    kind handler, it means no callable was found — emit a helpful error.
    """

    def execute_tool(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Error — function tool callable was not provided."""
        name = getattr(tool, "name", "unknown")
        raise ValueError(
            f"Function tool '{name}' declared but no callable provided. "
            f"Pass it via tools={{'{name}': fn}} in execute_agent()."
        )

    async def execute_tool_async(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Error — function tool callable was not provided."""
        name = getattr(tool, "name", "unknown")
        raise ValueError(
            f"Function tool '{name}' declared but no callable provided. "
            f"Pass it via tools={{'{name}': fn}} in execute_agent()."
        )


class PromptyToolHandler:
    """Handler for ``kind: "prompty"`` tools.

    Resolves a child ``.prompty`` file relative to the parent agent's
    ``__source_path`` metadata, loads it, and runs it in either
    ``"single"`` or ``"agentic"`` mode.

    Tracks loaded paths via ``__prompty_tool_stack`` metadata to detect
    and prevent circular references (A → B → A).
    """

    def execute_tool(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Load and execute a child .prompty file synchronously."""
        # Lazy imports to avoid circular dependency with pipeline.py
        from .loader import load
        from .pipeline import invoke_agent, prepare, run

        try:
            child_path = self._resolve_child_path(tool, agent)
            self._check_circular(child_path, agent)
            child = load(child_path)
            # Propagate the visited-path stack to the child
            stack = list((agent.metadata or {}).get("__prompty_tool_stack", []))
            stack.append(child_path)
            if not child.metadata:
                child.metadata = {}
            child.metadata["__prompty_tool_stack"] = stack

            mode = getattr(tool, "mode", "single")
            if mode == "agentic":
                result = invoke_agent(child, args)
            else:
                messages = prepare(child, args)
                result = run(child, messages)
        except Exception as e:
            return f"Error executing PromptyTool '{tool.name}': {type(e).__name__}: {e}"

        return str(result)

    async def execute_tool_async(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Load and execute a child .prompty file asynchronously."""
        from .loader import load
        from .pipeline import invoke_agent_async, prepare_async, run_async

        try:
            child_path = self._resolve_child_path(tool, agent)
            self._check_circular(child_path, agent)
            child = load(child_path)
            # Propagate the visited-path stack to the child
            stack = list((agent.metadata or {}).get("__prompty_tool_stack", []))
            stack.append(child_path)
            if not child.metadata:
                child.metadata = {}
            child.metadata["__prompty_tool_stack"] = stack

            mode = getattr(tool, "mode", "single")
            if mode == "agentic":
                result = await invoke_agent_async(child, args)
            else:
                messages = await prepare_async(child, args)
                result = await run_async(child, messages)
        except Exception as e:
            return f"Error executing PromptyTool '{tool.name}': {type(e).__name__}: {e}"

        return str(result)

    @staticmethod
    def _resolve_child_path(tool: Any, agent: Any) -> str:
        """Resolve the child .prompty path relative to the parent agent."""
        metadata = agent.metadata if agent and getattr(agent, "metadata", None) else {}
        parent_path = metadata.get("__source_path", "")
        if not parent_path:
            raise FileNotFoundError(f"Cannot resolve PromptyTool '{tool.name}': parent agent has no __source_path")
        return str(Path(parent_path).parent / tool.path)

    @staticmethod
    def _check_circular(child_path: str, agent: Any) -> None:
        """Raise if the child path is already in the call stack."""
        metadata = agent.metadata if agent and getattr(agent, "metadata", None) else {}
        stack: list[str] = metadata.get("__prompty_tool_stack", [])
        # Normalize for comparison
        normalized = str(Path(child_path).resolve())
        parent_source = metadata.get("__source_path", "")
        normalized_parent = str(Path(parent_source).resolve()) if parent_source else ""
        visited = {str(Path(p).resolve()) for p in stack}
        if normalized_parent:
            visited.add(normalized_parent)
        if normalized in visited:
            chain = (
                " → ".join([*stack, parent_source, child_path]) if parent_source else " → ".join([*stack, child_path])
            )
            raise RecursionError(f"Circular PromptyTool reference detected: {chain}")


class McpToolHandler:
    """Placeholder handler for ``kind: "mcp"`` tools."""

    def execute_tool(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Not yet implemented."""
        raise NotImplementedError("MCP tool dispatch is not yet implemented")

    async def execute_tool_async(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Not yet implemented."""
        raise NotImplementedError("MCP tool dispatch is not yet implemented")


class OpenApiToolHandler:
    """Placeholder handler for ``kind: "openapi"`` tools."""

    def execute_tool(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Not yet implemented."""
        raise NotImplementedError("OpenAPI tool dispatch is not yet implemented")

    async def execute_tool_async(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Not yet implemented."""
        raise NotImplementedError("OpenAPI tool dispatch is not yet implemented")


class CustomToolHandler:
    """Placeholder handler for unknown/custom tool kinds (wildcard ``"*"``)."""

    def execute_tool(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Not yet implemented."""
        raise NotImplementedError("Custom tool dispatch is not yet implemented")

    async def execute_tool_async(
        self,
        tool: Any,
        args: dict[str, Any],
        agent: Any,
        parent_inputs: dict[str, Any],
    ) -> str:
        """Not yet implemented."""
        raise NotImplementedError("Custom tool dispatch is not yet implemented")


# ---------------------------------------------------------------------------
# Main dispatch entry points
# ---------------------------------------------------------------------------


def _resolve_bindings_safe(
    agent: Any,
    tool_name: str,
    args: dict[str, Any],
    parent_inputs: dict[str, Any],
) -> dict[str, Any]:
    """Import and call ``_resolve_bindings`` from the pipeline module.

    Uses a lazy import to avoid circular dependency.
    """
    from .pipeline import _resolve_bindings

    return _resolve_bindings(agent, tool_name, args, parent_inputs)


def dispatch_tool(
    tool_name: str,
    arguments_json: str,
    user_tools: dict[str, Callable[..., Any]],
    agent: Any,
    parent_inputs: dict[str, Any],
) -> str:
    """Dispatch a tool call synchronously.

    Resolution order:

    1. Parse *arguments_json* as JSON.
    2. Resolve bindings from *parent_inputs* into the parsed args.
    3. Check *user_tools* for a matching function — if found, call it directly.
    4. Search ``agent.tools`` for a tool definition matching *tool_name*.
    5. Look up the handler via ``get_tool_handler(tool.kind)`` and delegate.
    6. If nothing matches, return an error string.

    Parameters
    ----------
    tool_name:
        Name of the tool to execute (from the LLM's tool_call).
    arguments_json:
        JSON-encoded arguments string from the LLM.
    user_tools:
        User-provided tool functions keyed by name.
    agent:
        The parent agent (carries tool definitions and metadata).
    parent_inputs:
        The original inputs to the parent agent (for binding resolution).

    Returns
    -------
    str
        The tool result, or an error message string on failure.
    """
    # 1. Parse arguments
    try:
        args = json.loads(arguments_json) if arguments_json else {}
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON arguments for '{tool_name}': {e}"

    # 2. Resolve bindings
    if agent is not None and parent_inputs:
        args = _resolve_bindings_safe(agent, tool_name, args, parent_inputs)

    # 3. Check user-provided tool functions first (per-call override)
    fn = user_tools.get(tool_name)
    if fn is not None:
        if inspect.iscoroutinefunction(fn):
            return f"Error: async tool '{tool_name}' cannot be called in sync mode"
        try:
            return str(fn(**args))
        except Exception as e:
            return f"Error calling '{tool_name}': {type(e).__name__}: {e}"

    # 4. Check global name registry (spec §11.2 Layer 1)
    registered_fn = get_tool(tool_name)
    if registered_fn is not None:
        if inspect.iscoroutinefunction(registered_fn):
            return f"Error: async tool '{tool_name}' cannot be called in sync mode"
        try:
            return str(registered_fn(**args))
        except Exception as e:
            return f"Error calling '{tool_name}': {type(e).__name__}: {e}"

    # 5. Search agent.tools for a matching definition → kind handler (Layer 2)
    tool_def = _find_tool_by_name(agent, tool_name)
    if tool_def is not None:
        kind = getattr(tool_def, "kind", None) or "*"
        try:
            handler = get_tool_handler(kind)
        except ToolHandlerError:
            # Fall back to wildcard handler
            try:
                handler = get_tool_handler("*")
            except ToolHandlerError:
                return f"Error: no handler registered for tool kind '{kind}' (tool '{tool_name}')"
        try:
            return handler.execute_tool(tool_def, args, agent, parent_inputs)
        except NotImplementedError as e:
            return f"Error: {e}"
        except Exception as e:
            return f"Error dispatching tool '{tool_name}': {type(e).__name__}: {e}"

    # 6. Nothing matched
    available = ", ".join(sorted(user_tools)) if user_tools else "(none)"
    return f"Error: tool '{tool_name}' not found in user_tools or agent.tools. Available user tools: {available}"


async def dispatch_tool_async(
    tool_name: str,
    arguments_json: str,
    user_tools: dict[str, Callable[..., Any]],
    agent: Any,
    parent_inputs: dict[str, Any],
) -> str:
    """Async variant of :func:`dispatch_tool`.

    Same resolution order as the sync version, but awaits async user
    functions and calls ``handler.execute_tool_async()`` for registered
    handlers.
    """
    # 1. Parse arguments
    try:
        args = json.loads(arguments_json) if arguments_json else {}
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON arguments for '{tool_name}': {e}"

    # 2. Resolve bindings
    if agent is not None and parent_inputs:
        args = _resolve_bindings_safe(agent, tool_name, args, parent_inputs)

    # 3. Check user-provided tool functions first (per-call override)
    fn = user_tools.get(tool_name)
    if fn is not None:
        try:
            if inspect.iscoroutinefunction(fn):
                return str(await fn(**args))
            else:
                return str(fn(**args))
        except Exception as e:
            return f"Error calling '{tool_name}': {type(e).__name__}: {e}"

    # 4. Check global name registry (spec §11.2 Layer 1)
    registered_fn = get_tool(tool_name)
    if registered_fn is not None:
        try:
            if inspect.iscoroutinefunction(registered_fn):
                return str(await registered_fn(**args))
            else:
                return str(registered_fn(**args))
        except Exception as e:
            return f"Error calling '{tool_name}': {type(e).__name__}: {e}"

    # 5. Search agent.tools for a matching definition → kind handler (Layer 2)
    tool_def = _find_tool_by_name(agent, tool_name)
    if tool_def is not None:
        kind = getattr(tool_def, "kind", None) or "*"
        try:
            handler = get_tool_handler(kind)
        except ToolHandlerError:
            try:
                handler = get_tool_handler("*")
            except ToolHandlerError:
                return f"Error: no handler registered for tool kind '{kind}' (tool '{tool_name}')"
        try:
            return await handler.execute_tool_async(tool_def, args, agent, parent_inputs)
        except NotImplementedError as e:
            return f"Error: {e}"
        except Exception as e:
            return f"Error dispatching tool '{tool_name}': {type(e).__name__}: {e}"

    # 6. Nothing matched
    available = ", ".join(sorted(user_tools)) if user_tools else "(none)"
    return f"Error: tool '{tool_name}' not found in user_tools or agent.tools. Available user tools: {available}"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _find_tool_by_name(agent: Any, tool_name: str) -> Any | None:
    """Find a tool on *agent* by name, or return ``None``."""
    tools = getattr(agent, "tools", None)
    if not tools:
        return None
    for t in tools:
        if getattr(t, "name", None) == tool_name:
            return t
    return None


# ---------------------------------------------------------------------------
# Auto-register built-in handlers
# ---------------------------------------------------------------------------

register_tool_handler("function", FunctionToolHandler())
register_tool_handler("prompty", PromptyToolHandler())
register_tool_handler("mcp", McpToolHandler())
register_tool_handler("openapi", OpenApiToolHandler())
register_tool_handler("*", CustomToolHandler())
