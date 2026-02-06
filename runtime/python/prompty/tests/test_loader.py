"""Tests for the Prompty v2 loader."""

from __future__ import annotations

import os
import warnings
from pathlib import Path

import pytest
from agentschema import (
    ApiKeyConnection,
    CustomTool,
    FunctionTool,
    McpTool,
    OpenApiTool,
    PromptAgent,
    ReferenceConnection,
)

from prompty import load

PROMPTS = Path(__file__).parent / "prompts"


# ---------------------------------------------------------------------------
# Basic loading
# ---------------------------------------------------------------------------


class TestBasicLoading:
    def test_load_basic(self):
        """Load basic.prompty and verify core fields."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            assert agent.name == "basic-prompt"
            assert agent.description == "A basic prompt for testing"
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]

    def test_load_minimal(self):
        """Load minimal.prompty — model with just an id."""
        agent = load(PROMPTS / "minimal.prompty")
        assert agent.name == "minimal"
        assert agent.model.id == "gpt-4"

    def test_load_returns_prompt_agent(self):
        """load() always returns a PromptAgent."""
        agent = load(PROMPTS / "minimal.prompty")
        assert isinstance(agent, PromptAgent)

    def test_load_kind_is_prompt(self):
        """kind is always 'prompt' for .prompty files."""
        agent = load(PROMPTS / "minimal.prompty")
        assert agent.kind == "prompt"

    def test_load_missing_file(self):
        """FileNotFoundError for non-existent files."""
        with pytest.raises(FileNotFoundError):
            load(PROMPTS / "nonexistent.prompty")

    def test_load_no_model(self):
        """A prompt with no model specified still loads."""
        agent = load(PROMPTS / "no_model.prompty")
        assert agent.name == "no-model"
        assert agent.model is not None  # agentschema provides a default


# ---------------------------------------------------------------------------
# Instructions
# ---------------------------------------------------------------------------


class TestInstructions:
    def test_load_instructions_from_body(self):
        """The markdown body becomes agent.instructions."""
        agent = load(PROMPTS / "minimal.prompty")
        assert agent.instructions is not None
        assert "Hello world." in agent.instructions

    def test_load_instructions_roles(self):
        """Instructions preserve role markers."""
        agent = load(PROMPTS / "minimal.prompty")
        assert agent.instructions is not None
        assert agent.instructions.strip().startswith("system:")

    def test_load_thread_input_kind(self):
        """Thread-kind input is declared in inputSchema."""
        agent = load(PROMPTS / "threaded.prompty")
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions
        assert "{{conversation}}" in agent.instructions
        # thread-kind input should be in the schema
        assert agent.inputSchema is not None
        thread_props = [p for p in agent.inputSchema.properties if p.kind == "thread"]
        assert len(thread_props) == 1
        assert thread_props[0].name == "conversation"


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


class TestModel:
    def test_load_model_id(self):
        """model.id is set correctly."""
        agent = load(PROMPTS / "minimal.prompty")
        assert agent.model.id == "gpt-4"

    def test_load_model_full(self):
        """Full model config: provider, apiType, connection, options."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            assert agent.model.id == "gpt-4"
            assert agent.model.provider == "azure"
            assert agent.model.apiType == "chat"
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]

    def test_load_model_connection(self):
        """model.connection is typed as ApiKeyConnection."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            conn = agent.model.connection
            assert isinstance(conn, ApiKeyConnection)
            assert conn.endpoint == "https://test.openai.azure.com/"
            assert conn.apiKey == "test-key-123"
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]

    def test_load_model_options(self):
        """model.options are typed with correct values."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            opts = agent.model.options
            assert opts is not None
            assert opts.temperature == 0.7
            assert opts.maxOutputTokens == 1000
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]


# ---------------------------------------------------------------------------
# Input/Output Schema
# ---------------------------------------------------------------------------


class TestSchema:
    def test_load_input_schema(self):
        """inputSchema.properties loaded from basic.prompty."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            assert agent.inputSchema is not None
            props = agent.inputSchema.properties
            assert len(props) == 3
            names = [p.name for p in props]
            assert "firstName" in names
            assert "lastName" in names
            assert "question" in names
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]

    def test_load_input_values(self):
        """Property values (examples) are preserved."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            assert agent.inputSchema is not None
            props = {p.name: p for p in agent.inputSchema.properties}
            assert props["firstName"].kind == "string"
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


class TestTools:
    def test_load_tools_function(self):
        """FunctionTool loads with parameters."""
        agent = load(PROMPTS / "tools_function.prompty")
        assert agent.tools is not None
        assert len(agent.tools) == 2
        tool = agent.tools[0]
        assert isinstance(tool, FunctionTool)
        assert tool.name == "get_current_weather"
        assert tool.kind == "function"
        assert len(tool.parameters.properties) > 0

    def test_load_tools_function_params(self):
        """FunctionTool parameters have correct properties."""
        agent = load(PROMPTS / "tools_function.prompty")
        tool = agent.tools[0]
        assert isinstance(tool, FunctionTool)
        param_names = [p.name for p in tool.parameters.properties]
        assert "location" in param_names

    def test_load_tools_mcp(self):
        """McpTool loads with serverName and connection."""
        agent = load(PROMPTS / "tools_mcp.prompty")
        assert agent.tools is not None
        assert len(agent.tools) == 1
        tool = agent.tools[0]
        assert isinstance(tool, McpTool)
        assert tool.name == "filesystem"
        assert tool.serverName == "filesystem-server"
        assert isinstance(tool.connection, ReferenceConnection)

    def test_load_tools_openapi(self):
        """OpenApiTool loads with specification and connection."""
        os.environ["WEATHER_API_KEY"] = "weather-key-123"
        try:
            agent = load(PROMPTS / "tools_openapi.prompty")
            assert agent.tools is not None
            tool = agent.tools[0]
            assert isinstance(tool, OpenApiTool)
            assert tool.name == "weather_api"
            assert isinstance(tool.connection, ApiKeyConnection)
        finally:
            del os.environ["WEATHER_API_KEY"]

    def test_load_tools_custom(self):
        """Unknown tool kind becomes CustomTool."""
        agent = load(PROMPTS / "tools_custom.prompty")
        assert agent.tools is not None
        tool = agent.tools[0]
        assert isinstance(tool, CustomTool)
        assert tool.name == "my_custom_tool"
        assert tool.kind == "my_provider"


# ---------------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------------


class TestTemplate:
    def test_load_template(self):
        """Template format and parser are loaded."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            assert agent.template is not None
            assert agent.template.format.kind == "jinja2"
            assert agent.template.parser.kind == "prompty"
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


class TestMetadata:
    def test_load_metadata(self):
        """metadata dict is preserved."""
        agent = load(PROMPTS / "rich_metadata.prompty")
        assert agent.metadata is not None
        assert "authors" in agent.metadata
        assert "alice" in agent.metadata["authors"]
        assert "bob" in agent.metadata["authors"]
        assert agent.metadata["tags"] == ["production", "v2"]
        assert agent.metadata["version"] == "2.0"
        assert agent.metadata["custom_field"] == "hello"


# ---------------------------------------------------------------------------
# Reference resolution — ${env:} and ${file:}
# ---------------------------------------------------------------------------


class TestReferenceResolution:
    def test_load_env_resolution(self):
        """${env:VAR} resolves from os.environ."""
        os.environ["TEST_ENDPOINT"] = "https://resolved.openai.azure.com/"
        os.environ["TEST_API_KEY"] = "resolved-key"
        try:
            agent = load(PROMPTS / "env_test.prompty")
            conn = agent.model.connection
            assert isinstance(conn, ApiKeyConnection)
            assert conn.endpoint == "https://resolved.openai.azure.com/"
            assert conn.apiKey == "resolved-key"
        finally:
            del os.environ["TEST_ENDPOINT"]
            del os.environ["TEST_API_KEY"]

    def test_load_env_default(self):
        """${env:VAR:default} falls back to default."""
        # Make sure the env var is NOT set
        os.environ.pop("NONEXISTENT_ENDPOINT", None)
        agent = load(PROMPTS / "env_default.prompty")
        conn = agent.model.connection
        assert isinstance(conn, ApiKeyConnection)
        assert conn.endpoint == "https://fallback.openai.azure.com/"

    def test_load_env_missing_raises(self):
        """Missing env var without default raises ValueError."""
        os.environ.pop("TEST_ENDPOINT", None)
        os.environ.pop("TEST_API_KEY", None)
        with pytest.raises(ValueError, match="not set"):
            load(PROMPTS / "env_test.prompty")

    def test_load_file_resolution(self):
        """${file:path} loads JSON file content."""
        agent = load(PROMPTS / "file_ref.prompty")
        assert agent.inputSchema is not None
        props = agent.inputSchema.properties
        assert len(props) == 1
        assert props[0].name == "question"

    def test_load_file_not_found_raises(self):
        """Missing file reference raises FileNotFoundError."""
        # Create a temp prompty that references a nonexistent file
        import tempfile

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".prompty", delete=False, dir=PROMPTS
        ) as f:
            f.write(
                "---\nname: bad-ref\ninputSchema: ${file:nonexistent.json}\n---\nHello\n"
            )
            tmp_path = f.name
        try:
            with pytest.raises(FileNotFoundError, match="not found"):
                load(tmp_path)
        finally:
            os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Shared config via ${file:} references
# ---------------------------------------------------------------------------


class TestFileSharedConfig:
    def test_load_shared_connection(self):
        """${file:shared_connection.json} injects full connection config."""
        agent = load(PROMPTS / "config_cascade.prompty")
        conn = agent.model.connection
        assert isinstance(conn, ApiKeyConnection)
        assert conn.endpoint == "https://shared.openai.azure.com/"
        assert conn.apiKey == "shared-key"

    def test_load_shared_connection_kind(self):
        """Shared connection resolves to correct kind."""
        agent = load(PROMPTS / "config_cascade.prompty")
        assert agent.model.connection is not None
        assert agent.model.connection.kind == "key"


# ---------------------------------------------------------------------------
# Legacy migration
# ---------------------------------------------------------------------------


class TestLegacyMigration:
    def _load_legacy(self):
        """Helper to load legacy_basic.prompty with env vars set."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://legacy.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "legacy-key"
        try:
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                agent = load(PROMPTS / "legacy_basic.prompty")
                return agent, w
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]

    def test_load_legacy_basic(self):
        """Old-format prompty loads and produces a valid PromptAgent."""
        agent, _ = self._load_legacy()
        assert isinstance(agent, PromptAgent)
        assert agent.kind == "prompt"

    def test_load_legacy_deprecation_warnings(self):
        """Legacy loading emits DeprecationWarning."""
        _, w = self._load_legacy()
        dep_warnings = [x for x in w if issubclass(x.category, DeprecationWarning)]
        assert len(dep_warnings) > 0

    def test_load_legacy_configuration_to_connection(self):
        """model.configuration → model.connection."""
        agent, _ = self._load_legacy()
        conn = agent.model.connection
        assert isinstance(conn, ApiKeyConnection)
        assert conn.endpoint == "https://legacy.openai.azure.com/"

    def test_load_legacy_azure_deployment_to_id(self):
        """model.configuration.azure_deployment → model.id."""
        agent, _ = self._load_legacy()
        assert agent.model.id == "gpt-35-turbo"

    def test_load_legacy_provider(self):
        """type: azure_openai → provider: azure."""
        agent, _ = self._load_legacy()
        assert agent.model.provider == "azure"

    def test_load_legacy_parameters_to_options(self):
        """model.parameters → model.options with camelCase renames."""
        agent, _ = self._load_legacy()
        opts = agent.model.options
        assert opts is not None
        assert opts.temperature == 0.7
        assert opts.maxOutputTokens == 500
        assert opts.topP == 0.9
        assert opts.frequencyPenalty == 0.5
        assert opts.presencePenalty == 0.3
        assert opts.stopSequences == ["\n"]

    def test_load_legacy_api_to_apitype(self):
        """model.api → model.apiType."""
        agent, _ = self._load_legacy()
        assert agent.model.apiType == "chat"

    def test_load_legacy_inputs(self):
        """inputs → inputSchema.properties."""
        agent, _ = self._load_legacy()
        assert agent.inputSchema is not None
        props = agent.inputSchema.properties
        names = [p.name for p in props]
        assert "firstName" in names
        assert "lastName" in names
        assert "question" in names

    def test_load_legacy_inputs_type_to_kind(self):
        """inputs.X.type → inputSchema.properties.X.kind."""
        agent, _ = self._load_legacy()
        assert agent.inputSchema is not None
        props = {p.name: p for p in agent.inputSchema.properties}
        assert props["firstName"].kind == "string"

    def test_load_legacy_metadata_hoisting(self):
        """Root authors/tags/version → metadata.*."""
        agent, _ = self._load_legacy()
        assert agent.metadata is not None
        assert "authors" in agent.metadata
        assert "testauthor" in agent.metadata["authors"]
        assert "tags" in agent.metadata
        assert "test" in agent.metadata["tags"]
        assert agent.metadata["version"] == "1.0"

    def test_load_legacy_template_string(self):
        """template: jinja2 → template.format.kind: jinja2."""
        agent, _ = self._load_legacy()
        assert agent.template is not None
        assert agent.template.format.kind == "jinja2"
        assert agent.template.parser.kind == "prompty"

    def test_load_legacy_template_dict(self):
        """template with format/parser strings → structured."""
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")
            agent = load(PROMPTS / "legacy_template_dict.prompty")
        assert agent.template is not None
        assert agent.template.format.kind == "jinja2"
        assert agent.template.parser.kind == "prompty"

    def test_load_legacy_tools_hoisted(self):
        """model.parameters.tools → top-level tools."""
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")
            agent = load(PROMPTS / "legacy_tools.prompty")
        assert agent.tools is not None
        assert len(agent.tools) == 1
        assert isinstance(agent.tools[0], FunctionTool)
        assert agent.tools[0].name == "get_weather"


# ---------------------------------------------------------------------------
# Shorthand prompty files
# ---------------------------------------------------------------------------


class TestShorthand:
    def test_model_string(self):
        """model: gpt-4o (string shorthand) → Model(id='gpt-4o')."""
        agent = load(PROMPTS / "shorthand_model_string.prompty")
        assert agent.name == "model-string"
        assert agent.model.id == "gpt-4o"
        assert agent.model.provider is None
        assert agent.instructions is not None
        assert "{{question}}" in agent.instructions

    def test_empty_frontmatter(self):
        """Empty frontmatter (---\\n---) produces a valid PromptAgent."""
        agent = load(PROMPTS / "shorthand_empty_frontmatter.prompty")
        assert isinstance(agent, PromptAgent)
        assert agent.kind == "prompt"
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions

    def test_body_only(self):
        """File with no frontmatter at all still loads."""
        agent = load(PROMPTS / "shorthand_body_only.prompty")
        assert isinstance(agent, PromptAgent)
        assert agent.instructions is not None
        assert "answers questions concisely" in agent.instructions

    def test_quick_prompt(self):
        """Compact prompt with model string + inline inputSchema."""
        agent = load(PROMPTS / "shorthand_quick.prompty")
        assert agent.name == "quick-prompt"
        assert agent.model.id == "gpt-4o-mini"
        assert agent.inputSchema is not None
        props = agent.inputSchema.properties
        assert len(props) == 1
        assert props[0].name == "topic"
        assert props[0].default == "Python"
        assert agent.instructions is not None
        assert "{{topic}}" in agent.instructions

    def test_no_name(self):
        """Prompt with no name field — name defaults to empty string."""
        agent = load(PROMPTS / "shorthand_no_name.prompty")
        assert agent.name == ""
        assert agent.description == "A prompt with no name field"
        assert agent.model.id == "gpt-4o"

    def test_name_only(self):
        """Frontmatter with only a name — no model, no schema."""
        agent = load(PROMPTS / "shorthand_name_only.prompty")
        assert agent.name == "just-a-name"
        assert agent.model is not None  # agentschema provides default Model
        assert agent.model.id == ""
        assert agent.inputSchema is None
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions

    def test_shorthand_threaded(self):
        """Shorthand prompt with thread-kind input."""
        agent = load(PROMPTS / "shorthand_threaded.prompty")
        assert agent.model.id == "gpt-4o"
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions
        assert "{{conversation}}" in agent.instructions
        assert agent.inputSchema is not None
        thread_props = [p for p in agent.inputSchema.properties if p.kind == "thread"]
        assert len(thread_props) == 1


# ---------------------------------------------------------------------------
# Async loading
# ---------------------------------------------------------------------------


class TestAsyncLoading:
    @pytest.mark.asyncio
    async def test_load_async_basic(self):
        """Async load returns same result as sync."""
        from prompty import load_async

        agent = await load_async(PROMPTS / "minimal.prompty")
        assert isinstance(agent, PromptAgent)
        assert agent.name == "minimal"
        assert agent.model.id == "gpt-4"

    @pytest.mark.asyncio
    async def test_load_async_missing_file(self):
        """Async load raises FileNotFoundError for missing files."""
        from prompty import load_async

        with pytest.raises(FileNotFoundError):
            await load_async(PROMPTS / "nonexistent.prompty")
