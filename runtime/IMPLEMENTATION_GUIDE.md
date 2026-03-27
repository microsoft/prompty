# Prompty Runtime — Cross-Language Implementation Guide

This document describes how to implement a Prompty
runtime in any language. It captures the architecture,
contracts, and design decisions from the Python reference
implementation so that new runtimes (C#, TypeScript, Go,
Rust, etc.) can implement the same behavior idiomatically.

## Table of Contents

1. [Overview](#overview)
2. [The `.prompty` File Format](#the-prompty-file-format)
3. [Loading Pipeline](#loading-pipeline)
4. [Execution Pipeline](#execution-pipeline)
5. [Protocol Interfaces](#protocol-interfaces)
6. [Discovery Mechanism](#discovery-mechanism)
7. [Wire Format Mapping](#wire-format-mapping)
8. [Connection Registry](#connection-registry)
9. [Agent Loop](#agent-loop)
10. [Streaming](#streaming)
11. [Tracing](#tracing)
12. [Error Handling](#error-handling)
13. [Testing Strategy](#testing-strategy)

---

## Overview

Prompty is a **markdown file format** (`.prompty`)
for LLM prompts. The runtime's job is:

1. **Load** a `.prompty` file → typed `PromptAgent`
2. **Render** the template with user inputs → string
3. **Parse** the rendered string → `list[Message]`
4. **Execute** messages against an LLM provider → response
5. **Process** the raw response → clean result

The type system comes from
[AgentSchema](https://microsoft.github.io/AgentSchema/).
Every runtime takes a dependency on an AgentSchema
library for its language (or embeds the types if no
library exists yet).

### Key Design Principles

- **AgentSchema is the type layer** — don't reinvent
  types. Use `PromptAgent`, `Model`, `Connection`, etc.
- **`.prompty` files are always `PromptAgent`** — the
  loader injects `kind: "prompt"`.
- **Markdown body → `instructions`** — the loader
  splits YAML frontmatter from body.
- **Pipeline stages are swappable** — renderers,
  parsers, executors, processors are pluggable.
- **Agent mode is a calling convention** —
  `run_agent()` is a pipeline function, not a file
  format concern.

---

## The `.prompty` File Format

### Structure

```text
---
YAML frontmatter (AgentSchema PromptAgent properties)
---
Markdown body (becomes `instructions`)
```

### Frontmatter Properties

The frontmatter maps directly to AgentSchema's
`PromptAgent` schema. The loader injects
`kind: "prompt"` — users never write it.

**Root properties**: `name`, `displayName`,
`description`, `metadata`, `model`, `inputSchema`,
`outputSchema`, `tools`, `template`

**Model shorthand**: `model: gpt-4` expands to
`model: { id: "gpt-4" }` during loading.

### Role Markers

The markdown body uses role markers on their own line:

```text
system:
You are a helpful assistant.

user:
{{question}}

assistant:
I'd be happy to help.
```

Valid roles: `system`, `user`, `assistant`, `developer`

The parser splits on these markers to produce a
message list.

### Thread Inputs

Conversation history (threads) are handled via a
`kind: thread` input property in `inputSchema`:

```yaml
inputSchema:
  properties:
    - name: question
      kind: string
      default: Hello
    - name: conversation
      kind: thread
```

The caller passes a list of messages as the thread
input. The renderer emits nonce markers where
`{{conversation}}` appears, and the parser/pipeline
expands those nonces into actual `Message` objects.

If no `{{thread_var}}` appears in the template but
thread-kind inputs are provided, thread messages are
appended at the end of the message list.

### Variable References

In YAML frontmatter values:

| Syntax | Purpose |
|--------|---------|
| `${env:VAR_NAME}` | Required env variable |
| `${env:VAR_NAME:default}` | Env variable w/ default |
| `${file:relative/path.json}` | Load file content |

These are resolved during loading via a pre-processing
walk over the parsed YAML dict tree.

---

## Loading Pipeline

```text
.prompty file
     │
     ▼
Split frontmatter / body
     │  Regex: /^---\s*\n(.*?)\n---\s*\n?(.*)/s
     │  Body → data["instructions"]
     ▼
YAML parse frontmatter
     │  MUST use safe_load (no arbitrary code exec)
     ▼
Migrate legacy properties
     │  Old v1 format → v2 AgentSchema names
     │  Emit deprecation warnings, don't error
     ▼
Inject kind: "prompt"
     │  Always — .prompty files are PromptAgents
     ▼
Resolve ${} references
     │  Walk every dict in the tree:
     │  ${env:VAR} → env lookup
     │  ${file:path} → file read
     ▼
AgentSchema load
     │  AgentDefinition.load(data, context)
     │  Dispatches on kind → PromptAgent
     │  Populates ALL fields (base + prompt-specific)
     ▼
PromptAgent (fully typed object)
```

### Critical Details

1. **Use `AgentDefinition.load()`** — not
   `PromptAgent.load()`. The former handles base
   fields (`inputSchema`, `outputSchema`, `name`,
   `metadata`) and dispatches on `kind`. The latter
   only handles prompt-specific fields.

2. **Frontmatter regex**: Match `---` at start of
   file, capture YAML until next `---`, remainder
   is body. The body becomes `instructions`.

   ```text
   ^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$
   ```

3. **`${file:path}` resolution**: Path is relative
   to the `.prompty` file's directory.

4. **Model shorthand**: If `model` is a plain string,
   convert to `{"id": that_string}`.

### Legacy Migration

When encountering old v1 property names, convert to
v2 and emit a deprecation warning. Never silently
drop properties.

| Old | New | Notes |
|-----|-----|-------|
| `model.configuration` | `model.connection` | Rename |
| `config.type: azure_openai` | `provider: azure`, `conn.kind: key` | Split |
| `config.type: openai` | `provider: openai` + `connection.kind: key` | Split |
| `configuration.azure_endpoint` | `connection.endpoint` | Rename |
| `configuration.azure_deployment` | `model.id` | Move |
| `configuration.api_key` | `connection.apiKey` | camelCase |
| `configuration.name` | `model.id` | Move |
| `model.parameters` | `model.options` | Rename |
| `parameters.max_tokens` | `options.maxOutputTokens` | Rename |
| `parameters.top_p` | `options.topP` | camelCase |
| `parameters.frequency_penalty` | `options.frequencyPenalty` | camelCase |
| `parameters.presence_penalty` | `options.presencePenalty` | camelCase |
| `parameters.stop` | `options.stopSequences` | Rename |
| `model.api` | `model.apiType` | Rename |
| `inputs` | `inputSchema.properties` | Restructure |
| `inputs.X.type` | `properties.X.kind` | Rename |
| `inputs.X.sample` | `properties.X.default` | Rename |
| `outputs` | `outputSchema` | Rename |
| `template: "jinja2"` | Structured `template` obj | Restructure |
| `template.type` | `template.format.kind` | Nested |
| Root `authors` | `metadata.authors` | Move |
| Root `tags` | `metadata.tags` | Move |
| Root `version` | `metadata.version` | Move |
| Root `sample` | Raise error | Deprecated |

**Inputs migration**: Old format is
`inputs: { name: { type: string, sample: Jane } }` or
just `inputs: { name: Jane }` (shorthand where value
is the default). Convert to `inputSchema.properties`
list with `kind`, `default`, etc.

---

## Execution Pipeline

### The Four-Step Principle

The Prompty pipeline is a **tree of four independently-traced leaf steps**,
grouped into composites:

```text
execute(prompt, inputs)              → top-level orchestrator
  │
  ├── prepare(agent, inputs)         → template → wire format
  │     ├── render(agent, inputs)    → template + inputs → rendered string
  │     └── parse(agent, rendered)   → rendered string → list[Message]
  │
  └── run(agent, messages)           → LLM call → clean result
        ├── Executor.execute(...)    → messages → raw LLM response
        └── process(agent, response) → raw response → clean result
```

**Four leaf steps** — each backed by a swappable Protocol, each independently
traced:

| Step | Protocol | Dispatched by | Trace span |
|------|----------|---------------|------------|
| **render** | `RendererProtocol` | `template.format.kind` (e.g. `"jinja2"`) | `Jinja2Renderer.render` |
| **parse** | `ParserProtocol` | `template.parser.kind` (e.g. `"prompty"`) | `PromptyChatParser.parse` |
| **executor** | `ExecutorProtocol` | `model.provider` (e.g. `"openai"`) | `OpenAIExecutor.execute` |
| **process** | `ProcessorProtocol` | `model.provider` (e.g. `"openai"`) | `OpenAIProcessor.process` |

**Two composites** — each creates a parent trace span:

| Composite | Contains | Purpose |
|-----------|----------|---------|
| `prepare()` | render + parse + thread expansion | Template → wire-format messages |
| `run()` | executor + process | Messages → clean result |

**One orchestrator** — `execute()` ties it all together:

```text
execute("chat.prompty", {"question": "Hello"})
  ├── load("chat.prompty")  → PromptAgent
  ├── prepare(agent, inputs)
  │     ├── Jinja2Renderer.render(...)   ← traced leaf
  │     └── PromptyChatParser.parse(...) ← traced leaf
  └── run(agent, messages)
        ├── OpenAIExecutor.execute(...)  ← traced leaf
        └── OpenAIProcessor.process(...) ← traced leaf
```

Users can see exactly where time is spent. Each leaf is independently
replaceable via the entry-point discovery system.

### Public API Functions

```python
# Leaf steps (standalone, for debugging/testing)
render(agent, inputs) → str
parse(agent, rendered_string) → list[Message]
process(agent, response) → Any

# Composites
prepare(agent, inputs) → list[Message]
run(agent, messages, *, raw=False) → Any

# Top-level orchestrators
execute(prompt_or_agent, inputs, *, raw=False) → Any
execute_agent(prompt_or_agent, inputs, *, tools, max_iterations=10, raw=False) → Any
```

All functions have async variants (`render_async`, `parse_async`, etc.).

### `prepare()` Details

1. Resolve template format and parser from
   `agent.template` (defaults: format=`jinja2`,
   parser=`prompty`).
2. If the parser implements a `pre_render()` hook,
   call it to get a sanitized template and context.
3. Call `renderer.render(agent, template, inputs)`.
4. Call
   `parser.parse(agent, rendered_string, **context)`.
5. If thread-kind inputs exist (inputs with
   `kind: thread` in `inputSchema`), scan the parsed
   messages for nonce markers and expand them into
   actual `Message` objects from the thread input.
   If no markers exist, append thread messages at
   the end.
6. Return the final `list[Message]`.

### `run()` Details

1. Call `Executor.execute(agent, messages)` — the
   executor converts abstract `Message` objects to
   the provider's wire format, dispatches on
   `agent.model.apiType` (`"chat"`, `"embedding"`,
   `"image"`), and makes the SDK call.
2. If `raw=True`, return the raw LLM response.
3. Otherwise call `Processor.process(agent, response)`
   — extracts content from chat completions,
   vectors from embeddings, URLs from images,
   or JSON-parses when `outputSchema` exists.

### Default Configuration

When template or provider config is missing:

| Field | Default |
|-------|---------|
| `template.format.kind` | `"jinja2"` |
| `template.parser.kind` | `"prompty"` |
| `model.provider` | `"openai"` |
| `model.apiType` | `"chat"` |

---

## Protocol Interfaces

Each pipeline stage is defined as an
interface/protocol. Implementations are swappable.

### RendererProtocol

```text
render(agent, template, inputs) → string
render_async(agent, template, inputs) → string
```

The renderer receives the raw instructions string
and input values. It must:

- Interpolate `{{variable}}` references with input
  values.
- Handle **rich input kinds** (`thread`, `image`,
  `file`, `audio`) by emitting unique nonce markers
  instead of interpolating the value directly. The
  parser later expands these nonces into proper
  `Message` parts.

### ParserProtocol

```text
parse(agent, rendered, **context) → list[Message]
parse_async(agent, rendered, **ctx) → list[Message]
```

Optional:

```text
pre_render(template) → (modified_template, context)
```

The parser splits rendered text into messages using
role markers. It also expands nonce markers back into
typed content parts (images, files, etc.).

### ExecutorProtocol

```text
execute(agent, messages) → any
execute_async(agent, messages) → any
```

The executor:

1. Resolves an SDK client from the agent's connection
   config.
2. Converts `Message` objects to the provider's wire
   format.
3. Makes the API call and returns the raw response.

### ProcessorProtocol

```text
process(agent, response) → any
process_async(agent, response) → any
```

The processor extracts clean results from
provider-specific response objects.

---

## Discovery Mechanism

Implementations are registered and discovered at
runtime. The mechanism is language-specific:

| Language | Mechanism |
|----------|-----------|
| Python | `entry_points()` via `pyproject.toml` |
| C# | Assembly scanning, DI registration |
| TypeScript | Package exports, plugin registry |
| Go | Interface registration at `init()` |

### Registration Keys

| Stage | Group | Key Source |
|-------|-------|------------|
| Renderer | `prompty.renderers` | `template.format.kind` |
| Parser | `prompty.parsers` | `template.parser.kind` |
| Executor | `prompty.executors` | `model.provider` |
| Processor | `prompty.processors` | `model.provider` |

### Discovery Contract

1. Lookup by `(group, key)` pair.
2. If not found, raise an error with a helpful
   message suggesting which package to install.
3. Cache results — discovery should only happen once
   per key.
4. Provide a `clear_cache()` for testing.

---

## Wire Format Mapping

The executor converts abstract `Message` objects to
provider-specific wire format.

### Message → OpenAI Wire Format

```python
# Abstract Message
Message(
    role="user",
    parts=[TextPart(value="Hello")],
    metadata={}
)

# → OpenAI wire format
{"role": "user", "content": "Hello"}
```

**Rules:**

- If all parts are `TextPart`, `content` is a plain
  string (concatenated).
- If any part is non-text (image, audio, file),
  `content` is an array of typed objects.
- `metadata` keys (except `"role"` and `"content"`)
  are passed through to the wire dict. This is how
  tool call metadata (`tool_calls`, `tool_call_id`,
  `name`) flows through.

### Content Part Mapping

| Abstract Type | OpenAI Wire |
|--------------|-------------|
| `TextPart(value="Hi")` | `{"type": "text", "text": "Hi"}` |
| `ImagePart(source="u")` | `{"type": "image_url", ...}` |
| `AudioPart(source="d")` | `{"type": "input_audio", ...}` |
| `FilePart(source="u")` | `{"type": "file", ...}` |

### Tool Definition Mapping

AgentSchema `FunctionTool` → OpenAI function tool:

```python
# AgentSchema
FunctionTool(
    name="get_weather",
    description="Get weather",
    parameters=PropertySchema(properties=[
        Property(
            name="location",
            kind="string",
            description="City",
        )
    ]),
    strict=True
)

# → OpenAI wire
{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City",
                }
            },
            "required": ["location"],
            "additionalProperties": False,
        },
        "strict": True,
    }
}
```

**Important**: `strict` goes on the function
definition object, not inside the JSON Schema
`parameters`. When `strict` is true, also add
`"additionalProperties": false` to the parameters
schema.

### Model Options Mapping

| AgentSchema | OpenAI Parameter |
|-------------|------------------|
| `temperature` | `temperature` |
| `maxOutputTokens` | `max_completion_tokens` |
| `topP` | `top_p` |
| `frequencyPenalty` | `frequency_penalty` |
| `presencePenalty` | `presence_penalty` |
| `seed` | `seed` |
| `stopSequences` | `stop` |
| `additionalProperties.*` | Pass through as-is |

**Important**: Use `max_completion_tokens`, not
`max_tokens`. The latter is deprecated and
incompatible with o-series reasoning models.

### Structured Output (outputSchema → response_format)

When `agent.outputSchema` is defined with properties,
convert to OpenAI's `response_format`:

```python
# response_format wire format
{
    "type": "json_schema",
    "json_schema": {
        "name": "agent_name",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": { ... },
            "required": [ ... ],
            "additionalProperties": False,
        }
    }
}
```

The processor then JSON-parses the response content
when `outputSchema` is present.

### Property Kind → JSON Schema Type

| AgentSchema `kind` | JSON Schema `type` |
|-------|---------|
| `string` | `string` |
| `integer` | `integer` |
| `float` | `number` |
| `number` | `number` |
| `boolean` | `boolean` |
| `array` | `array` |
| `object` | `object` |

### API Type Dispatch

The executor dispatches on `agent.model.apiType`:

| apiType | API Call | Output |
|---------|----------|--------|
| `chat` | `chat.completions.create()` | ChatCompletion |
| `embedding` | `embeddings.create()` | Vectors |
| `image` | `images.generate()` | Image URLs |
| `agent` | Same as `chat` | ChatCompletion |

**Important**: `embedding` and `image` only pass
through `additionalProperties` from model options —
chat-specific options (temperature, top_p, etc.) are
not valid for these APIs.

---

## Connection Registry

The connection registry decouples credential
management from `.prompty` files.

### Why It Exists

API keys can be embedded in `.prompty` files via
`${env:VAR}`, but complex credentials (Azure AAD,
managed identity, custom token providers) cannot.
The registry lets users pre-configure SDK clients
in code and reference them by name.

### The Contract

```text
register_connection(name, client) → void
get_connection(name) → any
clear_connections() → void
```

**Rules:**

1. Thread-safe (use a lock/mutex).
2. `register_connection` validates: name not empty,
   client not null.
3. `get_connection` throws if name not registered,
   with a message listing registered names.
4. `clear_connections` for test cleanup.

### How Executors Use It

When the agent's connection is `kind: reference`:

```text
connection = agent.model.connection
if connection is ReferenceConnection:
    client = get_connection(connection.name)
    # Use this pre-configured client directly
elif connection is ApiKeyConnection:
    client = build_client(
        connection.endpoint, connection.apiKey
    )
    # Build a new client from config
```

### `.prompty` File Patterns

```yaml
# Pattern 1: Self-contained API key
model:
  connection:
    kind: key
    endpoint: ${env:ENDPOINT}
    apiKey: ${env:API_KEY}

# Pattern 2: Named reference
model:
  connection:
    kind: reference
    name: my-azure-openai
```

---

## Agent Loop

The agent loop is a **pipeline function**
(`run_agent`), not an executor concern.
This design means:

- `.prompty` files don't need a special `apiType` —
  any chat prompt can be used with `run_agent`.
- Tool functions are passed explicitly by the caller,
  not stored in metadata.
- The same design works across languages without
  language-specific hacks.

### Algorithm

```text
function execute_agent(prompt, inputs, tools,
                       max_iterations=10):
    agent = load(prompt)     # if string path
    messages = prepare(agent, inputs)
    iteration = 0

    response = _invoke_executor(agent, messages)

    while has_tool_calls(response):
        iteration += 1
        if iteration > max_iterations:
            raise Error("max_iterations exceeded")

        for tool_call in response.tool_calls:
            fn = tools[tool_call.function.name]

            # Execute with error recovery
            try:
                args = json_parse(
                    tool_call.function.arguments
                )
                result = fn(**args)
            except JSONError as e:
                result = f"Error: invalid JSON: {e}"
            except Exception as e:
                result = f"Error calling tool: {e}"

            # Build tool result message
            messages.append(Message(
                role="tool",
                content=str(result),
                metadata={
                    "tool_call_id": tool_call.id,
                    "name":
                        tool_call.function.name,
                }
            ))

        # Also append assistant message with
        # tool_calls metadata (inserted before
        # tool results in the message list)

        response = _invoke_executor(agent, messages)

    return process(agent, response)
```

### Key Design Decisions

1. **Error recovery over crash**: Bad JSON arguments
   and tool exceptions produce error strings that are
   sent back to the model. The model can self-correct.
   Only `max_iterations` causes a hard failure.

2. **Missing tools are non-fatal**: If the model calls
   a tool that isn't registered, an error message is
   sent back (not an exception). The error includes
   the list of available tools.

3. **Async tool support**: In the async variant, if a
   tool function is async/coroutine, await it. Sync
   tools work in both sync and async modes. Async
   tools in sync mode produce an error message.

4. **Tool result message format**: The tool result is
   a `Message` with `role: "tool"`, content as a
   `TextPart`, and metadata containing `tool_call_id`
   and `name`. The wire format mapper passes metadata
   through.

### has_tool_calls() Check

```text
response.choices exists
AND response.choices is not empty
AND response.choices[0].finish_reason
    == "tool_calls"
AND response.choices[0].message.tool_calls
    is not empty
```

---

## Streaming

### Streaming Architecture

Streaming is handled at the executor and processor
level:

1. **Executor**: When `stream: true` is in options,
   wraps the raw SDK stream in a `PromptyStream`
   (sync) or `AsyncPromptyStream` (async). The
   wrapper accumulates chunks for tracing.

2. **Processor**: Recognizes streaming responses and
   yields delta content via a generator.

### PromptyStream Contract

```text
class PromptyStream:
    wraps: Iterator of chunks
    accumulates: list of all chunks (for tracing)

    iterate():
        for chunk in wrapped_iterator:
            accumulate(chunk)
            yield chunk
        on_exhaustion:
            flush accumulated data to tracer
```

### Processor Streaming Logic

The processor's stream generator must handle:

1. **Content deltas**:
   `chunk.choices[0].delta.content` — yield as string.
2. **Tool call deltas**: Accumulate by `index` field
   across chunks. Each chunk may contain partial
   `function.name` and/or `function.arguments`. At
   stream end, yield complete `ToolCall` objects.
3. **Refusal deltas**:
   `chunk.choices[0].delta.refusal` — accumulate and
   raise `ValueError` at stream end.
4. **Empty chunks**: `chunk.choices` may be empty
   (heartbeat) — skip silently.
5. **Finish reason**: Track
   `chunk.choices[0].finish_reason` for detecting
   tool calls vs. stop.

### Tool Call Delta Accumulation

Tool call deltas arrive across multiple chunks with
an `index` field:

```text
Chunk 1: tool_calls=[{index: 0, id: "call_1",
  function: {name: "get_", arguments: ""}}]
Chunk 2: tool_calls=[{index: 0,
  function: {name: "weather", arguments: "{\"lo"}}]
Chunk 3: tool_calls=[{index: 0,
  function: {arguments: "cation\": \"Seattle\"}"}}]
```

Accumulate by index: concatenate `function.name` and
`function.arguments` across chunks. Yield the complete
`ToolCall` at stream end.

---

## Tracing

Tracing is opt-in and pluggable. The tracer registry
holds named backends. Runtimes MUST support the
`.tracy` file format for run visualization.

### Tracing Architecture

```text
Tracer.add("console", console_tracer_fn)
Tracer.add("otel", otel_tracer_fn)
Tracer.add("prompty", prompty_tracer_fn)

# Pipeline functions use:
with Tracer.start("operation_name") as t:
    t("key", value)
    ...
    t("result", result)
```

### Tracer Contract

A tracer backend is a **factory function**:

```text
tracer_factory(span_name: string) → span_callback | null
```

The factory is called when a new span starts. It
returns a callback that receives `(key, value)` pairs
during the span's lifetime. The special key `"__end__"`
signals span completion.

```text
span_callback(key: string, value: any) → void
```

### `.tracy` File Format

The `.tracy` file is a JSON document written by the
`PromptyTracer` backend. It captures a complete
execution trace for visualization in the VS Code
extension's trace viewer.

#### Top-Level Structure

```json
{
  "runtime": "typescript",
  "version": "2.0.0",
  "trace": { /* root trace frame */ }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `runtime` | string | Language runtime (`"python"`, `"typescript"`, `"csharp"`, etc.) |
| `version` | string | Runtime version |
| `trace` | object | Root trace frame (see Frame Structure) |

#### File Naming

```text
<prompt-name>.<YYYYMMDD>.<HHmmss>.tracy
```

Example: `basic-chat.20260326.143507.tracy`

Written to a `.runs/` directory in the workspace root.

#### Frame Structure

Every frame in the trace tree has the same shape:

```json
{
  "name": "FoundryExecutor",
  "signature": "prompty.foundry.executor.FoundryExecutor.invoke",
  "description": "Optional human description",
  "inputs": { /* what went in */ },
  "result": { /* what came out */ },
  "__time": {
    "start": "2026-03-26T10:25:42.072706",
    "end": "2026-03-26T10:25:46.358027",
    "duration": 4285
  },
  "__usage": {
    "prompt_tokens": 52,
    "completion_tokens": 19,
    "total_tokens": 71
  },
  "__frames": [ /* child frames */ ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Frame display name — use the class name for invoker steps |
| `signature` | string | No | Qualified path for programmatic identification |
| `description` | string | No | Human-readable description |
| `inputs` | any | No | Data passed into this step |
| `result` | any | No | Data returned from this step |
| `__time` | object | Yes | `{start, end, duration}` — see Time Format |
| `__usage` | object | No | Token usage — hoisted from child frames |
| `__frames` | array | No | Child frames (nested spans) |

Additional keys emitted via `span("key", value)` are
preserved on the frame as-is (e.g., `type`, `iterations`).

#### Time Format

```json
{
  "start": "2026-03-26T10:25:42.072706",
  "end": "2026-03-26T10:25:46.358027",
  "duration": 4285
}
```

- `start` / `end`: ISO 8601 **without timezone**,
  microsecond precision: `YYYY-MM-DDTHH:MM:SS.ffffff`
- `duration`: milliseconds (integer), computed as
  `end - start`

#### Usage Hoisting

When a frame's `result` contains a `usage` object
(e.g., from an LLM API response), the tracer
extracts it into `__usage` on that frame AND
propagates it up to all ancestor frames by
**summing** token counts.

```text
run.__usage = executor.__usage + processor.__usage
execute.__usage = run.__usage
root.__usage = execute.__usage
```

This allows any level of the tree to show total
token consumption for its subtree.

### Trace Tree Structure

Every runtime MUST produce a trace tree matching
this structure. Frame names and signatures MUST
reflect the **actual** classes/functions used at
runtime — never hardcoded labels.

```text
<prompt-name>                              ← root wrapper
  sig: prompty.<context>.execute           (context = "cli", "vscode", etc.)
  inputs: { prompt_path, inputs }
  result: <final output>
  │
  └── execute                              ← pipeline orchestrator
        sig: prompty.execute
        inputs: { prompt: <serialized agent>, inputs: <user inputs> }
        result: <final output>
        │
        ├── prepare                        ← template → messages
        │     sig: prompty.prepare
        │     inputs: <validated inputs>
        │     result: [<serialized messages>]
        │     │
        │     ├── <RendererClass>          ← e.g. "NunjucksRenderer", "Jinja2Renderer"
        │     │     sig: prompty.renderers.<RendererClass>.render
        │     │     inputs: { data: <template inputs> }
        │     │     result: <rendered string>
        │     │
        │     └── <ParserClass>            ← e.g. "PromptyChatParser"
        │           sig: prompty.parsers.<ParserClass>.parse
        │           inputs: <rendered string>
        │           result: [{ role, content }, ...]
        │
        └── run                            ← LLM call → result
              sig: prompty.run
              inputs: [<serialized messages>]
              result: <processed output>
              │
              ├── <ExecutorClass>          ← e.g. "FoundryExecutor", "OpenAIExecutor"
              │     sig: prompty.<provider>.executor.<Class>.invoke
              │     inputs: { data: <messages> }
              │     result: <raw API response>
              │     │
              │     ├── <ClientClass>      ← e.g. "AzureOpenAI", "OpenAI"
              │     │     sig: <ClientClass>.ctor
              │     │     inputs: <sanitized constructor kwargs>
              │     │     result: <class name>
              │     │
              │     └── create             ← the actual SDK API call
              │           sig: <ClientClass>.chat.completions.create
              │           inputs: <wire format args>
              │           result: <raw response>
              │
              └── <ProcessorClass>         ← e.g. "FoundryProcessor", "OpenAIProcessor"
                    sig: prompty.<provider>.processor.<Class>.invoke
                    inputs: { data: <raw response> }
                    result: <processed output>
```

### Frame Name Rules

Frame names MUST reflect what is actually executing:

| Frame | Name Source | Example |
|-------|------------|---------|
| Root | Prompt file basename (no `.prompty`) | `basic-chat` |
| Renderer | `renderer.constructor.name` or class name | `NunjucksRenderer`, `Jinja2Renderer` |
| Parser | `parser.constructor.name` or class name | `PromptyChatParser` |
| Executor | `executor.constructor.name` or class name | `FoundryExecutor`, `OpenAIExecutor` |
| Processor | `processor.constructor.name` or class name | `FoundryProcessor`, `OpenAIProcessor` |
| Client ctor | `client.constructor.name` (the actual SDK class) | `AzureOpenAI`, `OpenAI` |
| API call | The SDK method name | `create`, `generate` |

**Never hardcode class names in trace output.** Use
the actual runtime type — if someone registers a
custom executor, its real class name should appear.

For **client ctor inputs**, trace what actually
happened:
- If a pre-registered client was used (reference
  connection), trace `{source: "reference", name: "..."}`
- If a new client was constructed, trace the
  constructor kwargs (with secrets sanitized)

### Per-Frame Data Contracts

#### `load` frame

```json
{
  "inputs": { "prompty_file": "/path/to/chat.prompty" },
  "result": {
    "name": "basic-chat",
    "description": "A chat prompt",
    "model": { "id": "gpt-4", "api": "chat", "provider": "foundry" },
    "inputs": [{ "name": "question", "kind": "string" }],
    "outputs": [],
    "tools": [],
    "template": { "format": "nunjucks", "parser": "prompty" },
    "instructions": "system:\nYou are helpful.\n\nuser:\n{{question}}"
  }
}
```

The load result should be the **full serialized agent**
with sensitive fields (apiKey, secrets) redacted.

#### Renderer frame

```json
{
  "inputs": { "data": { "question": "What is 2+2?" } },
  "result": "system:\nYou are helpful.\n\nuser:\nWhat is 2+2?"
}
```

The renderer traces the actual template inputs and
the rendered output string.

#### Parser frame

```json
{
  "inputs": "system:\nYou are helpful.\n\nuser:\nWhat is 2+2?",
  "result": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "What is 2+2?" }
  ]
}
```

#### Executor frame

The executor's own frame wraps two sub-frames:

1. **Client ctor**: how the SDK client was obtained
2. **API call**: the actual SDK method invocation with
   full wire-format arguments and raw response

```json
{
  "inputs": { "data": [{"role": "system", ...}, {"role": "user", ...}] },
  "result": { "choices": [...], "usage": {...}, ... }
}
```

#### API call sub-frame

```json
{
  "name": "create",
  "signature": "AzureOpenAI.chat.completions.create",
  "inputs": {
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "system", "content": "You are helpful." },
      { "role": "user", "content": "What is 2+2?" }
    ],
    "temperature": 0.7
  },
  "result": { "id": "chatcmpl-...", "choices": [...], "usage": {...} }
}
```

This is the most valuable frame for debugging — it
shows exactly what went over the wire and what came
back.

#### Processor frame

```json
{
  "inputs": { "data": { "choices": [...], "usage": {...} } },
  "result": "4"
}
```

### Sanitization

Before writing to `.tracy`, all frame data MUST be
sanitized to redact sensitive values. The sanitizer
walks the data tree and replaces values whose keys
match sensitive patterns:

**Keys to redact** (case-insensitive match):

- `api_key`, `apiKey`, `api-key`
- `secret`, `password`, `token`, `credential`
- `authorization`, `auth`

**Replacement value**: `"***REDACTED***"`

The sanitizer must be **recursive** — it walks into
nested objects and arrays.

### PromptyTracer Implementation

Each runtime MUST provide a `PromptyTracer` class that:

1. **Maintains a frame stack** — new spans push frames,
   `__end__` pops them.
2. **Nests child frames** — when a frame ends with
   items still on the stack, it becomes a child
   (`__frames`) of the parent.
3. **Computes `__time`** — start on push, end on pop,
   duration as `end - start` in milliseconds.
4. **Hoists `__usage`** — extracts from `result.usage`,
   sums across children, propagates to ancestors.
5. **Writes the `.tracy` file** when the root frame
   ends (stack becomes empty).
6. **Exposes `lastTracePath`** — so callers (e.g., the
   VS Code extension) can find the written file.

The `PromptyTracer` factory MUST be bound to the
instance so it can be passed directly to
`Tracer.add()`:

```typescript
// TypeScript
const tracer = new PromptyTracer({ outputDir: ".runs" });
Tracer.add("prompty", tracer.factory);
// ... execute ...
console.log(tracer.lastTracePath);
```

```python
# Python
tracer = PromptyTracer(output_dir=".runs")
Tracer.add("prompty", tracer)
# ... execute ...
print(tracer.last_trace_path)
```

---

## Error Handling

### Error Types

| Error | When |
|-------|------|
| `FileNotFoundError` | `.prompty` file or `${file:}` not found |
| `ValueError` | Bad frontmatter, missing env var, bad apiType |
| `TypeError` | Wrong argument types to pipeline functions |
| `InvokerError` | No invoker found for key |

### Error Messages

Error messages should be actionable:

- **Missing invoker**: "No renderer found for 'xyz'.
  Install the appropriate package, e.g.:
  `uv pip install prompty[xyz]`"
- **Missing connection**: "No connection registered
  with name 'foo'. Call
  `prompty.register_connection('foo', client=...)`
  at startup. Currently registered: bar, baz"
- **Missing env var**: "Environment variable
  'API_KEY' not set for key 'apiKey'"

---

## Testing Strategy

### Unit Test Categories

| Category | What to test | Mock strategy |
|----------|-------------|---------------|
| Loader | Frontmatter, migration, `${}` | `os.environ`, temp files |
| Renderer | Interpolation, nonces | No mocks needed |
| Parser | Role splitting, nonces | No mocks needed |
| Executor | Wire format, dispatch | Mock SDK client |
| Processor | Extraction, streaming | Mock response objects |
| Pipeline | prepare/execute/process | Mock invoker stages |
| Agent loop | Tools, error recovery | Mock execute/process |
| Connections | Register, get, clear | No mocks needed |
| Discovery | Entry points, caching | Mock entry point metadata |

### Test Fixtures

Keep `.prompty` test files in `tests/prompts/`
covering:

- Basic new format
- Minimal (just name + model)
- Tools (function, mcp, openapi, custom)
- Thread separator
- Legacy v1 format
- Shared config via `${file:...}`

### Integration Tests

Separate from unit tests. Require real API keys.
Should be opt-in (not in default test run).

Cover: chat, embedding, image, agent loop, streaming,
structured output.

---

## Implementation Checklist

When implementing a new language runtime:

### Phase 1: Loader

- [ ] YAML frontmatter / markdown body splitting
- [ ] Safe YAML parsing
- [ ] `${env:VAR}` and `${file:path}` resolution
- [ ] Legacy v1 migration with deprecation warnings
- [ ] Thread-kind input handling (nonce-based)
- [ ] `kind: "prompt"` injection
- [ ] AgentSchema type loading → `PromptAgent`
- [ ] Tests: basic, minimal, legacy, env, file, thread

### Phase 2: Pipeline Abstractions

- [ ] Renderer, Parser, Executor, Processor interfaces
- [ ] Discovery mechanism (language-appropriate)
- [ ] Four-step pipeline: `render()`, `parse()`, `prepare()`, `run()`, `execute()`
- [ ] Composite functions: `prepare()` = render+parse, `run()` = executor+process
- [ ] Top-level orchestrator: `execute()` = load+prepare+run
- [ ] Async variants of all pipeline functions
- [ ] Input validation (`validate_inputs()`)
- [ ] Tests: protocols, discovery, pipeline

### Phase 3: Concrete Implementations

- [ ] Jinja2/Mustache renderer (or equivalent)
- [ ] Prompty chat parser (role markers → messages)
- [ ] OpenAI executor (wire format, API dispatch)
- [ ] OpenAI processor (response extraction)
- [ ] Azure OpenAI executor (extends OpenAI)
- [ ] Tests: rendering, parsing, execution, processing

### Phase 4: Features

- [ ] Structured output (`outputSchema`)
- [ ] Embedding API (`apiType: embedding`)
- [ ] Image generation API (`apiType: image`)
- [ ] Streaming wrappers with tracing
- [ ] Connection registry
- [ ] Agent loop (`execute_agent` with error recovery)
- [ ] `headless()` for programmatic agent creation
- [ ] Tests: structured output, streaming, agent loop

### Phase 5: Tracing

- [ ] Tracer registry (add/remove backends)
- [ ] `traceSpan()` / `@trace` decorator or equivalent
- [ ] Console tracer
- [ ] `PromptyTracer` — `.tracy` file writer
  - [ ] Frame stack with push/pop
  - [ ] `__time` computation (ISO 8601, ms duration)
  - [ ] `__usage` hoisting from results + children
  - [ ] `.tracy` JSON file writing on root frame end
  - [ ] `lastTracePath` for callers
- [ ] Pipeline trace integration
  - [ ] Renderer/Parser frames use actual class names
  - [ ] Executor frame with client ctor + API call sub-frames
  - [ ] Processor frame with actual class name
  - [ ] Full data in inputs/result (not summaries)
  - [ ] Sensitive data sanitization (apiKey, secrets)
- [ ] OpenTelemetry backend (optional dependency)
- [ ] Tests: tracer registry, PromptyTracer file output,
  frame nesting, usage hoisting, sanitization

### Phase 6: Polish

- [ ] README with quick start and API reference
- [ ] Error messages are actionable
- [ ] Optional dependencies are truly optional
- [ ] Integration tests against real endpoints
