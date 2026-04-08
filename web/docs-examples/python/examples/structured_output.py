"""Structured output with JSON schema.

This example uses outputs schema to get structured JSON from the LLM.
Used in: how-to/structured-output.mdx
"""
from __future__ import annotations

from prompty import invoke, load

agent = load("structured-output.prompty")
result = invoke(agent, inputs={"city": "Seattle"})
print(f"City: {result['city']}")
print(f"Temperature: {result['temperature']}°F")
print(f"Conditions: {result['conditions']}")
