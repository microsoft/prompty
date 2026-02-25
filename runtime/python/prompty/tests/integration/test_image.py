"""Integration tests — image generation against real OpenAI / Azure OpenAI."""

from __future__ import annotations

import base64

from prompty.providers.azure.executor import AzureExecutor
from prompty.providers.azure.processor import AzureProcessor
from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import (
    _AZURE_IMAGE_DEPLOYMENT,
    _OPENAI_IMAGE_MODEL,
    make_azure_agent,
    make_openai_agent,
    skip_azure_image,
    skip_openai_image,
)


@skip_openai_image
class TestOpenAIImage:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_image_generation(self):
        agent = make_openai_agent(
            api_type="image",
            model=_OPENAI_IMAGE_MODEL,
            options={"n": 1, "size": "1024x1024"},
        )
        response = self.executor.execute(
            agent, "A simple red circle on a white background"
        )
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        # URL (dall-e) or base64 (gpt-image-1)
        assert result.startswith("http") or len(base64.b64decode(result)) > 1000


@skip_azure_image
class TestAzureImage:
    executor = AzureExecutor()
    processor = AzureProcessor()

    def test_image_generation(self):
        """gpt-image-1 returns base64 by default."""
        agent = make_azure_agent(
            api_type="image",
            deployment=_AZURE_IMAGE_DEPLOYMENT,
            options={"n": 1, "size": "1024x1024"},
        )
        response = self.executor.execute(
            agent, "A simple red circle on a white background"
        )
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        # gpt-image-1 returns b64_json — validate it's decodable base64
        raw = base64.b64decode(result)
        assert len(raw) > 1000, "Expected a non-trivial image payload"
