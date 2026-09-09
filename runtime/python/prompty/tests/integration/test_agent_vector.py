"""Live multi-iteration agent-loop tests anchored to a conformance vector.

The deterministic model-conformance suite replays the ``TurnConformance.run``
vector ``multi_turn_tool_calls`` through a scripted model double. Here we drive
the SAME canonical vector against a real provider: the vector supplies the
scenario (messages + tools) and the expected tool-dispatch order, while the
runtime's agent loop calls a live LLM that must reproduce the multi-turn
dependency chain get_weather -> convert_temperature -> final grounded answer.

One Typra-governed vector therefore validates both the deterministic engine and
the live provider path. Unlike the value-path integration tests these do not
fall back to mocks: a mocked model cannot demonstrate a real model choosing a
two-step tool chain, so they skip when live credentials are absent.
"""

from __future__ import annotations

import pytest

from prompty.core.pipeline import turn, turn_async

from .conftest import (
    has_foundry,
    has_openai,
    load_turn_vector,
    make_foundry_agent,
    make_openai_agent,
    turn_vector_tool_order,
)

_VECTOR = load_turn_vector("multi_turn_tool_calls")
_EXPECTED_TOOL_ORDER = turn_vector_tool_order(_VECTOR)  # ["get_weather", "convert_temperature"]
_VECTOR_TOOLS = _VECTOR["input"]["tools"]

# Operational directive appended to the vector's system message so a live model
# reliably delegates the conversion to the tool instead of doing the arithmetic
# itself. The vector still owns the scenario, tools, and expected tool order;
# this only forces the runtime through the multi-iteration path under test.
_TOOL_USE_DIRECTIVE = (
    " Always call the convert_temperature tool for any unit conversion; never convert temperatures yourself."
)


def _instructions_from_vector() -> str:
    """Render the vector's messages as a prompty role-marker instruction block."""
    parts: list[str] = []
    for message in _VECTOR["input"]["messages"]:
        role = message["role"]
        content = message["content"]
        if role == "system":
            content = content + _TOOL_USE_DIRECTIVE
        parts.append(f"{role}:\n{content}")
    return "\n".join(parts)


class _ToolRecorder:
    """Real tool implementations that record the live dispatch order and args."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def get_weather(self, city: str) -> str:
        self.calls.append(("get_weather", {"city": city}))
        # Fahrenheit, matching the vector's turn-1 tool result.
        return "72°F sunny"

    def convert_temperature(self, value: float, from_unit: str, to_unit: str) -> str:
        self.calls.append(("convert_temperature", {"value": value, "from_unit": from_unit, "to_unit": to_unit}))
        celsius = (float(value) - 32.0) * 5.0 / 9.0
        return f"{celsius:.1f}°C"

    def as_tools(self) -> dict:
        return {
            "get_weather": self.get_weather,
            "convert_temperature": self.convert_temperature,
        }

    @property
    def order(self) -> list[str]:
        return [name for name, _ in self.calls]


def _assert_multi_turn_chain(recorder: _ToolRecorder, result: str) -> None:
    """Assert the live loop reproduced the vector's multi-iteration chain."""
    # 1. Exact ordered dispatch sequence the vector prescribes.
    assert recorder.order == _EXPECTED_TOOL_ORDER, (
        f"expected tool order {_EXPECTED_TOOL_ORDER}, observed {recorder.order}"
    )
    # 2. The convert step consumed the weather step's output (72F) — this is what
    #    makes it a genuine multi-ITERATION chain, not two independent calls.
    convert_args = next(args for name, args in recorder.calls if name == "convert_temperature")
    assert abs(float(convert_args["value"]) - 72.0) < 0.5, (
        f"convert_temperature should receive ~72 from get_weather, got {convert_args['value']}"
    )
    # 3. Final answer is grounded in the tool outputs (converted Celsius value).
    assert isinstance(result, str) and result
    assert "22" in result, f"final answer should contain the converted value, got: {result!r}"


@pytest.mark.skipif(not has_openai, reason="OPENAI_API_KEY not set (live agent-loop vector)")
class TestOpenAIAgentVector:
    def test_multi_turn_tool_chain(self):
        recorder = _ToolRecorder()
        agent = make_openai_agent(
            api_type="chat",
            options={"temperature": 0, "maxOutputTokens": 300},
            tools=_VECTOR_TOOLS,
        )
        agent.instructions = _instructions_from_vector()
        result = turn(agent, tools=recorder.as_tools())
        _assert_multi_turn_chain(recorder, result)

    @pytest.mark.asyncio
    async def test_multi_turn_tool_chain_async(self):
        recorder = _ToolRecorder()
        agent = make_openai_agent(
            api_type="chat",
            options={"temperature": 0, "maxOutputTokens": 300},
            tools=_VECTOR_TOOLS,
        )
        agent.instructions = _instructions_from_vector()
        result = await turn_async(agent, tools=recorder.as_tools())
        _assert_multi_turn_chain(recorder, result)


@pytest.mark.skipif(not has_foundry, reason="Azure/Foundry env vars not set (live agent-loop vector)")
class TestFoundryAgentVector:
    def test_multi_turn_tool_chain(self):
        recorder = _ToolRecorder()
        agent = make_foundry_agent(
            api_type="chat",
            options={"temperature": 0, "maxOutputTokens": 300},
            tools=_VECTOR_TOOLS,
        )
        agent.instructions = _instructions_from_vector()
        result = turn(agent, tools=recorder.as_tools())
        _assert_multi_turn_chain(recorder, result)
