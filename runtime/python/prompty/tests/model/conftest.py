"""Consumer-authored provider fixtures for the typed @vector conformance rail.

The emitter generates ``test_<seam>_conformance.py`` files that route each vector's
shape discriminator through ``resolve_<seam>`` against a ``<seam>_provider`` pytest
fixture. This module authors those fixtures, wiring Prompty's concrete pipeline
implementations into the emitted ``new_<seam>_provider`` factories.

A dropped @dispatch variant becomes a collection-time error here (the factory
raises on a missing slot), so conformance can never silently skip a seam variant.

Some seams expose a slightly different call convention than our hand-written
runtime (e.g. the generated ``Parser.parse(agent, rendered, context)`` passes
``context`` positionally, while ``PromptyChatParser.parse`` takes ``**context``).
Thin seam adapters below bridge that gap without disturbing the runtime pipeline.
"""

from __future__ import annotations

from typing import Any

import pytest

from prompty.model._parser_resolver import new_parser_provider
from prompty.model._renderer_resolver import new_renderer_provider
from prompty.parsers.prompty import PromptyChatParser
from prompty.renderers.jinja2 import Jinja2Renderer
from prompty.renderers.mustache import MustacheRenderer


class _ParserSeamAdapter:
    """Adapt ``PromptyChatParser`` to the generated ``Parser`` seam signature.

    The seam calls ``parse(agent, rendered, context)`` with ``context`` as a
    positional ``dict | None``; our parser accepts pre-render state as ``**context``
    keyword arguments. This adapter spreads a positional context dict into kwargs.
    """

    def __init__(self, inner: PromptyChatParser) -> None:
        self._inner = inner

    def parse(self, agent: Any, rendered: str, context: dict[str, Any] | None = None) -> Any:
        return self._inner.parse(agent, rendered, **(context or {}))

    async def parse_async(self, agent: Any, rendered: str, context: dict[str, Any] | None = None) -> Any:
        return await self._inner.parse_async(agent, rendered, **(context or {}))

    def pre_render(self, template: str) -> Any | None:
        return self._inner.pre_render(template)


@pytest.fixture
def parser_provider():
    """Attach Prompty's chat parser to the ``prompty`` @dispatch variant."""
    return new_parser_provider({"prompty": _ParserSeamAdapter(PromptyChatParser())})


@pytest.fixture
def renderer_provider():
    """Attach Prompty's template renderers to the ``jinja2``/``mustache`` variants."""
    return new_renderer_provider(
        {
            "jinja2": Jinja2Renderer(),
            "mustache": MustacheRenderer(),
        }
    )


class _PassthroughProcessor:
    """A NOOP processor for the open-union ``*`` (CustomModel) default variant.

    An unknown ``Model.provider`` (e.g. ``anthropic``) routes through
    ``resolve_processor`` to the ``custom`` registry slot. This passthrough
    returns the raw provider response unchanged — the honest behavior for a
    provider Prompty has no typed extraction for — so the seam stays total
    (never a silent ``None``) without pretending to understand foreign wire shapes.
    """

    def process(self, agent: Any, response: Any) -> Any:
        return response

    async def process_async(self, agent: Any, response: Any) -> Any:
        return response


@pytest.fixture
def processor_provider():
    """Attach Prompty's response processors to the Processor @dispatch variants.

    ``openai``/``azure`` get the concrete typed processors; the open-union ``*``
    catch-all (``custom`` slot) gets a passthrough NOOP so unknown providers
    resolve to a total seam rather than a missing attachment.
    """
    from prompty.model._processor_resolver import new_processor_provider
    from prompty.providers.azure.processor import AzureProcessor
    from prompty.providers.openai.processor import OpenAIProcessor

    return new_processor_provider(
        {
            "openai": OpenAIProcessor(),
            "azure": AzureProcessor(),
            "custom": _PassthroughProcessor(),
        }
    )
