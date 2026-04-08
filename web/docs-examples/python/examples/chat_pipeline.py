"""Step-by-step pipeline: load → prepare → run.

This example shows each pipeline stage separately.
Used in: how-to/openai.mdx, getting-started/index.mdx
"""
from __future__ import annotations

from prompty import load, prepare, run

# Step 1: Load the .prompty file
agent = load("chat-basic.prompty")

# Step 2: Render + parse → list of messages
messages = prepare(agent, inputs={"question": "What is Prompty?"})
print("Messages:", messages)

# Step 3: Execute + process → final result
result = run(agent, messages)
print("Result:", result)
