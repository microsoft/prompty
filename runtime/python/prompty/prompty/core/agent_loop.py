"""Provider-agnostic agent loop — the canonical ``TurnConformance.run`` engine.

This module owns the *observable* agent-loop contract that the cross-runtime
``@vector`` suite (``schema/model/conformance/vectors/agent.tsp``, stage
``agent``) asserts. It is deliberately provider-agnostic: the loop is driven by
two abstract callbacks —

* ``invoke_model(conversation) -> ModelResponse`` — one LLM call, and
* ``dispatch_tool(call) -> str`` — one tool execution —

so the same engine backs every provider (OpenAI, Azure, Anthropic, …). Providers
supply only the wire translation that turns their raw response into a
:class:`ModelResponse`; they never re-implement the loop, its accounting, or its
event vocabulary.

Observable contract (verified against all 28 ``run`` vectors)
------------------------------------------------------------
* ``iterations`` counts **LLM calls** (not tool rounds).
* ``total_messages`` = ``len(conversation) + (1 if any tool round ran else 0)``.
  The trailing ``+1`` is a documented conformance convention; it is native to
  this engine, never recomputed by an adapter.
* ``messages_updated.message_count`` = ``len(conversation) + 1`` at the point the
  event fires (same convention).
* Events are emitted in a fixed order: ``status`` (loop start) →
  ``tool_call_start`` → ``tool_result`` → ``messages_updated`` → optional
  steering ``status``/``messages_updated`` → ``done``; ``cancelled`` replaces the
  tail when a cancellation fires.
* Canonical message shapes:
  - assistant-with-tool-calls: ``{"role": "assistant", "content": "",
    "metadata": {"tool_calls": [...]}}`` (content is the empty string).
  - tool result: ``{"role": "tool", "content": <str>,
    "metadata": {"tool_call_id": <id>}}`` (content stored as a string).
  - assistant final / system / user: ``{"role": <role>, "content": <str>}``.

Errors are returned as fields on :class:`AgentLoopResult` (``error``,
``error_type``, ``error_reason``) rather than raised, so the accumulated
conversation and events remain observable on the failure path.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field

__all__ = [
    "DEFAULT_MAX_ITERATIONS",
    "SUMMARY_PREFIX",
    "AgentLoopResult",
    "GuardrailDecision",
    "ModelResponse",
    "SteeringMessage",
    "ToolCall",
    "run_agent_loop",
]

DEFAULT_MAX_ITERATIONS = 10
SUMMARY_PREFIX = "[Summary of earlier conversation] "

# Canonical error markers. The vectors assert the *class name* for cancellation
# and guardrail denials, so these mirror the exception types in
# ``core.cancellation`` / ``core.guardrails`` without coupling the loop to them.
_CANCELLED_ERROR = "CancelledError"
_GUARDRAIL_ERROR = "GuardrailError"


@dataclass
class ToolCall:
    """A single tool invocation requested by the model."""

    id: str
    name: str
    arguments: str  # raw JSON string exactly as the model emitted it


@dataclass
class ModelResponse:
    """A normalized single-turn model response.

    ``raw_tool_calls`` carries the provider's exact tool-call array so the
    assistant message's ``metadata.tool_calls`` round-trips byte-for-byte; when
    omitted the engine reconstructs it from :class:`ToolCall` fields.
    """

    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw_tool_calls: list[dict] | None = None


@dataclass
class GuardrailDecision:
    """Outcome of a guardrail check."""

    allowed: bool
    reason: str | None = None


@dataclass
class SteeringMessage:
    """A steering message scheduled for injection before a given iteration."""

    inject_before_iteration: int
    role: str
    text: str


@dataclass
class AgentLoopResult:
    """The observable result of an agent-loop run."""

    result: str | None = None
    iterations: int = 0
    conversation: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    tool_rounds: int = 0
    tools_executed: int = 0
    tool_execution_order: list[str] = field(default_factory=list)
    denied_tools: list[str] = field(default_factory=list)
    trimmed_messages: list[dict] | None = None
    error: str | None = None
    error_type: str | None = None
    error_reason: str | None = None

    @property
    def total_messages(self) -> int:
        """Conversation length plus the conformance ``+1`` when tools ran."""
        return len(self.conversation) + (1 if self.tool_rounds > 0 else 0)


# Callback signatures.
InvokeModel = Callable[[list[dict]], ModelResponse]
DispatchTool = Callable[[ToolCall], str]
IsToolRegistered = Callable[[str], bool]
InputGuardrail = Callable[[list[dict]], GuardrailDecision]
OutputGuardrail = Callable[[ModelResponse], GuardrailDecision]
ToolGuardrail = Callable[[str, dict], GuardrailDecision]
Summarize = Callable[[list[dict]], str]


def _assistant_tool_calls_message(response: ModelResponse) -> dict:
    if response.raw_tool_calls is not None:
        tool_calls = response.raw_tool_calls
    else:
        tool_calls = [
            {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": tc.arguments}}
            for tc in response.tool_calls
        ]
    return {"role": "assistant", "content": "", "metadata": {"tool_calls": tool_calls}}


def _tool_message(call_id: str, content: str) -> dict:
    return {"role": "tool", "content": content, "metadata": {"tool_call_id": call_id}}


def _char_count(messages: list[dict]) -> int:
    total = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            total += len(content)
    return total


def _parse_args(arguments: str) -> dict:
    try:
        parsed = json.loads(arguments) if arguments else {}
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _default_summary(dropped_users: list[dict]) -> str:
    """Fallback summarizer used when no ``summarize`` callback is provided.

    A real provider implements compaction by asking the model to summarize the
    dropped turns; this deterministic fallback simply lists their content so the
    engine remains usable without a model in the loop.
    """
    topics = [str(m.get("content", "")).strip() for m in dropped_users if m.get("content")]
    return SUMMARY_PREFIX + "User asked about " + "; ".join(topics)


def _maybe_trim(
    conversation: list[dict],
    context_budget: int | None,
    summarize: Summarize | None,
) -> list[dict] | None:
    """Compact ``conversation`` in place when it exceeds ``context_budget``.

    Returns the trimmed conversation (a new list) when trimming occurred, or
    ``None`` when the messages fit and no modification was needed. All system
    messages are always preserved; a single summary system message is inserted
    after the last system message; the most-recent user message is always kept.
    """
    if context_budget is None or _char_count(conversation) <= context_budget:
        return None

    systems = [dict(m) for m in conversation if m.get("role") == "system"]
    users = [m for m in conversation if m.get("role") == "user"]
    dropped_users = users[:-1]
    last_user = users[-1] if users else None

    summary_text = summarize(dropped_users) if summarize is not None else _default_summary(dropped_users)
    summary_message = {"role": "system", "content": summary_text}

    trimmed = [*systems, summary_message]
    if last_user is not None:
        trimmed.append({"role": "user", "content": last_user.get("content")})
    return trimmed


def run_agent_loop(
    messages: list[dict],
    *,
    invoke_model: InvokeModel,
    dispatch_tool: DispatchTool,
    is_tool_registered: IsToolRegistered | None = None,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    input_guardrail: InputGuardrail | None = None,
    output_guardrail: OutputGuardrail | None = None,
    tool_guardrail: ToolGuardrail | None = None,
    steering: list[SteeringMessage] | None = None,
    cancel_at: str | None = None,
    context_budget: int | None = None,
    summarize: Summarize | None = None,
) -> AgentLoopResult:
    """Run the canonical agent loop and return its observable result.

    Parameters mirror the ``run`` vector inputs. ``cancel_at`` accepts the
    scripted positions ``"before_iteration"`` (before iteration 1),
    ``"before_iteration_<n>"`` (before iteration *n*), and ``"after_tool_<i>"``
    (after the *i*-th tool of a round). The loop is deterministic: given the same
    callbacks and flags it always produces the same events and accounting.
    """
    result = AgentLoopResult()
    conversation: list[dict] = [dict(m) for m in messages]

    def emit(event_type: str, data: dict) -> None:
        result.events.append({"type": event_type, "data": data})

    emit("status", {"message": "Starting agent loop"})

    trimmed = _maybe_trim(conversation, context_budget, summarize)
    if trimmed is not None:
        conversation = trimmed
        result.trimmed_messages = [dict(m) for m in trimmed]

    steering_pending = list(steering or [])
    registered = is_tool_registered or (lambda _name: True)

    while True:
        iteration_number = result.iterations + 1

        # Cancellation at the top of the iteration.
        if cancel_at == "before_iteration" and iteration_number == 1:
            emit("cancelled", {"reason": "Cancellation requested before first iteration"})
            result.error = _CANCELLED_ERROR
            result.conversation = conversation
            return result
        if cancel_at == f"before_iteration_{iteration_number}":
            emit("cancelled", {"reason": f"Cancellation requested before iteration {iteration_number}"})
            result.error = _CANCELLED_ERROR
            result.conversation = conversation
            return result

        # Steering: atomically drain everything scheduled for this iteration.
        to_inject = [s for s in steering_pending if s.inject_before_iteration == iteration_number]
        if to_inject:
            for s in to_inject:
                steering_pending.remove(s)
            emit("status", {"message": "Injecting steering message"})
            for s in to_inject:
                conversation.append({"role": s.role, "content": s.text})
            emit("messages_updated", {"message_count": len(conversation) + 1})

        # Input guardrail runs before the LLM call.
        if input_guardrail is not None:
            decision = input_guardrail(conversation)
            if not decision.allowed:
                result.error = _GUARDRAIL_ERROR
                result.error_reason = decision.reason
                result.conversation = conversation
                return result

        response = invoke_model(conversation)
        result.iterations += 1

        # Output guardrail runs on the model response.
        if output_guardrail is not None:
            decision = output_guardrail(response)
            if not decision.allowed:
                result.error = _GUARDRAIL_ERROR
                result.error_reason = decision.reason
                result.conversation = conversation
                return result

        if response.tool_calls:
            conversation.append(_assistant_tool_calls_message(response))
            result.tool_rounds += 1
            cancelled = False

            for idx, call in enumerate(response.tool_calls):
                emit("tool_call_start", {"name": call.name, "arguments": call.arguments})

                if tool_guardrail is not None:
                    decision = tool_guardrail(call.name, _parse_args(call.arguments))
                    if not decision.allowed:
                        result.denied_tools.append(call.name)
                        denial = f"Tool denied by guardrail: {decision.reason}"
                        conversation.append(_tool_message(call.id, denial))
                        continue

                if not registered(call.name):
                    result.error = f"Tool not registered: {call.name}"
                    result.error_type = "ValueError"
                    result.conversation = conversation
                    return result

                output = dispatch_tool(call)
                result.tools_executed += 1
                result.tool_execution_order.append(call.name)
                emit("tool_result", {"name": call.name, "result": output})
                conversation.append(_tool_message(call.id, output))

                if cancel_at == f"after_tool_{idx}":
                    emit("cancelled", {"reason": "Cancellation requested after tool execution"})
                    result.error = _CANCELLED_ERROR
                    cancelled = True
                    break

            if cancelled:
                result.conversation = conversation
                return result

            emit("messages_updated", {"message_count": len(conversation) + 1})

            if result.iterations > max_iterations:
                result.error = f"Agent loop exceeded {max_iterations} iterations"
                result.conversation = conversation
                return result

            continue

        # No tool calls — the model produced a final answer.
        result.result = response.content
        conversation.append({"role": "assistant", "content": response.content})
        emit("done", {"response": response.content})
        result.conversation = conversation
        return result
