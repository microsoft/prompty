# Prompty v2 Python Runtime — Progress Tracker

## Overall Architecture

Prompty v2 is a ground-up rebuild. The type system lives in `agentschema` (pip dependency). Prompty loads `.prompty` files into `PromptAgent` objects and runs them through a stateless pipeline.

**Pipeline:**

```
.prompty file → load() → PromptAgent
PromptAgent + inputs → prepare() → list[Message]
list[Message] → execute() → raw LLM response
raw response → process() → clean result
```

**Shortcut:** `run(path, inputs)` does all four steps.

---

## Phase 1: Loader ✅ COMPLETE

Loads `.prompty` files → typed `PromptAgent` from `agentschema`.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `prompty/loader.py` | 163 | `load()` / `load_async()` — parse frontmatter, migrate legacy, inject `kind: "prompt"`, resolve `${env:}` / `${file:}`, call `AgentDefinition.load()` |
| `prompty/migration.py` | 236 | `_migrate_legacy()` — converts v1 property names → v2 AgentSchema names with deprecation warnings |
| `prompty/utils.py` | 67 | `parse()` — regex frontmatter/body split; `load_prompty()` / `load_prompty_async()` — file I/O |
| `prompty/tracer.py` | 639 | `Tracer` class, `@trace` decorator (sync+async), `PromptyTracer` (JSON file backend), `console_tracer` |
| `prompty/otel.py` | ~100 | OpenTelemetry integration (optional) |
| `prompty/_version.py` | 1 | `VERSION = "2.0.0.dev0"` |
| `tests/test_loader.py` | 581 | 51 tests covering loading, migration, env/file resolution, threads, tools, shorthands, async |
| `tests/prompts/*.prompty` | — | Test fixtures: basic, minimal, legacy_basic, threaded, tools_function, tools_mcp, tools_openapi, tools_custom, etc. |

### Key decisions

- `agentschema` is a pip dependency, no code generation
- No `kind` in `.prompty` files — loader injects `kind: "prompt"`
- Markdown body → `instructions`
- Thread position is determined by template variable placement (not `![thread]` syntax)
- Thread-kind inputs are declared in `inputSchema` with `kind: thread`
- `${env:VAR}` and `${file:path}` resolved via `LoadContext(pre_process=fn)`
- Legacy v1 format loads with deprecation warnings
- `uv` exclusively for Python environment management

---

## Phase 2: Invoker Architecture ✅ COMPLETE

Stateless pipeline operating on `PromptAgent`. All implementations discovered via Python entry points.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `prompty/types.py` | 178 | Abstract message types — `ContentPart` base, `TextPart`, `ImagePart`, `FilePart`, `AudioPart`, `Message`, `ThreadMarker`, `RICH_KINDS`, `ROLES` |
| `prompty/invoker.py` | 615 | Protocols, entry point discovery, pipeline functions, thread marker injection |
| `tests/test_invoker.py` | 556 | 40 tests with mock implementations |

### `types.py` details

- `ContentPart` — base dataclass with `kind` discriminator
- `TextPart` — `kind="text"`, `value: str`
- `ImagePart` — `kind="image"`, `source: str`, `detail: str | None`, `media_type: str | None`
- `FilePart` — `kind="file"`, `source: str`, `media_type: str | None`
- `AudioPart` — `kind="audio"`, `source: str`, `media_type: str | None`
- `Message` — `role: str`, `parts: list[ContentPart]`, `metadata: dict`; has `.text` property, `.to_text_content()` method
- `ThreadMarker` — `name: str = "thread"` — positional marker for thread insertion
- `RICH_KINDS = frozenset({"thread", "image", "file", "audio"})` — property kinds handled structurally
- `ROLES = frozenset({"system", "user", "assistant", "developer"})`

### `invoker.py` details

**Protocols** (all `@runtime_checkable`):

- `RendererProtocol` — `render(agent, template, inputs) -> str` + async
- `ParserProtocol` — `parse(agent, rendered, **context) -> list[Message]` + async
- `_PreRenderable` — optional `pre_render(template) -> (sanitized, context)` for nonce-based sanitization
- `ExecutorProtocol` — `execute(agent, messages) -> Any` + async
- `ProcessorProtocol` — `process(agent, response) -> Any` + async

**Discovery:**

- `_discover(group, key)` — lazy entry point loading with module-level `_cache: dict[tuple[str, str], Any]`
- `get_renderer(key)`, `get_parser(key)`, `get_executor(key)`, `get_processor(key)`
- `clear_cache()` — for testing
- `InvokerError` — raised when entry point not found, suggests `pip install prompty[key]`

**Validation:**

- `validate_inputs(agent, inputs)` — applies `Property.default` then `Property.example` as fallbacks, enforces `Property.required`, rejects unknown keys when `PropertySchema.strict` is True

**Pipeline functions** (all `@trace` decorated):

- `prepare(agent, inputs)` → validate → discover parser → if `Format.strict` and parser has `pre_render`, call it → discover renderer → render → parse → inject thread nonces → expand thread markers → `list[Message]`
- `prepare_async(agent, inputs)` — async variant
- `execute(agent, messages)` → discover executor by `agent.model.provider` → call
- `execute_async(agent, messages)` — async variant
- `process(agent, response)` → discover processor by `agent.model.provider` → extract
- `process_async(agent, response)` — async variant
- `run(prompt, inputs, raw=False)` → load (if str path) → prepare → execute → process (skip if raw)
- `run_async(prompt, inputs, raw=False)` — async variant

**Internal helpers:**

- `_get_rich_input_names(agent)` — returns `{prop_name: kind}` for rich-kind inputs
- `_inject_thread_markers(messages, thread_nonces)` — scans parsed messages for renderer nonce markers, splits messages and inserts `ThreadMarker` at nonce positions
- `_expand_thread_markers(messages, inputs, rich_inputs)` — replaces `ThreadMarker` with actual messages from inputs; if no markers exist, appends thread-kind inputs at end
- `_dict_to_message(d)` — converts plain dict `{"role": ..., "content": ...}` to `Message`
- `_dict_content_to_part(d)` — converts dict content items to `ContentPart` subtypes

### `__init__.py` exports (updated)

- agentschema re-exports: `AgentDefinition`, `PromptAgent`, `Model`, `ModelOptions`, `Connection`, all connection subtypes, `Template`, `Format`, `Parser`, `PropertySchema`, `Property`, `Tool`, all tool subtypes, `LoadContext`, `SaveContext`
- Loader: `load`, `load_async`
- Pipeline: `prepare`, `prepare_async`, `execute`, `execute_async`, `process`, `process_async`, `run`, `run_async`, `validate_inputs`
- Protocols: `RendererProtocol`, `ParserProtocol`, `ExecutorProtocol`, `ProcessorProtocol`
- Error: `InvokerError`
- Types: `Message`, `ContentPart`, `TextPart`, `ImagePart`, `FilePart`, `AudioPart`, `ThreadMarker`, `RICH_KINDS`, `ROLES`
- Tracing: `Tracer`, `trace`, `PromptyTracer`, `console_tracer`, `sanitize`, `to_dict`, `trace_span`, `verbose_trace`

### `pyproject.toml` entry point groups

```toml
[project.entry-points."prompty.renderers"]
jinja2 = "prompty.renderers:Jinja2Renderer"
mustache = "prompty.renderers:MustacheRenderer"

[project.entry-points."prompty.parsers"]
prompty = "prompty.parsers:PromptyChatParser"

[project.entry-points."prompty.executors"]
openai = "prompty.executor:OpenAIExecutor"
azure = "prompty.executor:AzureExecutor"

[project.entry-points."prompty.processors"]
openai = "prompty.processor:OpenAIProcessor"
azure = "prompty.processor:AzureProcessor"
```

### Test coverage (40 tests)

- `TestInvokerError` (2) — message formatting, attributes
- `TestDiscovery` (5) — all 4 invoker types, missing raises, caching, cache reset
- `TestValidateInputs` (6) — no schema, defaults, example fallback, required missing, strict rejects unknown, override
- `TestThreadExpansion` (4) — marker replacement, no-marker append, Message objects, empty thread
- `TestInjectThreadMarkers` (4) — nonce injection, marker-only message, no nonces, no match
- `TestDictToMessage` (3) — simple, default role, metadata
- `TestPrepare` (4) — basic, template config, no inputs, missing renderer
- `TestExecute` (3) — basic, no provider, unknown provider
- `TestProcess` (2) — basic, no provider
- `TestRun` (2) — full pipeline, raw mode
- `TestRichInputNames` (3) — no schema, detects thread, ignores string

---

## Phase 3: Concrete Invokers ✅ COMPLETE

Concrete renderer, parser, executor, and processor implementations discovered via entry points.

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `prompty/renderers.py` | 113 | `Jinja2Renderer`, `MustacheRenderer` — template rendering with thread-kind nonce emission |
| `prompty/parsers.py` | 230 | `PromptyChatParser` — role marker parsing, nonce sanitization, inline image support |
| `prompty/executor.py` | ~350 | `OpenAIExecutor`, `AzureExecutor` — LLM API calls with wire format mapping |
| `prompty/processor.py` | ~180 | `OpenAIProcessor`, `AzureProcessor` — response extraction, `ToolCall` dataclass |
| `tests/test_renderers.py` | — | Jinja2/Mustache rendering, thread nonce emission, variable substitution |
| `tests/test_parsers.py` | ~240 | Role parsing, pre-render sanitization, inline images, async |
| `tests/test_executor.py` | ~300 | Wire format mapping, mocked API calls, connection config |
| `tests/test_processor.py` | — | Content/tool call/embedding extraction, streaming |

### Entry points (pyproject.toml)

```toml
[project.entry-points."prompty.renderers"]
jinja2 = "prompty.renderers:Jinja2Renderer"
mustache = "prompty.renderers:MustacheRenderer"

[project.entry-points."prompty.parsers"]
prompty = "prompty.parsers:PromptyChatParser"

[project.entry-points."prompty.executors"]
openai = "prompty.executor:OpenAIExecutor"
azure = "prompty.executor:AzureExecutor"

[project.entry-points."prompty.processors"]
openai = "prompty.processor:OpenAIProcessor"
azure = "prompty.processor:AzureProcessor"
```

### `renderers.py` details

- `_prepare_render_inputs(agent, inputs)` — detects `kind: "thread"` inputs from `agent.inputSchema`, replaces values with nonce markers (`__PROMPTY_THREAD_{nonce}_{name}__`), returns `(render_inputs, thread_nonces)`
- `Jinja2Renderer` — renders via `ImmutableSandboxedEnvironment`, stashes `_last_thread_nonces` for `prepare()` to read
- `MustacheRenderer` — renders via `chevron.render`, same nonce stashing
- `THREAD_NONCE_PREFIX = "__PROMPTY_THREAD_"` — exported for downstream detection

### `parsers.py` details

- `PromptyChatParser.pre_render(template)` — nonce-based sanitization for `Format.strict` mode; wraps role markers with nonces so template variables can't inject structural text
- `PromptyChatParser.parse(agent, rendered, **context)` — splits on role boundaries (`system:`, `user:`, `assistant:`, `developer:`), handles inline markdown images → `ImagePart`, validates nonces if provided
- Role boundary regex supports attributes: `user[name="Alice"]:` → `metadata["name"] = "Alice"`
- Data URI and URL images both supported
- Parser does NOT handle `![thread]` — thread position is determined by the renderer's nonce markers

### `executor.py` details

- `_message_to_wire(msg)` / `_part_to_wire(part)` — converts `Message`/`ContentPart` → OpenAI wire format
- `_tools_to_wire(agent)` — converts `FunctionTool` → OpenAI tools format
- `_schema_to_wire(schema)` — converts `PropertySchema` → JSON Schema
- `_build_options(agent)` — maps `ModelOptions` → API kwargs (`temperature`, `max_tokens`, `top_p`, etc.)
- `OpenAIExecutor` — uses `openai.OpenAI` client, extracts `api_key`/`base_url` from `ApiKeyConnection`
- `AzureExecutor` — uses `openai.AzureOpenAI`, extracts `azure_endpoint`/`api_key`, falls back to `DefaultAzureCredential`, defaults `api_version` to `"2024-06-01"`
- Both support chat, completion, and chat-with-tools API types
- Lazy imports (OpenAI/AzureOpenAI imported inside methods)

### `processor.py` details

- `OpenAIProcessor` / `AzureProcessor` — dispatches by response type
- Chat completions: extracts `choices[0].message.content` or `ToolCall` list
- Completions: extracts `choices[0].text`
- Embeddings: extracts float vectors
- Streaming: yields content chunks from `Stream` iterators
- `ToolCall` dataclass: `id`, `name`, `arguments` (parsed JSON)

### Thread handling design (nonce-based)

Thread position is determined by template variable placement, not `![thread]` syntax:

1. **Renderer**: `_prepare_render_inputs()` detects `kind: "thread"` inputs from `inputSchema`, substitutes nonce markers for thread values, renders template normally
2. **Parser**: Treats nonce markers as plain text — no special handling
3. **`prepare()`**: Reads `_last_thread_nonces` from renderer, calls `_inject_thread_markers()` to scan parsed messages for nonce strings and insert `ThreadMarker` objects at those positions
4. **`_expand_thread_markers()`**: Replaces `ThreadMarker` with actual conversation messages from inputs

If no `{{thread_var}}` appears in the template but thread-kind inputs exist, thread messages are appended at the end.

---

## Test Status

- **231 tests passing** (51 loader + 40 invoker + 17 renderers + 23 parsers + 17 executor + 13 processor)
- **0 type errors** (pyright/pylance)
- **0 lint errors** (ruff)
- **Python 3.11+**, venv at `.venv/`, managed with `uv`
- Run: `cd runtime/python/prompty && .\.venv\Scripts\python.exe -m pytest tests/ -q`
