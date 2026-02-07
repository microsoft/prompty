# Prompty v2 — Complete Rebuild Plan

## Overview

Prompty is being rebuilt from the ground up. The type system that originated in Prompty's TypeSpec specification has been extracted into [AgentSchema](https://microsoft.github.io/AgentSchema/) as the canonical, lower-level type layer. Prompty v2 takes a dependency on the `agentschema` Python package and builds its runtime on top.

**Core principle**: Prompty is a markdown file format (`.prompty`) for LLM prompts. The frontmatter uses AgentSchema's PromptAgent schema. The markdown body becomes `instructions`. The runtime loads, renders, parses, and executes prompts.

### What Prompty Uses from AgentSchema

Only the PromptAgent subset — not the full spec:

| AgentSchema Type                                           | Prompty Uses                                        |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `PromptAgent`                                              | Yes — the loaded `.prompty` file becomes this       |
| `Model`                                                    | Yes — model configuration                           |
| `Connection` (all subtypes)                                | Yes — auth/endpoint config                          |
| `ModelOptions`                                             | Yes — temperature, maxOutputTokens, etc.            |
| `Template` / `Format` / `Parser`                           | Yes — template engine config                        |
| `PropertySchema` / `Property`                              | Yes — inputSchema/outputSchema                      |
| `FunctionTool`                                             | Yes — local function calling                        |
| `McpTool`                                                  | Yes — MCP server integration                        |
| `OpenApiTool`                                              | Yes — API-based tools                               |
| `CustomTool`                                               | Yes — wildcard `*` catch-all for unknown tool kinds |
| `Workflow`                                                 | No                                                  |
| `ContainerAgent`                                           | No                                                  |
| `AgentManifest`                                            | No                                                  |
| `WebSearchTool` / `FileSearchTool` / `CodeInterpreterTool` | No                                                  |

### Key Design Decisions

1. **`agentschema` is a pip dependency** — no code generation, no TypeSpec in Prompty repo
2. **No `kind` in `.prompty` files** — the loader injects `kind: "prompt"` since Prompty only produces PromptAgents
3. **Markdown body → `instructions`** — the loader splits frontmatter/body and sets `agent.instructions = body`
4. **Legacy migration in the loader** — old-format `.prompty` files still load with deprecation warnings
5. **Invoker pattern retained** — Renderer → Parser → Executor → Processor pipeline, redesigned in Phase 2
6. **Use `uv` exclusively** for all Python environment and package management. Never use `pip`, `pip install`, `python -m pip`, or `python -m venv` directly. Use `uv venv`, `uv pip install`, `uv run`, etc. instead.
7. **Use `AgentDefinition.load(data, ctx)`** — not `PromptAgent.load()`. `AgentDefinition.load()` dispatches on `kind` via `load_kind()` to create a `PromptAgent`, then populates base fields (`name`, `metadata`, `inputSchema`, `outputSchema`, `description`, `displayName`). `PromptAgent.load()` only handles prompt-specific fields (`model`, `tools`, `template`, `instructions`)
8. **`Property` has `default` and `example`** — not `value`. The `value` field mentioned in early specs does not exist in agentschema. Use `default` for sample/default values
9. **`${protocol:value}` expansion via `LoadContext.pre_process`** — agentschema's `LoadContext(pre_process=fn)` walks every dict in the tree, calling `fn(dict)` → mutated dict. This is the ideal hook for resolving `${env:VAR}`, `${file:path}`, etc. without a separate recursive pass

---

## Python Coding Rules

### Environment & Tooling

- **Python ≥ 3.11** — use modern syntax: `X | Y` unions, `match`/`case`, `ExceptionGroup`, `type` aliases.
- **`uv` exclusively** — never use `pip`, `pip install`, `python -m pip`, or `python -m venv`. Use `uv venv`, `uv pip install`, `uv run`, etc. Package installs: `uv pip install -e ".[dev,all]"`.
- **Flit build system** — `flit_core >=3.11,<4`. Version is dynamic via `_version.py`.
- **Ruff** for linting and formatting. Config lives in `pyproject.toml`:
  - Line length: **120**
  - Target: `py311`
  - Rules: `E`, `F`, `I` (isort), `UP` (pyupgrade)
  - `E501` (line too long) is **ignored** (handled by formatter)
  - `__init__.py` files ignore `F401` (unused imports — they're re-exports)
  - `tests/test_otel.py` ignores `E402` (imports not at top — conditional skip)
  - Run: `uv run ruff check .` and `uv run ruff format .`

### Code Style

- **`from __future__ import annotations`** — include at the top of every module for PEP 604 style annotations.
- **Type hints everywhere** — all function signatures, return types, and class attributes must be annotated. Use `from typing import Any` sparingly; prefer specific types.
- **Docstrings** — every module gets a module-level docstring explaining purpose and registration key (if applicable). Use imperative mood. Public functions & classes get docstrings; private helpers may omit them.
- **`__all__`** — define in modules that export public API (especially `core/pipeline.py`, `core/discovery.py`). Not needed in `__init__.py` re-export files.
- **Private names** — prefix internal helpers with `_` (e.g., `_message_to_wire`, `_build_options`). These can still be imported across sibling modules within the package but signal "not public API".
- **No bare `except:`** — always catch specific exceptions. Use `except Exception:` at minimum.
- **f-strings preferred** over `%` formatting or `.format()`.
- **Constants** — `UPPER_SNAKE_CASE`, defined at module level (e.g., `ROLES`, `RICH_KINDS`, `THREAD_NONCE_PREFIX`).

### Imports

- **Internal code uses relative imports**:

  ```python
  # Inside core/pipeline.py
  from .types import Message
  from .discovery import get_renderer
  from ..tracing.tracer import trace

  # Inside providers/azure/executor.py (3 dots = up to prompty/)
  from ..._version import VERSION
  from ...core.types import Message
  from ..openai.executor import _build_options, _message_to_wire
  ```

- **Tests use absolute imports** from the package:
  ```python
  from prompty.core.types import Message, TextPart
  from prompty.providers.openai.executor import OpenAIExecutor
  from prompty.tracing.tracer import Tracer, trace
  ```
- **Users import from `prompty` directly** — everything is re-exported at the top:
  ```python
  from prompty import load, prepare, run, Message, Tracer, trace
  ```
- **Sort order** enforced by ruff's `I` (isort) rule: stdlib → third-party → local, alphabetized within groups.
- **Lazy imports for optional deps** — `openai`, `jinja2`, `chevron`, `azure.identity` are imported inside functions/methods, not at module top level, so the package works without them installed:
  ```python
  def execute(self, agent, messages):
      from openai import OpenAI  # lazy — only needed when actually called
  ```

### Async Conventions

- Every public pipeline function has a sync and async variant: `prepare()` / `prepare_async()`, `run()` / `run_async()`.
- Protocol classes define both `render()` / `render_async()`, `parse()` / `parse_async()`, etc.
- Use `aiofiles` for async file I/O (e.g., `load_prompty_async`).
- Use `pytest-asyncio` for async tests.

### Testing

- All tests in `runtime/python/prompty/tests/`.
- Run: `.venv/Scripts/python.exe -m pytest tests/ -q` or `uv run pytest tests/ -q`.
- **Mock external services** — never make real API calls. Use `unittest.mock.patch` to mock SDK clients.
- **Mock entry points** for discovery tests: patch `prompty.core.discovery.importlib.metadata.entry_points`.
- Test file naming: `test_<module>.py` — mirrors the module it tests.
- Fixtures and `.prompty` test files live in `tests/prompts/`.
- **Coverage**: `pytest-cov` available; `[tool.coverage.report] show_missing = true`.

### Package Management

- **Required deps**: `agentschema`, `pyyaml`, `python-dotenv`, `aiofiles`.
- **Optional deps** via extras: `[jinja2]`, `[mustache]`, `[openai]`, `[azure]`, `[otel]`, `[all]`, `[dev]`.
- **Never add optional deps to `dependencies`** — they go in `[project.optional-dependencies]`.
- **Entry points** register invokers for pluggable discovery — always update `pyproject.toml` when adding a new renderer, parser, executor, or processor.
- After changing entry points, reinstall: `uv pip install -e ".[dev,all]"`.

### Error Handling

- Raise `InvokerError` (from `core/discovery.py`) for missing invoker registrations.
- Raise `ValueError` for invalid `.prompty` frontmatter, missing env vars without defaults.
- Raise `FileNotFoundError` for missing `.prompty` files or `${file:...}` references.
- Emit `warnings.warn("...", DeprecationWarning)` for legacy property migrations — never silently swallow old formats.

---

## Architecture

### How a `.prompty` File is Processed

```
.prompty file
     │
     ▼
utils.parse()              Split frontmatter (YAML) from body (markdown)
     │                     Returns dict with body as 'instructions' key
     ▼
_migrate_legacy()          Convert old property names → AgentSchema names
     │                     (with deprecation warnings)
     ▼
Handle ![thread]           Split instructions / additionalInstructions
     │
     ▼
Inject kind: "prompt"      Always — .prompty files are PromptAgents
     │
     ▼
AgentDefinition.load(      Uses LoadContext(pre_process=...) for ${} expansion
  data, ctx)               Resolves ${env:VAR}, ${file:path} in every dict
     │                     Dispatches on kind → PromptAgent, populates ALL fields
     ▼
PromptAgent                Fully typed: .instructions, .model, .tools,
                           .inputSchema, .outputSchema, .template, .metadata
```

### Execution Pipeline (Phases 2-3)

```
PromptAgent
     │
     ▼
  Renderer                 Jinja2 or Mustache: render instructions with inputs
     │
     ▼
  Parser                   Convert role markers (system:/user:/assistant:) → message list
     │
     ▼
  Executor                 Call LLM provider (OpenAI, Azure OpenAI, etc.)
     │
     ▼
  Processor                Extract content/tool_calls from response
     │
     ▼
  Result
```

---

## Repository Structure (After Cleanup)

### What Gets Deleted

| Path                                 | Reason                                  |
| ------------------------------------ | --------------------------------------- |
| `specification/` (entire directory)  | TypeSpec + emitter moved to AgentSchema |
| `runtime/csharp/` (entire directory) | Auto-generated from same TypeSpec       |

### What Stays

```
prompty/
├── .github/
│   └── copilot-instructions.md      # THIS FILE — the plan
├── Prompty.yaml                      # Legacy JSON Schema (update later)
├── runtime/
│   ├── prompty/                      # OLD Python runtime — kept as reference during rebuild
│   │   └── prompty/
│   │       ├── core.py               # Old dataclasses (Prompty, ModelProperty, etc.)
│   │       ├── invoker.py            # Old invoker pattern (Invoker, InvokerFactory, etc.)
│   │       ├── parsers.py            # Old PromptyChatParser
│   │       ├── renderers.py          # Old Jinja2Renderer, MustacheRenderer
│   │       ├── tracer.py             # Tracing (also in new runtime)
│   │       └── ...
│   ├── python/                       # NEW Python runtime — the rebuild target
│   │   └── prompty/
│   │       ├── pyproject.toml        # Package config, deps, entry points
│   │       ├── tests/                # All test files
│   │       └── prompty/              # The package — see "Python Package Layout" below
│   ├── promptycs/                    # Hand-written C# runtime (separate migration)
│   └── promptyjs/                    # Hand-written JS runtime (separate migration)
├── vscode/prompty/                   # VS Code extension
└── web/                              # Documentation site
```

---

## Python Package Layout

All source code lives under `runtime/python/prompty/prompty/`. The package is organized
into subpackages by responsibility:

```
prompty/                              # runtime/python/prompty/prompty/
├── __init__.py                       # Public API — re-exports everything users need
├── _version.py                       # VERSION = "2.0.0.dev0"
├── invoker.py                        # Backward-compat re-export shim (see below)
│
├── core/                             # Infrastructure & pipeline logic
│   ├── __init__.py                   # Re-exports from all core submodules
│   ├── loader.py                     # load(), load_async() → PromptAgent
│   ├── migration.py                  # Legacy v1 → v2 frontmatter migration
│   ├── utils.py                      # Frontmatter parsing, file I/O helpers
│   ├── types.py                      # Message, ContentPart, TextPart, ImagePart, etc.
│   ├── protocols.py                  # RendererProtocol, ParserProtocol, ExecutorProtocol, ProcessorProtocol
│   ├── discovery.py                  # Entry-point-based invoker lookup, InvokerError
│   └── pipeline.py                   # prepare(), execute(), process(), run(), validate_inputs()
│
├── renderers/                        # Template engine implementations
│   ├── __init__.py                   # Re-exports Jinja2Renderer, MustacheRenderer
│   ├── _common.py                    # Shared: THREAD_NONCE_PREFIX, _prepare_render_inputs()
│   ├── jinja2.py                     # Jinja2Renderer (optional dep: jinja2)
│   └── mustache.py                   # MustacheRenderer (optional dep: chevron)
│
├── parsers/                          # Format parser implementations
│   ├── __init__.py                   # Re-exports PromptyChatParser
│   └── prompty.py                    # PromptyChatParser — role markers → Message list
│
├── providers/                        # LLM provider implementations
│   ├── __init__.py                   # Docstring explaining how to add a provider
│   ├── openai/                       # OpenAI provider
│   │   ├── __init__.py               # Re-exports OpenAIExecutor, OpenAIProcessor, ToolCall
│   │   ├── executor.py               # OpenAIExecutor + shared wire-format helpers
│   │   └── processor.py              # OpenAIProcessor + ToolCall + shared response processing
│   └── azure/                        # Azure OpenAI provider
│       ├── __init__.py               # Re-exports AzureExecutor, AzureProcessor
│       ├── executor.py               # AzureExecutor (imports wire helpers from openai)
│       └── processor.py              # AzureProcessor (imports processing from openai)
│
└── tracing/                          # Observability
    ├── __init__.py                   # Re-exports tracer symbols
    ├── tracer.py                     # Tracer registry, @trace decorator, PromptyTracer, console_tracer
    └── otel.py                       # OpenTelemetry backend (optional dep: opentelemetry-api)
```

### Module Responsibilities

#### `core/` — Infrastructure

| Module         | What it does                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `loader.py`    | `load()` / `load_async()` — parse `.prompty` file → `PromptAgent`. Handles frontmatter, `${env:}`, `${file:}`.           |
| `migration.py` | `_migrate_legacy()` — converts v1 property names to v2 AgentSchema names with deprecation warnings.                      |
| `utils.py`     | `parse()` — regex frontmatter/body split. `load_prompty()`, `load_text()`, `load_json()` file helpers.                   |
| `types.py`     | `Message`, `TextPart`, `ImagePart`, `AudioPart`, `FilePart`, `ContentPart`, `ThreadMarker`, `ROLES`.                     |
| `protocols.py` | Protocol classes defining the interfaces: `RendererProtocol`, `ParserProtocol`, `ExecutorProtocol`, `ProcessorProtocol`. |
| `discovery.py` | Entry-point-based lookup: `get_renderer()`, `get_parser()`, `get_executor()`, `get_processor()`, `clear_cache()`.        |
| `pipeline.py`  | `prepare()`, `execute()`, `process()`, `run()` — orchestrates renderer→parser→executor→processor.                        |

#### `renderers/` — Template Engines

| Module        | What it does                                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| `_common.py`  | `THREAD_NONCE_PREFIX`, `_prepare_render_inputs()` — shared rendering helpers. |
| `jinja2.py`   | `Jinja2Renderer` — renders `agent.instructions` with inputs via Jinja2.       |
| `mustache.py` | `MustacheRenderer` — renders via Chevron (Mustache).                          |

#### `parsers/` — Format Parsers

| Module       | What it does                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `prompty.py` | `PromptyChatParser` — splits role markers (`system:`, `user:`, `assistant:`) → `list[Message]`. |

#### `providers/` — LLM Providers

Each provider is a subpackage with `executor.py` and `processor.py`:

| Provider  | Executor         | Processor         | Registration Key | SDK                         |
| --------- | ---------------- | ----------------- | ---------------- | --------------------------- |
| `openai/` | `OpenAIExecutor` | `OpenAIProcessor` | `openai`         | `openai` package            |
| `azure/`  | `AzureExecutor`  | `AzureProcessor`  | `azure`          | `openai` + `azure-identity` |

**Shared code**: Wire-format helpers (`_message_to_wire`, `_part_to_wire`, `_tools_to_wire`, `_build_options`,
`_schema_to_wire`) live in `providers/openai/executor.py` since Azure uses the same OpenAI SDK. The Azure
executor imports these directly. Similarly, `_process_response` lives in `providers/openai/processor.py` and
is imported by the Azure processor.

**Adding a new provider** (e.g. Anthropic):

1. Create `providers/anthropic/` with `__init__.py`, `executor.py`, `processor.py`
2. Implement `AnthropicExecutor.execute()` / `execute_async()` and `AnthropicProcessor.process()` / `process_async()`
3. Register entry points in `pyproject.toml`:

   ```toml
   [project.entry-points."prompty.executors"]
   anthropic = "prompty.providers.anthropic.executor:AnthropicExecutor"

   [project.entry-points."prompty.processors"]
   anthropic = "prompty.providers.anthropic.processor:AnthropicProcessor"
   ```

4. Add optional dependency: `anthropic = ["anthropic"]`

#### `tracing/` — Observability

| Module      | What it does                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- |
| `tracer.py` | `Tracer` registry, `@trace` decorator, `PromptyTracer` (JSON file backend), `console_tracer`. |
| `otel.py`   | `otel_tracer()` — OpenTelemetry span backend. Optional dep: `opentelemetry-api`.              |

### Top-level Files

| File          | What it does                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `__init__.py` | Public API surface — re-exports everything users need from subpackages. `from prompty import X` works.                                                 |
| `_version.py` | `VERSION = "2.0.0.dev0"` — read by flit for package version.                                                                                           |
| `invoker.py`  | Backward-compatibility shim. Re-exports from `core.protocols`, `core.discovery`, `core.pipeline` so `from prompty.invoker import prepare` still works. |

### Entry Points (in `pyproject.toml`)

The invoker discovery system uses Python entry points to find implementations at runtime:

```toml
[project.entry-points."prompty.renderers"]
jinja2 = "prompty.renderers.jinja2:Jinja2Renderer"
mustache = "prompty.renderers.mustache:MustacheRenderer"

[project.entry-points."prompty.parsers"]
prompty = "prompty.parsers.prompty:PromptyChatParser"

[project.entry-points."prompty.executors"]
openai = "prompty.providers.openai.executor:OpenAIExecutor"
azure = "prompty.providers.azure.executor:AzureExecutor"

[project.entry-points."prompty.processors"]
openai = "prompty.providers.openai.processor:OpenAIProcessor"
azure = "prompty.providers.azure.processor:AzureProcessor"
```

### Import Conventions

**For users** — import from `prompty` directly:

```python
from prompty import load, prepare, run, Tracer, trace, Message
```

**For internal code** — use relative imports within the package:

```python
# Inside core/pipeline.py
from .types import Message
from .discovery import get_renderer
from ..tracing.tracer import trace

# Inside providers/azure/executor.py
from ..._version import VERSION
from ...core.types import Message
from ..openai.executor import _build_options, _message_to_wire
from ...tracing.tracer import Tracer, trace
```

**For tests** — import from the specific submodule:

```python
from prompty.core.types import Message, TextPart
from prompty.providers.openai.executor import OpenAIExecutor, _message_to_wire
from prompty.tracing.tracer import Tracer, trace
```

### Test Files

All tests live in `runtime/python/prompty/tests/`:

| Test File           | What it covers                                         |
| ------------------- | ------------------------------------------------------ |
| `test_loader.py`    | `.prompty` file loading, frontmatter, legacy migration |
| `test_invoker.py`   | Protocols, discovery, pipeline, thread markers         |
| `test_renderers.py` | Jinja2 and Mustache template rendering                 |
| `test_parsers.py`   | Role marker parsing → Message list                     |
| `test_executor.py`  | OpenAI/Azure executor wire format (mocked API)         |
| `test_processor.py` | Response extraction — chat, embedding, streaming       |
| `test_tracer.py`    | Tracer registry, @trace decorator, PromptyTracer       |
| `test_otel.py`      | OpenTelemetry backend (skipped if otel not installed)  |

Run tests: `uv run pytest tests/ -q` (or `.venv/Scripts/python -m pytest tests/ -q`)

### Dependencies

**Required**: `agentschema`, `pyyaml`, `python-dotenv`, `aiofiles`

**Optional** (install via extras):

| Extra      | Packages                           | What it enables           |
| ---------- | ---------------------------------- | ------------------------- |
| `jinja2`   | `jinja2`                           | Jinja2 template rendering |
| `mustache` | `chevron`                          | Mustache rendering        |
| `openai`   | `openai`                           | OpenAI provider           |
| `azure`    | `openai`, `azure-identity`         | Azure OpenAI provider     |
| `otel`     | `opentelemetry-api>=1.20`          | OTel tracing backend      |
| `all`      | All of the above                   | Everything                |
| `dev`      | pytest, ruff, type stubs, otel-sdk | Development               |

Install: `uv pip install -e ".[dev,all]"`

---

## PHASE 1: Redo the Loader

### Goal

`load("path/to/file.prompty")` returns a typed `PromptAgent` from `agentschema`.

### Files to Create/Modify

#### 1. Update `runtime/python/prompty/pyproject.toml`

```toml
[project]
name = "prompty"
dynamic = ["version"]
description = "Prompty is an asset class and format for LLM prompts"
requires-python = ">=3.11"
dependencies = [
    "agentschema",
    "pyyaml",
    "python-dotenv",
    "aiofiles",
]

[build-system]
requires = ["flit_core >=3.2,<4"]
build-backend = "flit_core.buildapi"

[tool.flit.module]
path = "prompty"

[project.optional-dependencies]
jinja2 = ["jinja2"]
mustache = ["chevron"]
openai = ["openai"]
azure = ["openai", "azure-identity"]
all = ["jinja2", "chevron", "openai", "azure-identity"]
```

No `[project.scripts]` — CLI comes later.

#### 2. Create `prompty/loader.py`

Public API:

- `load(path: str | Path) -> PromptAgent`
- `load_async(path: str | Path) -> PromptAgent`

Internal helpers:

- `_migrate_legacy(data: dict) -> dict` — deprecation conversions
- `_pre_process(agent_file: Path) -> Callable` — returns a `LoadContext.pre_process` callback for `${env:}` and `${file:}` resolution

**Loading flow**:

```python
from agentschema import AgentDefinition, LoadContext, PromptAgent

def load(path: str | Path) -> PromptAgent:
    path = Path(path).resolve()

    # 1. Split frontmatter + body (existing util)
    data = load_prompty(path)  # returns dict with 'instructions' from body

    # 2. Migrate legacy property names
    data = _migrate_legacy(data)

    # 3. Handle ![thread] separator
    if "instructions" in data and isinstance(data["instructions"], str):
        if "\n![thread]" in data["instructions"]:
            parts = data["instructions"].split("\n![thread]", 1)
            data["instructions"] = parts[0]
            data["additionalInstructions"] = parts[1].lstrip("\n")

    # 4. Inject kind (Prompty files are always PromptAgents)
    data["kind"] = "prompt"

    # 5. Load via agentschema with pre_process for ${} expansion
    ctx = LoadContext(pre_process=_pre_process(path))
    agent = AgentDefinition.load(data, ctx)
    assert isinstance(agent, PromptAgent)
    return agent
```

**Legacy migration** (`_migrate_legacy`):

| Old Property                               | New Property                                                            | Notes                                |
| ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------ |
| `model.configuration`                      | `model.connection`                                                      | Rename                               |
| `model.configuration.type: "azure_openai"` | `model.provider: "azure"` + `model.connection.kind: "key"`              | Split                                |
| `model.configuration.type: "openai"`       | `model.provider: "openai"` + `model.connection.kind: "key"`             | Split                                |
| `model.configuration.azure_endpoint`       | `model.connection.endpoint`                                             | Rename                               |
| `model.configuration.azure_deployment`     | `model.id`                                                              | Move up                              |
| `model.configuration.api_key`              | `model.connection.apiKey`                                               | camelCase                            |
| `model.configuration.name` (OpenAI model)  | `model.id`                                                              | Move up                              |
| `model.parameters`                         | `model.options`                                                         | Rename                               |
| `model.parameters.max_tokens`              | `model.options.maxOutputTokens`                                         | Rename                               |
| `model.parameters.top_p`                   | `model.options.topP`                                                    | camelCase                            |
| `model.parameters.frequency_penalty`       | `model.options.frequencyPenalty`                                        | camelCase                            |
| `model.parameters.presence_penalty`        | `model.options.presencePenalty`                                         | camelCase                            |
| `model.parameters.stop`                    | `model.options.stopSequences`                                           | Rename                               |
| `model.api`                                | `model.apiType`                                                         | Rename                               |
| `model.parameters.tools`                   | top-level `tools`                                                       | Move out of model                    |
| `inputs` (dict/list)                       | `inputSchema.properties`                                                | Restructure                          |
| `inputs.X.type`                            | `inputSchema.properties.X.kind`                                         | `type` → `kind`                      |
| `inputs.X.sample`                          | `inputSchema.properties.X.default`                                      | `sample` → `default`                 |
| `outputs`                                  | `outputSchema`                                                          | Rename                               |
| Root `authors`                             | `metadata.authors`                                                      | Move into metadata                   |
| Root `tags`                                | `metadata.tags`                                                         | Move into metadata                   |
| Root `version`                             | `metadata.version`                                                      | Move into metadata                   |
| `template: "jinja2"` (string)              | `template: { format: { kind: "jinja2" }, parser: { kind: "prompty" } }` | Restructure                          |
| `template.type`                            | `template.format.kind`                                                  | Nested rename                        |
| `sample` (root)                            | Raise error                                                             | Deprecated, use inputSchema.examples |

Each legacy conversion emits `warnings.warn("...", DeprecationWarning)`.

**Reference resolution** (`_pre_process`):

Uses `LoadContext(pre_process=fn)` — agentschema walks every dict in the tree, calling `fn(dict)` → mutated dict.
This resolves `${env:VAR}`, `${env:VAR:default}`, and `${file:path}` in-place as the tree is loaded.

```python
def _pre_process(agent_file: Path) -> Callable[[Any], Any]:
    def process(data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        for key, value in list(data.items()):
            if not isinstance(value, str) or not value.startswith("${"):
                continue
            if not value.endswith("}"):
                continue
            inner = value[2:-1]
            protocol, _, val = inner.partition(":")
            protocol = protocol.lower()
            if protocol == "env":
                var_name, _, default = val.partition(":")
                env_val = os.environ.get(var_name)
                if env_val is None:
                    if default:
                        data[key] = default
                    else:
                        raise ValueError(f"Environment variable '{var_name}' not set for key '{key}'")
                else:
                    data[key] = env_val
            elif protocol == "file":
                relative_path = (agent_file.parent / val).resolve()
                if not relative_path.exists():
                    raise FileNotFoundError(f"Referenced file '{val}' not found for key '{key}'")
                data[key] = _load_file_content(relative_path)
        return data
    return process
```

#### 3. Update `prompty/__init__.py`

```python
from ._version import VERSION

__version__ = VERSION

# Core API
from .loader import load, load_async

# Re-export key agentschema types for convenience
from agentschema import (
    AgentDefinition,
    PromptAgent,
    Model,
    ModelOptions,
    Connection,
    ApiKeyConnection,
    ReferenceConnection,
    RemoteConnection,
    AnonymousConnection,
    Template,
    Format,
    Parser,
    PropertySchema,
    Property,
    Tool,
    FunctionTool,
    McpTool,
    OpenApiTool,
    CustomTool,
    LoadContext,
    SaveContext,
)

# Tracing
from .tracer import Tracer, trace
```

#### 4. Create Test Fixtures (`tests/prompts/`)

**`basic.prompty`** — new AgentSchema format:

```prompty
---
name: basic-prompt
description: A basic prompt for testing
metadata:
  authors: [testauthor]
model:
  id: gpt-4
  provider: azure
  apiType: chat
  connection:
    kind: key
    endpoint: ${env:AZURE_OPENAI_ENDPOINT}
    apiKey: ${env:AZURE_OPENAI_API_KEY}
  options:
    temperature: 0.7
    maxOutputTokens: 1000
inputSchema:
  properties:
    firstName:
      kind: string
      default: Jane
    lastName:
      kind: string
      default: Doe
    question:
      kind: string
      default: What is the meaning of life?
template:
  format:
    kind: jinja2
  parser:
    kind: prompty
---
system:
You are an AI assistant who helps people find information.

# Customer
You are helping {{firstName}} {{lastName}} to find answers to their questions.

user:
{{question}}
```

**`minimal.prompty`** — bare minimum:

```prompty
---
name: minimal
model: gpt-4
---
system:
Hello world.
```

**`tools_function.prompty`** — with FunctionTool:

```prompty
---
name: function-tools
model:
  id: gpt-4
  apiType: chat
tools:
  - name: get_weather
    kind: function
    description: Get the current weather
    parameters:
      properties:
        location:
          kind: string
          description: City and state
---
system:
You are a helpful assistant with access to tools.

user:
{{question}}
```

**`tools_mcp.prompty`** — with McpTool:

```prompty
---
name: mcp-tools
model:
  id: gpt-4
tools:
  - name: filesystem
    kind: mcp
    connection:
      kind: reference
    serverName: filesystem-server
    approvalMode:
      kind: always
---
system:
You have access to filesystem tools.

user:
{{question}}
```

**`tools_openapi.prompty`** — with OpenApiTool:

```prompty
---
name: openapi-tools
model:
  id: gpt-4
tools:
  - name: weather_api
    kind: openapi
    connection:
      kind: key
      endpoint: https://api.weather.com
    specification: ./weather.openapi.json
---
system:
You can check the weather via API.

user:
{{question}}
```

**`tools_custom.prompty`** — with CustomTool (wildcard `*`):

```prompty
---
name: custom-tools
model:
  id: gpt-4
tools:
  - name: my_custom_tool
    kind: my_provider
    connection:
      kind: key
      endpoint: https://custom.example.com
    options:
      setting: value
---
system:
You have custom tools.

user:
{{question}}
```

**`threaded.prompty`** — with `![thread]` separator:

```prompty
---
name: threaded-chat
model:
  id: gpt-4
inputSchema:
  properties:
    question:
      kind: string
      default: Hello
---
system:
You are a helpful assistant.

![thread]

user:
{{question}}
```

**`legacy_basic.prompty`** — old format for migration testing:

```prompty
---
name: legacy-prompt
description: Tests legacy property migration
version: "1.0"
authors:
  - testauthor
tags:
  - test
model:
  api: chat
  configuration:
    type: azure_openai
    azure_endpoint: ${env:AZURE_OPENAI_ENDPOINT}
    azure_deployment: gpt-35-turbo
    api_key: ${env:AZURE_OPENAI_API_KEY}
  parameters:
    temperature: 0.7
    max_tokens: 500
inputs:
  firstName:
    type: string
    sample: Jane
  lastName: Doe
  question: What is the meaning of life?
template:
  format: jinja2
  parser: prompty
---
system:
You are an AI assistant.

user:
{{question}}
```

#### 5. Create `tests/test_loader.py`

```python
# Tests to implement (each is a separate test function):

# --- Basic loading ---
# test_load_basic: load basic.prompty → assert PromptAgent fields
# test_load_minimal: load minimal.prompty → model shorthand works
# test_load_returns_prompt_agent: isinstance(result, PromptAgent)
# test_load_kind_is_prompt: agent.kind == "prompt"

# --- Instructions ---
# test_load_instructions_from_body: agent.instructions == markdown body
# test_load_thread_separator: instructions split at ![thread]
# test_load_additional_instructions: additionalInstructions populated after ![thread]

# --- Model ---
# test_load_model_shorthand: model: gpt-4 → Model(id="gpt-4")
# test_load_model_full: model with connection, options, provider
# test_load_model_connection: connection.kind, endpoint, apiKey

# --- Input/Output Schema ---
# test_load_input_schema: inputSchema.properties loaded with correct kinds
# test_load_input_values: property values (examples) preserved

# --- Tools ---
# test_load_tools_function: FunctionTool with parameters
# test_load_tools_mcp: McpTool with serverName, connection
# test_load_tools_openapi: OpenApiTool with specification
# test_load_tools_custom: unknown kind → CustomTool

# --- Template ---
# test_load_template: template.format.kind, template.parser.kind

# --- Metadata ---
# test_load_metadata: metadata dict preserved

# --- Reference Resolution ---
# test_load_env_resolution: ${env:VAR} resolved (set os.environ in test)
# test_load_env_default: ${env:VAR:default} fallback works
# test_load_file_resolution: ${file:path} loads file content

# --- Shared Config via ${file:} ---
# test_load_file_shared_config: ${file:shared_connection.json} merges into model connection

# --- Legacy Migration ---
# test_load_legacy_basic: old format loads, produces correct PromptAgent
# test_load_legacy_deprecation_warnings: warnings.warn emitted
# test_load_legacy_configuration_to_connection: model.configuration → connection
# test_load_legacy_parameters_to_options: model.parameters → options
# test_load_legacy_inputs: inputs → inputSchema.properties
# test_load_legacy_template_string: template: jinja2 → structured Template

# --- Error Cases ---
# test_load_missing_file: FileNotFoundError
# test_load_invalid_frontmatter: ValueError for malformed YAML
# test_load_missing_env_var: ValueError when env var not set and no default
```

### Phase 1 Gate

All of the following must pass before moving to Phase 2:

- `pytest tests/test_loader.py` — all green
- `from prompty import load` works
- `load()` returns a `PromptAgent` (from agentschema)
- `agent.instructions` contains the markdown body
- `agent.model` is a typed `Model` object
- `agent.tools` contains typed tool instances (`FunctionTool`, `McpTool`, etc.)
- Legacy `.prompty` files load with deprecation warnings

---

## PHASE 2: Invoker Abstractions (IMPLEMENTED)

### Design

The invoker system uses **Protocol classes** (not ABCs) for the four pipeline stages, with
**entry-point-based discovery** replacing the old `InvokerFactory` decorator pattern:

| Component | Protocol            | Defined in          | Discovery Key                |
| --------- | ------------------- | ------------------- | ---------------------------- |
| Renderer  | `RendererProtocol`  | `core/protocols.py` | `agent.template.format.kind` |
| Parser    | `ParserProtocol`    | `core/protocols.py` | `agent.template.parser.kind` |
| Executor  | `ExecutorProtocol`  | `core/protocols.py` | `agent.model.provider`       |
| Processor | `ProcessorProtocol` | `core/protocols.py` | `agent.model.provider`       |

**Discovery** (`core/discovery.py`): Uses `importlib.metadata.entry_points()` to look up
implementations registered under `prompty.renderers`, `prompty.parsers`, `prompty.executors`,
`prompty.processors` entry point groups. Results are cached; `clear_cache()` resets.

**Pipeline** (`core/pipeline.py`): Orchestrates the full flow:

- `prepare(agent, inputs)` → render + parse → `list[Message]`
- `execute(agent, messages)` → call LLM → raw response
- `process(agent, response)` → extract content → final result
- `run(agent, inputs)` → prepare + execute + process
- `validate_inputs(agent, inputs)` → check required inputs
- All have `_async` variants

**Backward compatibility**: `prompty/invoker.py` re-exports everything from `core.protocols`,
`core.discovery`, and `core.pipeline` so `from prompty.invoker import prepare` still works.

### Implemented Files

| File                        | Contents                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `prompty/core/protocols.py` | `RendererProtocol`, `ParserProtocol`, `ExecutorProtocol`, `ProcessorProtocol`                          |
| `prompty/core/discovery.py` | `get_renderer()`, `get_parser()`, `get_executor()`, `get_processor()`, `clear_cache()`, `InvokerError` |
| `prompty/core/pipeline.py`  | `prepare()`, `execute()`, `process()`, `run()`, `validate_inputs()` + async variants                   |
| `prompty/invoker.py`        | Backward-compat shim — re-exports from `core.*` submodules                                             |
| `tests/test_invoker.py`     | Protocol conformance, discovery, pipeline composition, thread markers                                  |

---

## PHASE 3: Concrete Implementations (IMPLEMENTED)

### Implemented Invokers

| Invoker             | Type      | Registration Key | Location                                | Optional Dep               |
| ------------------- | --------- | ---------------- | --------------------------------------- | -------------------------- |
| `Jinja2Renderer`    | Renderer  | `jinja2`         | `prompty/renderers/jinja2.py`           | `jinja2`                   |
| `MustacheRenderer`  | Renderer  | `mustache`       | `prompty/renderers/mustache.py`         | `chevron`                  |
| `PromptyChatParser` | Parser    | `prompty`        | `prompty/parsers/prompty.py`            | —                          |
| `OpenAIExecutor`    | Executor  | `openai`         | `prompty/providers/openai/executor.py`  | `openai`                   |
| `AzureExecutor`     | Executor  | `azure`          | `prompty/providers/azure/executor.py`   | `openai`, `azure-identity` |
| `OpenAIProcessor`   | Processor | `openai`         | `prompty/providers/openai/processor.py` | `openai`                   |
| `AzureProcessor`    | Processor | `azure`          | `prompty/providers/azure/processor.py`  | `openai`, `azure-identity` |

### Implemented Test Files

| File                      | What it covers                                   |
| ------------------------- | ------------------------------------------------ |
| `tests/test_renderers.py` | Jinja2 and Mustache template rendering           |
| `tests/test_parsers.py`   | Role marker parsing → Message list               |
| `tests/test_executor.py`  | OpenAI/Azure executor wire format (mocked API)   |
| `tests/test_processor.py` | Response extraction — chat, embedding, streaming |

### High-Level Public API

```python
from prompty import load, prepare, run

# Load only
agent = load("path/to/prompt.prompty")

# Load + render + parse (no LLM call)
messages = prepare("path/to/prompt.prompty", inputs={"name": "Jane"})

# Load + render + parse + execute + process
result = run("path/to/prompt.prompty", inputs={"name": "Jane"})

# Async variants
agent = await load_async("path/to/prompt.prompty")
messages = await prepare_async("path/to/prompt.prompty", inputs={"name": "Jane"})
result = await run_async("path/to/prompt.prompty", inputs={"name": "Jane"})
```

---

## .prompty File Format (v2)

### Structure

```prompty
---
# YAML frontmatter — AgentSchema PromptAgent properties (minus kind and instructions)
---
# Markdown body — becomes 'instructions' on the PromptAgent
# Uses role markers and template syntax (Jinja2 or Mustache)
```

### Valid Frontmatter Properties

**Root level**:
`name`, `displayName`, `description`, `metadata`, `model`, `inputSchema`, `outputSchema`, `tools`, `template`, `additionalInstructions`

**Model** (`model:` or shorthand `model: gpt-4`):
`id`, `provider`, `apiType`, `connection`, `options`

**Connection** (`model.connection:`):
`kind` (`key` | `reference` | `remote` | `anonymous`), `endpoint`, `apiKey`, `name`, `target`, `authenticationMode`

**ModelOptions** (`model.options:`):
`temperature`, `maxOutputTokens`, `frequencyPenalty`, `presencePenalty`, `seed`, `topK`, `topP`, `stopSequences`, `allowMultipleToolCalls`, `additionalProperties`

**InputSchema/OutputSchema** (`inputSchema:` / `outputSchema:`):
`properties` (list or dict of Property), `examples`, `strict`

**Property** (`inputSchema.properties.X:`):
`kind` (`string` | `integer` | `float` | `boolean` | `array` | `object`), `description`, `required`, `default`, `value`, `example`, `enumValues`

**Template** (`template:`):
`format` (`{ kind: "jinja2" }`), `parser` (`{ kind: "prompty" }`)

**Tool** (`tools:` list):
Common: `name`, `kind`, `description`, `bindings`
FunctionTool (`kind: function`): `parameters` (PropertySchema), `strict`
McpTool (`kind: mcp`): `connection`, `serverName`, `serverDescription`, `approvalMode`, `allowedTools`
OpenApiTool (`kind: openapi`): `connection`, `specification`
CustomTool (`kind: *`): `connection`, `options`

### Role Markers (in body)

```
system:     → {"role": "system", "content": "..."}
user:       → {"role": "user", "content": "..."}
assistant:  → {"role": "assistant", "content": "..."}
```

### Thread Separator

```
system:
You are a helpful assistant.

![thread]

user:
{{question}}
```

Everything before `![thread]` → `instructions`. Everything after → `additionalInstructions`.

### Template Syntax

Jinja2 (default): `{{variable}}`, `{% if %}`, `{% for %}`, `{# comment #}`
Mustache (optional): `{{variable}}`, `{{#section}}`

### Variable References (in frontmatter)

- `${env:VAR_NAME}` — environment variable (required)
- `${env:VAR_NAME:default}` — with default value
- `${file:path/to/data.json}` — load JSON file content

### Shared Configuration

Use `${file:path/to/config.json}` references in frontmatter to load shared connection or model config from external JSON/YAML files. This replaces the old implicit `prompty.json` cascade — all config sources are now explicit and visible in the `.prompty` file.

---

## Existing Code Reference

### New Runtime Files (Implemented)

**`runtime/python/prompty/prompty/core/utils.py`**:

- `parse(contents: str) -> dict` — regex-based frontmatter/body split, puts body into `instructions` key
- `load_prompty(path) -> dict` — reads file + calls `parse()`
- `load_prompty_async(path) -> dict` — async variant
- `load_text(path)` / `load_json(path)` — file read helpers

**`runtime/python/prompty/prompty/tracing/tracer.py`**:

- `Tracer` class — context-manager based tracing with pluggable backends
- `@trace` decorator — wraps functions with tracing
- `to_dict()` — serialization helper for trace data
- `PromptyTracer` — console/file-based tracer implementation
- `console_tracer` — simple console output tracer

**`runtime/python/prompty/prompty/tracing/otel.py`**:

- `otel_tracer()` — OpenTelemetry span backend (optional dep: `opentelemetry-api`)

### Old Runtime Reference (for porting logic)

**`runtime/prompty/prompty/core.py`** — key dataclasses to understand migration:

- `Prompty` (line ~155): `model`, `inputs`, `outputs`, `tools`, `template`, `instructions`, `additional_instructions`
- `ModelProperty` (line ~83): `id`, `api`, `connection` (dict), `options` (dict)
- `load_manifest()` (line ~459): handles all legacy migrations — ported into `core/migration.py:_migrate_legacy()`

**`runtime/prompty/prompty/invoker.py`** — old invoker pattern (replaced by protocols + discovery + pipeline):

- `Invoker` ABC: `invoke()` / `invoke_async()` + traced `run()` / `run_async()`
- `InvokerFactory`: registry + dispatch → replaced by `core/discovery.py` entry-point lookup
- Dispatch keys: renderer=`template.format`, parser=`{parser}.{api}`, executor=`connection.type`

**`runtime/prompty/prompty/renderers.py`** — old template rendering (ported to `renderers/`):

- `Jinja2Renderer`: → `renderers/jinja2.py`
- `MustacheRenderer`: → `renderers/mustache.py`

**`runtime/prompty/prompty/parsers.py`** — old parser (ported to `parsers/`):

- `PromptyChatParser`: → `parsers/prompty.py`

### AgentSchema API Reference

```python
from agentschema import (
    AgentDefinition,     # ABC — dispatches on 'kind'
    PromptAgent,         # kind="prompt" — what .prompty files become
    Model,               # model config (id, provider, apiType, connection, options)
    Connection,          # ABC — dispatches on 'kind'
    ApiKeyConnection,    # kind="key" (endpoint, apiKey)
    ReferenceConnection, # kind="reference"
    RemoteConnection,    # kind="remote"
    AnonymousConnection, # kind="anonymous"
    ModelOptions,        # temperature, maxOutputTokens, etc.
    Template,            # format (Format) + parser (Parser)
    PropertySchema,      # properties list + examples + strict
    Property,            # kind, description, value, required, etc.
    Tool,                # ABC — dispatches on 'kind'
    FunctionTool,        # kind="function" (parameters: PropertySchema)
    McpTool,             # kind="mcp" (connection, serverName, etc.)
    OpenApiTool,         # kind="openapi" (connection, specification)
    CustomTool,          # kind="*" (wildcard catch-all)
    LoadContext,          # pre/post processing hooks for loading
    SaveContext,          # pre/post processing hooks for saving
)

# Loading
agent = PromptAgent.load(data_dict)                    # from dict
agent = PromptAgent.load(data_dict, LoadContext(...))   # with hooks
agent = AgentDefinition.from_yaml(yaml_string)         # from YAML (needs kind in data)
agent = AgentDefinition.from_yaml_file("agent.yaml")   # from file

# Saving
data = agent.save()                                     # to dict
yaml = agent.to_yaml()                                  # to YAML string
json = agent.to_json()                                  # to JSON string

# Tool dispatch (automatic via Tool.load_kind):
# "function" → FunctionTool, "mcp" → McpTool, "openapi" → OpenApiTool
# unknown kind → CustomTool (the * wildcard)
```
