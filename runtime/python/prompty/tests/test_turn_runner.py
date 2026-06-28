from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from prompty import (
    AllowAllPermissionResolver,
    CollectingEventSink,
    DenyAllPermissionResolver,
    FunctionHostToolExecutor,
    InMemoryCheckpointStore,
    JsonlEventJournalWriter,
    ReferenceTurnRunner,
    RunTurnRequest,
    TurnModelRequest,
    TurnModelResponse,
)
from prompty.model import HostToolRequest, HostToolResult, TurnOptions


def _fixed_ids():
    index = 0

    def next_id(prefix: str) -> str:
        nonlocal index
        index += 1
        return f"{prefix}-{index}"

    return next_id


def _records(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


@pytest.mark.asyncio
async def test_turn_runner_emits_journals_and_checkpoints_in_order(tmp_path: Path) -> None:
    journal_path = tmp_path / "trace.jsonl"
    sink = CollectingEventSink()
    checkpoint_store = InMemoryCheckpointStore()

    runner = ReferenceTurnRunner(
        event_sink=sink,
        journal=JsonlEventJournalWriter(journal_path),
        checkpoint_store=checkpoint_store,
        permission_resolver=AllowAllPermissionResolver(),
        host_tool_executor=FunctionHostToolExecutor({}),
        invoke_model=lambda request: TurnModelResponse(
            output={"text": f"hello {request.inputs['name']}"},
            checkpoint_state={"stable": True},
        ),
        now=lambda: "2026-06-28T00:00:00Z",
        next_id=_fixed_ids(),
    )

    result = await runner.run(
        RunTurnRequest(
            session_id="session-1",
            turn_id="turn-1",
            inputs={"name": "Ada"},
            options=TurnOptions(max_iterations=3),
        )
    )

    assert result.status == "success"
    assert result.iterations == 1
    assert result.output == {"text": "hello Ada"}
    assert [event.type for event in sink.session_events] == ["session_start", "checkpoint_created", "session_end"]
    assert [event.type for event in sink.turn_events] == ["turn_start", "llm_start", "llm_complete", "turn_end"]
    checkpoint = await checkpoint_store.load("session-1", "turn-1-checkpoint-0")
    assert checkpoint is not None
    assert checkpoint.state == {
        "iteration": 0,
        "output": {"text": "hello Ada"},
        "toolRequests": [],
        "stable": True,
    }
    assert [record["kind"] for record in _records(journal_path)] == [
        "session",
        "turn",
        "turn",
        "turn",
        "session",
        "turn",
        "session",
        "summary",
    ]


@pytest.mark.asyncio
async def test_turn_runner_requests_permission_and_executes_host_tools(tmp_path: Path) -> None:
    sink = CollectingEventSink()

    def invoke_model(request: TurnModelRequest) -> TurnModelResponse:
        if request.iteration == 0:
            return TurnModelResponse(
                tool_requests=[
                    HostToolRequest(
                        request_id="exec-1",
                        tool_call_id="call-1",
                        tool_name="add",
                        arguments={"a": 2, "b": 3},
                    )
                ]
            )
        return TurnModelResponse(output={"toolResult": request.tool_results[0].result})

    runner = ReferenceTurnRunner(
        event_sink=sink,
        journal=JsonlEventJournalWriter(tmp_path / "trace.jsonl"),
        checkpoint_store=InMemoryCheckpointStore(),
        permission_resolver=AllowAllPermissionResolver(),
        host_tool_executor=FunctionHostToolExecutor({"add": lambda args, request: int(args["a"]) + int(args["b"])}),
        invoke_model=invoke_model,
        now=lambda: "2026-06-28T00:00:00Z",
        next_id=_fixed_ids(),
    )

    result = await runner.run(RunTurnRequest(session_id="session-1", turn_id="turn-1"))

    assert result.output == {"toolResult": 5}
    assert result.tool_results[0].success is True
    assert result.tool_results[0].result == 5
    assert [event.type for event in sink.turn_events] == [
        "turn_start",
        "llm_start",
        "llm_complete",
        "permission_requested",
        "permission_completed",
        "tool_execution_start",
        "tool_execution_complete",
        "tool_result",
        "messages_updated",
        "llm_start",
        "llm_complete",
        "turn_end",
    ]


@pytest.mark.asyncio
async def test_turn_runner_records_denied_permission_without_executing_tool(tmp_path: Path) -> None:
    class FailingExecutor:
        async def execute(self, request: HostToolRequest) -> HostToolResult:
            raise AssertionError("should not execute")

    sink = CollectingEventSink()

    def invoke_model(request: TurnModelRequest) -> TurnModelResponse:
        if request.iteration == 0:
            return TurnModelResponse(tool_requests=[HostToolRequest(request_id="exec-1", tool_name="shell")])
        return TurnModelResponse(output={"denied": request.tool_results[0].error_kind})

    runner = ReferenceTurnRunner(
        event_sink=sink,
        journal=JsonlEventJournalWriter(tmp_path / "trace.jsonl"),
        checkpoint_store=InMemoryCheckpointStore(),
        permission_resolver=DenyAllPermissionResolver(),
        host_tool_executor=FailingExecutor(),
        invoke_model=invoke_model,
        now=lambda: "2026-06-28T00:00:00Z",
        next_id=_fixed_ids(),
    )

    result = await runner.run(RunTurnRequest(session_id="session-1", turn_id="turn-1"))

    assert result.output == {"denied": "permission_denied"}
    assert result.tool_results[0].success is False
    assert result.tool_results[0].error_kind == "permission_denied"
    assert "tool_execution_start" not in [event.type for event in sink.turn_events]


@pytest.mark.asyncio
async def test_turn_runner_surfaces_host_tool_failure(tmp_path: Path) -> None:
    def fail(args: dict[str, Any], request: HostToolRequest) -> object:
        raise RuntimeError("boom")

    def invoke_model(request: TurnModelRequest) -> TurnModelResponse:
        if request.iteration == 0:
            return TurnModelResponse(tool_requests=[HostToolRequest(request_id="exec-1", tool_name="fail")])
        return TurnModelResponse(output=request.tool_results[0].save())

    runner = ReferenceTurnRunner(
        event_sink=CollectingEventSink(),
        journal=JsonlEventJournalWriter(tmp_path / "trace.jsonl"),
        checkpoint_store=InMemoryCheckpointStore(),
        permission_resolver=AllowAllPermissionResolver(),
        host_tool_executor=FunctionHostToolExecutor({"fail": fail}),
        invoke_model=invoke_model,
        now=lambda: "2026-06-28T00:00:00Z",
        next_id=_fixed_ids(),
    )

    result = await runner.run(RunTurnRequest(session_id="session-1", turn_id="turn-1"))

    assert result.output["success"] is False
    assert result.output["errorKind"] == "exception"
    assert result.output["result"] == {"message": "boom"}


@pytest.mark.asyncio
async def test_turn_runner_produces_deterministic_replayable_records(tmp_path: Path) -> None:
    async def run_once(path: Path) -> list[dict[str, Any]]:
        runner = ReferenceTurnRunner(
            event_sink=CollectingEventSink(),
            journal=JsonlEventJournalWriter(path),
            checkpoint_store=InMemoryCheckpointStore(),
            permission_resolver=AllowAllPermissionResolver(),
            host_tool_executor=FunctionHostToolExecutor({}),
            invoke_model=lambda request: TurnModelResponse(output="done"),
            now=lambda: "2026-06-28T00:00:00Z",
            next_id=_fixed_ids(),
        )
        await runner.run(RunTurnRequest(session_id="session-1", turn_id="turn-1"))
        return _records(path)

    assert await run_once(tmp_path / "first.jsonl") == await run_once(tmp_path / "second.jsonl")
