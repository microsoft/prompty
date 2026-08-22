"""Provider-agnostic single-turn engine — the ``TurnConformance.runTurn`` engine.

This module owns the *snapshot and portability* turn contract asserted by
``schema/model/conformance/vectors/turn.tsp`` (stage ``turn``). Like
:mod:`prompty.core.agent_loop`, it is provider-agnostic: the turn is driven by an
abstract ``invoke_model`` callback plus optional ``resolve_permission`` /
``execute_tool`` callbacks, so every provider shares one engine and supplies only
wire translation.

Where :mod:`agent_loop` models the *conversational* agent loop (message
accounting, guardrails, steering), this engine models the *durable* turn:
per-iteration snapshots, a stable-prefix marker, portability transitions
(``portable`` vs ``delegated`` provider state), and a fixed lifecycle event
vocabulary. A turn is one or more model iterations; each iteration takes a
snapshot after the model responds, runs any requested tools (through a
permission gate), commits their results back into the conversation, and loops
until the model returns a final output.

Observable contract (verified against all 5 ``runTurn`` vectors)
----------------------------------------------------------------
* ``iterations`` — number of model invocations.
* ``snapshots`` — one per model iteration (== ``iterations`` on the success
  path). ``snapshotStablePrefixes[i]`` is the length of the stable message
  prefix at snapshot *i*; ``snapshotPortability[i]`` is the provider-state
  portability entering iteration *i* (``portable`` until a model turn declares
  ``nextPortability: "delegated"``, which applies to the *following* snapshot).
* ``commitPortability`` / ``delegatedState`` — the portability and delegated
  provider-state carried at commit time.
* ``toolResults`` / ``toolResultOrder`` — count and ordered tool-call ids of
  every tool round (denied tools still produce a model-visible result).
* ``eventKinds`` — the exact lifecycle event order:
  ``turn_started`` → per iteration (``context_prepared`` →
  ``model_invocation_started`` → ``model_invocation_completed`` →
  ``checkpoint_created``; then per tool ``permission_requested`` →
  ``permission_resolved`` → ``tool_execution_started`` →
  ``tool_execution_completed`` → ``checkpoint_created``; then
  ``tool_result_committed`` × n → ``conversation_updated`` →
  ``checkpoint_created``) → on final answer ``turn_committed`` →
  ``post_commit_started`` → ``post_commit_completed``. A pre-run cancellation
  emits only ``turn_started`` → ``turn_cancelled``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "DEFAULT_MAX_ITERATIONS",
    "PORTABILITY_DELEGATED",
    "PORTABILITY_PORTABLE",
    "TurnModelTurn",
    "TurnResult",
    "TurnToolCall",
    "TurnToolResult",
    "run_turn",
]

DEFAULT_MAX_ITERATIONS = 10
PORTABILITY_PORTABLE = "portable"
PORTABILITY_DELEGATED = "delegated"


@dataclass
class TurnToolCall:
    """A tool invocation requested by the model."""

    id: str
    name: str
    arguments: dict = field(default_factory=dict)


@dataclass
class TurnModelTurn:
    """A normalized single model turn.

    ``output`` is set for a final answer; ``tool_calls`` for a tool round.
    ``next_portability``/``delegated_state`` declare the provider-state
    portability transition that applies to the *next* snapshot.
    """

    output: Any = None
    tool_calls: list[TurnToolCall] = field(default_factory=list)
    next_portability: str | None = None
    delegated_state: list | None = None


@dataclass
class TurnToolResult:
    """The outcome of one tool invocation within a turn."""

    id: str
    result: Any
    success: bool


@dataclass
class TurnResult:
    """The observable result of a single turn."""

    status: str
    output: Any = None
    iterations: int = 0
    snapshots: int = 0
    snapshot_stable_prefixes: list[int] = field(default_factory=list)
    snapshot_portability: list[str] = field(default_factory=list)
    commit_portability: str = PORTABILITY_PORTABLE
    delegated_state_count: int = 0
    tool_results: list[TurnToolResult] = field(default_factory=list)
    tool_result_order: list[str] = field(default_factory=list)
    events: list[str] = field(default_factory=list)


InvokeModel = Callable[[int, list[TurnToolResult]], TurnModelTurn]
ResolvePermission = Callable[[TurnToolCall], bool]
ExecuteTool = Callable[[TurnToolCall], Any]


def run_turn(
    messages: list[dict],
    *,
    invoke_model: InvokeModel,
    resolve_permission: ResolvePermission | None = None,
    execute_tool: ExecuteTool | None = None,
    cancel_before_run: bool = False,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> TurnResult:
    """Run one turn and return its snapshot/portability observable result.

    The turn is deterministic: given the same callbacks and inputs it always
    produces the same snapshots, portability transitions, tool ordering, and
    lifecycle events.
    """
    result = TurnResult(status="success")

    def emit(kind: str) -> None:
        result.events.append(kind)

    emit("turn_started")

    if cancel_before_run:
        emit("turn_cancelled")
        result.status = "cancelled"
        result.output = None
        return result

    stable_prefix = len(messages)
    pending_portability = PORTABILITY_PORTABLE
    delegated_state: list = []
    pending_tool_results: list[TurnToolResult] = []
    approve = resolve_permission or (lambda _call: True)
    dispatch = execute_tool or (lambda _call: None)

    for iteration in range(max_iterations):
        result.iterations = iteration + 1

        emit("context_prepared")
        emit("model_invocation_started")
        turn = invoke_model(iteration, pending_tool_results)
        emit("model_invocation_completed")

        # Snapshot: one per model iteration, using the portability *entering*
        # this iteration.
        result.snapshot_portability.append(pending_portability)
        result.snapshot_stable_prefixes.append(stable_prefix)
        result.snapshots += 1
        emit("checkpoint_created")

        # Apply the portability transition declared by this response, which
        # takes effect for the following snapshot / at commit.
        if turn.next_portability == PORTABILITY_DELEGATED:
            pending_portability = PORTABILITY_DELEGATED
            delegated_state = turn.delegated_state or []

        if not turn.tool_calls:
            result.output = turn.output
            result.commit_portability = pending_portability
            result.delegated_state_count = len(delegated_state)
            emit("turn_committed")
            emit("post_commit_started")
            emit("post_commit_completed")
            return result

        pending_tool_results = []
        for call in turn.tool_calls:
            emit("permission_requested")
            approved = approve(call)
            emit("permission_resolved")
            if approved:
                emit("tool_execution_started")
                output = dispatch(call)
                emit("tool_execution_completed")
                tool_result = TurnToolResult(id=call.id, result=output, success=True)
            else:
                tool_result = TurnToolResult(
                    id=call.id,
                    result={"message": "Permission denied", "error_kind": "permission_denied"},
                    success=False,
                )
            emit("checkpoint_created")
            result.tool_results.append(tool_result)
            result.tool_result_order.append(call.id)
            pending_tool_results.append(tool_result)

        for _ in turn.tool_calls:
            emit("tool_result_committed")
        emit("conversation_updated")
        emit("checkpoint_created")

    # Exhausted max_iterations while still requesting tools.
    result.status = "error"
    result.commit_portability = pending_portability
    result.delegated_state_count = len(delegated_state)
    return result
