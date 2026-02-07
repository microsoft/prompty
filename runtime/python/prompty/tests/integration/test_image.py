"""Integration tests — image generation against real OpenAI.

Note: Azure OpenAI DALL-E support varies by region and deployment.
These tests target direct OpenAI only by default.
"""

from __future__ import annotations

from prompty.providers.openai.executor import OpenAIExecutor
from prompty.providers.openai.processor import OpenAIProcessor

from .conftest import make_openai_agent, skip_openai


@skip_openai
class TestOpenAIImage:
    executor = OpenAIExecutor()
    processor = OpenAIProcessor()

    def test_image_generation(self):
        agent = make_openai_agent(
            api_type="image",
            model="dall-e-2",
            options={"n": 1, "size": "256x256"},
        )
        response = self.executor.execute(
            agent, "A simple red circle on a white background"
        )
        result = self.processor.process(agent, response)
        assert isinstance(result, str)
        assert result.startswith("http")
