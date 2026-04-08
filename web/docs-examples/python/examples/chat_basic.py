"""Basic chat completion with OpenAI.

This example loads a .prompty file and runs a simple chat completion.
Used in: how-to/openai.mdx, getting-started/index.mdx
"""
from __future__ import annotations

from prompty import invoke, load

agent = load("chat-basic.prompty")
result = invoke(agent, inputs={"question": "What is Prompty?"})
print(result)
