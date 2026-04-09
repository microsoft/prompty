"""Agent with tool calling — register tools and run the agent loop.

This example shows how to define tools and run an agent that calls them.
Used in: how-to/agent-tool-calling.mdx
"""
from __future__ import annotations

from prompty import turn, load
from prompty.core import tool


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"72°F and sunny in {city}"


agent = load("chat-agent.prompty")
result = turn(
    agent,
    inputs={"question": "What's the weather in Seattle?"},
    tools={"get_weather": get_weather},
)
print(result)
