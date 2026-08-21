"""Non-vector renderer guards for Jinja2Renderer and MustacheRenderer.

Behavioral rendering conformance (substitution, conditionals, loops, filters,
whitespace, nested objects, missing-variable-renders-empty, Mustache
sections/inverted/loops, thread-nonce injection, role-marker preservation) is
owned by the ``Renderer.render`` @vector set in
``schema/tsp-output/.typra-generated/vectors.json`` and driven against this
runtime by ``tests/model/test_vector_conformance.py`` via the wired
``Renderer.render`` adapter in ``tests/model/vector_adapters.py`` — so the
organic per-case rendering tests were removed to defer to the vectors.

Only the checks the vector format cannot express are retained here:

* the Jinja2 sandbox-escape security guard (asserts an exception is raised),
* the sync/async API surface smoke tests.
"""

from __future__ import annotations

import pytest

from prompty.model import Agent
from prompty.renderers import Jinja2Renderer, MustacheRenderer


def _make_agent(**kwargs) -> Agent:
    """Create a minimal Agent for testing."""
    data = {"name": "test", "model": "gpt-4"}
    data.update(kwargs)
    return Agent.load(data)


class TestJinja2Renderer:
    def setup_method(self):
        self.renderer = Jinja2Renderer()
        self.agent = _make_agent()

    def test_sandboxed_environment(self):
        """Ensure the sandbox restricts dangerous operations.

        Security property (sandbox escape prevention) — not expressible as an
        input/output equality vector.
        """
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


class TestMustacheRenderer:
    def setup_method(self):
        self.renderer = MustacheRenderer()
        self.agent = _make_agent()

    @pytest.mark.asyncio
    async def test_async_render(self):
        result = await self.renderer.render_async(
            self.agent,
            "Hello, {{name}}!",
            {"name": "Async"},
        )
        assert result == "Hello, Async!"
