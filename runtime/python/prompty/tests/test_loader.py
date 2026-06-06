"""Tests for the Prompty v2 loader."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from prompty import load
from prompty.model import (
    ApiKeyConnection,
    CustomTool,
    FunctionTool,
    McpTool,
    OpenApiTool,
    Prompty,
    ReferenceConnection,
)

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
        """load() always returns a Prompty."""
        agent = load(PROMPTS / "minimal.prompty")
        assert isinstance(agent, Prompty)

    def test_load_kind_is_prompt(self):
        """Prompty is always a Prompty (no kind field — flat model)."""
        agent = load(PROMPTS / "minimal.prompty")
        assert isinstance(agent, Prompty)

    def test_load_missing_file(self):
        """FileNotFoundError for non-existent files."""
        with pytest.raises(FileNotFoundError):
            load(PROMPTS / "nonexistent.prompty")

    def test_load_no_model(self):
        """A prompt with no model specified still loads."""
        agent = load(PROMPTS / "no_model.prompty")
        assert agent.name == "no-model"
        assert agent.model is not None  # model provides a default


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
        """Thread-kind input is declared in inputs."""
        agent = load(PROMPTS / "threaded.prompty")
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions
        assert "{{conversation}}" in agent.instructions
        # thread-kind input should be in the inputs list
        assert len(agent.inputs) > 0
        thread_props = [p for p in agent.inputs if p.kind == "thread"]
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
            assert agent.model.provider == "foundry"
            assert agent.model.api_type == "chat"
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
            assert conn.api_key == "test-key-123"
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
            assert opts.max_output_tokens == 1000
        finally:
            del os.environ["AZURE_OPENAI_ENDPOINT"]
            del os.environ["AZURE_OPENAI_API_KEY"]


# ---------------------------------------------------------------------------
# Input/Output Schema
# ---------------------------------------------------------------------------


class TestSchema:
    def test_load_input_schema(self):
        """inputs loaded from basic.prompty."""
        os.environ["AZURE_OPENAI_ENDPOINT"] = "https://test.openai.azure.com/"
        os.environ["AZURE_OPENAI_API_KEY"] = "test-key-123"
        try:
            agent = load(PROMPTS / "basic.prompty")
            assert len(agent.inputs) > 0
            props = agent.inputs
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
            assert len(agent.inputs) > 0
            props = {p.name: p for p in agent.inputs}
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
        assert len(tool.parameters) > 0

    def test_load_tools_function_params(self):
        """FunctionTool parameters have correct properties."""
        agent = load(PROMPTS / "tools_function.prompty")
        tool = agent.tools[0]
        assert isinstance(tool, FunctionTool)
        param_names = [p.name for p in tool.parameters]
        assert "location" in param_names

    def test_load_tools_mcp(self):
        """McpTool loads with serverName and connection."""
        agent = load(PROMPTS / "tools_mcp.prompty")
        assert agent.tools is not None
        assert len(agent.tools) == 1
        tool = agent.tools[0]
        assert isinstance(tool, McpTool)
        assert tool.name == "filesystem"
        assert tool.server_name == "filesystem-server"
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
            assert conn.api_key == "resolved-key"
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
        assert len(agent.inputs) > 0
        props = agent.inputs
        assert len(props) == 1
        assert props[0].name == "question"

    def test_load_file_not_found_raises(self):
        """Missing file reference raises FileNotFoundError."""
        # Create a temp prompty that references a nonexistent file
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".prompty", delete=False, dir=PROMPTS) as f:
            f.write("---\nname: bad-ref\ninputs: ${file:nonexistent.json}\n---\nHello\n")
            tmp_path = f.name
        try:
            with pytest.raises(FileNotFoundError, match="not found"):
                load(tmp_path)
        finally:
            os.unlink(tmp_path)

    def test_load_file_traversal_outside_prompt_dir_raises(self, tmp_path: Path):
        """${file:../...} references outside the prompt directory are rejected by default."""
        prompt_dir = tmp_path / "prompts"
        prompt_dir.mkdir()
        (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")
        prompt = prompt_dir / "bad.prompty"
        prompt.write_text('---\nname: bad\ndescription: "${file:../secret.txt}"\n---\nHello\n', encoding="utf-8")

        with pytest.raises(ValueError, match="outside allowed roots"):
            load(prompt)

    def test_load_file_absolute_path_outside_prompt_dir_raises(self, tmp_path: Path):
        """Absolute ${file:...} references outside the prompt directory are rejected by default."""
        prompt_dir = tmp_path / "prompts"
        prompt_dir.mkdir()
        secret = tmp_path / "secret.txt"
        secret.write_text("secret", encoding="utf-8")
        prompt = prompt_dir / "bad.prompty"
        prompt.write_text(
            f'---\nname: bad\ndescription: "${{file:{secret.as_posix()}}}"\n---\nHello\n',
            encoding="utf-8",
        )

        with pytest.raises(ValueError, match="outside allowed roots"):
            load(prompt)

    def test_load_file_allowed_root_permits_shared_file(self, tmp_path: Path):
        """allowed_file_roots opts into shared files outside the prompt directory."""
        prompt_dir = tmp_path / "prompts"
        shared_dir = tmp_path / "shared"
        prompt_dir.mkdir()
        shared_dir.mkdir()
        (shared_dir / "description.txt").write_text("shared description", encoding="utf-8")
        prompt = prompt_dir / "shared.prompty"
        prompt.write_text(
            '---\nname: shared\ndescription: "${file:../shared/description.txt}"\n---\nHello\n',
            encoding="utf-8",
        )

        agent = load(prompt, allowed_file_roots=[shared_dir])

        assert agent.description == "shared description"

    def test_load_file_symlink_escape_raises(self, tmp_path: Path):
        """Symlinks inside the prompt directory cannot escape allowed roots."""
        prompt_dir = tmp_path / "prompts"
        prompt_dir.mkdir()
        secret = tmp_path / "secret.txt"
        secret.write_text("secret", encoding="utf-8")
        link = prompt_dir / "secret-link.txt"
        try:
            link.symlink_to(secret)
        except OSError as exc:
            pytest.skip(f"symlinks are not available: {exc}")

        prompt = prompt_dir / "bad.prompty"
        prompt.write_text('---\nname: bad\ndescription: "${file:secret-link.txt}"\n---\nHello\n', encoding="utf-8")

        with pytest.raises(ValueError, match="outside allowed roots"):
            load(prompt)


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
        assert conn.api_key == "shared-key"

    def test_load_shared_connection_kind(self):
        """Shared connection resolves to correct kind."""
        agent = load(PROMPTS / "config_cascade.prompty")
        assert agent.model.connection is not None
        assert agent.model.connection.kind == "key"


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
        """Empty frontmatter (---\\n---) produces a valid Prompty."""
        agent = load(PROMPTS / "shorthand_empty_frontmatter.prompty")
        assert isinstance(agent, Prompty)
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions

    def test_body_only(self):
        """File with no frontmatter at all still loads."""
        agent = load(PROMPTS / "shorthand_body_only.prompty")
        assert isinstance(agent, Prompty)
        assert agent.instructions is not None
        assert "answers questions concisely" in agent.instructions

    def test_quick_prompt(self):
        """Compact prompt with model string + inline inputs."""
        agent = load(PROMPTS / "shorthand_quick.prompty")
        assert agent.name == "quick-prompt"
        assert agent.model.id == "gpt-4o-mini"
        assert len(agent.inputs) > 0
        props = agent.inputs
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
        assert agent.model is not None  # Prompty.load() provides default Model
        assert agent.model.id == ""
        assert len(agent.inputs) == 0
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions

    def test_shorthand_threaded(self):
        """Shorthand prompt with thread-kind input."""
        agent = load(PROMPTS / "shorthand_threaded.prompty")
        assert agent.model.id == "gpt-4o"
        assert agent.instructions is not None
        assert "helpful assistant" in agent.instructions
        assert "{{conversation}}" in agent.instructions
        assert agent.inputs is not None
        thread_props = [p for p in agent.inputs if p.kind == "thread"]
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
        assert isinstance(agent, Prompty)
        assert agent.name == "minimal"
        assert agent.model.id == "gpt-4"

    @pytest.mark.asyncio
    async def test_load_async_missing_file(self):
        """Async load raises FileNotFoundError for missing files."""
        from prompty import load_async

        with pytest.raises(FileNotFoundError):
            await load_async(PROMPTS / "nonexistent.prompty")
