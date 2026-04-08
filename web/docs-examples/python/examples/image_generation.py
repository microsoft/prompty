"""Generate images with DALL-E.

This example loads an image generation .prompty file.
Used in: how-to/image-generation.mdx
"""
from __future__ import annotations

from prompty import invoke, load

agent = load("image-gen.prompty")
result = invoke(agent, inputs={"prompt": "A serene mountain landscape at sunset"})
print(f"Image URL: {result}")
