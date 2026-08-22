"""Unit tests for the provider-agnostic single-turn snapshot engine."""

from __future__ import annotations

from prompty.core.turn_engine import (
    PORTABILITY_DELEGATED,
    PORTABILITY_PORTABLE,
    TurnModelTurn,
    TurnToolCall,
    run_turn,
)


def _scripted(turns: list[TurnModelTurn]):
    def invoke(iteration: int, _tool_results):
        return turns[iteration]

    return invoke


class TestFinalAnswer:
    def test_single_iteration_final(self):
        result = run_turn(
            [{"role": "user", "content": "hi"}],
            invoke_model=_scripted([TurnModelTurn(output="hello")]),
        )
        assert result.status == "success"
        assert result.output == "hello"
        assert result.iterations == 1
        assert result.snapshots == 1
        assert result.snapshot_stable_prefixes == [1]
        assert result.snapshot_portability == [PORTABILITY_PORTABLE]
        assert result.commit_portability == PORTABILITY_PORTABLE
        assert result.delegated_state_count == 0
        assert result.tool_results == []

    def test_final_event_kinds(self):
        result = run_turn(
            [{"role": "user", "content": "hi"}],
            invoke_model=_scripted([TurnModelTurn(output="x")]),
        )
        assert result.events == [
            "turn_started",
            "context_prepared",
            "model_invocation_started",
            "model_invocation_completed",
            "checkpoint_created",
            "turn_committed",
            "post_commit_started",
            "post_commit_completed",
        ]


class TestToolRound:
    def test_tool_round_then_final(self):
        turns = [
            TurnModelTurn(tool_calls=[TurnToolCall(id="t1", name="search", arguments={"q": "x"})]),
            TurnModelTurn(output="answer"),
        ]
        result = run_turn(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted(turns),
            execute_tool=lambda call: "result-data",
        )
        assert result.iterations == 2
        assert result.snapshots == 2
        assert result.tool_results[0].id == "t1"
        assert result.tool_results[0].success is True
        assert result.tool_result_order == ["t1"]
        assert result.output == "answer"

    def test_tool_round_event_kinds(self):
        turns = [
            TurnModelTurn(tool_calls=[TurnToolCall(id="t1", name="s", arguments={})]),
            TurnModelTurn(output="done"),
        ]
        result = run_turn(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted(turns),
            execute_tool=lambda call: "r",
        )
        assert result.events == [
            "turn_started",
            "context_prepared",
            "model_invocation_started",
            "model_invocation_completed",
            "checkpoint_created",
            "permission_requested",
            "permission_resolved",
            "tool_execution_started",
            "tool_execution_completed",
            "checkpoint_created",
            "tool_result_committed",
            "conversation_updated",
            "checkpoint_created",
            "context_prepared",
            "model_invocation_started",
            "model_invocation_completed",
            "checkpoint_created",
            "turn_committed",
            "post_commit_started",
            "post_commit_completed",
        ]

    def test_ordered_multi_tool(self):
        turns = [
            TurnModelTurn(
                tool_calls=[
                    TurnToolCall(id="a", name="one", arguments={}),
                    TurnToolCall(id="b", name="two", arguments={}),
                ]
            ),
            TurnModelTurn(output="done"),
        ]
        result = run_turn(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted(turns),
            execute_tool=lambda call: "r",
        )
        assert result.tool_result_order == ["a", "b"]
        assert len(result.tool_results) == 2
        # snapshots counts only model iterations, not tool checkpoints.
        assert result.snapshots == 2


class TestPermissionDenial:
    def test_denied_tool_still_counts_but_not_executed(self):
        turns = [
            TurnModelTurn(tool_calls=[TurnToolCall(id="t1", name="danger", arguments={})]),
            TurnModelTurn(output="done"),
        ]
        executed: list[str] = []

        def execute(call):
            executed.append(call.name)
            return "should not run"

        result = run_turn(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted(turns),
            resolve_permission=lambda call: call.name != "danger",
            execute_tool=execute,
        )
        assert executed == []
        assert result.tool_results[0].success is False
        assert result.tool_result_order == ["t1"]
        # No tool_execution_* events on the denied path.
        assert "tool_execution_started" not in result.events
        assert "permission_resolved" in result.events


class TestPortability:
    def test_delegated_applies_to_next_snapshot(self):
        turns = [
            TurnModelTurn(
                tool_calls=[TurnToolCall(id="t1", name="s", arguments={})],
                next_portability=PORTABILITY_DELEGATED,
                delegated_state=[{"provider": "openai", "kind": "response", "id": "resp_1"}],
            ),
            TurnModelTurn(output="done"),
        ]
        result = run_turn(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted(turns),
            execute_tool=lambda call: "r",
        )
        # model[0] declares delegated -> applies to snapshot 1 (the SECOND), not 0.
        assert result.snapshot_portability == [PORTABILITY_PORTABLE, PORTABILITY_DELEGATED]
        assert result.commit_portability == PORTABILITY_DELEGATED
        assert result.delegated_state_count == 1


class TestCancellation:
    def test_cancel_before_run(self):
        result = run_turn(
            [{"role": "user", "content": "u"}],
            invoke_model=_scripted([TurnModelTurn(output="never")]),
            cancel_before_run=True,
        )
        assert result.status == "cancelled"
        assert result.output is None
        assert result.iterations == 0
        assert result.snapshots == 0
        assert result.events == ["turn_started", "turn_cancelled"]
