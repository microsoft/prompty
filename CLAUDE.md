# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Prompty

Prompty is a markdown-based file format (`.prompty`) for LLM prompts with multi-language runtime support. It is currently in **v2 alpha** — APIs, file format, and tooling are under active development.

A `.prompty` file has:
- **YAML frontmatter**: Conforms to [AgentSchema](https://microsoft.github.io/AgentSchema/)'s `PromptAgent` schema (model config, inputs, tools, template engine). The loader injects `kind: "prompt"` — it does not appear in files.
- **Markdown body**: Becomes `agent.instructions`. Role markers (`system:`, `user:`, `assistant:`) split it into a `Message` list during parsing.
- **Template variables**: `${env:VAR}`, `${env:VAR:default}`, `${file:path.json}` — expanded via `LoadContext.pre_process` during load.

## Repository Layout

```
runtime/python/    Python runtime (PyPI: prompty)
runtime/typescript/ TypeScript monorepo (NPM: @prompty/*)
runtime/rust/      Rust workspace (crates.io: prompty-*)
runtime/csharp/    C# solution (NuGet: Prompty.*)
vscode/prompty/    VS Code extension
schema/            TypeSpec schema definitions (reference only)
spec/              Language-agnostic runtime specification
```

## Commands

### Python (`runtime/python/prompty/`)

Use **`uv` exclusively** — never `pip`, `python -m pip`, or `python -m venv`.

```bash
# Install dev environment
uv pip install -e ".[dev,all]"

# Run tests (integration tests excluded by default)
uv run pytest tests/ -q --tb=short --cov=prompty --cov-report=term

# Run a single test
uv run pytest tests/test_loader.py::test_load_basic -v

# Lint and format
uv run ruff check .
uv run ruff format .

# Build distributable
uv pip install --system flit
flit build --format wheel
flit build --format sdist
```

### TypeScript (`runtime/typescript/`)

Workspace root runs all packages; individual packages can be targeted directly.

```bash
cd runtime/typescript

npm ci
npm run build    # tsup → dist/ (.js, .cjs, .d.ts) for all packages
npm run test     # vitest for all packages
npm run lint     # tsc --noEmit for all packages

# Single package
cd packages/core
npm run test
npx vitest run tests/loader.test.ts
```

### Rust (`runtime/rust/`)

```bash
cd runtime/rust

cargo build --workspace
cargo test --workspace

# Single test (with output)
cargo test test_name -- --nocapture

# Lint
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
```

### C# (`runtime/csharp/`)

```bash
dotnet build runtime/csharp/prompty.sln
dotnet test runtime/csharp/prompty.sln
```

## Architecture

### Pipeline (all runtimes)

Every runtime implements the same 5-stage pipeline:

```
Load → Render → Parse → Execute → Process
```

1. **Load** — reads `.prompty` file, runs `${...}` variable expansion via `LoadContext.pre_process`, applies legacy migration, produces a `PromptAgent` object
2. **Render** — applies Jinja2 or Mustache template engine to `instructions` with caller-provided inputs
3. **Parse** — splits rendered text on role markers into a `Message[]` list
4. **Execute** — sends messages to the LLM provider (OpenAI, Foundry/Azure, Anthropic)
5. **Process** — normalizes raw provider response into Prompty's output types

Each stage is async-capable. All public pipeline functions have both sync and `_async` variants.

### Python — Invoker Pattern

Stages 2–5 use pluggable **Invoker** classes discovered via Python entry points (defined in `pyproject.toml`):

| Group | Key | Class |
|---|---|---|
| `prompty.renderers` | `jinja2` / `mustache` | `Jinja2Renderer` / `MustacheRenderer` |
| `prompty.parsers` | `prompty` | `PromptyChatParser` |
| `prompty.executors` | `openai` / `foundry` / `azure` / `anthropic` | Provider-specific `Executor` |
| `prompty.processors` | `openai` / `foundry` / `azure` / `anthropic` | Provider-specific `Processor` |

Entry-point-based discovery means invokers are registered by installing the package — no manual wiring. `foundry` and `azure` are aliases pointing to the same class.

### Python — Type System

The canonical type layer is **AgentSchema** (`agentschema` pip package). Key usage:

- Load a file: `AgentDefinition.load(data, ctx)` — dispatches on `kind` → creates `PromptAgent`
- Do **not** call `PromptAgent.load()` directly; it only handles prompt-specific fields
- `Property` uses `default` and `example` fields — there is no `value` field
- Optional dependencies (openai, jinja2, chevron, azure-identity, anthropic) are **lazily imported** — import inside the function that needs them, never at module level

### Python — Code Style Rules

- `from __future__ import annotations` at the top of every module
- Python ≥ 3.11 syntax: `X | Y` unions, `match`/`case`, `type` aliases
- Relative imports inside the package; absolute imports in tests
- `__init__.py` files are re-export modules only (`F401` suppressed)
- Ruff config: line length 120, rules E/F/I/UP, E501 ignored

### TypeScript — Package Structure

Four packages under `runtime/typescript/packages/`:

- `@prompty/core` — loader, renderer (nunjucks + mustache via `gray-matter` + `yaml`), parser, tracer
- `@prompty/openai` — OpenAI executor + processor
- `@prompty/foundry` — Azure/Foundry executor + processor
- `@prompty/anthropic` — Anthropic executor + processor

Each package builds to CJS + ESM + `.d.ts` via `tsup`.

### Tracing

Both Python and TypeScript support OpenTelemetry tracing. In Python, `@trace` decorator (from `tracing.tracer`) wraps pipeline functions; the `[otel]` extra wires `PromptyTracer` to an OTEL exporter. In tests, mock tracers are used — never real OTEL endpoints.

## Testing Notes

- **Python integration tests** (hitting real APIs) are marked `@pytest.mark.integration` and excluded by default (`addopts = "-m 'not integration'"`). Run them explicitly with `-m integration`.
- **Mock all external services** in unit tests — no real API calls.
- `pytest-asyncio` is used with `asyncio_mode = "strict"` — async test functions require `@pytest.mark.asyncio`.
