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
`outputSchema`, `tools`, `template`,
`additionalInstructions`

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

### Thread Separator

`![thread]` splits `instructions` from
`additionalInstructions`:

```text
system:
You are a helpful assistant.

![thread]

user:
{{question}}
```

Everything before `![thread]` → `instructions`
(the system prompt).
Everything after → `additionalInstructions`
(user turn template, typically with `{{variables}}`).

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
Handle ![thread]
     │  Split instructions at "\n![thread]"
     │  Part 1 → instructions
     │  Part 2 → additionalInstructions
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

```text
PromptAgent + inputs
     │
     ▼
  prepare(agent, inputs)
     │
     ├─ Renderer.render(agent, instructions, inputs)
     │    → rendered string
     │    Dispatched by: agent.template.format.kind
     │    (e.g., "jinja2")
     │
     ├─ Parser.parse(agent, rendered_string)
     │    → list[Message]
     │    Dispatched by: agent.template.parser.kind
     │    (e.g., "prompty")
     │
     └─ Thread expansion:
        if additionalInstructions, render + parse
        those too, append to message list
     │
     ▼
  execute(agent, messages)
     │
     ├─ Executor.execute(agent, messages)
     │    → raw LLM response
     │    Dispatched by: agent.model.provider
     │    (e.g., "openai")
     │
     ▼
  process(agent, response)
     │
     ├─ Processor.process(agent, response)
     │    → clean result
     │    Dispatched by: agent.model.provider
     │    (e.g., "openai")
     │
     ▼
  Result (string, JSON, embeddings, image URLs)
```

### `prepare()` Details

1. Resolve template format and parser from
   `agent.template` (defaults: format=`jinja2`,
   parser=`prompty`).
2. If the parser implements a `pre_render()` hook,
   call it to get a sanitized template and context.
3. Call `renderer.render(agent, template, inputs)`.
4. Call
   `parser.parse(agent, rendered_string, **context)`.
5. If `agent.additionalInstructions` exists, render
   and parse those too (using the same inputs), then
   append to the message list.
6. Return the final `list[Message]`.

### `execute()` Details

1. Look up executor by `agent.model.provider`
   (defaults to `"openai"`).
2. The executor converts abstract `Message` objects
   to the provider's wire format.
3. Dispatches on `agent.model.apiType`: `"chat"`
   (default), `"embedding"`, `"image"`.
4. Makes the SDK call and returns the raw response.

### `process()` Details

1. Look up processor by `agent.model.provider`.
2. Dispatches on response type: chat completion →
   extract content, embedding → extract vectors,
   image → extract URLs.
3. If `agent.outputSchema` exists and response is a
   chat completion, JSON-parse the content.
4. Streaming responses are wrapped and yield chunks.

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
function run_agent(prompt, inputs, tools,
                   max_iterations=10):
    agent = load(prompt)     # if string path
    messages = prepare(agent, inputs)
    iteration = 0

    response = execute(agent, messages)

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

        response = execute(agent, messages)

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
holds named backends.

### Tracing Architecture

```text
Tracer.add("console", console_tracer_fn)
Tracer.add("otel", otel_tracer_fn)

# Pipeline functions use:
with Tracer.start("operation_name") as t:
    t("key", value)
    ...
    t("result", result)
```

### Tracer Contract

A tracer backend is a function/callable:

```text
tracer_fn(operation_name: string) → ContextManager
```

The context manager receives `(key, value)` calls
during its lifetime.

### What Gets Traced

| Operation | Trace Name | Key Data |
|-----------|-----------|----------|
| Loading | `load` | path, agent name |
| Rendering | `Renderer.render` | template type, inputs |
| Parsing | `Parser.parse` | message count |
| Execution | `chat.completions` | model, options, msgs |
| Processing | `Processor.process` | response type |
| Agent loop | `AgentLoop` | tools, iterations |

### Serialization

The `to_dict()` helper converts complex objects for
tracing. Key rules:

- Check for `model_dump()` (Pydantic v2) first.
- Then `to_dict()` on the object itself.
- Booleans before numbers (booleans are subtypes of
  int in Python).
- Dataclasses, dicts, lists, primitives all handled.

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
- [ ] `![thread]` separator handling
- [ ] `kind: "prompt"` injection
- [ ] AgentSchema type loading → `PromptAgent`
- [ ] Tests: basic, minimal, legacy, env, file, thread

### Phase 2: Pipeline Abstractions

- [ ] Renderer, Parser, Executor, Processor interfaces
- [ ] Discovery mechanism (language-appropriate)
- [ ] `prepare()`, `execute()`, `process()`, `run()`
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
- [ ] Agent loop (`run_agent` with error recovery)
- [ ] `headless()` for programmatic agent creation
- [ ] Tests: structured output, streaming, agent loop

### Phase 5: Tracing

- [ ] Tracer registry (add/remove backends)
- [ ] `@trace` decorator or equivalent
- [ ] Console tracer
- [ ] OpenTelemetry backend (optional dependency)
- [ ] Tests: tracer registry, decorator, serialization

### Phase 6: Polish

- [ ] README with quick start and API reference
- [ ] Error messages are actionable
- [ ] Optional dependencies are truly optional
- [ ] Integration tests against real endpoints
