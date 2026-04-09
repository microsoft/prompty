"""``@tool`` decorator for typed tool functions (spec §11.2).

The ``@tool`` decorator introspects a Python function's signature, docstring,
and type hints to produce a ``FunctionTool`` definition and automatically
register the function in the global tool name registry.

Usage::

    from prompty import tool

    @tool
    def get_weather(city: str, units: str = "celsius") -> str:
        \"\"\"Get the current weather for a city.\"\"\"
        return f"72°F in {city}"

    # get_weather.__tool__ is a FunctionTool with parameters derived from hints
    # get_weather is auto-registered via register_tool("get_weather", get_weather)

The decorator can also be called with arguments::

    @tool(name="weather", description="Fetch weather data")
    def get_weather(city: str) -> str:
        ...

"""

from __future__ import annotations

import functools
import inspect
from typing import Any, overload

from .tool_dispatch import register_tool

__all__ = ["tool", "bind_tools"]

# ---------------------------------------------------------------------------
# Type-hint → Property kind mapping
# ---------------------------------------------------------------------------

_TYPE_MAP: dict[type | str, str] = {
    str: "string",
    int: "integer",
    float: "float",
    bool: "boolean",
    list: "array",
    dict: "object",
}


def _kind_from_annotation(annotation: Any) -> str:
    """Map a Python type annotation to a Property ``kind`` string."""
    if annotation is inspect.Parameter.empty:
        return "string"

    # Direct match
    if annotation in _TYPE_MAP:
        return _TYPE_MAP[annotation]

    # Handle typing generics (list[str], dict[str, Any], etc.)
    origin = getattr(annotation, "__origin__", None)
    if origin is not None:
        if origin is list:
            return "array"
        if origin is dict:
            return "object"

    # String annotation fallback
    if isinstance(annotation, str):
        lower = annotation.lower()
        for k, v in _TYPE_MAP.items():
            if isinstance(k, type) and k.__name__.lower() == lower:
                return v

    return "string"


# ---------------------------------------------------------------------------
# Signature → FunctionTool builder
# ---------------------------------------------------------------------------


def _build_function_tool(
    fn: Any,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Any:
    """Build a ``FunctionTool`` from a function's signature.

    Returns the FunctionTool model instance with ``parameters`` derived
    from the function's type hints and docstring.
    """
    from ..model import FunctionTool, Property

    tool_name = name or fn.__name__
    tool_desc = description or (inspect.getdoc(fn) or "")

    sig = inspect.signature(fn)

    # Use get_type_hints() to resolve string annotations from PEP 604
    try:
        hints = inspect.get_annotations(fn, eval_str=True)
    except Exception:
        hints = {}

    properties: list[Property] = []

    for param_name, param in sig.parameters.items():
        if param_name in ("self", "cls"):
            continue

        annotation = hints.get(param_name, param.annotation)
        kind = _kind_from_annotation(annotation)
        has_default = param.default is not inspect.Parameter.empty
        required = not has_default

        prop = Property(
            name=param_name,
            kind=kind,
            required=required,
        )

        # Set default if present
        if has_default:
            prop.default = param.default

        properties.append(prop)

    tool = FunctionTool(
        name=tool_name,
        kind="function",
        description=tool_desc,
    )
    tool.parameters = properties

    return tool


# ---------------------------------------------------------------------------
# @tool decorator
# ---------------------------------------------------------------------------

# Overloads allow both @tool and @tool(...) syntax


@overload
def tool(fn: Any, /) -> Any: ...


@overload
def tool(
    *,
    name: str | None = None,
    description: str | None = None,
    register: bool = True,
) -> Any: ...


def tool(
    fn: Any = None,
    /,
    *,
    name: str | None = None,
    description: str | None = None,
    register: bool = True,
) -> Any:
    """Decorator that creates a ``FunctionTool`` from a typed function.

    Can be used as ``@tool`` or ``@tool(name=..., description=...)``.

    Parameters
    ----------
    fn:
        The function to decorate (when used as bare ``@tool``).
    name:
        Override the tool name (defaults to ``fn.__name__``).
    description:
        Override the tool description (defaults to the function's docstring).
    register:
        If ``True`` (default), auto-register the function in the global
        tool name registry via ``register_tool()``.

    Returns
    -------
    The original function, with a ``__tool__`` attribute containing the
    ``FunctionTool`` definition.
    """

    def _decorate(func: Any) -> Any:
        tool_def = _build_function_tool(func, name=name, description=description)
        func.__tool__ = tool_def

        if register:
            register_tool(tool_def.name, func)

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            return func(*args, **kwargs)

        # Copy __tool__ to wrapper
        wrapper.__tool__ = tool_def  # type: ignore[attr-defined]
        return wrapper

    if fn is not None:
        # Bare @tool usage
        return _decorate(fn)

    # @tool(...) usage — return the decorator
    return _decorate


# ---------------------------------------------------------------------------
# bind_tools — validate handlers against agent declarations
# ---------------------------------------------------------------------------


def bind_tools(
    agent: Any,
    tools: list[Any],
) -> dict[str, Any]:
    """Validate tool handlers against an agent's tool declarations and return a handler dict.

    Each function in *tools* must have a ``__tool__`` attribute (set by the ``@tool``
    decorator). ``bind_tools`` matches each handler's name against the ``kind: "function"``
    tools declared in ``agent.tools``, raising on mismatches and warning on missing handlers.

    Parameters
    ----------
    agent:
        A loaded Prompty agent (has ``.tools`` attribute).
    tools:
        List of ``@tool``-decorated functions.

    Returns
    -------
    dict[str, callable]
        Handler dict suitable for ``turn(..., tools=result)``.

    Raises
    ------
    ValueError
        If a handler has no ``__tool__`` attribute, or if a handler name doesn't
        match any ``kind: "function"`` tool declared in ``agent.tools``.
    """
    import warnings

    handlers: dict[str, Any] = {}

    for fn in tools:
        tool_def = getattr(fn, "__tool__", None)
        if tool_def is None:
            raise ValueError(
                f"Function '{getattr(fn, '__name__', fn)}' is not a @tool-decorated function "
                f"(missing __tool__ attribute)"
            )
        name = tool_def.name
        if name in handlers:
            raise ValueError(f"Duplicate tool handler: '{name}'")
        handlers[name] = fn

    # Get declared function tool names from agent.tools
    declared_function_tools: set[str] = set()
    for tool_decl in getattr(agent, "tools", []) or []:
        if getattr(tool_decl, "kind", None) == "function":
            declared_function_tools.add(tool_decl.name)

    # Validate: every handler must match a declaration
    for name in handlers:
        if name not in declared_function_tools:
            declared_str = ", ".join(sorted(declared_function_tools)) if declared_function_tools else "(none)"
            raise ValueError(
                f"Tool handler '{name}' has no matching 'kind: function' declaration in agent.tools. "
                f"Declared function tools: {declared_str}"
            )

    # Warn: every function declaration should have a handler
    for name in declared_function_tools:
        if name not in handlers:
            warnings.warn(
                f"Tool '{name}' is declared in agent.tools but no handler was provided to bind_tools()",
                UserWarning,
                stacklevel=2,
            )

    return handlers
