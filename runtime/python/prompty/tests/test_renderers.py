"""Tests for Jinja2Renderer and MustacheRenderer."""

from __future__ import annotations

import pytest
from agentschema import PromptAgent

from prompty.renderers import Jinja2Renderer, MustacheRenderer

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_agent(**kwargs) -> PromptAgent:
    """Create a minimal PromptAgent for testing."""
    data = {"kind": "prompt", "name": "test", "model": "gpt-4"}
    data.update(kwargs)
    return PromptAgent.load(data)


# ---------------------------------------------------------------------------
# Jinja2Renderer
# ---------------------------------------------------------------------------


class TestJinja2Renderer:
    def setup_method(self):
        self.renderer = Jinja2Renderer()
        self.agent = _make_agent()

    def test_simple_variable(self):
        result = self.renderer.render(
            self.agent,
            "Hello, {{name}}!",
            {"name": "World"},
        )
        assert result == "Hello, World!"

    def test_multiple_variables(self):
        result = self.renderer.render(
            self.agent,
            "{{greeting}}, {{name}}! You are {{age}} years old.",
            {"greeting": "Hi", "name": "Jane", "age": 30},
        )
        assert result == "Hi, Jane! You are 30 years old."

    def test_conditional(self):
        template = "{% if premium %}Premium user{% else %}Free user{% endif %}"
        assert self.renderer.render(self.agent, template, {"premium": True}) == "Premium user"
        assert self.renderer.render(self.agent, template, {"premium": False}) == "Free user"

    def test_loop(self):
        template = "{% for item in items %}{{item}} {% endfor %}"
        result = self.renderer.render(self.agent, template, {"items": ["a", "b", "c"]})
        assert result == "a b c "

    def test_missing_variable_renders_empty(self):
        result = self.renderer.render(self.agent, "Hello, {{name}}!", {})
        assert result == "Hello, !"

    def test_nested_dict(self):
        result = self.renderer.render(
            self.agent,
            "{{user.name}} is {{user.age}}",
            {"user": {"name": "Alice", "age": 25}},
        )
        assert result == "Alice is 25"

    def test_preserves_newlines(self):
        template = "line1\nline2\nline3\n"
        result = self.renderer.render(self.agent, template, {})
        assert result == "line1\nline2\nline3\n"

    def test_multiline_template(self):
        template = "system:\nYou are {{role}}.\n\nuser:\n{{question}}"
        result = self.renderer.render(
            self.agent,
            template,
            {"role": "a helper", "question": "Why is the sky blue?"},
        )
        assert "You are a helper." in result
        assert "Why is the sky blue?" in result

    def test_filters(self):
        result = self.renderer.render(
            self.agent,
            "{{name | upper}}",
            {"name": "alice"},
        )
        assert result == "ALICE"

    def test_sandboxed_environment(self):
        """Ensure the sandbox restricts dangerous operations."""
        # Trying to access __class__ should be blocked
        with pytest.raises(Exception):
            self.renderer.render(
                self.agent,
                "{{ ''.__class__.__mro__ }}",
                {},
            )

    @pytest.mark.asyncio
    async def test_async_render(self):
        result = await self.renderer.render_async(
            self.agent,
            "Hello, {{name}}!",
            {"name": "Async"},
        )
        assert result == "Hello, Async!"


# ---------------------------------------------------------------------------
# MustacheRenderer
# ---------------------------------------------------------------------------


class TestMustacheRenderer:
    def setup_method(self):
        self.renderer = MustacheRenderer()
        self.agent = _make_agent()

    def test_simple_variable(self):
        result = self.renderer.render(
            self.agent,
            "Hello, {{name}}!",
            {"name": "World"},
        )
        assert result == "Hello, World!"

    def test_section(self):
        template = "{{#show}}Visible{{/show}}"
        assert self.renderer.render(self.agent, template, {"show": True}) == "Visible"
        assert self.renderer.render(self.agent, template, {"show": False}) == ""

    def test_inverted_section(self):
        template = "{{^items}}No items{{/items}}"
        assert self.renderer.render(self.agent, template, {"items": []}) == "No items"

    def test_list_section(self):
        template = "{{#items}}{{.}} {{/items}}"
        result = self.renderer.render(self.agent, template, {"items": ["a", "b", "c"]})
        assert result == "a b c "

    def test_missing_variable(self):
        result = self.renderer.render(self.agent, "Hello, {{name}}!", {})
        assert result == "Hello, !"

    @pytest.mark.asyncio
    async def test_async_render(self):
        result = await self.renderer.render_async(
            self.agent,
            "Hello, {{name}}!",
            {"name": "Async"},
        )
        assert result == "Hello, Async!"
