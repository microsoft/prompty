"""Tests for the Phase 2 invoker architecture.

Covers:
- Protocol compliance
- Entry point discovery (with mocked entry points)
- Input validation
- prepare() pipeline (with mock renderer/parser)
- execute() and process() dispatch
- run() end-to-end with mocks
- Thread marker expansion
- Rich input kinds
- Error cases
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest import mock

import pytest

from prompty.core.types import (
    Message,
    TextPart,
    ThreadMarker,
)
from prompty.invoker import (
    InvokerError,
    _dict_to_message,
    _expand_thread_markers,
    _get_rich_input_names,
    _inject_thread_markers,
    clear_cache,
    execute,
    get_executor,
    get_parser,
    get_processor,
    get_renderer,
    prepare,
    process,
    run,
    validate_inputs,
)

# ---------------------------------------------------------------------------
# Test fixtures directory
# ---------------------------------------------------------------------------

PROMPTS_DIR = Path(__file__).parent / "prompts"


# ---------------------------------------------------------------------------
# Helpers — mock invoker classes that satisfy protocols
# ---------------------------------------------------------------------------


class MockRenderer:
    """A simple renderer that does {{ var }} substitution."""

    def render(self, agent, template: str, inputs: dict) -> str:
        result = template
        for key, value in inputs.items():
            result = result.replace("{{" + key + "}}", str(value))
        return result

    async def render_async(self, agent, template: str, inputs: dict) -> str:
        return self.render(agent, template, inputs)


class MockParser:
    """A simple parser that splits on 'role:' markers."""

    def parse(self, agent, rendered: str, **context) -> list[Message]:
        messages: list[Message] = []
        current_role = "system"
        current_text: list[str] = []

        for line in rendered.split("\n"):
            stripped = line.strip()
            if stripped.endswith(":") and stripped[:-1] in (
                "system",
                "user",
                "assistant",
                "developer",
            ):
                if current_text:
                    messages.append(
                        Message(
                            role=current_role,
                            parts=[TextPart(value="\n".join(current_text).strip())],
                        )
                    )
                    current_text = []
                current_role = stripped[:-1]
            else:
                current_text.append(line)

        if current_text:
            text = "\n".join(current_text).strip()
            if text:
                messages.append(
                    Message(
                        role=current_role,
                        parts=[TextPart(value=text)],
                    )
                )

        return messages

    async def parse_async(self, agent, rendered: str, **context) -> list[Message]:
        return self.parse(agent, rendered, **context)


class MockParserWithPreRender(MockParser):
    """Parser with pre_render sanitization support."""

    def pre_render(self, template: str) -> tuple[str, dict[str, Any]]:
        nonce = "__NONCE_1234__"
        sanitized = template.replace("{{", f"{nonce}{{{{").replace("}}", f"}}}}{nonce}")
        return sanitized, {"nonce": nonce}


class MockExecutor:
    """Returns a fake response based on messages."""

    def execute(self, agent, messages: list[Message]) -> dict:
        content = " | ".join(msg.text for msg in messages if isinstance(msg, Message))
        return {
            "choices": [
                {"message": {"role": "assistant", "content": f"Response to: {content}"}}
            ]
        }

    async def execute_async(self, agent, messages: list[Message]) -> dict:
        return self.execute(agent, messages)


class MockProcessor:
    """Extracts content from fake response."""

    def process(self, agent, response: Any) -> str:
        return response["choices"][0]["message"]["content"]

    async def process_async(self, agent, response: Any) -> str:
        return self.process(agent, response)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_cache():
    """Clear the invoker cache before each test."""
    clear_cache()
    yield
    clear_cache()


def _make_entry_point(name: str, obj: Any):
    """Create a mock entry point that loads to the given object."""
    ep = mock.Mock()
    ep.name = name
    ep.load.return_value = obj
    return ep


def _patch_entry_points(**groups):
    """Patch importlib.metadata.entry_points to return mock EPs.

    Usage::
        _patch_entry_points(
            renderers=[("jinja2", MockRenderer)],
            parsers=[("prompty", MockParser)],
        )
    """
    ep_map: dict[str, dict[str, Any]] = {}
    for group_suffix, items in groups.items():
        group_key = f"prompty.{group_suffix}"
        ep_map[group_key] = {}
        for name, cls in items:
            ep_map[group_key][name] = _make_entry_point(name, cls)

    def fake_entry_points(group=None, name=None):
        if group not in ep_map:
            return []
        if name and name in ep_map[group]:
            return [ep_map[group][name]]
        if name:
            return []
        return list(ep_map[group].values())

    return mock.patch(
        "prompty.core.discovery.importlib.metadata.entry_points",
        side_effect=fake_entry_points,
    )


def _make_agent(**overrides) -> Any:
    """Create a minimal mock PromptAgent for testing."""
    from agentschema import Model, PromptAgent

    agent = mock.Mock(spec=PromptAgent)
    agent.instructions = overrides.get(
        "instructions", "system:\nHello {{name}}\n\nuser:\n{{question}}"
    )
    agent.inputSchema = overrides.get("inputSchema", None)
    agent.template = overrides.get("template", None)
    agent.model = overrides.get("model", mock.Mock(spec=Model))
    agent.model.provider = overrides.get("provider", "openai")
    agent.tools = overrides.get("tools", None)
    return agent


# ---------------------------------------------------------------------------
# Tests: InvokerError
# ---------------------------------------------------------------------------


class TestInvokerError:
    def test_error_message(self):
        err = InvokerError("prompty.renderers", "jinja2")
        assert "jinja2" in str(err)
        assert "renderer" in str(err)
        assert "pip install" in str(err)

    def test_error_attributes(self):
        err = InvokerError("prompty.executors", "openai")
        assert err.group == "prompty.executors"
        assert err.key == "openai"


# ---------------------------------------------------------------------------
# Tests: Entry point discovery
# ---------------------------------------------------------------------------


class TestDiscovery:
    def test_discover_renderer(self):
        with _patch_entry_points(renderers=[("jinja2", MockRenderer)]):
            renderer = get_renderer("jinja2")
            assert isinstance(renderer, MockRenderer)

    def test_discover_parser(self):
        with _patch_entry_points(parsers=[("prompty", MockParser)]):
            parser = get_parser("prompty")
            assert isinstance(parser, MockParser)

    def test_discover_executor(self):
        with _patch_entry_points(executors=[("openai", MockExecutor)]):
            executor = get_executor("openai")
            assert isinstance(executor, MockExecutor)

    def test_discover_processor(self):
        with _patch_entry_points(processors=[("openai", MockProcessor)]):
            processor = get_processor("openai")
            assert isinstance(processor, MockProcessor)

    def test_discover_missing_raises(self):
        with _patch_entry_points():
            with pytest.raises(InvokerError, match="renderer"):
                get_renderer("nonexistent")

    def test_discovery_caches(self):
        with _patch_entry_points(renderers=[("jinja2", MockRenderer)]):
            r1 = get_renderer("jinja2")
            r2 = get_renderer("jinja2")
            assert r1 is r2

    def test_clear_cache_resets(self):
        with _patch_entry_points(renderers=[("jinja2", MockRenderer)]):
            r1 = get_renderer("jinja2")
            clear_cache()
            r2 = get_renderer("jinja2")
            # After clearing, a new instance is created
            assert r1 is not r2


# ---------------------------------------------------------------------------
# Tests: Input validation
# ---------------------------------------------------------------------------


class TestValidateInputs:
    def test_no_schema(self):
        agent = _make_agent()
        result = validate_inputs(agent, {"foo": "bar"})
        assert result == {"foo": "bar"}

    def test_defaults_applied(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "name"
        p.kind = "string"
        p.default = "World"

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]
        schema.strict = False

        agent = _make_agent(inputSchema=schema)
        result = validate_inputs(agent, {})
        assert result["name"] == "World"

    def test_example_as_fallback(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "name"
        p.kind = "string"
        p.default = None
        p.example = "Jane"

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]
        schema.strict = False

        agent = _make_agent(inputSchema=schema)
        result = validate_inputs(agent, {})
        assert result["name"] == "Jane"

    def test_required_missing_raises(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "name"
        p.kind = "string"
        p.default = None
        p.example = None
        p.required = True

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]
        schema.strict = False

        agent = _make_agent(inputSchema=schema)
        with pytest.raises(ValueError, match="Required input 'name'"):
            validate_inputs(agent, {})

    def test_strict_rejects_unknown(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "name"
        p.kind = "string"
        p.default = "X"

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]
        schema.strict = True

        agent = _make_agent(inputSchema=schema)
        with pytest.raises(ValueError, match="Unknown input"):
            validate_inputs(agent, {"name": "ok", "extra": "bad"})

    def test_provided_overrides_default(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "name"
        p.kind = "string"
        p.default = "Default"

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]
        schema.strict = False

        agent = _make_agent(inputSchema=schema)
        result = validate_inputs(agent, {"name": "Custom"})
        assert result["name"] == "Custom"


# ---------------------------------------------------------------------------
# Tests: Thread marker expansion
# ---------------------------------------------------------------------------


class TestThreadExpansion:
    def test_marker_replaced_with_messages(self):
        messages: list[Message | ThreadMarker] = [
            Message(role="system", parts=[TextPart(value="Hello")]),
            ThreadMarker(name="history"),
            Message(role="user", parts=[TextPart(value="Question")]),
        ]
        inputs = {
            "history": [
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello!"},
            ]
        }
        rich = {"history": "thread"}

        result = _expand_thread_markers(messages, inputs, rich)
        assert len(result) == 4
        assert result[0].role == "system"
        assert result[1].role == "user"
        assert result[1].text == "Hi"
        assert result[2].role == "assistant"
        assert result[2].text == "Hello!"
        assert result[3].role == "user"
        assert result[3].text == "Question"

    def test_no_marker_appends_thread(self):
        messages: list[Message | ThreadMarker] = [
            Message(role="system", parts=[TextPart(value="Hello")]),
        ]
        inputs = {
            "history": [
                {"role": "user", "content": "Hi"},
            ]
        }
        rich = {"history": "thread"}

        result = _expand_thread_markers(messages, inputs, rich)
        assert len(result) == 2
        assert result[1].text == "Hi"

    def test_marker_with_message_objects(self):
        thread_msg = Message(role="user", parts=[TextPart(value="Message obj")])
        messages: list[Message | ThreadMarker] = [
            ThreadMarker(name="chat"),
        ]
        inputs = {"chat": [thread_msg]}
        rich = {"chat": "thread"}

        result = _expand_thread_markers(messages, inputs, rich)
        assert len(result) == 1
        assert result[0].text == "Message obj"

    def test_empty_thread(self):
        messages: list[Message | ThreadMarker] = [
            Message(role="system", parts=[TextPart(value="Hello")]),
            ThreadMarker(name="history"),
        ]
        inputs: dict[str, Any] = {"history": []}
        rich = {"history": "thread"}

        result = _expand_thread_markers(messages, inputs, rich)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Tests: _inject_thread_markers (nonce-based thread injection)
# ---------------------------------------------------------------------------


class TestInjectThreadMarkers:
    def test_injects_marker_at_nonce_position(self):
        """Nonce marker in message text gets replaced by ThreadMarker."""
        marker = "__PROMPTY_THREAD_abc123_conv__"
        messages = [
            Message(role="system", parts=[TextPart(value=f"Before {marker} After")]),
            Message(role="user", parts=[TextPart(value="Question")]),
        ]
        thread_nonces = {marker: "conv"}

        result = _inject_thread_markers(messages, thread_nonces)
        # Should produce: system(Before), ThreadMarker(conv), system(After), user(Question)
        assert len(result) == 4
        assert isinstance(result[0], Message)
        assert result[0].text == "Before"
        assert isinstance(result[1], ThreadMarker)
        assert result[1].name == "conv"
        assert isinstance(result[2], Message)
        assert result[2].text == "After"
        assert isinstance(result[3], Message)
        assert result[3].role == "user"

    def test_marker_only_message(self):
        """Message containing only the nonce marker becomes just a ThreadMarker."""
        marker = "__PROMPTY_THREAD_xyz_history__"
        messages = [
            Message(role="system", parts=[TextPart(value=marker)]),
        ]
        thread_nonces = {marker: "history"}

        result = _inject_thread_markers(messages, thread_nonces)
        assert len(result) == 1
        assert isinstance(result[0], ThreadMarker)
        assert result[0].name == "history"

    def test_no_nonces_returns_unchanged(self):
        """Without nonce markers, messages pass through unchanged."""
        messages = [
            Message(role="system", parts=[TextPart(value="Hello")]),
        ]
        result = _inject_thread_markers(messages, {})
        assert len(result) == 1
        assert isinstance(result[0], Message)
        assert result[0].text == "Hello"

    def test_no_match_passes_through(self):
        """Messages without matching nonces pass through unchanged."""
        messages = [
            Message(role="user", parts=[TextPart(value="Hello world")]),
        ]
        thread_nonces = {"__PROMPTY_THREAD_abc_x__": "x"}

        result = _inject_thread_markers(messages, thread_nonces)
        assert len(result) == 1
        assert isinstance(result[0], Message)
        assert result[0].text == "Hello world"


# ---------------------------------------------------------------------------
# Tests: dict_to_message
# ---------------------------------------------------------------------------


class TestDictToMessage:
    def test_simple_dict(self):
        msg = _dict_to_message({"role": "user", "content": "Hello"})
        assert msg.role == "user"
        assert msg.text == "Hello"

    def test_defaults_to_user(self):
        msg = _dict_to_message({"content": "Hello"})
        assert msg.role == "user"

    def test_metadata_preserved(self):
        msg = _dict_to_message({"role": "assistant", "content": "Hi", "name": "bot"})
        assert msg.metadata.get("name") == "bot"


# ---------------------------------------------------------------------------
# Tests: prepare()
# ---------------------------------------------------------------------------


class TestPrepare:
    def _patch_all(self):
        return _patch_entry_points(
            renderers=[("jinja2", MockRenderer)],
            parsers=[("prompty", MockParser)],
        )

    def test_basic_prepare(self):
        agent = _make_agent(
            instructions="system:\nHello {{name}}\n\nuser:\n{{question}}",
        )

        with self._patch_all():
            messages = prepare(agent, {"name": "World", "question": "How?"})

        assert len(messages) == 2
        assert messages[0].role == "system"
        assert "World" in messages[0].text
        assert messages[1].role == "user"
        assert "How?" in messages[1].text

    def test_prepare_with_template_config(self):
        from agentschema import Format, Template
        from agentschema import Parser as SchemaParser

        fmt = mock.Mock(spec=Format)
        fmt.kind = "jinja2"
        fmt.strict = None

        parser = mock.Mock(spec=SchemaParser)
        parser.kind = "prompty"

        template = mock.Mock(spec=Template)
        template.format = fmt
        template.parser = parser

        agent = _make_agent(
            instructions="system:\nHi {{name}}",
            template=template,
        )

        with self._patch_all():
            messages = prepare(agent, {"name": "Test"})

        assert len(messages) == 1
        assert "Test" in messages[0].text

    def test_prepare_no_inputs(self):
        agent = _make_agent(
            instructions="system:\nHello world",
        )

        with self._patch_all():
            messages = prepare(agent, {})

        assert len(messages) == 1

    def test_prepare_missing_renderer_raises(self):
        agent = _make_agent(instructions="Hello")

        with _patch_entry_points(parsers=[("prompty", MockParser)]):
            with pytest.raises(InvokerError, match="renderer"):
                prepare(agent, {})


# ---------------------------------------------------------------------------
# Tests: execute()
# ---------------------------------------------------------------------------


class TestExecute:
    def test_basic_execute(self):
        agent = _make_agent(provider="openai")
        messages = [Message(role="user", parts=[TextPart(value="Hi")])]

        with _patch_entry_points(executors=[("openai", MockExecutor)]):
            result = execute(agent, messages)

        assert "Response to:" in result["choices"][0]["message"]["content"]

    def test_execute_no_provider_raises(self):
        agent = _make_agent(provider="")
        messages = [Message(role="user", parts=[TextPart(value="Hi")])]

        with pytest.raises(InvokerError):
            execute(agent, messages)

    def test_execute_unknown_provider_raises(self):
        agent = _make_agent(provider="unknown")
        messages = [Message(role="user", parts=[TextPart(value="Hi")])]

        with _patch_entry_points():
            with pytest.raises(InvokerError, match="executor"):
                execute(agent, messages)


# ---------------------------------------------------------------------------
# Tests: process()
# ---------------------------------------------------------------------------


class TestProcess:
    def test_basic_process(self):
        agent = _make_agent(provider="openai")
        response = {
            "choices": [{"message": {"role": "assistant", "content": "Hello!"}}]
        }

        with _patch_entry_points(processors=[("openai", MockProcessor)]):
            result = process(agent, response)

        assert result == "Hello!"

    def test_process_no_provider_raises(self):
        agent = _make_agent(provider="")

        with pytest.raises(InvokerError):
            process(agent, {})


# ---------------------------------------------------------------------------
# Tests: run()
# ---------------------------------------------------------------------------


class TestRun:
    def _patch_all(self):
        return _patch_entry_points(
            renderers=[("jinja2", MockRenderer)],
            parsers=[("prompty", MockParser)],
            executors=[("openai", MockExecutor)],
            processors=[("openai", MockProcessor)],
        )

    def test_run_with_agent(self):
        agent = _make_agent(
            instructions="system:\nHello\n\nuser:\n{{q}}",
            provider="openai",
        )

        with self._patch_all():
            result = run(agent, {"q": "Hi"})

        assert isinstance(result, str)
        assert "Response to:" in result

    def test_run_raw(self):
        agent = _make_agent(
            instructions="system:\nHello",
            provider="openai",
        )

        with self._patch_all():
            result = run(agent, {}, raw=True)

        assert isinstance(result, dict)
        assert "choices" in result


# ---------------------------------------------------------------------------
# Tests: _get_rich_input_names
# ---------------------------------------------------------------------------


class TestRichInputNames:
    def test_no_schema(self):
        agent = _make_agent()
        assert _get_rich_input_names(agent) == {}

    def test_detects_thread(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "history"
        p.kind = "thread"

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]

        agent = _make_agent(inputSchema=schema)
        result = _get_rich_input_names(agent)
        assert result == {"history": "thread"}

    def test_ignores_string(self):
        from agentschema import Property, PropertySchema

        p = Property()
        p.name = "name"
        p.kind = "string"

        schema = mock.Mock(spec=PropertySchema)
        schema.properties = [p]

        agent = _make_agent(inputSchema=schema)
        assert _get_rich_input_names(agent) == {}


# ---------------------------------------------------------------------------
# headless() API
# ---------------------------------------------------------------------------


class TestHeadless:
    def test_returns_prompt_agent(self):
        from agentschema import PromptAgent

        from prompty.core.pipeline import headless

        agent = headless()
        assert isinstance(agent, PromptAgent)

    def test_default_values(self):
        from prompty.core.pipeline import headless

        agent = headless()
        assert agent.model.apiType == "chat"
        assert agent.model.provider == "openai"
        assert agent.name == "headless"

    def test_custom_api_type(self):
        from prompty.core.pipeline import headless

        agent = headless(api="embedding", model="text-embedding-ada-002")
        assert agent.model.apiType == "embedding"
        assert agent.model.id == "text-embedding-ada-002"

    def test_content_in_metadata(self):
        from prompty.core.pipeline import headless

        agent = headless(content="hello world")
        assert agent.metadata is not None
        assert agent.metadata["content"] == "hello world"

    def test_content_list(self):
        from prompty.core.pipeline import headless

        agent = headless(content=["hello", "world"])
        assert agent.metadata is not None  # pyright: ignore[reportPossiblyUnbound]
        assert agent.metadata["content"] == [
            "hello",
            "world",
        ]  # pyright: ignore[reportOptionalSubscript]

    def test_custom_provider(self):
        from prompty.core.pipeline import headless

        agent = headless(provider="azure", model="gpt-4")
        assert agent.model.provider == "azure"

    def test_connection_config(self):
        from prompty.core.pipeline import headless

        agent = headless(
            connection={
                "kind": "key",
                "endpoint": "https://my.openai.azure.com",
                "apiKey": "sk-test",
            }
        )
        conn = agent.model.connection
        assert conn is not None
        from agentschema import ApiKeyConnection

        assert isinstance(conn, ApiKeyConnection)
        assert conn.apiKey == "sk-test"
        assert conn.endpoint == "https://my.openai.azure.com"

    def test_options_config(self):
        from prompty.core.pipeline import headless

        agent = headless(
            options={
                "temperature": 0.5,
                "maxOutputTokens": 100,
            }
        )
        assert agent.model.options is not None
        assert agent.model.options.temperature == 0.5
        assert agent.model.options.maxOutputTokens == 100

    def test_import_from_top_level(self):
        from prompty import headless as h

        agent = h(api="image", model="dall-e-3", content="a cat")
        assert agent.model.apiType == "image"
        assert agent.model.id == "dall-e-3"
