"""Unit tests for the provider-agnostic agent loop engine."""

from __future__ import annotations

from prompty.core.agent_loop import (
    GuardrailDecision,
    ModelResponse,
    SteeringMessage,
    ToolCall,
    run_agent_loop,
)


def _final(text: str) -> ModelResponse:
    return ModelResponse(content=text)


def _tool(call_id: str, name: str, arguments: str) -> ModelResponse:
    raw = [{"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}]
    return ModelResponse(content=None, tool_calls=[ToolCall(call_id, name, arguments)], raw_tool_calls=raw)


def _scripted(responses: list[ModelResponse]):
    calls = iter(responses)

    def invoke(_conversation):
        return next(calls)

    return invoke


class TestAccounting:
    def test_no_tools_single_iteration(self):
        result = run_agent_loop(
            [{"role": "user", "content": "hi"}],
            invoke_model=_scripted([_final("hello")]),
            dispatch_tool=lambda call: "",
        )
        assert result.iterations == 1
        assert result.result == "hello"
        # user + assistant final, no tool round.
        assert result.total_messages == 2
        assert result.tool_rounds == 0

    def test_single_tool_round_counts_iterations_as_llm_calls(self):
        result = run_agent_loop(
            [{"role": "system", "content": "s"}, {"role": "user", "content": "weather?"}],
            invoke_model=_scripted([_tool("c1", "get_weather", '{"city": "Paris"}'), _final("72F")]),
            dispatch_tool=lambda call: "72F sunny",
        )
        assert result.iterations == 2
        assert result.tools_executed == 1
        assert result.tool_execution_order == ["get_weather"]
        # system + user + assistant(tool_calls) + tool + assistant(final) = 5, +1 tool round.
        assert result.total_messages == 6

    def test_assistant_tool_calls_message_shape(self):
        result = run_agent_loop(
            [{"role": "user", "content": "x"}],
            invoke_model=_scripted([_tool("c1", "t", "{}"), _final("done")]),
            dispatch_tool=lambda call: "ok",
        )
        assistant = result.conversation[1]
        assert assistant["role"] == "assistant"
        assert assistant["content"] == ""
        assert assistant["metadata"]["tool_calls"][0]["id"] == "c1"

    def test_tool_message_content_is_string(self):
        result = run_agent_loop(
            [{"role": "user", "content": "x"}],
            invoke_model=_scripted([_tool("c1", "t", "{}"), _final("done")]),
            dispatch_tool=lambda call: "raw-output",
        )
        tool_msg = result.conversation[2]
        assert tool_msg == {"role": "tool", "content": "raw-output", "metadata": {"tool_call_id": "c1"}}


class TestEvents:
    def test_event_order_for_tool_round(self):
        result = run_agent_loop(
            [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
            invoke_model=_scripted([_tool("c1", "t", "{}"), _final("done")]),
            dispatch_tool=lambda call: "r",
        )
        kinds = [e["type"] for e in result.events]
        assert kinds == [
            "status",
            "tool_call_start",
            "tool_result",
            "messages_updated",
            "done",
        ]

    def test_messages_updated_uses_plus_one_convention(self):
        result = run_agent_loop(
            [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
            invoke_model=_scripted([_tool("c1", "t", "{}"), _final("done")]),
            dispatch_tool=lambda call: "r",
        )
        updated = next(e for e in result.events if e["type"] == "messages_updated")
        # conversation at that point = [s, u, assistant_tc, tool] = 4, reported = 5.
        assert updated["data"]["message_count"] == 5


class TestGuardrails:
    def test_input_guardrail_denies_before_llm(self):
        result = run_agent_loop(
            [{"role": "user", "content": "pii"}],
            invoke_model=_scripted([_final("should not run")]),
            dispatch_tool=lambda call: "",
            input_guardrail=lambda conv: GuardrailDecision(False, "Contains PII"),
        )
        assert result.error == "GuardrailError"
        assert result.error_reason == "Contains PII"
        assert result.iterations == 0

    def test_output_guardrail_denies_after_llm(self):
        result = run_agent_loop(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted([_final("harmful")]),
            dispatch_tool=lambda call: "",
            output_guardrail=lambda resp: GuardrailDecision(False, "harmful"),
        )
        assert result.error == "GuardrailError"
        assert result.iterations == 1

    def test_tool_guardrail_denies_one_tool(self):
        response = ModelResponse(
            content=None,
            tool_calls=[ToolCall("c1", "safe", "{}"), ToolCall("c2", "danger", "{}")],
            raw_tool_calls=[
                {"id": "c1", "type": "function", "function": {"name": "safe", "arguments": "{}"}},
                {"id": "c2", "type": "function", "function": {"name": "danger", "arguments": "{}"}},
            ],
        )
        result = run_agent_loop(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted([response, _final("done")]),
            dispatch_tool=lambda call: "ok",
            tool_guardrail=lambda name, args: GuardrailDecision(name != "danger", "blocked"),
        )
        assert result.denied_tools == ["danger"]
        assert result.tool_execution_order == ["safe"]


class TestCancellation:
    def test_cancel_before_first_iteration(self):
        result = run_agent_loop(
            [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
            invoke_model=_scripted([_final("x")]),
            dispatch_tool=lambda call: "",
            cancel_at="before_iteration",
        )
        assert result.error == "CancelledError"
        assert result.iterations == 0
        assert result.total_messages == 2
        assert result.events[-1]["type"] == "cancelled"

    def test_cancel_after_first_tool(self):
        response = ModelResponse(
            content=None,
            tool_calls=[ToolCall("c1", "a", "{}"), ToolCall("c2", "b", "{}")],
            raw_tool_calls=[
                {"id": "c1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                {"id": "c2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
            ],
        )
        result = run_agent_loop(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted([response, _final("x")]),
            dispatch_tool=lambda call: "r",
            cancel_at="after_tool_0",
        )
        assert result.error == "CancelledError"
        assert result.tools_executed == 1
        assert result.tool_execution_order == ["a"]


class TestSteering:
    def test_steering_injected_before_iteration(self):
        result = run_agent_loop(
            [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
            invoke_model=_scripted([_tool("c1", "t", "{}"), _final("done")]),
            dispatch_tool=lambda call: "r",
            steering=[SteeringMessage(2, "user", "focus on X")],
        )
        kinds = [e["type"] for e in result.events]
        assert "Injecting steering message" in [
            e["data"].get("message") for e in result.events if e["type"] == "status"
        ]
        assert kinds.count("messages_updated") == 2
        assert any(m.get("content") == "focus on X" for m in result.conversation)


class TestErrors:
    def test_unregistered_tool_raises_value_error_marker(self):
        result = run_agent_loop(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted([_tool("c1", "unknown", "{}")]),
            dispatch_tool=lambda call: "",
            is_tool_registered=lambda name: name == "known",
        )
        assert result.error == "Tool not registered: unknown"
        assert result.error_type == "ValueError"

    def test_max_iterations_exceeded(self):
        tool_forever = [_tool(f"c{i}", "t", "{}") for i in range(12)]
        result = run_agent_loop(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted(tool_forever),
            dispatch_tool=lambda call: "r",
            max_iterations=10,
        )
        assert result.error == "Agent loop exceeded 10 iterations"
        assert result.iterations == 11


class TestContextTrim:
    def test_no_trim_when_within_budget(self):
        result = run_agent_loop(
            [{"role": "user", "content": "short"}],
            invoke_model=_scripted([_final("ok")]),
            dispatch_tool=lambda call: "",
            context_budget=10_000,
        )
        assert result.trimmed_messages is None

    def test_trim_preserves_systems_and_last_user(self):
        messages = [
            {"role": "system", "content": "sys1"},
            {"role": "system", "content": "sys2"},
            {"role": "user", "content": "x" * 200},
            {"role": "assistant", "content": "y" * 200},
            {"role": "user", "content": "latest question"},
        ]
        result = run_agent_loop(
            messages,
            invoke_model=_scripted([_final("done")]),
            dispatch_tool=lambda call: "",
            context_budget=100,
            summarize=lambda dropped: "[Summary of earlier conversation] earlier stuff",
        )
        assert result.trimmed_messages is not None
        roles = [m["role"] for m in result.trimmed_messages]
        assert roles == ["system", "system", "system", "user"]
        assert result.trimmed_messages[2]["content"].startswith("[Summary of earlier conversation]")
        assert result.trimmed_messages[-1]["content"] == "latest question"
