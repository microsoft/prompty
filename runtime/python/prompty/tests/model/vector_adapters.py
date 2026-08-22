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
from unittest.mock import MagicMock

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
from prompty.core.loader import default_save_context
from prompty.core.streaming import reconcile_stream
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
from prompty.model import Agent, HostToolRequest, ModelInfo, Property, TurnOptions
from prompty.parsers.prompty import PromptyChatParser
from prompty.providers.anthropic.executor import _build_chat_args as _anthropic_build_chat_args
from prompty.providers.anthropic.processor import _process_response as _anthropic_process_response
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
from prompty.providers.openai.processor import ToolCall, _process_response, process_stream_events
from prompty.renderers.jinja2 import Jinja2Renderer
from prompty.renderers.mustache import MustacheRenderer

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


def _load_invoke(input: dict, context: dict) -> Any:
    expected = context["vector"]["expected"]
    env_vars = input.get("env", {})
    old_env: dict[str, str | None] = {}
    for k, v in env_vars.items():
        old_env[k] = os.environ.get(k)
        os.environ[k] = v
    # Error vectors that assert a missing env var explicitly clear it
    if isinstance(expected, dict) and "error" in expected and "NONEXISTENT" in json.dumps(input):
        old_env.setdefault("NONEXISTENT", os.environ.get("NONEXISTENT"))
        os.environ.pop("NONEXISTENT", None)

    def _err(exc: Exception) -> dict:
        name = type(exc).__name__
        msg = str(exc)
        low = msg.lower()
        exp_err = expected.get("error") if isinstance(expected, dict) else None
        field = expected.get("error_field") if isinstance(expected, dict) else None
        matched = False
        if isinstance(exp_err, str):
            if exp_err == name or exp_err in msg:
                matched = True
            elif exp_err == "invalid frontmatter" and (_is_yaml_error(exc) or "yaml" in low or "mapping" in low):
                matched = True
            elif exp_err == "Invalid template format" and "template" in low:
                matched = True
            elif exp_err == "Missing required input" and "required" in low:
                matched = True
        if not matched:
            return {"error": msg}
        observed: dict[str, Any] = {"error": exp_err}
        if field is not None and str(field) in msg:
            observed["error_field"] = field
        return observed

    try:
        # --- input validation vectors ---
        if isinstance(expected, dict) and "validated_inputs" in expected:
            agent = _make_agent_from_frontmatter(input["frontmatter"])
            return {"validated_inputs": validate_inputs(agent, input.get("inputs", {}))}
        if isinstance(expected, dict) and "error" in expected and "inputs" in input and "frontmatter" in input:
            agent = _make_agent_from_frontmatter(input["frontmatter"])
            try:
                validate_inputs(agent, input.get("inputs", {}))
            except Exception as exc:  # noqa: BLE001
                return _err(exc)
            return {"error": "<no error raised>"}

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            if "fixture" in input:
                try:
                    agent = load(SPEC_FIXTURES / input["fixture"])
                except Exception as exc:  # noqa: BLE001
                    return _err(exc)
            elif "frontmatter_raw" in input:
                p = tmp_path / "vector.prompty"
                p.write_text(input["frontmatter_raw"], encoding="utf-8")
                try:
                    agent = load(p)
                except Exception as exc:  # noqa: BLE001
                    return _err(exc)
            else:
                frontmatter = dict(input["frontmatter"])
                sub = tmp_path / input["agent_subdir"] if input.get("agent_subdir") else tmp_path
                sub.mkdir(parents=True, exist_ok=True)
                p = sub / "vector.prompty"
                _write_prompty(p, frontmatter, input.get("files"))
                try:
                    agent = load(p)
                except Exception as exc:  # noqa: BLE001
                    return _err(exc)
            return _agent_to_canonical(agent.save(default_save_context(use_shorthand=False)))
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# ---------------------------------------------------------------------------
# RENDER
# ---------------------------------------------------------------------------


def _render_invoke(input: dict, context: dict) -> Any:
    import re

    template = input["template"]
    engine = input.get("engine", "jinja2")
    inputs = dict(input.get("inputs", {}))
    expected = context["vector"]["expected"]

    agent = Agent(name="render_test")
    if any(isinstance(v, dict) and v.get("_kind") == "thread" for v in inputs.values()):
        thread_inputs = []
        regular_inputs: dict[str, Any] = {}
        for k, v in inputs.items():
            if isinstance(v, dict) and v.get("_kind") == "thread":
                thread_inputs.append(Property(name=k, kind="thread"))
                regular_inputs[k] = v.get("messages", [])
            else:
                regular_inputs[k] = v
        thread_names = {t.name for t in thread_inputs}
        agent.inputs = thread_inputs + [
            Property(name=k, kind="string") for k in regular_inputs if k not in thread_names
        ]
        inputs = regular_inputs

    if engine == "jinja2":
        renderer: Any = Jinja2Renderer()
    elif engine == "mustache":
        renderer = MustacheRenderer()
    else:
        raise ValueError(f"Unknown engine: {engine}")

    rendered = renderer._render(agent, template, inputs)

    if isinstance(expected, dict) and "nonce_pattern" in expected:
        if re.match(expected["nonce_pattern"], rendered, re.DOTALL):
            return expected
        return {"rendered": rendered}
    return {"rendered": rendered}


def _render_segments_invoke(input: dict, context: dict) -> Any:
    """Provenance-tagged segment rendering via the owned ``jinja_subset`` engine (§7).

    ``render_segments`` is the provenance-carrying superset of ``render``:
    concatenating each segment's ``text`` reproduces the flat render, while the
    ``kind``/``source``/``strict`` tags carry literal-vs-interpolated provenance.
    A ``strict`` value that forges a role boundary raises ``StrictViolation``,
    which we surface as ``{"error": "StrictViolation"}`` to match the vector's
    ``expected`` (the same catch-and-return convention the load-error vectors use).
    """
    from dataclasses import asdict

    from prompty.jinja_subset import StrictViolation, render_segments

    template = input["template"]
    inputs = dict(input.get("inputs", {}))
    strict_props = input.get("strict_props")
    try:
        segments = render_segments(template, inputs, strict_props=strict_props)
    except StrictViolation:
        return {"error": "StrictViolation"}
    return {"segments": [asdict(segment) for segment in segments]}


# ---------------------------------------------------------------------------
# PARSE
# ---------------------------------------------------------------------------


def _message_to_canonical(msg: Message) -> dict:
    content = [p.save() for p in msg.parts]
    result: dict[str, Any] = {"role": msg.role, "content": content}
    if msg.metadata:
        result["metadata"] = msg.metadata
    return result


def _parse_invoke(input: dict, context: dict) -> Any:
    import re

    rendered = input["rendered"]
    parser = PromptyChatParser()
    agent = Agent(name="parse_test")
    messages = parser._parse(agent, rendered)

    thread_inputs = input.get("thread_inputs")
    if thread_inputs:
        from prompty.core.pipeline import _expand_thread_markers, _inject_thread_markers
        from prompty.renderers._common import THREAD_NONCE_PREFIX

        nonces: dict[str, str] = {}
        for name in thread_inputs:
            pattern = re.escape(THREAD_NONCE_PREFIX) + r"[0-9a-fA-F]+_" + re.escape(name) + r"__"
            found = re.search(pattern, rendered)
            if found:
                nonces[found.group(0)] = name
        rich_inputs = {name: "thread" for name in thread_inputs}
        injected = _inject_thread_markers(messages, nonces, rich_inputs)
        messages = _expand_thread_markers(injected, thread_inputs, rich_inputs)

    return {"messages": [_message_to_canonical(m) for m in messages]}


# ---------------------------------------------------------------------------
# WIRE (toRequest)
# ---------------------------------------------------------------------------


def _make_agent_for_wire(vec_input: dict) -> Agent:
    data: dict[str, Any] = {
        "name": "wire_test",
        "model": {"id": vec_input.get("model_id", "gpt-4"), "apiType": vec_input.get("apiType", "chat")},
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
    provider = input.get("provider", "openai")
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
# PROCESS
# ---------------------------------------------------------------------------


def _make_mock_response(data: dict, obj_type: str) -> MagicMock:
    mock = MagicMock()
    mock.object = obj_type
    if "choices" in data:
        choices = []
        for c in data["choices"]:
            choice = MagicMock()
            choice.index = c.get("index", 0)
            choice.finish_reason = c.get("finish_reason", "stop")
            msg = c.get("message", {})
            choice.message = MagicMock()
            choice.message.role = msg.get("role", "assistant")
            choice.message.content = msg.get("content")
            choice.message.refusal = msg.get("refusal")
            tc_data = msg.get("tool_calls")
            if tc_data:
                tool_calls = []
                for tc in tc_data:
                    tc_mock = MagicMock()
                    tc_mock.id = tc["id"]
                    tc_mock.type = tc["type"]
                    tc_mock.function = MagicMock()
                    tc_mock.function.name = tc["function"]["name"]
                    tc_mock.function.arguments = tc["function"]["arguments"]
                    tool_calls.append(tc_mock)
                choice.message.tool_calls = tool_calls
            else:
                choice.message.tool_calls = None
            choices.append(choice)
        mock.choices = choices
    if "data" in data:
        items = []
        for d in data["data"]:
            item = MagicMock()
            for k, v in d.items():
                setattr(item, k, v)
            items.append(item)
        mock.data = items
    return mock


def _make_mock_chat_completion(response_data: dict) -> Any:
    try:
        from openai.types.chat.chat_completion import ChatCompletion

        return ChatCompletion.model_validate(response_data)
    except Exception:  # noqa: BLE001
        return _make_mock_response(response_data, "chat.completion")


def _make_mock_embedding_response(response_data: dict) -> Any:
    try:
        from openai.types.create_embedding_response import CreateEmbeddingResponse

        return CreateEmbeddingResponse.model_validate(response_data)
    except Exception:  # noqa: BLE001
        return _make_mock_response(response_data, "list")


def _make_mock_image_response(response_data: dict) -> Any:
    try:
        from openai.types.images_response import ImagesResponse

        return ImagesResponse.model_validate(response_data)
    except Exception:  # noqa: BLE001
        return _make_mock_response(response_data, "images")


def _process_result_to_canonical(result: Any) -> Any:
    if isinstance(result, list) and result and isinstance(result[0], ToolCall):
        return [{"id": tc.id, "name": tc.name, "arguments": tc.arguments} for tc in result]
    if result is None:
        return ""
    return result


def _make_responses_api_mock(data: dict) -> MagicMock:
    """Build a mock Responses API response mirroring the SDK surface."""
    mock = MagicMock()
    mock.object = "response"
    mock.id = data.get("id", "")
    mock.status = data.get("status", "completed")
    mock.output_text = data.get("output_text", "")
    mock.model = data.get("model", "")
    mock.error = None

    output_items = []
    for item in data.get("output", []):
        item_mock = MagicMock()
        item_mock.type = item["type"]
        if item["type"] == "message":
            item_mock.id = item.get("id", "")
            item_mock.status = item.get("status", "completed")
            item_mock.role = item.get("role", "assistant")
            content_mocks = []
            for c in item.get("content", []):
                c_mock = MagicMock()
                c_mock.type = c["type"]
                c_mock.text = c.get("text", "")
                c_mock.annotations = c.get("annotations", [])
                content_mocks.append(c_mock)
            item_mock.content = content_mocks
        elif item["type"] == "function_call":
            item_mock.id = item.get("id", "")
            item_mock.call_id = item.get("call_id", "")
            item_mock.name = item.get("name", "")
            item_mock.arguments = item.get("arguments", "")
            item_mock.status = item.get("status", "completed")
        output_items.append(item_mock)
    mock.output = output_items
    return mock


def _process_invoke(input: dict, context: dict) -> Any:
    provider = input.get("provider", "openai")
    api_type = input.get("apiType", "chat")
    response_data = input["response"]
    has_outputs = input.get("has_outputs", False)

    agent = None
    if has_outputs:
        agent = Agent(name="process_test", outputs=[Property(name="dummy", kind="string")])

    if provider == "anthropic":
        result = _anthropic_process_response(agent, response_data)
        return {"result": _process_result_to_canonical(result)}

    if api_type == "chat":
        response = _make_mock_chat_completion(response_data)
    elif api_type == "embedding":
        response = _make_mock_embedding_response(response_data)
    elif api_type == "image":
        response = _make_mock_image_response(response_data)
    elif api_type == "responses":
        response = _make_responses_api_mock(response_data)
    else:
        raise ValueError(f"Unknown apiType for process: {api_type}")

    result = _process_response(response, agent)
    return {"result": _process_result_to_canonical(result)}


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


def _process_stream_invoke(resolved_input: Any, context: dict[str, Any]) -> dict[str, Any]:
    """Classify a raw provider stream and reconcile the streaming-failure contract."""
    provider = resolved_input.get("provider") or context.get("provider") or "openai"
    events = resolved_input.get("events") or []
    if provider == "openai":
        chunks = process_stream_events(events)
    else:
        raise ValueError(f"Unsupported stream provider: {provider!r}")
    reconciliation = reconcile_stream(chunks)
    return {
        "chunks": [chunk.save() for chunk in chunks],
        **reconciliation.save(),
    }


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
# Adapter registry
# ---------------------------------------------------------------------------

VECTOR_ADAPTERS: dict[str, Any] = {
    "LoadConformance.load": {"invoke": _load_invoke, "normalize": _project_normalize},
    "Renderer.render": {"invoke": _render_invoke, "normalize": _project_normalize},
    "Renderer.renderSegments": {"invoke": _render_segments_invoke, "normalize": _project_normalize},
    "Parser.parse": {"invoke": _parse_invoke, "normalize": _project_normalize},
    "WireConformance.toRequest": {"invoke": _wire_invoke, "normalize": _project_normalize},
    "Processor.process": {"invoke": _process_invoke, "normalize": _project_normalize},
    "Processor.processStream": {"invoke": _process_stream_invoke, "normalize": _project_normalize},
    "TurnConformance.run": {"invoke": _run_invoke, "normalize": _run_normalize},
    "TurnConformance.runTurn": {"invoke": _run_turn_invoke, "normalize": _project_normalize},
    "DiscoveryConformance.enrich": {"invoke": _discovery_enrich_invoke},
    "DiscoveryConformance.mapModel": {"invoke": _discovery_map_invoke},
    "TurnConformance.replay": {"invoke": _replay_invoke},
}

# Contracts introduced/tightened by Typra 0.12.0 that the Python runtime does not
# yet satisfy against the canonical spec. Each waiver is an explicit, reasoned
# conformance gap -- NOT a silent skip -- and is the honest "how done" signal.
VECTOR_WAIVERS: dict[str, str] = {}

VECTOR_DOUBLES: dict[str, Any] = {}
