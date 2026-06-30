from __future__ import annotations

import json

import pytest

from prompty import (
    AllowAllPermissionResolver,
    CollectingEventSink,
    DenyAllPermissionResolver,
    FunctionHostToolExecutor,
    InMemoryCheckpointStore,
    JsonlEventJournalWriter,
)
from prompty.model import Checkpoint, HostToolRequest, PermissionRequest, SessionEvent, SessionSummary, TurnEvent


def _turn_event() -> TurnEvent:
    return TurnEvent(id="turn-event", type="turn_start", timestamp="2026-06-10T00:00:00Z", payload={"phase": "start"})


def _session_event() -> SessionEvent:
    return SessionEvent(
        id="session-event",
        type="session_start",
        timestamp="2026-06-10T00:00:00Z",
        session_id="session-1",
        payload={"phase": "start"},
    )


def test_collecting_event_sink_captures_events() -> None:
    sink = CollectingEventSink()

    assert sink.emit_turn(_turn_event()) is True
    assert sink.emit_session(_session_event()) is True

    assert [event.id for event in sink.turn_events] == ["turn-event"]
    assert [event.id for event in sink.session_events] == ["session-event"]


def test_jsonl_event_journal_writer_writes_records(tmp_path) -> None:
    trace_path = tmp_path / "trace.jsonl"
    writer = JsonlEventJournalWriter(trace_path)

    writer.append_turn(_turn_event())
    writer.append_session(_session_event())
    writer.close(SessionSummary(session_id="session-1", turns=1))

    lines = [json.loads(line) for line in trace_path.read_text(encoding="utf-8").splitlines()]
    assert [line["kind"] for line in lines] == ["turn", "session", "summary"]
    assert lines[0]["event"]["id"] == "turn-event"
    assert lines[1]["event"]["id"] == "session-event"
    assert lines[2]["summary"]["sessionId"] == "session-1"


def test_jsonl_event_journal_writer_returns_false_after_close(tmp_path) -> None:
    writer = JsonlEventJournalWriter(tmp_path / "trace.jsonl")

    closed = writer.close(None)
    assert closed is True
    assert writer.append_turn(_turn_event()) is False


@pytest.mark.asyncio
async def test_in_memory_checkpoint_store() -> None:
    store = InMemoryCheckpointStore()
    checkpoint = Checkpoint(id="checkpoint-1", session_id="session-1", title="First")

    assert await store.save(checkpoint) is checkpoint
    assert await store.load("session-1", "checkpoint-1") is checkpoint
    assert await store.load("session-1", "missing") is None
    assert await store.list_checkpoints("session-1") == [checkpoint]


@pytest.mark.asyncio
async def test_in_memory_checkpoint_store_requires_keys() -> None:
    store = InMemoryCheckpointStore()

    with pytest.raises(ValueError, match="session_id"):
        await store.save(Checkpoint(id="checkpoint-1", title="Missing session"))
    with pytest.raises(ValueError, match="id"):
        await store.save(Checkpoint(session_id="session-1", title="Missing id"))


@pytest.mark.asyncio
async def test_permission_resolvers() -> None:
    request = PermissionRequest(request_id="permission-1", tool_call_id="tool-call-1", permission="tool.execute")

    allow = await AllowAllPermissionResolver().request(request)
    deny = await DenyAllPermissionResolver().request(request)

    assert allow.approved is True
    assert allow.reason == "allow_all"
    assert allow.request_id == "permission-1"
    assert allow.tool_call_id == "tool-call-1"
    assert deny.approved is False
    assert deny.reason == "deny_all"


@pytest.mark.asyncio
async def test_function_host_tool_executor_success() -> None:
    executor = FunctionHostToolExecutor({"add": lambda args, request: int(args["a"]) + int(args["b"])})

    result = await executor.execute(HostToolRequest(request_id="exec-1", tool_name="add", arguments={"a": 2, "b": 3}))

    assert result.success is True
    assert result.result == 5
    assert result.request_id == "exec-1"
    assert result.tool_name == "add"


@pytest.mark.asyncio
async def test_function_host_tool_executor_passes_empty_arguments() -> None:
    executor = FunctionHostToolExecutor({"count": lambda args, request: len(args)})

    result = await executor.execute(HostToolRequest(tool_name="count"))

    assert result.success is True
    assert result.result == 0


@pytest.mark.asyncio
async def test_function_host_tool_executor_failures() -> None:
    def fail(args, request):
        raise RuntimeError("boom")

    executor = FunctionHostToolExecutor({"fail": fail})

    missing = await executor.execute(HostToolRequest(tool_name="missing"))
    thrown = await executor.execute(HostToolRequest(tool_name="fail"))

    assert missing.success is False
    assert missing.error_kind == "not_found"
    assert thrown.success is False
    assert thrown.error_kind == "exception"
    assert thrown.result == {"message": "boom"}
