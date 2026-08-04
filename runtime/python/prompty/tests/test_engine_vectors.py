"""Exercise the emitted Python turn engine contracts against shared vectors."""

from __future__ import annotations

import json
from collections import Counter, deque
from pathlib import Path
from typing import Any

import pytest

from prompty import (
    CancellationToken,
    ReferenceTurnEngine,
    load_engine_checkpoint,
    save_engine_checkpoint,
)
from prompty.model import (
    EngineCheckpoint,
    EngineEvent,
    EnginePermissionDecision,
    InvocationContextState,
    Message,
    ModelInvocationRequest,
    ModelInvocationResponse,
    ModelReconciliationState,
    ModelToolRequest,
    ModelToolResult,
    ResumeContext,
)

REPO_ROOT = Path(__file__).parents[4]
TURN_VECTORS = REPO_ROOT / "spec" / "vectors" / "engine" / "turn_vectors.json"


def _vectors() -> dict[str, Any]:
    return json.loads(TURN_VECTORS.read_text(encoding="utf-8"))


def _roundtrip_checkpoint(checkpoint: EngineCheckpoint) -> EngineCheckpoint:
    saved = save_engine_checkpoint(checkpoint)
    return load_engine_checkpoint(json.loads(json.dumps(saved)))


class _Ids:
    def __init__(self) -> None:
        self._counts: Counter[str] = Counter()

    def __call__(self, kind: str) -> str:
        self._counts[kind] += 1
        return f"{kind}-{self._counts[kind]}"


def _response(data: dict[str, Any]) -> ModelInvocationResponse:
    context_state = None
    if data.get("nextPortability") is not None or data.get("delegatedState") is not None:
        context_state = InvocationContextState.load(
            {
                "portability": data.get("nextPortability", "portable"),
                "delegatedState": data.get("delegatedState", []),
            }
        )
    return ModelInvocationResponse(
        output=data.get("output"),
        assistant_messages=[Message.assistant(data["assistant"])] if data.get("assistant") else [],
        tool_requests=[ModelToolRequest.load(item) for item in data.get("tools", [])],
        next_context_state=context_state,
    )


@pytest.mark.asyncio
async def test_reference_turn_engine_matches_shared_vectors() -> None:
    vectors = _vectors()
    assert vectors["version"] == "1"

    for case in vectors["cases"]:
        responses = deque(_response(item) for item in case["model"])
        requests: list[ModelInvocationRequest] = []
        events: list[EngineEvent] = []
        checkpoints: list[EngineCheckpoint] = []
        post_commits: list[object] = []

        def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
            requests.append(request)
            return responses.popleft()

        def execute_tool(request: ModelToolRequest) -> ModelToolResult:
            return ModelToolResult(
                request_id=request.id,
                name=request.name,
                output=case.get("toolOutputs", {}).get(request.id),
            )

        engine = ReferenceTurnEngine(
            invoke_model=invoke_model,
            execute_tool=execute_tool,
            authorize=lambda request: EnginePermissionDecision(
                approved=request.name not in case.get("denyTools", []),
                reason="denied by vector" if request.name in case.get("denyTools", []) else "allowed",
            ),
            on_event=events.append,
            save_checkpoint=checkpoints.append,
            post_commit=post_commits.append,
            now=lambda: "2026-06-28T00:00:00Z",
            next_id=_Ids(),
        )
        cancellation = CancellationToken()
        if case.get("cancelBeforeRun"):
            cancellation.cancel()

        result = await engine.run_async(
            f"session-{case['name']}",
            f"turn-{case['name']}",
            [Message.user(item["content"]) for item in case["messages"]],
            cancellation=cancellation,
        )
        expected = case["expected"]

        assert result.commit.status == expected["status"], case["name"]
        assert result.commit.output == expected.get("output"), case["name"]
        assert result.commit.iterations == expected["iterations"], case["name"]
        assert len(result.snapshots) == expected["snapshots"], case["name"]
        assert len(result.tool_results) == expected["toolResults"], case["name"]
        assert [item.request_id for item in result.tool_results] == expected.get("toolResultOrder", []), case["name"]
        if "snapshotStablePrefixes" in expected:
            assert [item.stable_prefix_messages for item in result.snapshots] == expected["snapshotStablePrefixes"]
        if "snapshotPortability" in expected:
            assert [item.context_state.portability for item in result.snapshots] == expected["snapshotPortability"]
        if "commitPortability" in expected:
            assert result.commit.context_state.portability == expected["commitPortability"]
        if "delegatedState" in expected:
            assert len(result.commit.context_state.delegated_state) == expected["delegatedState"]
        if "eventKinds" in expected:
            assert [event.kind for event in events] == expected["eventKinds"], case["name"]
        assert [event.sequence for event in events] == list(range(1, len(events) + 1))
        assert result.commit.last_sequence == events[-1].sequence
        assert len(requests) == expected["snapshots"]
        assert len(post_commits) == int(expected["status"] == "success")
        assert all(checkpoint.run_id for checkpoint in checkpoints)


class _Interrupted(Exception):
    pass


@pytest.mark.asyncio
async def test_resume_does_not_repeat_completed_model_effect() -> None:
    model_calls = 0
    captured: EngineCheckpoint | None = None
    resumed_events: list[EngineEvent] = []

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        nonlocal model_calls
        model_calls += 1
        return ModelInvocationResponse(output="done")

    def interrupt(checkpoint: EngineCheckpoint) -> None:
        nonlocal captured
        captured = checkpoint
        raise _Interrupted

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        save_checkpoint=interrupt,
        next_id=_Ids(),
    )
    with pytest.raises(_Interrupted):
        await engine.run_async("session-1", "turn-1", [Message.user("hello")])

    assert captured is not None
    assert captured.final_output_ready is True
    captured = _roundtrip_checkpoint(captured)
    resumed = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        on_event=resumed_events.append,
        next_id=_Ids(),
    )
    result = await resumed.resume_async(ResumeContext(checkpoint=captured, max_iterations=10))

    assert result.commit.output == "done"
    assert model_calls == 1
    assert resumed_events[0].sequence == captured.last_sequence + 1
    assert [event.kind for event in resumed_events] == [
        "turn_started",
        "turn_committed",
        "post_commit_started",
        "post_commit_completed",
    ]


@pytest.mark.asyncio
async def test_resume_does_not_repeat_completed_tool_effect() -> None:
    tool_calls: list[str] = []
    captured: EngineCheckpoint | None = None

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        return ModelInvocationResponse(
            assistant_messages=[Message.assistant("calling tools")],
            tool_requests=[
                ModelToolRequest(id="call-a", name="echo", arguments={"value": "A"}),
                ModelToolRequest(id="call-b", name="echo", arguments={"value": "B"}),
            ],
        )

    def execute_tool(request: ModelToolRequest) -> ModelToolResult:
        tool_calls.append(request.id)
        return ModelToolResult(request_id=request.id, name=request.name, output=request.arguments)

    def interrupt(checkpoint: EngineCheckpoint) -> None:
        nonlocal captured
        if len(checkpoint.completed_tool_results) == 1:
            captured = checkpoint
            raise _Interrupted

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=execute_tool,
        save_checkpoint=interrupt,
        next_id=_Ids(),
    )
    with pytest.raises(_Interrupted):
        await engine.run_async("session-1", "turn-1", [Message.user("tools")])

    assert captured is not None
    assert [message.role for message in captured.messages] == ["user"]
    captured = _roundtrip_checkpoint(captured)
    responses = deque([ModelInvocationResponse(output="done")])
    resumed = ReferenceTurnEngine(
        invoke_model=lambda request: responses.popleft(),
        execute_tool=execute_tool,
        next_id=_Ids(),
    )
    result = await resumed.resume_async(ResumeContext(checkpoint=captured, max_iterations=10))

    assert result.commit.output == "done"
    assert tool_calls == ["call-a", "call-b"]
    assert [item.request_id for item in result.tool_results] == ["call-a", "call-b"]
    resumed_request = result.snapshots[0]
    tool_messages = [message for message in resumed_request.messages if message.role == "tool"]
    assert [message.metadata["tool_call_id"] for message in tool_messages] == ["call-a", "call-b"]
    assert [message.role for message in resumed_request.messages] == ["user", "assistant", "tool", "tool"]
    assert resumed_request.stable_prefix_messages == 1


@pytest.mark.asyncio
async def test_cancellation_mid_tool_round_preserves_pending_batch_for_resume() -> None:
    cancellation = CancellationToken()
    tool_calls: list[str] = []
    checkpoints: list[EngineCheckpoint] = []
    events: list[EngineEvent] = []

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        return ModelInvocationResponse(
            assistant_messages=[Message.assistant("calling")],
            tool_requests=[
                ModelToolRequest(id="call-a", name="echo"),
                ModelToolRequest(id="call-b", name="echo"),
            ],
        )

    def execute_tool(request: ModelToolRequest) -> ModelToolResult:
        tool_calls.append(request.id)
        if request.id == "call-a":
            cancellation.cancel()
        return ModelToolResult(request_id=request.id, name=request.name, output=request.id)

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=execute_tool,
        on_event=events.append,
        save_checkpoint=checkpoints.append,
        next_id=_Ids(),
    )
    cancelled = await engine.run_async(
        "session-1",
        "turn-1",
        [Message.user("tools")],
        cancellation=cancellation,
    )

    assert cancelled.commit.status == "cancelled"
    assert tool_calls == ["call-a"]
    checkpoint = _roundtrip_checkpoint(checkpoints[-1])
    assert [request.id for request in checkpoint.pending_tool_requests] == ["call-a", "call-b"]
    assert [result.request_id for result in checkpoint.completed_tool_results] == ["call-a"]
    assert [message.role for message in checkpoint.messages] == ["user"]

    resumed_events: list[EngineEvent] = []
    responses = deque([ModelInvocationResponse(output="done")])
    resumed = ReferenceTurnEngine(
        invoke_model=lambda request: responses.popleft(),
        execute_tool=execute_tool,
        on_event=resumed_events.append,
        next_id=_Ids(),
    )
    result = await resumed.resume_async(
        ResumeContext(
            checkpoint=checkpoint,
            max_iterations=10,
            last_journal_sequence=events[-1].sequence,
        )
    )

    assert result.commit.status == "success"
    assert tool_calls == ["call-a", "call-b"]
    assert [item.request_id for item in result.tool_results] == ["call-a", "call-b"]
    assert resumed_events[0].sequence == events[-1].sequence + 1
    assert [message.role for message in result.snapshots[0].messages] == ["user", "assistant", "tool", "tool"]


@pytest.mark.asyncio
async def test_cancellation_after_model_effect_prevents_commit() -> None:
    cancellation = CancellationToken()
    events: list[EngineEvent] = []
    checkpoints: list[EngineCheckpoint] = []
    model_calls = 0

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        nonlocal model_calls
        model_calls += 1
        cancellation.cancel()
        return ModelInvocationResponse(output="must not commit")

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        on_event=events.append,
        save_checkpoint=checkpoints.append,
        next_id=_Ids(),
    )
    result = await engine.run_async(
        "session-1",
        "turn-1",
        [Message.user("cancel")],
        cancellation=cancellation,
    )

    assert result.commit.status == "cancelled"
    assert "turn_committed" not in [event.kind for event in events]
    checkpoint = _roundtrip_checkpoint(checkpoints[-1])
    assert checkpoint.final_output_ready is True

    resumed = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        next_id=_Ids(),
    )
    resumed_result = await resumed.resume_async(ResumeContext(checkpoint=checkpoint, max_iterations=10))
    assert resumed_result.commit.output == "must not commit"
    assert model_calls == 1


@pytest.mark.asyncio
async def test_resume_honors_cancellation_and_reconciliation_checkpoints() -> None:
    model_calls = 0

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        nonlocal model_calls
        model_calls += 1
        return ModelInvocationResponse(output="unexpected")

    base = EngineCheckpoint(
        id="checkpoint-1",
        session_id="session-1",
        turn_id="turn-1",
        run_id="run-1",
        iteration=0,
        last_sequence=4,
        messages=[Message.user("hello")],
        completed_model_iterations=1,
        pending_output="done",
        final_output_ready=True,
    )
    cancellation = CancellationToken()
    cancellation.cancel()
    cancelled_engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        next_id=_Ids(),
    )
    cancelled = await cancelled_engine.resume_async(ResumeContext(checkpoint=base), cancellation=cancellation)
    assert cancelled.commit.status == "cancelled"

    reconciliation = ModelReconciliationState(
        invocation_id="invocation-1",
        request=ModelInvocationRequest(),
        message="provider outcome unknown",
    )
    base.final_output_ready = False
    base.pending_output = None
    base.reconciliation_required = True
    base.model_reconciliation = reconciliation
    reconciliation_engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        next_id=_Ids(),
    )
    unresolved = await reconciliation_engine.resume_async(ResumeContext(checkpoint=base))

    assert unresolved.commit.status == "reconciliation_required"
    assert unresolved.commit.model_reconciliation == reconciliation
    assert model_calls == 0


@pytest.mark.asyncio
async def test_checkpoints_retain_all_turn_tool_results() -> None:
    responses = deque(
        [
            ModelInvocationResponse(tool_requests=[ModelToolRequest(id="call-a", name="echo")]),
            ModelInvocationResponse(tool_requests=[ModelToolRequest(id="call-b", name="echo")]),
            ModelInvocationResponse(output="done"),
        ]
    )
    checkpoints: list[EngineCheckpoint] = []
    engine = ReferenceTurnEngine(
        invoke_model=lambda request: responses.popleft(),
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name, output=request.id),
        save_checkpoint=checkpoints.append,
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("tools")])

    assert result.commit.output == "done"
    assert [item.request_id for item in checkpoints[-1].completed_tool_results] == ["call-a", "call-b"]
    assert checkpoints[-1].metadata is None


@pytest.mark.asyncio
async def test_indeterminate_tool_halts_batch_and_requires_reconciliation() -> None:
    tool_calls: list[str] = []
    checkpoints: list[EngineCheckpoint] = []

    def execute_tool(request: ModelToolRequest) -> ModelToolResult:
        tool_calls.append(request.id)
        return ModelToolResult(
            request_id=request.id,
            name=request.name,
            outcome="indeterminate",
            error_kind="outcome_unknown",
        )

    engine = ReferenceTurnEngine(
        invoke_model=lambda request: ModelInvocationResponse(
            tool_requests=[
                ModelToolRequest(id="call-a", name="write"),
                ModelToolRequest(id="call-b", name="write"),
            ]
        ),
        execute_tool=execute_tool,
        save_checkpoint=checkpoints.append,
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("write")])

    assert result.commit.status == "reconciliation_required"
    assert tool_calls == ["call-a"]
    assert checkpoints[-1].reconciliation_required is True
    assert [item.request_id for item in checkpoints[-1].completed_tool_results] == ["call-a"]


@pytest.mark.asyncio
async def test_mismatched_tool_result_identity_fails_conversation_commit() -> None:
    engine = ReferenceTurnEngine(
        invoke_model=lambda request: ModelInvocationResponse(
            assistant_messages=[Message.assistant("calling")],
            tool_requests=[ModelToolRequest(id="call-a", name="echo")],
        ),
        execute_tool=lambda request: ModelToolResult(request_id="wrong", name=request.name),
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("echo")])

    assert result.commit.status == "failed"
    assert result.commit.output["errorKind"] == "conversation_format_error"
    assert [message.role for message in result.commit.messages] == ["user"]


@pytest.mark.asyncio
async def test_model_invocation_retries_with_configured_attempt_budget() -> None:
    attempts = 0
    events: list[EngineEvent] = []

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("transient")
        return ModelInvocationResponse(output="done")

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        on_event=events.append,
        next_id=_Ids(),
    )
    result = await engine.run_async(
        "session-1",
        "turn-1",
        [Message.user("retry")],
        max_model_attempts=2,
    )

    assert result.commit.status == "success"
    assert result.commit.output == "done"
    assert attempts == 2
    assert [event.kind for event in events].count("model_invocation_started") == 2
    failed = next(event for event in events if event.kind == "model_invocation_failed")
    assert failed.payload["attempt"] == 0
    assert failed.payload["exhausted"] is False


@pytest.mark.asyncio
async def test_zero_model_attempts_uses_default_retry_budget() -> None:
    attempts = 0

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("still failing")

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        next_id=_Ids(),
    )
    result = await engine.run_async(
        "session-1",
        "turn-1",
        [Message.user("retry")],
        max_model_attempts=0,
    )

    assert result.commit.status == "failed"
    assert attempts == 3


@pytest.mark.asyncio
async def test_resume_honors_max_model_attempts() -> None:
    attempts = 0
    checkpoint = EngineCheckpoint(
        id="checkpoint-1",
        session_id="session-1",
        turn_id="turn-1",
        run_id="run-1",
        messages=[Message.user("retry")],
        stable_prefix_messages=1,
    )

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("still failing")

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        next_id=_Ids(),
    )
    result = await engine.resume_async(ResumeContext(checkpoint=checkpoint, max_iterations=1, max_model_attempts=2))

    assert result.commit.status == "failed"
    assert result.commit.output["errorKind"] == "model_error"
    assert attempts == 2


@pytest.mark.asyncio
async def test_indeterminate_model_failure_requires_reconciliation() -> None:
    class IndeterminateModelError(RuntimeError):
        outcome_unknown = True
        metadata = {"requestId": "provider-request-1"}

    checkpoints: list[EngineCheckpoint] = []
    engine = ReferenceTurnEngine(
        invoke_model=lambda request: (_ for _ in ()).throw(IndeterminateModelError("unknown outcome")),
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        save_checkpoint=checkpoints.append,
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("reconcile")])

    assert result.commit.status == "reconciliation_required"
    assert result.commit.model_reconciliation is not None
    assert result.commit.model_reconciliation.failed_attempt == 0
    assert result.commit.model_reconciliation.metadata == {"requestId": "provider-request-1"}
    assert checkpoints[-1].reconciliation_required is True
    assert checkpoints[-1].resume_same_iteration is True


@pytest.mark.asyncio
async def test_indeterminate_model_checkpoint_retains_prior_tool_results() -> None:
    class IndeterminateModelError(RuntimeError):
        outcome_unknown = True

    responses: deque[ModelInvocationResponse | Exception] = deque(
        [
            ModelInvocationResponse(tool_requests=[ModelToolRequest(id="call-1", name="echo")]),
            IndeterminateModelError("unknown outcome"),
        ]
    )
    checkpoints: list[EngineCheckpoint] = []

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        response = responses.popleft()
        if isinstance(response, Exception):
            raise response
        return response

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name, output="echoed"),
        save_checkpoint=checkpoints.append,
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("echo")])

    assert result.commit.status == "reconciliation_required"
    assert [item.request_id for item in result.tool_results] == ["call-1"]
    assert [item.request_id for item in checkpoints[-1].completed_tool_results] == ["call-1"]


@pytest.mark.asyncio
async def test_permission_callback_failure_commits_failed_turn() -> None:
    events: list[EngineEvent] = []

    def authorize(request: ModelToolRequest) -> EnginePermissionDecision:
        raise RuntimeError("permission service unavailable")

    engine = ReferenceTurnEngine(
        invoke_model=lambda request: ModelInvocationResponse(
            tool_requests=[ModelToolRequest(id="call-1", name="write")]
        ),
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name),
        authorize=authorize,
        on_event=events.append,
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("write")])

    assert result.commit.status == "failed"
    assert result.commit.output["errorKind"] == "permission_error"
    assert events[-1].kind == "turn_failed"


@pytest.mark.asyncio
async def test_unknown_tool_is_terminal_configuration_failure() -> None:
    def execute_tool(request: ModelToolRequest) -> ModelToolResult:
        raise KeyError(f"unknown tool: {request.name}")

    engine = ReferenceTurnEngine(
        invoke_model=lambda request: ModelInvocationResponse(
            tool_requests=[ModelToolRequest(id="call-1", name="missing")]
        ),
        execute_tool=execute_tool,
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("missing")])

    assert result.commit.status == "failed"
    assert result.commit.output["errorKind"] == "tool_configuration_error"
    assert result.tool_results == []


@pytest.mark.asyncio
async def test_portable_assistant_history_is_reused_after_tool_round() -> None:
    requests: list[ModelInvocationRequest] = []

    def invoke_model(request: ModelInvocationRequest) -> ModelInvocationResponse:
        requests.append(request)
        if len(requests) == 1:
            return ModelInvocationResponse(
                assistant_messages=[Message.assistant("calling")],
                tool_requests=[ModelToolRequest(id="call-1", name="echo")],
                next_context_state=InvocationContextState(portability="portable"),
            )
        return ModelInvocationResponse(output="done")

    engine = ReferenceTurnEngine(
        invoke_model=invoke_model,
        execute_tool=lambda request: ModelToolResult(request_id=request.id, name=request.name, output="echoed"),
        next_id=_Ids(),
    )
    result = await engine.run_async("session-1", "turn-1", [Message.user("echo")])

    assert result.commit.status == "success"
    assert [message.role for message in requests[1].context.messages] == ["user", "assistant", "tool"]
