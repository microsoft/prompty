"""Tests for @tool decorator (spec §11.2 typed tool functions)."""

from __future__ import annotations

import warnings
from typing import Any

import pytest

from prompty.core.tool_decorator import bind_tools, tool
from prompty.core.tool_dispatch import clear_tools, get_tool


@pytest.fixture(autouse=True)
def _clean_registry():
    """Clear name registry before each test."""
    clear_tools()
    yield
    clear_tools()


# ---------------------------------------------------------------------------
# Bare @tool
# ---------------------------------------------------------------------------


class TestBareDecorator:
    """Tests for ``@tool`` without arguments."""

    def test_basic_function(self):
        @tool
        def greet(name: str) -> str:
            """Say hello."""
            return f"Hello, {name}!"

        assert hasattr(greet, "__tool__")
        assert greet.__tool__.name == "greet"
        assert greet.__tool__.kind == "function"
        assert greet.__tool__.description == "Say hello."

    def test_preserves_callable(self):
        @tool
        def add(a: int, b: int) -> int:
            return a + b

        assert add(a=3, b=4) == 7

    def test_auto_registers(self):
        @tool
        def my_func(x: str) -> str:
            return x

        fn = get_tool("my_func")
        assert fn is not None
        assert fn(x="hello") == "hello"

    def test_parameter_kinds(self):
        @tool
        def typed(
            s: str,
            i: int,
            f: float,
            b: bool,
            items: list,
            d: dict,
        ) -> str:
            return "ok"

        params = {p.name: p.kind for p in typed.__tool__.parameters}
        assert params == {
            "s": "string",
            "i": "integer",
            "f": "float",
            "b": "boolean",
            "items": "array",
            "d": "object",
        }

    def test_required_vs_optional(self):
        @tool
        def func(required: str, optional: str = "default") -> str:
            return required

        params = {p.name: p.required for p in func.__tool__.parameters}
        assert params == {"required": True, "optional": False}

    def test_default_values(self):
        @tool
        def func(x: int = 42) -> int:
            return x

        param = func.__tool__.parameters[0]
        assert param.default == 42

    def test_no_type_hint_defaults_to_string(self):
        @tool
        def func(x) -> str:
            return str(x)

        assert func.__tool__.parameters[0].kind == "string"

    def test_skips_self_cls(self):
        # Simulate a method-like signature (self isn't normally decorated but test the guard)
        @tool
        def method(self, x: str) -> str:  # noqa: N805
            return x

        names = [p.name for p in method.__tool__.parameters]
        assert "self" not in names
        assert "x" in names

    def test_no_docstring(self):
        @tool
        def bare(x: str) -> str:
            return x

        assert bare.__tool__.description == ""


# ---------------------------------------------------------------------------
# @tool(...) with arguments
# ---------------------------------------------------------------------------


class TestDecoratorWithArgs:
    """Tests for ``@tool(name=..., description=...)``."""

    def test_custom_name(self):
        @tool(name="weather")
        def get_weather(city: str) -> str:
            return f"Sunny in {city}"

        assert get_weather.__tool__.name == "weather"
        assert get_tool("weather") is not None
        assert get_tool("get_weather") is None

    def test_custom_description(self):
        @tool(description="Fetch current weather data")
        def get_weather(city: str) -> str:
            return "sunny"

        assert get_weather.__tool__.description == "Fetch current weather data"

    def test_register_false(self):
        @tool(register=False)
        def secret_fn(x: int) -> int:
            return x * 2

        assert hasattr(secret_fn, "__tool__")
        assert get_tool("secret_fn") is None

    def test_all_options(self):
        @tool(name="calc", description="Calculator", register=True)
        def calculate(a: float, b: float) -> float:
            return a + b

        assert calculate.__tool__.name == "calc"
        assert calculate.__tool__.description == "Calculator"
        assert get_tool("calc") is not None
        assert calculate(a=1.5, b=2.5) == 4.0


# ---------------------------------------------------------------------------
# Integration with dispatch
# ---------------------------------------------------------------------------


class TestDispatchIntegration:
    """Verify @tool-decorated functions work with dispatch_tool."""

    def test_dispatch_via_name_registry(self):
        from prompty.core.tool_dispatch import dispatch_tool

        @tool
        def multiply(x: int, y: int) -> int:
            """Multiply two numbers."""
            return x * y

        result = dispatch_tool("multiply", '{"x": 3, "y": 7}', {}, None, {})
        assert result == "21"

    def test_tool_definition_matches_schema(self):
        @tool
        def search(query: str, limit: int = 10) -> list:
            """Search for items."""
            return []

        t = search.__tool__
        assert t.name == "search"
        assert t.kind == "function"
        assert len(t.parameters) == 2
        assert t.parameters[0].name == "query"
        assert t.parameters[0].kind == "string"
        assert t.parameters[0].required is True
        assert t.parameters[1].name == "limit"
        assert t.parameters[1].kind == "integer"
        assert t.parameters[1].required is False

    def test_generic_list_type(self):
        @tool
        def func(items: list[str]) -> list[int]:
            return []

        assert func.__tool__.parameters[0].kind == "array"

    def test_generic_dict_type(self):
        @tool
        def func(data: dict[str, Any]) -> dict:
            return {}

        assert func.__tool__.parameters[0].kind == "object"


# ---------------------------------------------------------------------------
# bind_tools
# ---------------------------------------------------------------------------


class TestBindTools:
    """Tests for bind_tools() validation."""

    def _make_agent_with_tools(self, tool_names: list[str]) -> Any:
        """Create a minimal agent-like object with function tool declarations."""
        from prompty.model import FunctionTool, Prompty

        tools = [FunctionTool(name=name, kind="function") for name in tool_names]
        return Prompty(name="test", tools=tools)

    def test_bind_tools_basic(self):
        """Decorated functions matching declarations produce a valid dict."""
        @tool(register=False)
        def get_weather(city: str) -> str:
            return f"72°F in {city}"

        agent = self._make_agent_with_tools(["get_weather"])
        result = bind_tools(agent, [get_weather])
        assert "get_weather" in result
        assert result["get_weather"] is get_weather

    def test_bind_tools_multiple(self):
        """Multiple handlers all validated."""
        @tool(register=False)
        def get_weather(city: str) -> str:
            return ""

        @tool(register=False)
        def get_time(tz: str) -> str:
            return ""

        agent = self._make_agent_with_tools(["get_weather", "get_time"])
        result = bind_tools(agent, [get_weather, get_time])
        assert len(result) == 2

    def test_bind_tools_handler_not_declared(self):
        """Handler with no matching declaration raises ValueError."""
        @tool(register=False)
        def unknown_tool(x: str) -> str:
            return x

        agent = self._make_agent_with_tools(["get_weather"])
        with pytest.raises(ValueError, match="unknown_tool.*no matching"):
            bind_tools(agent, [unknown_tool])

    def test_bind_tools_missing_handler_warns(self):
        """Declared function tool with no handler emits warning."""
        @tool(register=False)
        def get_weather(city: str) -> str:
            return ""

        agent = self._make_agent_with_tools(["get_weather", "get_time"])
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            bind_tools(agent, [get_weather])
            assert any("get_time" in str(x.message) for x in w)

    def test_bind_tools_not_decorated(self):
        """Non-decorated function raises ValueError."""
        def plain_fn(x: str) -> str:
            return x

        agent = self._make_agent_with_tools(["plain_fn"])
        with pytest.raises(ValueError, match="not a @tool-decorated"):
            bind_tools(agent, [plain_fn])

    def test_bind_tools_duplicate_handler(self):
        """Two handlers with the same name raises ValueError."""
        @tool(name="get_weather", register=False)
        def weather_v1(city: str) -> str:
            return ""

        @tool(name="get_weather", register=False)
        def weather_v2(city: str) -> str:
            return ""

        agent = self._make_agent_with_tools(["get_weather"])
        with pytest.raises(ValueError, match="Duplicate tool handler"):
            bind_tools(agent, [weather_v1, weather_v2])

    def test_bind_tools_ignores_non_function_tools(self):
        """Non-function tools (MCP, OpenAPI) are not validated."""
        from prompty.model import FunctionTool, McpTool, Prompty

        mcp = McpTool(name="filesystem", kind="mcp")
        func_tool = FunctionTool(name="get_weather", kind="function")
        agent = Prompty(name="test", tools=[func_tool, mcp])

        @tool(register=False)
        def get_weather(city: str) -> str:
            return ""

        # Should NOT raise about "filesystem" missing a handler
        result = bind_tools(agent, [get_weather])
        assert len(result) == 1

    def test_bind_tools_empty(self):
        """Empty tools list with no function declarations is valid."""
        from prompty.model import Prompty

        agent = Prompty(name="test")
        result = bind_tools(agent, [])
        assert result == {}
