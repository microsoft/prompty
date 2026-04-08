"""Generate embeddings with OpenAI.

This example loads an embedding .prompty file and generates a vector.
Used in: how-to/embeddings.mdx
"""
from __future__ import annotations

from prompty import invoke, load

agent = load("embedding.prompty")
vector = invoke(agent, inputs={"text": "Prompty is a prompt asset format"})
print(f"Embedding dimensions: {len(vector)}")
print(f"First 5 values: {vector[:5]}")
