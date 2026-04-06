"""Tests for the two-layer tool registry and dispatch (spec §11.2).

Covers:
- Name registry: register_tool / get_tool / clear_tools
- Kind handler registry: register_tool_handler / get_tool_handler / clear_tool_handlers
- dispatch_tool / dispatch_tool_async (full dispatch flow)
- PromptyToolHandler (wire projection + execution with mocked pipeline)
- FunctionToolHandler (error for missing callable)
- Wire projection via _project_prompty_tool
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from prompty.core.tool_dispatch import (
    CustomToolHandler,
    FunctionToolHandler,
    McpToolHandler,
    OpenApiToolHandler,
    PromptyToolHandler,
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

PROMPTS_DIR = Path(__file__).parent / "prompts"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_registries():
    """Clear both registries before and after each test."""
    clear_tools()
    # Re-register built-in kind handlers (they were cleared)
    register_tool_handler("function", FunctionToolHandler())
    register_tool_handler("prompty", PromptyToolHandler())
    register_tool_handler("mcp", McpToolHandler())
    register_tool_handler("openapi", OpenApiToolHandler())
    register_tool_handler("*", CustomToolHandler())
    yield
    clear_tools()
    clear_tool_handlers()
    # Re-register for other tests that might run after
    register_tool_handler("function", FunctionToolHandler())
    register_tool_handler("prompty", PromptyToolHandler())
    register_tool_handler("mcp", McpToolHandler())
    register_tool_handler("openapi", OpenApiToolHandler())
    register_tool_handler("*", CustomToolHandler())


def _make_agent(*, tools: list[Any] | None = None, metadata: dict[str, Any] | None = None) -> MagicMock:
    """Create a minimal mock agent for dispatch tests."""
    agent = MagicMock()
    agent.tools = tools
    agent.metadata = metadata or {}
    return agent


def _make_tool_def(*, name: str, kind: str, **kwargs: Any) -> MagicMock:
    """Create a mock tool definition."""
    tool = MagicMock()
    tool.name = name
    tool.kind = kind
    for k, v in kwargs.items():
        setattr(tool, k, v)
    return tool


# ===========================================================================
# Layer 1: Name Registry
# ===========================================================================


class TestNameRegistry:
    """Test register_tool / get_tool / clear_tools."""

    def test_register_and_get(self):
        def fn(**kw: Any) -> str:
            return "hello"

        register_tool("my_tool", fn)
        assert get_tool("my_tool") is fn

    def test_get_missing_returns_none(self):
        assert get_tool("nonexistent") is None

    def test_clear_removes_all(self):
        register_tool("a", lambda: None)
        register_tool("b", lambda: None)
        clear_tools()
        assert get_tool("a") is None
        assert get_tool("b") is None

    def test_overwrite(self):
        def fn1() -> str:
            return "first"

        def fn2() -> str:
            return "second"

        register_tool("x", fn1)
        register_tool("x", fn2)
        assert get_tool("x") is fn2


# ===========================================================================
# Layer 2: Kind Handler Registry
# ===========================================================================


class TestKindHandlerRegistry:
    """Test register_tool_handler / get_tool_handler / clear_tool_handlers."""

    def test_builtin_handlers_registered(self):
        """Built-in handlers for function, prompty, mcp, openapi, * are registered."""
        for kind in ("function", "prompty", "mcp", "openapi", "*"):
            handler = get_tool_handler(kind)
            assert handler is not None

    def test_get_missing_raises(self):
        with pytest.raises(ToolHandlerError, match="unknown_kind"):
            get_tool_handler("unknown_kind")

    def test_clear_and_reregister(self):
        clear_tool_handlers()
        with pytest.raises(ToolHandlerError):
            get_tool_handler("prompty")
        register_tool_handler("prompty", PromptyToolHandler())
        assert get_tool_handler("prompty") is not None

    def test_custom_handler(self):
        class MyHandler:
            def execute_tool(self, tool, args, agent, parent_inputs):
                return "custom_result"

            async def execute_tool_async(self, tool, args, agent, parent_inputs):
                return "custom_result_async"

        register_tool_handler("my_kind", MyHandler())
        handler = get_tool_handler("my_kind")
        assert handler.execute_tool(None, {}, None, {}) == "custom_result"


# ===========================================================================
# Dispatch: Layer priority
# ===========================================================================


class TestDispatchPriority:
    """Test that dispatch follows: user_tools → name registry → kind handler."""

    def test_user_tools_wins_over_name_registry(self):
        """Per-call user_tools override global name registry."""
        register_tool("calc", lambda **kw: "from_registry")
        result = dispatch_tool(
            "calc",
            json.dumps({"x": 1}),
            user_tools={"calc": lambda **kw: "from_user_tools"},
            agent=_make_agent(),
            parent_inputs={},
        )
        assert result == "from_user_tools"

    def test_name_registry_wins_over_kind_handler(self):
        """Global name registry overrides kind handler."""
        register_tool("my_func", lambda **kw: "from_name_registry")
        tool_def = _make_tool_def(name="my_func", kind="function")
        agent = _make_agent(tools=[tool_def])
        result = dispatch_tool(
            "my_func",
            json.dumps({}),
            user_tools={},
            agent=agent,
            parent_inputs={},
        )
        assert result == "from_name_registry"

    def test_kind_handler_fallback(self):
        """Kind handler used when neither user_tools nor name registry has it."""
        tool_def = _make_tool_def(
            name="summarize", kind="prompty", path="./child.prompty", mode="single", bindings=None
        )
        agent = _make_agent(
            tools=[tool_def],
            metadata={"__source_path": str(PROMPTS_DIR / "tools_prompty.prompty")},
        )

        with patch("prompty.core.tool_dispatch.PromptyToolHandler.execute_tool", return_value="mocked_result"):
            result = dispatch_tool(
                "summarize",
                json.dumps({"text": "hello"}),
                user_tools={},
                agent=agent,
                parent_inputs={},
            )
        assert result == "mocked_result"

    def test_nothing_found_returns_error(self):
        """When no layer can handle the tool, return an error string."""
        result = dispatch_tool(
            "nonexistent",
            json.dumps({}),
            user_tools={},
            agent=_make_agent(),
            parent_inputs={},
        )
        assert "Error" in result
        assert "nonexistent" in result


# ===========================================================================
# dispatch_tool / dispatch_tool_async: edge cases
# ===========================================================================


class TestDispatchTool:
    """Test dispatch_tool sync edge cases."""

    def test_invalid_json(self):
        result = dispatch_tool("fn", "not valid json", user_tools={}, agent=_make_agent(), parent_inputs={})
        assert "Error" in result
        assert "invalid JSON" in result

    def test_empty_arguments(self):
        result = dispatch_tool(
            "fn",
            "",
            user_tools={"fn": lambda: "ok"},
            agent=_make_agent(),
            parent_inputs={},
        )
        assert result == "ok"

    def test_user_tool_error_caught(self):
        def bad_fn(**kw):
            raise RuntimeError("boom")

        result = dispatch_tool(
            "bad",
            json.dumps({}),
            user_tools={"bad": bad_fn},
            agent=_make_agent(),
            parent_inputs={},
        )
        assert "Error" in result
        assert "boom" in result

    def test_async_fn_in_sync_dispatch_errors(self):
        async def async_fn(**kw):
            return "nope"

        result = dispatch_tool(
            "afn",
            json.dumps({}),
            user_tools={"afn": async_fn},
            agent=_make_agent(),
            parent_inputs={},
        )
        assert "Error" in result
        assert "async" in result.lower()


class TestDispatchToolAsync:
    """Test dispatch_tool_async edge cases."""

    def test_async_user_tool(self):
        async def async_fn(**kw):
            return f"result_{kw.get('x')}"

        result = asyncio.get_event_loop().run_until_complete(
            dispatch_tool_async(
                "afn",
                json.dumps({"x": 42}),
                user_tools={"afn": async_fn},
                agent=_make_agent(),
                parent_inputs={},
            )
        )
        assert result == "result_42"

    def test_sync_fn_works_in_async_dispatch(self):
        result = asyncio.get_event_loop().run_until_complete(
            dispatch_tool_async(
                "fn",
                json.dumps({"a": 1}),
                user_tools={"fn": lambda **kw: f"sync_{kw['a']}"},
                agent=_make_agent(),
                parent_inputs={},
            )
        )
        assert result == "sync_1"

    def test_async_name_registry(self):
        async def async_fn(**kw):
            return "from_async_registry"

        register_tool("areg", async_fn)
        result = asyncio.get_event_loop().run_until_complete(
            dispatch_tool_async(
                "areg",
                json.dumps({}),
                user_tools={},
                agent=_make_agent(),
                parent_inputs={},
            )
        )
        assert result == "from_async_registry"


# ===========================================================================
# Built-in Kind Handlers
# ===========================================================================


class TestFunctionToolHandler:
    """FunctionToolHandler should error when reached (callable should have been in user_tools)."""

    def test_sync_raises(self):
        handler = FunctionToolHandler()
        tool = _make_tool_def(name="my_fn", kind="function")
        with pytest.raises(ValueError, match="no callable provided"):
            handler.execute_tool(tool, {}, _make_agent(), {})

    def test_dispatch_to_function_kind_without_callable(self):
        """Dispatching to a function tool without a callable returns error."""
        tool_def = _make_tool_def(name="calc", kind="function")
        agent = _make_agent(tools=[tool_def])
        result = dispatch_tool("calc", json.dumps({}), user_tools={}, agent=agent, parent_inputs={})
        assert "Error" in result
        assert "no callable provided" in result


class TestPromptyToolHandler:
    """PromptyToolHandler: resolves child path, loads, and runs."""

    def test_resolve_child_path(self):
        handler = PromptyToolHandler()
        tool = _make_tool_def(name="summarize", kind="prompty", path="./summarize_child.prompty")
        agent = _make_agent(metadata={"__source_path": str(PROMPTS_DIR / "tools_prompty.prompty")})
        resolved = handler._resolve_child_path(tool, agent)
        assert resolved == str(PROMPTS_DIR / "summarize_child.prompty")

    def test_missing_source_path_raises(self):
        handler = PromptyToolHandler()
        tool = _make_tool_def(name="summarize", kind="prompty", path="./child.prompty")
        agent = _make_agent(metadata={})
        with pytest.raises(FileNotFoundError, match="no __source_path"):
            handler._resolve_child_path(tool, agent)

    def test_execute_tool_mocked(self):
        """PromptyToolHandler.execute_tool loads child and runs prepare+run."""
        handler = PromptyToolHandler()
        tool = _make_tool_def(name="summarize", kind="prompty", path="./summarize_child.prompty", mode="single")
        agent = _make_agent(metadata={"__source_path": str(PROMPTS_DIR / "tools_prompty.prompty")})

        with (
            patch("prompty.core.tool_dispatch.PromptyToolHandler.execute_tool") as mock_exec,
        ):
            mock_exec.return_value = "Summary of the text"
            result = handler.execute_tool(tool, {"text": "hello world"}, agent, {})
        assert result == "Summary of the text"

    def test_execute_tool_error_returns_string(self):
        """Errors during execution are caught and returned as strings."""
        handler = PromptyToolHandler()
        tool = _make_tool_def(name="broken", kind="prompty", path="./nonexistent.prompty", mode="single")
        agent = _make_agent(metadata={"__source_path": str(PROMPTS_DIR / "tools_prompty.prompty")})
        result = handler.execute_tool(tool, {}, agent, {})
        assert "Error executing PromptyTool" in result


class TestPlaceholderHandlers:
    """MCP, OpenAPI, and Custom handlers raise NotImplementedError."""

    def test_mcp_sync(self):
        with pytest.raises(NotImplementedError, match="MCP"):
            McpToolHandler().execute_tool(None, {}, None, {})

    def test_openapi_sync(self):
        with pytest.raises(NotImplementedError, match="OpenAPI"):
            OpenApiToolHandler().execute_tool(None, {}, None, {})

    def test_custom_sync(self):
        with pytest.raises(NotImplementedError, match="Custom"):
            CustomToolHandler().execute_tool(None, {}, None, {})

    def test_mcp_async(self):
        with pytest.raises(NotImplementedError, match="MCP"):
            asyncio.get_event_loop().run_until_complete(McpToolHandler().execute_tool_async(None, {}, None, {}))

    def test_openapi_async(self):
        with pytest.raises(NotImplementedError, match="OpenAPI"):
            asyncio.get_event_loop().run_until_complete(OpenApiToolHandler().execute_tool_async(None, {}, None, {}))

    def test_custom_async(self):
        with pytest.raises(NotImplementedError, match="Custom"):
            asyncio.get_event_loop().run_until_complete(CustomToolHandler().execute_tool_async(None, {}, None, {}))


# ===========================================================================
# Wire Projection (_project_prompty_tool)
# ===========================================================================


class TestWireProjection:
    """Test that PromptyTool is projected as an OpenAI function definition."""

    def test_project_prompty_tool(self):
        """Load tools_prompty.prompty and verify the tool projects correctly."""
        from prompty.core.loader import load

        agent = load(str(PROMPTS_DIR / "tools_prompty.prompty"))
        assert agent.tools is not None
        assert len(agent.tools) == 1

        tool = agent.tools[0]
        assert tool.name == "summarize"
        assert tool.kind == "prompty"

    def test_wire_format(self):
        """The wire projection should produce a valid OpenAI function tool."""
        from prompty.core.loader import load
        from prompty.providers.openai.executor import _project_prompty_tool

        agent = load(str(PROMPTS_DIR / "tools_prompty.prompty"))
        tool = agent.tools[0]
        func_def = _project_prompty_tool(tool, agent)

        assert func_def["name"] == "summarize"
        assert "description" in func_def
        assert "parameters" in func_def

        # Parameters should include 'text' but NOT 'context' (it's bound)
        param_names = list(func_def["parameters"].get("properties", {}).keys())
        assert "text" in param_names
        assert "context" not in param_names, "bound parameter 'context' should be stripped"

    def test_wire_format_through_tools_to_wire(self):
        """End-to-end: _tools_to_wire should include the prompty tool."""
        from prompty.core.loader import load
        from prompty.providers.openai.executor import _tools_to_wire

        agent = load(str(PROMPTS_DIR / "tools_prompty.prompty"))
        wire = _tools_to_wire(agent)

        assert wire is not None
        assert len(wire) == 1
        assert wire[0]["type"] == "function"
        assert wire[0]["function"]["name"] == "summarize"

    def test_missing_source_path_raises(self):
        """Wire projection fails cleanly when parent has no __source_path."""
        from prompty.providers.openai.executor import _project_prompty_tool

        tool = _make_tool_def(name="broken", kind="prompty", path="./child.prompty")
        parent = MagicMock()
        parent.metadata = {}
        parent.tools = [tool]

        with pytest.raises(ValueError, match="no __source_path"):
            _project_prompty_tool(tool, parent)
