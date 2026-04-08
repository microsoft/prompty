"""Tests for §13 Agent Loop Extensions.

Tests cover: events, cancellation, context window management, guardrails,
steering, and parallel tool execution — all integrated into invoke_agent.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from prompty.core.agent_events import AgentEvent, emit_event
from prompty.core.cancellation import CancellationToken, CancelledError
from prompty.core.context import estimate_chars, summarize_dropped, trim_to_context_window
from prompty.core.guardrails import GuardrailError, GuardrailResult, Guardrails
from prompty.core.pipeline import invoke_agent, invoke_agent_async
from prompty.core.steering import Steering
from prompty.core.types import Message, TextPart
from prompty.model import Prompty


# ---------------------------------------------------------------------------
# Shared helpers (same pattern as test_run_agent.py)
# ---------------------------------------------------------------------------


def _make_agent() -> Prompty:
    data = {
        "name": "test-agent",
        "model": {
            "id": "gpt-4",
            "provider": "openai",
            "connection": {"kind": "key", "apiKey": "test-key"},
        },
        "tools": [
            {
                "name": "get_weather",
                "kind": "function",
                "description": "Get weather",
                "parameters": [
                    {"name": "location", "kind": "string", "description": "City"},
                ],
            }
        ],
        "template": {"format": {"kind": "jinja2"}, "parser": {"kind": "prompty"}},
    }
    return Prompty.load(data)


def _mock_tool_call_response(fn_name: str = "get_weather", fn_args: str = '{"location":"NYC"}', call_id: str = "call_1") -> MagicMock:
    tc = MagicMock()
    tc.id = call_id
    tc.name = fn_name
    tc.arguments = fn_args
    tc.function.name = fn_name
    tc.function.arguments = fn_args
    tc.model_dump.return_value = {
        "id": call_id,
        "type": "function",
        "function": {"name": fn_name, "arguments": fn_args},
    }
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].finish_reason = "tool_calls"
    response.choices[0].message.tool_calls = [tc]
    return response


def _mock_final_response(content: str = "The weather is sunny.") -> MagicMock:
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].finish_reason = "stop"
    response.choices[0].message.tool_calls = None
    response.choices[0].message.content = content
    response.choices[0].message.model_dump.return_value = {"role": "assistant", "content": content}
    return response


_PIPELINE = "prompty.core.pipeline"


# =========================================================================
# §13.1 Events
# =========================================================================


class TestEvents:
    """Event callback receives structured events during agent loop."""

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="The weather is sunny.")
    def test_events_emitted(self, mock_process, mock_prepare, mock_exec):
        mock_exec.side_effect = [_mock_tool_call_response(), _mock_final_response()]
        agent = _make_agent()
        events: list[tuple[str, Any]] = []

        def on_event(event_type: str, data: Any) -> None:
            events.append((event_type, data))

        invoke_agent(agent, {"question": "weather"}, tools={"get_weather": lambda location: "Sunny"}, on_event=on_event)

        types = [e[0] for e in events]
        assert "tool_call_start" in types
        assert "tool_result" in types
        assert "messages_updated" in types
        assert "done" in types

    def test_emit_event_swallows_errors(self):
        """Event callbacks must not break the loop."""
        def bad_callback(event_type: str, data: Any) -> None:
            raise RuntimeError("boom")

        # Should not raise
        emit_event(bad_callback, "test", {})

    def test_emit_event_none_callback(self):
        """None callback is a no-op."""
        emit_event(None, "test", {})  # Should not raise


# =========================================================================
# §13.2 Cancellation
# =========================================================================


class TestCancellation:
    """CancellationToken cooperatively cancels the loop."""

    def test_token_basic(self):
        token = CancellationToken()
        assert not token.is_cancelled
        token.cancel()
        assert token.is_cancelled

    def test_token_reset(self):
        token = CancellationToken()
        token.cancel()
        token.reset()
        assert not token.is_cancelled

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    def test_cancel_before_loop(self, mock_prepare, mock_exec):
        """Pre-cancelled token raises immediately."""
        mock_exec.return_value = _mock_tool_call_response()
        agent = _make_agent()
        token = CancellationToken()
        token.cancel()

        with pytest.raises(CancelledError):
            invoke_agent(agent, {}, tools={"get_weather": lambda **kw: "sunny"}, cancel=token)

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="result")
    def test_cancel_during_tools(self, mock_process, mock_prepare, mock_exec):
        """Cancel during tool dispatch."""
        mock_exec.side_effect = [_mock_tool_call_response(), _mock_final_response()]
        agent = _make_agent()
        token = CancellationToken()

        call_count = 0

        def cancelling_tool(**kwargs):
            nonlocal call_count
            call_count += 1
            token.cancel()
            return "result"

        # The cancel check happens at the TOP of the next iteration, after tool dispatch
        # So first iteration completes tools, then cancel fires on second iteration entry
        with pytest.raises(CancelledError):
            invoke_agent(
                agent, {},
                tools={"get_weather": cancelling_tool},
                cancel=token,
                max_iterations=5,
            )


# =========================================================================
# §13.3 Context Window Management
# =========================================================================


class TestContextWindow:
    """Context trimming functions and integration."""

    def test_estimate_chars(self):
        msgs = [Message(role="user", parts=[TextPart(value="hello world")])]
        assert estimate_chars(msgs) > 0

    def test_trim_preserves_system(self):
        msgs = [
            Message(role="system", parts=[TextPart(value="You are helpful.")]),
            Message(role="user", parts=[TextPart(value="A" * 1000)]),
            Message(role="assistant", parts=[TextPart(value="B" * 1000)]),
            Message(role="user", parts=[TextPart(value="C" * 100)]),
        ]
        dropped, summary = trim_to_context_window(msgs, 500)
        assert dropped > 0
        # System message must be preserved
        assert msgs[0].role == "system"

    def test_trim_no_op_when_under_budget(self):
        msgs = [
            Message(role="user", parts=[TextPart(value="short")]),
        ]
        dropped, dropped_msgs = trim_to_context_window(msgs, 10000)
        assert dropped == 0
        assert dropped_msgs == []

    def test_summarize_dropped(self):
        dropped = [Message(role="user", parts=[TextPart(value="How's the weather?")])]
        result = summarize_dropped(dropped)
        assert "weather" in result.lower()

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="result")
    def test_context_budget_in_agent_loop(self, mock_process, mock_prepare, mock_exec):
        """context_budget triggers trimming during agent loop."""
        mock_exec.side_effect = [_mock_tool_call_response(), _mock_final_response()]
        agent = _make_agent()
        events: list[tuple[str, Any]] = []

        result = invoke_agent(
            agent, {},
            tools={"get_weather": lambda **kw: "sunny"},
            context_budget=50,
            on_event=lambda t, d: events.append((t, d)),
        )
        assert result == "result"


# =========================================================================
# §13.4 Guardrails
# =========================================================================


class TestGuardrails:
    """Guardrail hooks at input, output, and tool check points."""

    def test_guardrail_result_allowed(self):
        r = GuardrailResult(allowed=True)
        assert r.allowed

    def test_guardrail_result_denied(self):
        r = GuardrailResult(allowed=False, reason="PII detected")
        assert not r.allowed
        assert r.reason == "PII detected"

    def test_guardrails_defaults_allow(self):
        g = Guardrails()
        assert g.check_input([]).allowed
        assert g.check_output(Message(role="assistant", parts=[])).allowed
        assert g.check_tool("any", {}).allowed

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    def test_input_guardrail_blocks(self, mock_prepare, mock_exec):
        mock_exec.return_value = _mock_tool_call_response()
        agent = _make_agent()
        g = Guardrails(input=lambda msgs: GuardrailResult(allowed=False, reason="blocked"))

        with pytest.raises(GuardrailError, match="blocked"):
            invoke_agent(agent, {}, tools={"get_weather": lambda **kw: "sunny"}, guardrails=g)

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="bad output")
    def test_output_guardrail_blocks(self, mock_process, mock_prepare, mock_exec):
        # Return a non-streaming response with tool_calls=None but content
        final = _mock_final_response("bad content")
        # Make it look like it has tool calls first, then final
        tool_resp = _mock_tool_call_response()
        mock_exec.side_effect = [tool_resp, final]
        agent = _make_agent()

        # Output guardrail denies after tool iteration
        g = Guardrails(output=lambda msg: GuardrailResult(allowed=False, reason="toxic"))

        with pytest.raises(GuardrailError, match="toxic"):
            invoke_agent(agent, {}, tools={"get_weather": lambda **kw: "sunny"}, guardrails=g)

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="result")
    def test_tool_guardrail_denies(self, mock_process, mock_prepare, mock_exec):
        """Tool guardrail produces synthetic denial result."""
        mock_exec.side_effect = [_mock_tool_call_response(), _mock_final_response()]
        agent = _make_agent()
        events: list[tuple[str, Any]] = []

        g = Guardrails(tool=lambda name, args: GuardrailResult(allowed=False, reason="disallowed"))

        result = invoke_agent(
            agent, {},
            tools={"get_weather": lambda **kw: "sunny"},
            guardrails=g,
            on_event=lambda t, d: events.append((t, d)),
        )

        # The tool result should be a denial message, not the actual tool output
        tool_results = [e for e in events if e[0] == "tool_result"]
        assert len(tool_results) > 0
        assert "denied" in tool_results[0][1]["result"].lower()


# =========================================================================
# §13.5 Steering
# =========================================================================


class TestSteering:
    """Steering injects messages mid-loop."""

    def test_steering_send_drain(self):
        s = Steering()
        s.send("Follow up question")
        assert s.has_pending
        msgs = s.drain()
        assert len(msgs) == 1
        assert msgs[0].role == "user"
        assert not s.has_pending

    def test_steering_drain_empty(self):
        s = Steering()
        assert s.drain() == []

    def test_steering_multiple(self):
        s = Steering()
        s.send("msg1")
        s.send("msg2")
        msgs = s.drain()
        assert len(msgs) == 2

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="result")
    def test_steering_in_agent_loop(self, mock_process, mock_prepare, mock_exec):
        """Steering messages are drained into the conversation."""
        mock_exec.side_effect = [_mock_tool_call_response(), _mock_final_response()]
        agent = _make_agent()
        steering = Steering()

        events: list[tuple[str, Any]] = []

        def on_event(t: str, d: Any) -> None:
            events.append((t, d))
            # Inject steering after first tool call
            if t == "tool_result":
                steering.send("Please also check humidity")

        result = invoke_agent(
            agent, {},
            tools={"get_weather": lambda **kw: "sunny"},
            steering=steering,
            on_event=on_event,
        )
        assert result == "result"


# =========================================================================
# §13.6 Parallel Tool Execution
# =========================================================================


class TestParallelTools:
    """Parallel tool execution via asyncio.gather."""

    @pytest.mark.asyncio
    @patch(f"{_PIPELINE}._invoke_executor_async")
    @patch(f"{_PIPELINE}.prepare_async", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process_async", return_value="result")
    async def test_parallel_async(self, mock_process, mock_prepare, mock_exec):
        """parallel_tool_calls=True uses asyncio.gather for multiple tools."""
        # Create response with 2 tool calls
        tc1 = MagicMock()
        tc1.id = "call_1"
        tc1.name = "get_weather"
        tc1.arguments = '{"location":"NYC"}'
        tc1.function.name = "get_weather"
        tc1.function.arguments = '{"location":"NYC"}'
        tc1.model_dump.return_value = {"id": "call_1", "type": "function", "function": {"name": "get_weather", "arguments": '{"location":"NYC"}'}}

        tc2 = MagicMock()
        tc2.id = "call_2"
        tc2.name = "get_weather"
        tc2.arguments = '{"location":"LA"}'
        tc2.function.name = "get_weather"
        tc2.function.arguments = '{"location":"LA"}'
        tc2.model_dump.return_value = {"id": "call_2", "type": "function", "function": {"name": "get_weather", "arguments": '{"location":"LA"}'}}

        tool_resp = MagicMock()
        tool_resp.choices = [MagicMock()]
        tool_resp.choices[0].finish_reason = "tool_calls"
        tool_resp.choices[0].message.tool_calls = [tc1, tc2]

        mock_exec.side_effect = [tool_resp, _mock_final_response()]

        agent = _make_agent()
        result = await invoke_agent_async(
            agent, {},
            tools={"get_weather": lambda **kw: f"Sunny in {kw.get('location', '?')}"},
            parallel_tool_calls=True,
        )
        assert result == "result"


# =========================================================================
# Combined extensions
# =========================================================================


class TestCombinedExtensions:
    """Multiple extensions working together."""

    @patch(f"{_PIPELINE}._invoke_executor")
    @patch(f"{_PIPELINE}.prepare", return_value=[Message(role="user", parts=[TextPart(value="hi")])])
    @patch(f"{_PIPELINE}.process", return_value="result")
    def test_all_extensions_together(self, mock_process, mock_prepare, mock_exec):
        """Events + context_budget + guardrails + steering all active simultaneously."""
        mock_exec.side_effect = [_mock_tool_call_response(), _mock_final_response()]
        agent = _make_agent()
        events: list[tuple[str, Any]] = []
        steering = Steering()
        guardrails = Guardrails()  # all allow

        result = invoke_agent(
            agent, {},
            tools={"get_weather": lambda **kw: "sunny"},
            on_event=lambda t, d: events.append((t, d)),
            context_budget=100000,
            guardrails=guardrails,
            steering=steering,
        )
        assert result == "result"
        assert len(events) > 0
