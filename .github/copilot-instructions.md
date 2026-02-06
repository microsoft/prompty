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

| Path                                   | Reason                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| `specification/` (entire directory)    | TypeSpec + emitter moved to AgentSchema                      |
| `runtime/csharp/` (entire directory)   | Auto-generated from same TypeSpec                            |
| `runtime/python/prompty/prompty/core/` | 21 auto-generated model files, replaced by `agentschema` dep |
| `runtime/python/prompty/tests/core/`   | 44 auto-generated test files                                 |

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
│   │       ├── pyproject.toml
│   │       └── prompty/
│   │           ├── __init__.py       # Public API exports
│   │           ├── _version.py       # VERSION = "2.0.0.dev0"
│   │           ├── loader.py         # PHASE 1: load() → PromptAgent
│   │           ├── invoker.py        # PHASE 2: Invoker ABCs + factory
│   │           ├── renderers.py      # PHASE 3: Jinja2Renderer, MustacheRenderer
│   │           ├── parsers.py        # PHASE 3: PromptyChatParser
│   │           ├── executor.py       # PHASE 3: OpenAI/Azure executor
│   │           ├── processor.py      # PHASE 3: Response processing
│   │           ├── tracer.py         # KEPT: 352-line tracing framework
│   │           └── utils.py          # KEPT: frontmatter parsing, file loading
│   ├── promptycs/                    # Hand-written C# runtime (separate migration)
│   └── promptyjs/                    # Hand-written JS runtime (separate migration)
├── vscode/prompty/                   # VS Code extension
└── web/                              # Documentation site
```

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
- No imports from `prompty.core` anywhere

---

## PHASE 2: Revisit the Invokers

### Goal

Design the invoker abstractions that operate on `PromptAgent`. The pipeline is:

```
PromptAgent + inputs → Renderer → rendered string
                           → Parser → list[dict] (messages)
                               → Executor → LLM response
                                   → Processor → final result
```

### Design Questions to Resolve

1. **Factory/registry pattern**: Keep `InvokerFactory` with `@register_renderer("jinja2")` decorators? Or simplify to direct dispatch based on `agent.template.format.kind` and `agent.model.provider`?

2. **Invoker receives PromptAgent how**: Constructor injection (current: `Invoker.__init__(self, prompty)`) vs passed per call (`invoker.run(agent, data)`)?

3. **Executor + Processor**: Keep separate (current) or merge into one stage? Current split: Executor calls API, Processor extracts content. Merging simplifies the pipeline but reduces composability.

4. **Async strategy**: Async-first with sync wrapper? Or sync/async ABCs like current?

5. **Tracing integration**: Keep `@trace` decorator on `.run()` methods (current) or build tracing into the base class?

### Files to Create

| File                    | Contents                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `prompty/invoker.py`    | `Invoker` ABC, `Renderer`, `Parser`, `Executor`, `Processor` ABCs, `InvokerFactory` |
| `tests/test_invoker.py` | Factory registration, dispatch logic, pipeline composition                          |

### Key Reference: Old Invoker Pattern

The old runtime (`runtime/prompty/prompty/invoker.py`, 520 lines) has:

- `Invoker` ABC with `invoke()` / `invoke_async()` abstract methods and `run()` / `run_async()` traced wrappers
- `Renderer(Invoker)` — before rendering, asks Parser to sanitize template content
- `Parser(Invoker)` — has `sanitize()` and `process()` methods; `run()` calls `invoke()` then `process()`
- `Executor(Invoker)` — direct pass-through
- `Processor(Invoker)` — direct pass-through
- `InvokerFactory` — class-level dicts `_renderers`, `_parsers`, `_executors`, `_processors`; dispatch keys:
  - Renderer: `template.format` (e.g., `"jinja2"`)
  - Parser: `{template.parser}.{model.api}` (e.g., `"prompty.chat"`)
  - Executor: `model.connection["type"]` (e.g., `"azure_openai"`)
  - Processor: same as executor
- `NoOp` invoker registered for `"NOOP"` keys and unused parser combos
- Registration via `@InvokerFactory.register_renderer("jinja2")` decorators

### Phase 2 Gate

- Abstract base classes defined and tested
- Factory dispatch logic tested (registration, lookup, NOOP handling)
- Pipeline composition tested (renderer → parser → executor → processor)
- No concrete implementations yet — those are Phase 3

---

## PHASE 3: Individual Invokers

### Goal

Concrete implementations that plug into Phase 2 abstractions.

### Invokers to Implement

| Invoker             | Type      | Registration Key   | What It Does                                                     |
| ------------------- | --------- | ------------------ | ---------------------------------------------------------------- |
| `Jinja2Renderer`    | Renderer  | `jinja2`           | Renders `agent.instructions` with inputs via Jinja2              |
| `MustacheRenderer`  | Renderer  | `mustache`         | Same via Chevron (optional dep)                                  |
| `PromptyChatParser` | Parser    | `prompty.chat`     | Converts role markers → `[{"role": "system", "content": "..."}]` |
| `OpenAIExecutor`    | Executor  | `openai` / `azure` | Calls chat completions API                                       |
| `OpenAIProcessor`   | Processor | `openai` / `azure` | Extracts `.choices[0].message.content` or tool calls             |

### Files to Create

| File                      | Contents                             | Optional Dep        |
| ------------------------- | ------------------------------------ | ------------------- |
| `prompty/renderers.py`    | `Jinja2Renderer`, `MustacheRenderer` | `jinja2`, `chevron` |
| `prompty/parsers.py`      | `PromptyChatParser`                  | —                   |
| `prompty/executor.py`     | `OpenAIExecutor`                     | `openai`            |
| `prompty/processor.py`    | `OpenAIProcessor`                    | `openai`            |
| `tests/test_renderers.py` | Template rendering tests             |                     |
| `tests/test_parsers.py`   | Role marker parsing tests            |                     |
| `tests/test_executor.py`  | Mocked LLM call tests                |                     |
| `tests/test_processor.py` | Response extraction tests            |                     |

### High-Level Public API (After Phase 3)

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

### Phase 3 Gate

- `pytest` — all tests green across all phases
- `run("basic.prompty", inputs={...})` works end-to-end with a mocked LLM
- Provider packages installed via extras: `pip install prompty[openai]`
- Tracing decorator applied to all invoker `.run()` methods

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

### Kept Files (New Runtime)

**`runtime/python/prompty/prompty/utils.py`** (141 lines):

- `parse(contents: str) -> dict` — regex-based frontmatter/body split, puts body into `instructions` key
- `load_prompty(path) -> dict` — reads file + calls `parse()`
- `load_prompty_async(path) -> dict` — async variant
- `load_text(path)` / `load_json(path)` — file read helpers

**`runtime/python/prompty/prompty/tracer.py`** (352 lines):

- `Tracer` class — context-manager based tracing with pluggable backends
- `@trace` decorator — wraps functions with tracing
- `to_dict()` — serialization helper for trace data
- `PromptyTracer` — console/file-based tracer implementation

### Old Runtime Reference (for porting logic)

**`runtime/prompty/prompty/core.py`** — key dataclasses to understand migration:

- `Prompty` (line ~155): `model`, `inputs`, `outputs`, `tools`, `template`, `instructions`, `additional_instructions`
- `ModelProperty` (line ~83): `id`, `api`, `connection` (dict), `options` (dict)
- `load_manifest()` (line ~459): handles all legacy migrations — THIS is the logic to port into `_migrate_legacy()`

**`runtime/prompty/prompty/invoker.py`** — invoker pattern to redesign:

- `Invoker` ABC: `invoke()` / `invoke_async()` + traced `run()` / `run_async()`
- `InvokerFactory`: registry + dispatch
- Dispatch keys: renderer=`template.format`, parser=`{parser}.{api}`, executor=`connection.type`

**`runtime/prompty/prompty/renderers.py`** — template rendering to port:

- `Jinja2Renderer`: renders with `jinja2.Template`
- `MustacheRenderer`: renders with `chevron.render`

**`runtime/prompty/prompty/parsers.py`** — parser to port:

- `PromptyChatParser`: splits on role markers, produces message list

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
