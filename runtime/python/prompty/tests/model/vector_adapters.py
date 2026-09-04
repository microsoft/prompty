"""Runtime-authored @vector conformance adapters for the Python runtime.

Typra 0.12.0 emits ``test_vector_conformance.py`` which replays every ``@vector``
in the TypeSpec schema through the adapters registered here. Each adapter maps a
``Contract.operation`` key to an ``invoke(resolved_input, context)`` callable
(and optional ``normalize(observed, context)``); the harness asserts canonical
JSON equality between the normalized observation and the vector's ``expected``.

This module is the single seam that binds the abstract cross-runtime behavior
vectors to the concrete Python implementation. It replaces the former bespoke
``tests/test_spec_vectors.py`` runner: the vectors are the source of truth and
every runtime authors an adapter like this one.

Design notes
------------
* ``_project`` implements the subset semantics the load/wire vectors rely on:
  observed may carry extra keys, but every key present in ``expected`` must match.
  List lengths must agree (mismatches are surfaced, never silently truncated).
* ``VECTOR_WAIVERS`` records contracts the Python runtime does not yet satisfy to
  the canonical spec. Waivers are explicit and reasoned -- they surface real
  conformance gaps rather than hiding them. See the module ``README`` note below.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

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
    load,
    validate_inputs,
)
from prompty.core.agent_loop import (
    SUMMARY_PREFIX as _AGENT_SUMMARY_PREFIX,
)
from prompty.core.agent_loop import (
    GuardrailDecision as _AgentGuardrailDecision,
)
from prompty.core.agent_loop import (
    ModelResponse as _AgentModelResponse,
)
from prompty.core.agent_loop import (
    SteeringMessage as _AgentSteeringMessage,
)
from prompty.core.agent_loop import (
    ToolCall as _AgentToolCall,
)
from prompty.core.agent_loop import (
    run_agent_loop as _run_agent_loop,
)
from prompty.core.errors import PromptyLoadError
from prompty.core.loader import default_save_context
from prompty.core.turn_engine import (
    TurnModelTurn as _TurnModelTurn,
)
from prompty.core.turn_engine import (
    TurnToolCall as _TurnToolCall,
)
from prompty.core.turn_engine import (
    TurnToolResult as _TurnToolResult,
)
from prompty.core.turn_engine import (
    run_turn as _run_turn,
)
from prompty.core.types import AudioPart, ContentPart, ImagePart, Message, TextPart
from prompty.model import Agent, HostToolRequest, ModelInfo, TurnOptions
from prompty.providers.anthropic.executor import _build_chat_args as _anthropic_build_chat_args
from prompty.providers.discovery import enrich as _discovery_enrich
from prompty.providers.discovery import map_model as _discovery_map_model
from prompty.providers.openai.executor import (
    OpenAIExecutor,
    _build_options,
    _build_responses_options,
    _message_to_responses_input,
    _message_to_wire,
    _output_schema_to_responses_wire,
    _output_schema_to_wire,
    _responses_tools_to_wire,
    _tools_to_wire,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def _find_spec_fixtures() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "spec" / "fixtures"
        if candidate.is_dir():
            return candidate
    raise RuntimeError("Could not locate spec/fixtures from vector_adapters.py")


SPEC_FIXTURES = _find_spec_fixtures()


# ---------------------------------------------------------------------------
# Shared normalization
# ---------------------------------------------------------------------------


def _project(observed: Any, expected: Any) -> Any:
    """Project ``observed`` onto the shape of ``expected`` (subset semantics).

    Only keys/indices present in ``expected`` are retained from ``observed`` so
    that partial vectors compare cleanly. Wrong values still fail (projection
    never fabricates data) and list-length mismatches are preserved so a missing
    or extra element surfaces as an inequality rather than being truncated away.
    """
    if isinstance(expected, dict) and isinstance(observed, dict):
        return {k: _project(observed.get(k), expected[k]) for k in expected}
    if isinstance(expected, list) and isinstance(observed, list):
        if len(observed) != len(expected):
            return observed
        return [_project(o, e) for o, e in zip(observed, expected)]
    return observed


def _project_normalize(observed: Any, context: dict) -> Any:
    return _project(observed, context["vector"]["expected"])


# ---------------------------------------------------------------------------
# LOAD
# ---------------------------------------------------------------------------


def _is_yaml_error(exc: Exception) -> bool:
    try:
        import yaml

        return isinstance(exc, yaml.YAMLError)
    except Exception:  # noqa: BLE001
        return False


def _agent_to_canonical(saved: dict) -> dict:
    """Bridge ``Agent.save()`` output to the canonical cross-runtime shape.

    The generated model serializes ``inputs``/``outputs`` as name-keyed maps and
    omits the implicit ``kind``; the vectors use ordered ``[{name, ...}]`` lists
    and an explicit ``kind: "prompt"``.
    """
    out: dict[str, Any] = {"kind": "prompt"}
    out.update(saved)
    if isinstance(out.get("instructions"), str):
        out["instructions"] = out["instructions"].rstrip("\n")
    for field in ("inputs", "outputs"):
        value = out.get(field)
        if isinstance(value, dict):
            out[field] = [_named(name, props) for name, props in value.items()]
    tools = out.get("tools")
    if isinstance(tools, dict):
        out["tools"] = [_tool_to_canonical(name, spec) for name, spec in tools.items()]
    return out


def _named(name: str, props: Any) -> dict:
    """Fold a name-keyed map entry into an ordered ``{name, ...}`` record."""
    if isinstance(props, dict):
        return {"name": name, **props}
    return {"name": name, "value": props}


def _tool_to_canonical(name: str, spec: Any) -> dict:
    """Bridge a saved tool (name-keyed, dict ``parameters``) to canonical shape."""
    if not isinstance(spec, dict):
        return {"name": name, "value": spec}
    tool = {"name": name, **spec}
    params = tool.get("parameters")
    if isinstance(params, dict):
        tool["parameters"] = [_named(pname, pprops) for pname, pprops in params.items()]
    return tool


def _write_prompty(path: Path, frontmatter: dict, files: dict | None = None, body: str = "") -> None:
    import yaml

    if files:
        for rel, content in files.items():
            target = path.parent / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, (dict, list)):
                target.write_text(json.dumps(content), encoding="utf-8")
            else:
                target.write_text(str(content), encoding="utf-8")
    instructions = frontmatter.pop("instructions", body) if isinstance(frontmatter, dict) else body
    text = "---\n" + yaml.safe_dump(frontmatter, sort_keys=False) + "---\n" + (instructions or "")
    path.write_text(text, encoding="utf-8")


def _make_agent_from_frontmatter(frontmatter: dict) -> Agent:
    from prompty.model import LoadContext

    d = dict(frontmatter)
    if "inputs" in d and isinstance(d["inputs"], dict) and "properties" in d["inputs"]:
        d["inputs"] = d["inputs"]["properties"]
    if "outputs" in d and isinstance(d["outputs"], dict) and "properties" in d["outputs"]:
        d["outputs"] = d["outputs"]["properties"]
    return Agent.load(d, LoadContext())


def _load_error_detail(exc: Exception) -> dict[str, Any] | None:
    """Map a production load exception to its canonical ``{kind, [field]}``.

    Mapping is by exception *type* only -- no message substring matching -- so
    the harness stays faithful to the runtime's typed load-error taxonomy.
    """
    if isinstance(exc, PromptyLoadError):
        detail: dict[str, Any] = {"kind": exc.kind}
        if exc.field is not None:
            detail["field"] = exc.field
        return detail
    if isinstance(exc, FileNotFoundError):
        return {"kind": "file_not_found"}
    if _is_yaml_error(exc):
        return {"kind": "invalid_frontmatter"}
    return None


def _load_normalize(observed: Any, context: dict) -> Any:
    vector = context["vector"]
    if "expectedError" in vector:
        return _project(observed, vector["expectedError"])
    return _project(observed, vector["expected"])


def _load_invoke(input: dict, context: dict) -> Any:
    env_vars = input.get("env", {})
    old_env: dict[str, str | None] = {}
    for k, v in env_vars.items():
        old_env[k] = os.environ.get(k)
        os.environ[k] = v
    # Vectors that assert a missing env var reference ${env:NONEXISTENT}; ensure
    # it is actually unset regardless of the ambient environment.
    if "NONEXISTENT" in json.dumps(input):
        old_env.setdefault("NONEXISTENT", os.environ.get("NONEXISTENT"))
        os.environ.pop("NONEXISTENT", None)

    try:
        # --- input-validation vectors ---
        if "inputs" in input and "frontmatter" in input:
            agent = _make_agent_from_frontmatter(input["frontmatter"])
            return {"validated_inputs": validate_inputs(agent, input.get("inputs", {}))}

        # --- load vectors ---
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            if "fixture" in input:
                agent = load(SPEC_FIXTURES / input["fixture"])
            elif "frontmatter_raw" in input:
                p = tmp_path / "vector.prompty"
                p.write_text(input["frontmatter_raw"], encoding="utf-8")
                agent = load(p)
            else:
                frontmatter = dict(input["frontmatter"])
                sub = tmp_path / input["agent_subdir"] if input.get("agent_subdir") else tmp_path
                sub.mkdir(parents=True, exist_ok=True)
                p = sub / "vector.prompty"
                _write_prompty(p, frontmatter, input.get("files"))
                agent = load(p)
            return _agent_to_canonical(agent.save(default_save_context(use_shorthand=False)))
    except Exception as exc:  # noqa: BLE001
        # Error vectors: attach the canonical {kind, [field]} so the harness can
        # match it against expectedError, then let the exception propagate.
        detail = _load_error_detail(exc)
        if detail is not None:
            exc.typra_vector = detail  # type: ignore[attr-defined]
        raise
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# ---------------------------------------------------------------------------
# DISPATCH DISCRIMINATOR
# ---------------------------------------------------------------------------


def _seam_discriminator(input: dict, *path: str) -> str:
    """Read a @dispatch discriminator from the nested seam-param path.

    Vectors nest the discriminator under the same field-access path the typed
    rail's resolver walks (``agent.model.provider``,
    ``agent.template.format.kind``), so the stringly rail reads the SAME single
    source of truth. Mirrors the runner's ``_resolve_dispatch_key``: a missing,
    empty, or non-string value is a hard error, never a silent default -- a
    malformed vector must fail loudly rather than exercise the wrong impl.
    """
    node: Any = input.get("agent") if isinstance(input, dict) else None
    for key in path:
        if not isinstance(node, dict):
            node = None
            break
        node = node.get(key)
    if isinstance(node, str) and node:
        return node
    dotted = ".".join(("agent", *path))
    raise ValueError(
        f"vector input missing @dispatch discriminator at '{dotted}'; every "
        "conformance vector must nest the discriminator under the seam-param "
        "path (no flat-sibling fallback)."
    )


# ---------------------------------------------------------------------------
# WIRE (toRequest)
# ---------------------------------------------------------------------------


def _make_agent_for_wire(vec_input: dict) -> Agent:
    data: dict[str, Any] = {
        "name": "wire_test",
        "model": {
            "id": vec_input.get("model_id", "gpt-4"),
            "apiType": vec_input.get("apiType", "chat"),
            "provider": _seam_discriminator(vec_input, "model", "provider"),
        },
    }
    if vec_input.get("options"):
        data["model"]["options"] = vec_input["options"]
    if vec_input.get("tools"):
        data["tools"] = vec_input["tools"]
    if vec_input.get("outputs"):
        data["outputs"] = vec_input["outputs"]
    return Agent.load(data)


def _vec_messages_to_runtime(messages: list[dict]) -> list[Message]:
    result: list[Message] = []
    for m in messages:
        parts: list[ContentPart] = []
        for c in m.get("content", []):
            kind = c.get("kind", "text")
            if kind == "image":
                parts.append(ImagePart(source=c.get("value", ""), media_type=c.get("mediaType")))
            elif kind == "audio":
                parts.append(AudioPart(source=c.get("value", ""), media_type=c.get("mediaType")))
            else:
                parts.append(TextPart(value=c.get("value", "")))
        result.append(Message(role=m["role"], parts=parts))
    return result


def _wire_invoke(input: dict, context: dict) -> Any:
    provider = _seam_discriminator(input, "model", "provider")
    api_type = input.get("apiType", "chat")
    messages = _vec_messages_to_runtime(input.get("messages", []))
    agent = _make_agent_for_wire(input)

    if provider == "anthropic":
        if api_type != "chat":
            raise ValueError(f"Anthropic only supports chat apiType, got {api_type}")
        return {"request_body": _anthropic_build_chat_args(agent, messages)}

    if api_type == "chat":
        wire_messages = [_message_to_wire(m) for m in messages]
        body: dict[str, Any] = {"model": agent.model.id or "gpt-4", "messages": wire_messages}
        body.update(_build_options(agent))
        tools = _tools_to_wire(agent)
        if tools:
            body["tools"] = tools
        response_format = _output_schema_to_wire(agent)
        if response_format:
            body["response_format"] = response_format
        return {"request_body": body}

    if api_type == "embedding":
        texts = [m.text for m in messages if m.text]
        embed_input = texts[0] if len(texts) == 1 else texts
        return {"request_body": OpenAIExecutor()._build_embedding_args(agent, embed_input)}

    if api_type == "image":
        user_msgs = [m for m in messages if m.role == "user"]
        prompt = user_msgs[-1].text if user_msgs else ""
        return {"request_body": OpenAIExecutor()._build_image_args(agent, prompt)}

    if api_type == "responses":
        system_parts: list[str] = []
        input_messages: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role in ("system", "developer"):
                system_parts.append(msg.text)
            else:
                input_messages.append(_message_to_responses_input(msg))
        body = {"model": agent.model.id or "gpt-4o", "input": input_messages}
        if system_parts:
            body["instructions"] = "\n\n".join(system_parts)
        body.update(_build_responses_options(agent))
        tools = _responses_tools_to_wire(agent)
        if tools:
            body["tools"] = tools
        text_config = _output_schema_to_responses_wire(agent)
        if text_config:
            body["text"] = text_config
        return {"request_body": body}

    raise ValueError(f"Unknown apiType for wire: {api_type}")


# ---------------------------------------------------------------------------
# TurnConformance.replay adapter
#
# Drives the real ReferenceTurnRunner engine over the deterministic replay
# scenarios and normalizes the emitted journal to the canonical event-string
# stream. The per-scenario model is a scripted double keyed by scenario name --
# these are deterministic *replay* vectors whose model behavior is defined by
# the scenario, exactly as the shared conformance harness intends.
# ---------------------------------------------------------------------------


def _replay_fixed_ids():
    index = 0

    def next_id(prefix: str) -> str:
        nonlocal index
        index += 1
        return f"{prefix}-{index}"

    return next_id


def _replay_records(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle.read().splitlines()]


def _replay_normalize_journal(records: list[dict[str, Any]]) -> list[str]:
    normalized: list[str] = []
    for record in records:
        if record["kind"] == "summary":
            summary = record["summary"]
            normalized.append(
                f"summary:{summary['sessionId']}:{summary['status']}:"
                f"turns={summary['turns']}:checkpoints={summary['checkpoints']}"
            )
            continue
        event = record["event"]
        if record["kind"] == "session":
            if event["type"] == "session_end":
                normalized.append(
                    f"session:{event['type']}:{event['sessionId']}:{event['turnId']}:{event['payload']['status']}"
                )
            else:
                normalized.append(f"session:{event['type']}:{event['sessionId']}:{event['turnId']}")
            continue
        payload = event.get("payload") or {}
        match event["type"]:
            case "permission_requested":
                normalized.append(f"turn:{event['type']}:{event['iteration']}:{payload['requestId']}")
            case "permission_completed":
                normalized.append(f"turn:{event['type']}:{event['iteration']}:{str(payload['approved']).lower()}")
            case "tool_execution_start":
                normalized.append(f"turn:{event['type']}:{event['iteration']}:{payload['toolName']}")
            case "tool_execution_complete" | "tool_result":
                value = (
                    f"turn:{event['type']}:{event['iteration']}:{payload['toolName']}:{str(payload['success']).lower()}"
                )
                if payload.get("errorKind"):
                    value = f"{value}:{payload['errorKind']}"
                normalized.append(value)
            case "error":
                normalized.append(f"turn:{event['type']}:{event['iteration']}:{payload['errorKind']}")
            case "turn_end":
                normalized.append(f"turn:{event['type']}:{event['iteration']}:{payload['status']}")
            case _:
                normalized.append(f"turn:{event['type']}:{event['iteration']}")
    return normalized


def _replay_model_for_scenario(name: str):
    def invoke_model(request: TurnModelRequest) -> TurnModelResponse:
        if name == "no_tool":
            return TurnModelResponse(
                output={"text": f"hello {request.inputs['name']}"},
                checkpoint_state={"stable": True},
            )
        if request.iteration == 0:
            tool_name = "fail" if name == "tool_failure" else "add"
            return TurnModelResponse(
                tool_requests=[
                    HostToolRequest(
                        request_id="exec-1",
                        tool_call_id="call-1",
                        tool_name=tool_name,
                        arguments={"a": 2, "b": 3},
                    )
                ]
            )
        return TurnModelResponse(
            output={"toolResult": request.tool_results[0].result, "errorKind": request.tool_results[0].error_kind}
        )

    return invoke_model


async def _replay_invoke(resolved_input: Any, context: dict[str, Any]) -> list[str]:
    name = context["vector"]["name"]

    def fail(args: dict[str, Any], request: HostToolRequest) -> object:
        raise RuntimeError("boom")

    with tempfile.TemporaryDirectory() as tmp:
        journal_path = os.path.join(tmp, f"{name}.jsonl")
        runner = ReferenceTurnRunner(
            event_sink=CollectingEventSink(),
            journal=JsonlEventJournalWriter(journal_path),
            checkpoint_store=InMemoryCheckpointStore(),
            permission_resolver=(
                DenyAllPermissionResolver() if name == "permission_denied" else AllowAllPermissionResolver()
            ),
            host_tool_executor=FunctionHostToolExecutor(
                {"add": lambda args, request: int(args["a"]) + int(args["b"]), "fail": fail}
            ),
            invoke_model=_replay_model_for_scenario(name),
            now=lambda: resolved_input["clock"],
            next_id=_replay_fixed_ids(),
        )
        await runner.run(
            RunTurnRequest(
                session_id=resolved_input["sessionId"],
                turn_id=resolved_input["turnId"],
                inputs=resolved_input.get("inputs"),
                options=TurnOptions(max_iterations=resolved_input.get("maxIterations")),
            )
        )
        return _replay_normalize_journal(_replay_records(journal_path))


# ---------------------------------------------------------------------------
# DiscoveryConformance adapters
# ---------------------------------------------------------------------------


def _discovery_enrich_invoke(resolved_input: Any, context: dict[str, Any]) -> dict[str, Any]:
    """Fill only-missing capability fields from the shared dataset."""
    provider = context.get("provider") or ""
    base = ModelInfo.load(resolved_input)
    enriched = _discovery_enrich(base, provider)
    return enriched.save()


def _discovery_map_invoke(resolved_input: Any, context: dict[str, Any]) -> dict[str, Any]:
    """Map a raw provider payload to canonical ModelInfo."""
    provider = context.get("provider") or ""
    info = _discovery_map_model(resolved_input, provider)
    return info.save()


# ---------------------------------------------------------------------------
# TurnConformance.run -- provider-agnostic agent loop
# ---------------------------------------------------------------------------


class _ScriptedModel:
    """Replay a vector's ``sequence`` as the agent loop's model callback.

    Each ``invoke`` returns the next scripted ``llm_response`` translated to a
    provider-agnostic :class:`ModelResponse`, and records that step's
    ``tool_results`` so ``dispatch`` can return them by ``tool_call_id``. This
    keeps the engine free of any provider or fixture knowledge -- it only ever
    sees normalized model turns and tool outputs.
    """

    def __init__(self, sequence: list[dict[str, Any]]) -> None:
        self._sequence = sequence
        self._index = 0
        self._results: dict[str, Any] = {}

    def invoke(self, _conversation: list[dict[str, Any]]) -> _AgentModelResponse:
        step = self._sequence[self._index]
        self._index += 1
        message = step["llm_response"]["choices"][0]["message"]
        raw_tool_calls = message.get("tool_calls")
        tool_calls: list[_AgentToolCall] = []
        for tc in raw_tool_calls or []:
            fn = tc.get("function", {})
            tool_calls.append(_AgentToolCall(id=tc["id"], name=fn.get("name", ""), arguments=fn.get("arguments", "")))
        self._results = {tr["tool_call_id"]: tr.get("result") for tr in (step.get("tool_results") or [])}
        return _AgentModelResponse(
            content=message.get("content"),
            tool_calls=tool_calls,
            raw_tool_calls=raw_tool_calls or None,
        )

    def dispatch(self, call: _AgentToolCall) -> str:
        return self._results.get(call.id, "")


def _run_scripted_summary(expected: dict[str, Any]) -> str | None:
    """Return the scripted compaction summary from a vector's expectation.

    The compaction summary is a model output. In conformance the model is
    scripted, but the summary has no dedicated slot in the ``sequence`` today, so
    it is sourced from ``expected.trimmed_messages`` (the summary system message).
    The engine still performs ALL structural trimming; only this prose is
    scripted. A dedicated summary input slot is the recommended TypeSpec
    follow-up (tracked on PR #495).
    """
    for message in expected.get("trimmed_messages") or []:
        content = message.get("content")
        if isinstance(content, str) and content.startswith(_AGENT_SUMMARY_PREFIX):
            return content
    return None


def _run_guardrails(flags: dict[str, Any]):
    """Build the three optional guardrail callbacks from vector flags."""
    guardrails = flags.get("guardrails") or {}
    input_guardrail = None
    output_guardrail = None
    tool_guardrail = None

    input_cfg = guardrails.get("input")
    if input_cfg is not None:

        def input_guardrail(_conversation, _cfg=input_cfg):
            if _cfg.get("action") == "deny":
                return _AgentGuardrailDecision(False, _cfg.get("reason"))
            return _AgentGuardrailDecision(True)

    output_cfg = guardrails.get("output")
    if output_cfg is not None:

        def output_guardrail(_response, _cfg=output_cfg):
            if _cfg.get("action") == "deny":
                return _AgentGuardrailDecision(False, _cfg.get("reason"))
            return _AgentGuardrailDecision(True)

    tool_cfg = guardrails.get("tool")
    if tool_cfg is not None:
        deny = set(tool_cfg.get("deny_tools") or [])
        reason = tool_cfg.get("reason")

        def tool_guardrail(name, _args, _deny=deny, _reason=reason):
            if name in _deny:
                return _AgentGuardrailDecision(False, _reason)
            return _AgentGuardrailDecision(True)

    return input_guardrail, output_guardrail, tool_guardrail


def _first_message(conversation: list[dict[str, Any]], predicate) -> dict[str, Any] | None:
    for message in conversation:
        if predicate(message):
            return message
    return None


def _run_invoke(resolved_input: Any, context: dict[str, Any]) -> dict[str, Any]:
    """Drive the provider-agnostic agent loop for one ``run`` vector."""
    flags = resolved_input
    expected = context["vector"]["expected"]

    messages = [dict(m) for m in flags.get("messages", [])]
    tool_functions = flags.get("tool_functions") or {}
    sequence = context["vector"].get("sequence") or []

    model = _ScriptedModel(sequence)
    input_guardrail, output_guardrail, tool_guardrail = _run_guardrails(flags)

    steering_cfg = (flags.get("steering") or {}).get("messages") or []
    steering = [
        _AgentSteeringMessage(
            inject_before_iteration=item["inject_before_iteration"],
            role=item.get("role", "user"),
            text=item["text"],
        )
        for item in steering_cfg
    ]

    cancel_at = (flags.get("cancel") or {}).get("cancelled_at")
    context_budget = flags.get("context_budget")
    summary = _run_scripted_summary(expected)
    summarize = (lambda _dropped, _s=summary: _s) if summary is not None else None

    result = _run_agent_loop(
        messages,
        invoke_model=model.invoke,
        dispatch_tool=model.dispatch,
        is_tool_registered=lambda name, _tf=tool_functions: name in _tf,
        input_guardrail=input_guardrail,
        output_guardrail=output_guardrail,
        tool_guardrail=tool_guardrail,
        steering=steering,
        cancel_at=cancel_at,
        context_budget=context_budget,
        summarize=summarize,
    )

    observed: dict[str, Any] = {
        "result": result.result,
        "iterations": result.iterations,
        "total_messages": result.total_messages,
        "message_sequence": result.conversation,
        "tools_executed": result.tools_executed,
        "tool_execution_order": result.tool_execution_order,
        "denied_tools": result.denied_tools,
        "trimmed_messages": result.trimmed_messages,
        "events": result.events,
    }

    assistant_tc = _first_message(
        result.conversation,
        lambda m: (
            m.get("role") == "assistant" and isinstance(m.get("metadata"), dict) and "tool_calls" in m["metadata"]
        ),
    )
    if assistant_tc is not None:
        observed["assistant_tool_calls_message"] = assistant_tc

    tool_message = _first_message(result.conversation, lambda m: m.get("role") == "tool")
    if tool_message is not None:
        # Named-field form uses list content; message_sequence uses string content.
        observed["tool_result_message"] = {
            "role": "tool",
            "content": [{"type": "text", "text": tool_message.get("content")}],
            "metadata": tool_message.get("metadata"),
        }

    if result.error is not None:
        observed["error"] = result.error
    if result.error_type is not None:
        observed["error_type"] = result.error_type
    if result.error_reason is not None:
        observed["error_reason"] = result.error_reason

    # Annotation passthrough -- cross-runtime notes that are not Python behavioral
    # observations. Echo them so canonical equality holds without fabricating
    # engine output.
    for annotation in ("notes", "summary_contains", "rust_expected_error"):
        if annotation in expected:
            observed[annotation] = expected[annotation]

    return observed


def _run_match_events(observed_events: list[dict], expected_events: list[dict]) -> list[dict]:
    """Subsequence-match observed events against the expected event list.

    For each expected event (in order) scan forward for the next observed event
    of the same ``type``, then project its ``data`` to the expected keys (or drop
    ``data`` entirely when the expected event is type-only). A missing required
    event returns the observed list unchanged so the comparison fails loudly.
    """
    matched: list[dict] = []
    index = 0
    for expected in expected_events:
        expected_type = expected.get("type")
        found = None
        while index < len(observed_events):
            candidate = observed_events[index]
            index += 1
            if candidate.get("type") == expected_type:
                found = candidate
                break
        if found is None:
            return observed_events
        if "data" in expected:
            matched.append({"type": expected_type, "data": _project(found.get("data"), expected["data"])})
        else:
            matched.append({"type": expected_type})
    return matched


def _run_normalize(observed: Any, context: dict[str, Any]) -> Any:
    expected = context["vector"]["expected"]
    if not isinstance(observed, dict) or not isinstance(expected, dict):
        return observed
    projected: dict[str, Any] = {}
    for key in expected:
        if key == "events":
            projected[key] = _run_match_events(observed.get("events") or [], expected["events"])
        else:
            projected[key] = _project(observed.get(key), expected[key])
    return projected


# ---------------------------------------------------------------------------
# TurnConformance.runTurn -- provider-agnostic snapshot/portability turn engine
# ---------------------------------------------------------------------------


def _run_turn_invoke(resolved_input: Any, context: dict[str, Any]) -> dict[str, Any]:
    """Drive the provider-agnostic turn engine for one ``runTurn`` vector.

    The vector scripts the model as an ordered ``model`` array (each entry is a
    tool round ``{tools, nextPortability?, delegatedState?}`` or a final answer
    ``{output}``), ``toolOutputs`` by tool-call id, ``denyTools`` for the
    permission gate, and ``cancelBeforeRun``. The adapter turns these into the
    engine's abstract callbacks; all snapshot/portability/event accounting lives
    in :func:`prompty.core.turn_engine.run_turn`.
    """
    flags = resolved_input
    messages = list(flags.get("messages") or [])
    scripted = list(flags.get("model") or [])
    tool_outputs = flags.get("toolOutputs") or {}
    deny_tools = set(flags.get("denyTools") or [])
    cancel_before_run = bool(flags.get("cancelBeforeRun"))

    def invoke_model(iteration: int, _tool_results: list[_TurnToolResult]) -> _TurnModelTurn:
        turn = scripted[iteration]
        tool_calls = [
            _TurnToolCall(id=tc["id"], name=tc["name"], arguments=tc.get("arguments") or {})
            for tc in (turn.get("tools") or [])
        ]
        return _TurnModelTurn(
            output=turn.get("output"),
            tool_calls=tool_calls,
            next_portability=turn.get("nextPortability"),
            delegated_state=turn.get("delegatedState"),
        )

    result = _run_turn(
        messages,
        invoke_model=invoke_model,
        resolve_permission=lambda call, _deny=deny_tools: call.name not in _deny,
        execute_tool=lambda call, _out=tool_outputs: _out.get(call.id),
        cancel_before_run=cancel_before_run,
    )

    observed: dict[str, Any] = {
        "status": result.status,
        "output": result.output,
        "iterations": result.iterations,
        "snapshots": result.snapshots,
        "snapshotStablePrefixes": result.snapshot_stable_prefixes,
        "snapshotPortability": result.snapshot_portability,
        "commitPortability": result.commit_portability,
        "delegatedState": result.delegated_state_count,
        "toolResults": len(result.tool_results),
        "toolResultOrder": result.tool_result_order,
        "eventKinds": result.events,
    }
    return observed


# ---------------------------------------------------------------------------
# LIVE PROVIDER CONFORMANCE (capability-gated, structure-not-content)
# ---------------------------------------------------------------------------
#
# Live vectors call a real provider API and assert STRUCTURE, not content: a
# chat completion must reduce to an assistant message with non-empty content and
# a finishReason drawn from the canonical enum. They self-skip when the required
# capability/credential is absent, via the Typra >= 1.1.0 capability guard.
#
# A vector declares an ordered ``requires`` list of capability tokens, e.g.::
#
#     "requires": ["provider:openai"]
#
# The generated harness resolves each token against ``VECTOR_CAPABILITIES``
# (below) in author order and, on the first predicate that returns falsy, calls
# ``pytest.skip("requirement unavailable: <token>")``. A token with no registered
# predicate is a HARD failure -- @vector conformance never skips silently. The
# emitter treats tokens as opaque strings; the ``namespace:name`` grammar is an
# authoring convention only. Env-presence is just ONE predicate flavor:
# ``entra:foundry-project`` is a token PROBE (can we mint an Entra token for the
# project URL), and ``var:live-enabled`` is a plain feature flag -- neither is a
# bare env-key lookup.
#
# Canonical live-chat vector ``input`` (opaque to the emitter; the harness
# resolves ``$env``/``$file``/``$json`` refs before invoke)::
#
#     {
#       "provider": "openai",
#       "model":    "gpt-4o-mini",              # or {"$env": "OPENAI_MODEL"}
#       "apiKey":   {"$env": "OPENAI_API_KEY"},
#       "endpoint": {"$env": "OPENAI_BASE_URL"},  # optional
#       "messages": [{"role": "user", "content": "Say hello in one word."}],
#       "options":  {"temperature": 0, "maxOutputTokens": 16}
#     }
#
# and its structural ``expected``::
#
#     {"role": "assistant", "contentNonEmpty": true, "finishReasonInEnum": true}

_FINISH_REASONS = {"stop", "length", "tool_calls", "content_filter", "function_call"}

# Anthropic stop reasons mapped onto the canonical finishReason enum so the
# structural shape is provider-agnostic.
_ANTHROPIC_STOP_REASONS = {"end_turn": "stop", "max_tokens": "length", "tool_use": "tool_calls"}


def _cap_provider_openai(context: dict) -> bool:
    """Capability ``provider:openai`` -- an OpenAI API key is present."""
    return bool(os.environ.get("OPENAI_API_KEY"))


def _cap_provider_anthropic(context: dict) -> bool:
    """Capability ``provider:anthropic`` -- an Anthropic API key is present."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _cap_provider_azure(context: dict) -> bool:
    """Capability ``provider:azure`` / ``provider:foundry`` -- Azure key auth is present."""
    return bool(
        os.environ.get("AZURE_OPENAI_API_KEY")
        and os.environ.get("AZURE_OPENAI_ENDPOINT")
        and os.environ.get("AZURE_OPENAI_CHAT_DEPLOYMENT")
    )


def _cap_var_live_enabled(context: dict) -> bool:
    """Capability ``var:live-enabled`` -- a plain feature flag (the 'variable' flavor).

    This is deliberately NOT a credential: it lets a suite opt live vectors in or
    out independently of whether keys happen to be present.
    """
    return os.environ.get("PROMPTY_LIVE_VECTORS", "").strip().lower() in {"1", "true", "yes", "on"}


def _cap_entra_foundry_project(context: dict) -> bool:
    """Capability ``entra:foundry-project`` -- a token PROBE, not an env-key check.

    Resolves a project URL/endpoint (preferring the ref-resolved vector input,
    falling back to ``AZURE_OPENAI_ENDPOINT``) and asks ``DefaultAzureCredential``
    whether it can mint a Cognitive Services token. Any failure -- missing
    ``azure-identity``, no endpoint, no signed-in identity -- means unavailable.
    """
    try:
        from azure.identity import DefaultAzureCredential
    except Exception:  # noqa: BLE001 -- azure-identity is optional
        return False

    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
    resolve = context.get("resolveInput")
    vector = context.get("vector") or {}
    raw_input = vector.get("input")
    if callable(resolve) and isinstance(raw_input, dict):
        try:
            resolved = resolve(raw_input)
            if isinstance(resolved, dict):
                endpoint = resolved.get("projectUrl") or resolved.get("endpoint") or endpoint
        except Exception:  # noqa: BLE001 -- a bad ref must not crash the probe
            pass
    if not endpoint:
        return False

    try:
        credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
        token = credential.get_token("https://cognitiveservices.azure.com/.default")
        return bool(getattr(token, "token", None))
    except Exception:  # noqa: BLE001 -- no usable identity == capability absent
        return False


def _live_provider_impls(provider: str) -> tuple[Any, Any]:
    """Return ``(executor, processor)`` instances for a live provider."""
    normalized = (provider or "openai").lower()
    if normalized == "openai":
        from prompty.providers.openai.executor import OpenAIExecutor
        from prompty.providers.openai.processor import OpenAIProcessor

        return OpenAIExecutor(), OpenAIProcessor()
    if normalized in ("foundry", "azure"):
        from prompty.providers.foundry.executor import FoundryExecutor
        from prompty.providers.foundry.processor import FoundryProcessor

        return FoundryExecutor(), FoundryProcessor()
    if normalized == "anthropic":
        from prompty.providers.anthropic.executor import AnthropicExecutor
        from prompty.providers.anthropic.processor import AnthropicProcessor

        return AnthropicExecutor(), AnthropicProcessor()
    raise ValueError(f"live-chat adapter: unknown provider {provider!r}")


def _drill_build_agent(resolved_input: dict, *, endpoint: str | None, api_key: str | None) -> Any:
    """Construct a chat ``Agent`` bound to a specific transport ``endpoint``.

    The drill binds the transport seam via base-URL redirect, so ``endpoint`` and
    ``api_key`` are supplied by the caller (a local cassette-replay server in
    replay mode, the real base URL + key in live mode) rather than read from the
    vector input. When ``endpoint`` is falsy the connection omits it so the SDK
    falls back to the provider's default base URL (live mode without an override).
    """
    from prompty.model import Agent

    provider = (resolved_input.get("provider") or "openai").lower()

    connection: dict[str, Any] = {"kind": "key"}
    if api_key:
        connection["apiKey"] = api_key
    if endpoint:
        connection["endpoint"] = endpoint

    data: dict[str, Any] = {
        "name": "drill-chat-vector",
        "model": {
            "id": resolved_input.get("model") or "gpt-4o-mini",
            "provider": provider,
            "apiType": "chat",
            "connection": connection,
        },
    }
    options = resolved_input.get("options")
    if options:
        data["model"]["options"] = options
    return Agent.load(data)


def _extract_chat_structure(observed: Any) -> tuple[Any, Any, Any]:
    """Reduce a raw provider chat response to ``(role, content, finishReason)``."""
    # OpenAI / Foundry: ChatCompletion.choices[0].message + .finish_reason
    choices = getattr(observed, "choices", None)
    if not choices and isinstance(observed, dict):
        choices = observed.get("choices")
    if choices:
        choice = choices[0]
        message = getattr(choice, "message", None)
        if message is None and isinstance(choice, dict):
            message = choice.get("message")
        role = getattr(message, "role", None)
        content = getattr(message, "content", None)
        if isinstance(message, dict):
            role = message.get("role")
            content = message.get("content")
        finish = getattr(choice, "finish_reason", None)
        if isinstance(choice, dict):
            finish = choice.get("finish_reason")
        return role, content, finish

    # Anthropic Messages: .role, .content (list of blocks), .stop_reason
    role = getattr(observed, "role", None)
    content = getattr(observed, "content", None)
    if isinstance(content, list):
        parts = []
        for block in content:
            text = getattr(block, "text", None)
            if text is None and isinstance(block, dict):
                text = block.get("text")
            if text:
                parts.append(text)
        content = "".join(parts)
    finish = getattr(observed, "stop_reason", None)
    finish = _ANTHROPIC_STOP_REASONS.get(finish, finish)
    return role, content, finish


# ---------------------------------------------------------------------------
# LiveChatConformance.complete -- the service-drill adapter
# ---------------------------------------------------------------------------
#
# A "drill" is a conformance vector that crosses the REAL Executor transport
# seam. Unlike the pure conformance vectors that stop at the SDK edge, the drill
# binds the seam via base-URL redirect -- to a local ``CassetteReplayServer``
# (replay mode) or the real base URL (live mode) -- and asserts three planes:
#
#   1. transport -- the seam was reached and returned bytes (executor got a
#      response, and the replay server captured an inbound request).
#   2. wire      -- the outbound provider request body matches the cassette's
#      recorded request body (canonical equality; throw on mismatch).
#   3. semantic  -- normalized executor output == the vector `expected`. This
#      plane is asserted by the RUNNER via the registered ``normalize``, so the
#      drill's semantic plane IS a conformance vector over the executor.
#
# In live mode the adapter additionally asserts live-semantic == replay-semantic
# (parity). ``requires`` is deliberately OMITTED from the drill vector -- the
# ``requires`` guard is all-or-nothing and would skip the WHOLE vector when creds
# are absent, defeating the replay plane. Instead the adapter self-gates the live
# plane on credential presence and always runs replay.
#
# Cassette bytes and the SDK transport binding are consumer-owned "roster" -- by
# design NOT modeled in TypeSpec/Typra.

_DRILL_REPLAY_API_KEY = "sk-drill-replay-placeholder"


def _drill_canonical(value: Any) -> str:
    """Order-insensitive canonical JSON for wire/parity equality checks."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _drill_build_messages(resolved_input: dict) -> list:
    from prompty.core.types import Message, TextPart

    return [
        Message(role=spec.get("role", "user"), parts=[TextPart(value=spec.get("content", ""))])
        for spec in (resolved_input.get("messages") or [])
    ]


def _drill_execute(resolved_input: dict, *, endpoint: str | None, api_key: str | None) -> Any:
    """Drive the real executor with its transport bound to ``endpoint``.

    Returns the raw provider response. Shared by the replay path (``endpoint`` =
    a ``CassetteReplayServer`` base URL) and the live path (``endpoint`` = the
    real base URL or ``None`` for the SDK default).
    """
    agent = _drill_build_agent(resolved_input, endpoint=endpoint, api_key=api_key)
    executor, _processor = _live_provider_impls(resolved_input.get("provider") or "openai")
    messages = _drill_build_messages(resolved_input)
    return executor.execute(agent, messages)


def _drill_normalize_response(observed: Any) -> dict:
    """Project a raw chat response onto the canonical structural shape."""
    role, content, finish = _extract_chat_structure(observed)
    return {
        "role": role,
        "contentNonEmpty": bool(content and str(content).strip()),
        "finishReasonInEnum": finish in _FINISH_REASONS,
    }


def _drill_live_enabled(resolved_input: dict) -> bool:
    """Live plane is enabled iff a base URL AND an API key resolved from env.

    ``$env`` refs resolve to ``""`` when unset, so this is false in replay-only
    (no-creds) runs and true only when the vector's endpoint+apiKey env vars are
    both populated.
    """
    return bool(resolved_input.get("endpoint") and resolved_input.get("apiKey"))


def _drill_invoke(resolved_input: dict, context: dict) -> Any:
    """Run the drill: bind transport, replay the cassette, assert 3 planes.

    Returns the raw replay response; the runner then applies ``normalize`` and
    compares against the vector ``expected`` (the semantic plane).
    """
    from _drill_replay import CassetteReplayServer

    resolve = context.get("resolveInput")
    vector = context.get("vector") or {}
    exchange_raw = vector.get("exchange") or {}
    # The runner resolves refs only on `input`; the adapter owns `exchange`
    # resolution (nested `$env` transport ref + `$json` cassette ref).
    exchange = resolve(exchange_raw) if callable(resolve) else exchange_raw

    cassette = exchange.get("cassette") or {}
    recorded_request = (cassette.get("request") or {}).get("body")
    recorded_response = (cassette.get("response") or {}).get("body")
    recorded_status = int((cassette.get("response") or {}).get("status", 200))
    if recorded_response is None:
        raise AssertionError("drill cassette missing response.body")

    # --- Replay: bind the transport to the local cassette server -------------
    with CassetteReplayServer(recorded_response, recorded_status) as server:
        raw = _drill_execute(resolved_input, endpoint=server.base_url, api_key=_DRILL_REPLAY_API_KEY)

        # Plane 1: transport -- the seam was reached and a request was captured.
        captured = server.last_request
        if captured is None:
            raise AssertionError("drill transport plane: no request reached the replay server")
        if raw is None:
            raise AssertionError("drill transport plane: executor returned no response")

        # Plane 2: wire -- outbound request body matches the cassette request.
        if recorded_request is not None:
            observed_body = captured.get("body")
            if _drill_canonical(observed_body) != _drill_canonical(recorded_request):
                raise AssertionError(
                    "drill wire plane mismatch:\n"
                    f"  observed={_drill_canonical(observed_body)}\n"
                    f"  cassette={_drill_canonical(recorded_request)}"
                )

    # --- Live parity (self-gated): live-semantic must equal replay-semantic ---
    if _drill_live_enabled(resolved_input):
        live_raw = _drill_execute(
            resolved_input,
            endpoint=resolved_input.get("endpoint") or None,
            api_key=resolved_input.get("apiKey"),
        )
        if _drill_canonical(_drill_normalize_response(live_raw)) != _drill_canonical(_drill_normalize_response(raw)):
            raise AssertionError(
                "drill live/replay parity mismatch:\n"
                f"  live={_drill_normalize_response(live_raw)}\n"
                f"  replay={_drill_normalize_response(raw)}"
            )

    # Plane 3 (semantic) is asserted by the runner: normalize(raw) == expected.
    return raw


def _drill_normalize(observed: Any, context: dict) -> dict:
    """Registered semantic projection: raw response -> canonical structure."""
    return _drill_normalize_response(observed)


# ---------------------------------------------------------------------------
# Adapter registry
# ---------------------------------------------------------------------------

VECTOR_ADAPTERS: dict[str, Any] = {
    "LoadConformance.load": {"invoke": _load_invoke, "normalize": _load_normalize},
    "WireConformance.toRequest": {"invoke": _wire_invoke, "normalize": _project_normalize},
    "TurnConformance.run": {"invoke": _run_invoke, "normalize": _run_normalize},
    "TurnConformance.runTurn": {"invoke": _run_turn_invoke, "normalize": _project_normalize},
    "DiscoveryConformance.enrich": {"invoke": _discovery_enrich_invoke},
    "DiscoveryConformance.mapModel": {"invoke": _discovery_map_invoke},
    "TurnConformance.replay": {"invoke": _replay_invoke},
    "LiveChatConformance.complete": {"invoke": _drill_invoke, "normalize": _drill_normalize},
}

# Contracts introduced/tightened by Typra 0.12.0 that the Python runtime does not
# yet satisfy against the canonical spec. Each waiver is an explicit, reasoned
# conformance gap -- NOT a silent skip -- and is the honest "how done" signal.
VECTOR_WAIVERS: dict[str, str] = {}

VECTOR_DOUBLES: dict[str, Any] = {}

# Capability predicates for the Typra >= 1.1.0 requirement guard. The generated
# harness loads this via ``getattr(_ADAPTER_MODULE, "VECTOR_CAPABILITIES", {})``,
# so it is backward-compatible with harnesses that predate the guard. Each token
# maps to ``predicate(context) -> bool`` (truthy = available). ``context`` is the
# same object adapters receive (contract, operation, vector, provider, targetApi,
# doubles, baseDir, resolveInput), so probes can inspect the resolved input.
VECTOR_CAPABILITIES: dict[str, Any] = {
    "provider:openai": _cap_provider_openai,
    "provider:anthropic": _cap_provider_anthropic,
    "provider:azure": _cap_provider_azure,
    "provider:foundry": _cap_provider_azure,
    "entra:foundry-project": _cap_entra_foundry_project,
    "var:live-enabled": _cap_var_live_enabled,
}
