"""Streaming chat completion.

This example shows how to consume streaming responses.
Used in: how-to/streaming.mdx
"""
from __future__ import annotations

from prompty import invoke, load

agent = load("streaming-chat.prompty")
for chunk in invoke(agent, inputs={"question": "Tell me a short story"}):
    print(chunk, end="", flush=True)
print()
