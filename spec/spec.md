# Prompty Runtime Specification

**Version**: 0.1.0-draft
**Status**: Draft
**Date**: 2026-04-04

> This specification defines the runtime behavior of Prompty — a markdown file format
> and execution pipeline for LLM prompts. It is language-agnostic: implementations in
> any programming language MUST conform to the behavioral contracts defined here.
>
> The type system (data model) is defined separately in TypeSpec (`schema/`). This
> specification covers what implementations DO with those types.

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

---

## §1 Overview & Architecture

### §1.1 What is Prompty?

Prompty is a markdown file format (`.prompty`) for LLM prompts paired with a runtime
pipeline that loads, renders, parses, executes, and post-processes those prompts.

A `.prompty` file consists of:

- **YAML frontmatter** — configuration: model settings, input/output schemas, tool
  definitions, template engine selection, and metadata.
- **Markdown body** — the prompt template containing role markers, template variables,
  and instructions that become the `instructions` field on the loaded agent.

### §1.2 Type System

The data model (types such as `PromptAgent`, `Model`, `Connection`, `Property`, `Tool`,
and their subtypes) is defined in TypeSpec (`schema/`) and generated into each target
language. This specification does **not** redefine those types. It defines the **runtime
behavior**: what implementations do with those types at each pipeline stage.

When this specification refers to a type name (e.g., `PromptAgent`, `Message`,
`FunctionTool`), it refers to the generated type from the TypeSpec schema or the
runtime-defined type described in this specification.

### §1.3 Pipeline Architecture

Every `.prompty` file passes through a five-stage pipeline. Tracing (§3) wraps every
stage. Registries (§11, future section) provide pluggable discovery for renderers,
parsers, executors, and processors.

```
                        ┌─────────────────────────────────┐
                        │        .prompty file             │
                        │  ┌───────────┐ ┌──────────────┐ │
                        │  │ YAML      │ │ Markdown     │ │
                        │  │ frontmatter│ │ body         │ │
                        │  └───────────┘ └──────────────┘ │
                        └────────────┬────────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
                    │  §4  LOAD                        │
                    │  parse frontmatter + body         │
                    │  resolve ${env:} ${file:}         │
                    │  produce PromptAgent              │
                    └────────────────┬─────────────────┘
                                     │ PromptAgent
                    ┌────────────────▼─────────────────┐
                    │  §5  RENDER                      │
                    │  template engine (Jinja2/Mustache)│
                    │  substitute inputs into template  │
                    │  replace rich kinds with nonces   │
                    └────────────────┬─────────────────┘
                                     │ rendered string
                    ┌────────────────▼─────────────────┐
                    │  §6  PARSE                       │
                    │  split on role markers            │
                    │  build Message[] list             │
                    │  expand thread nonces → messages  │
                    └────────────────┬─────────────────┘
                                     │ Message[]
                    ┌────────────────▼─────────────────┐
                    │  §7  EXECUTE (future section)    │
                    │  convert to wire format           │
                    │  call LLM provider API            │
                    │  handle streaming                 │
                    └────────────────┬─────────────────┘
                                     │ raw API response
                    ┌────────────────▼─────────────────┐
                    │  §8  PROCESS (future section)    │
                    │  extract content / tool_calls     │
                    │  structured output parsing        │
                    └────────────────┬─────────────────┘
                                     │ final result
                                     ▼

    ╔═══════════════════════════════════════════════════════╗
    ║  TRACING (§3) wraps every stage above.               ║
    ║  Every function emits a span with inputs and result. ║
    ╚═══════════════════════════════════════════════════════╝
```

### §1.4 Composite Operations

The five pipeline stages compose into higher-level operations:

| Operation      | Composition                            | Description                            |
| -------------- | -------------------------------------- | -------------------------------------- |
| `prepare`      | render + parse + thread expansion      | Produce `Message[]` ready for the LLM  |
| `run`          | execute + process                      | Standalone: execute + process (building block) |
| `invoke`       | load + prepare + execute + process     | One-shot pipeline: load + prepare + execute + process |
| `turn`         | prepare + [agent loop] + process       | Conversational round: prepare + [agent loop] + process. Accepts `tools` option for tool-calling. Primary API for multi-turn conversations. |

> **Naming note**: The pipeline stage that calls the LLM is called **execute** (the
> `ExecutorProtocol`). The top-level convenience function that runs the entire pipeline
> end-to-end is called **invoke** to avoid ambiguity. For multi-turn conversations with
> optional tool-calling, use **turn**.

### §1.5 Public API Surface

Implementations MUST expose the following functions. Each function MUST have an async
variant (e.g., `load_async`). Each function SHOULD have a sync variant.

| Function           | Signature                                    | Returns          | Spec Section |
| ------------------ | -------------------------------------------- | ---------------- | ------------ |
| `load`             | `(path: string) → PromptAgent`               | PromptAgent      | §4           |
| `render`           | `(agent, inputs) → string`                   | Rendered string  | §5           |
| `parse`            | `(agent, rendered) → Message[]`              | Message list     | §6           |
| `prepare`          | `(agent, inputs) → Message[]`                | Message list     | §5 + §6      |
| `run`              | `(agent, messages) → result`                 | Processed result | §7 + §8      |
| `turn`             | `(agent_or_path, inputs, options?) → result`  | Processed result | §14          |
| `turn<T>`          | `(agent_or_path, inputs, options?) → T`       | Typed result     | §14 + §8.8   |
| `invoke`           | `(path_or_agent, inputs) → result`            | Processed result | §4–§8        |
| `invoke<T>`        | `(path_or_agent, inputs, target_type?) → T`   | Typed result     | §4–§8 + §8.8 |
| `cast`             | `(result, target_type) → T`                  | Typed result     | §8.8         |
| `process`          | `(agent, response) → result`                 | Extracted result | §8           |
| `validate_inputs`  | `(agent, inputs) → validated_inputs`         | Validated dict   | §12          |

**Async contract**: All pipeline functions MUST have async variants. Implementations
SHOULD also provide sync variants. When both exist, they MUST produce identical results
for the same inputs.

### §1.6 Conformance Levels

This specification uses three conformance levels:

- **MUST** — An absolute requirement. An implementation that does not satisfy a MUST
  requirement is non-conformant.
- **SHOULD** — Recommended but not required. An implementation may omit a SHOULD
  requirement with good reason, but the implications must be understood.
- **MAY** — Truly optional. An implementation may provide or omit a MAY feature freely.

---

## §2 File Format

### §2.1 Structure

A `.prompty` file consists of an optional YAML frontmatter block followed by a markdown
body. The frontmatter is delimited by `---` or `+++` markers:

```
---
<YAML frontmatter>
---
<markdown body>
```

The markdown body becomes the `instructions` field on the loaded `PromptAgent`.

If no frontmatter markers are found, the entire file content MUST be treated as the body
(instructions only), with no frontmatter properties set.

If frontmatter markers are found but the content between them is not valid YAML,
implementations MUST raise a parse error (`ValueError` or equivalent).

### §2.2 Frontmatter Splitting

Implementations MUST split frontmatter from body using the following contract:

**Reference regex**:

```
^\s*(?:---|\+\+\+)(.*?)(?:---|\+\+\+)\s*(.+)$
```

With flags: **dotall** (`.` matches newlines) and **multiline**.

- **Group 1**: YAML frontmatter content (between the delimiters).
- **Group 2**: Markdown body (everything after the closing delimiter).

**Behavior**:

1. If the content does not start with a frontmatter delimiter (`---` or `+++`), return
   `{instructions: <entire content>}` — no frontmatter is parsed.
2. If a delimiter is found at the start but no closing delimiter matches, implementations
   MUST raise a `ValueError` (malformed frontmatter).
3. Leading whitespace before the opening delimiter is permitted.
4. The opening and closing delimiters need not match (e.g., `---` may close with `+++`),
   but implementations SHOULD use matching delimiters.

**Test vectors** (normative — tie-breaker for ambiguous behavior):

```yaml
# Vector 1: Standard frontmatter
input: "---\nname: test\n---\nHello world"
frontmatter: "name: test"
body: "Hello world"

# Vector 2: No frontmatter
input: "Just a prompt with no frontmatter"
frontmatter: null
body: "Just a prompt with no frontmatter"

# Vector 3: Empty frontmatter
input: "---\n---\nBody only"
frontmatter: ""
body: "Body only"

# Vector 4: Whitespace before delimiter
input: "  ---\nname: test\n---\nBody"
frontmatter: "name: test"
body: "Body"
```

### §2.3 Frontmatter Properties

The following properties are valid at the top level of the frontmatter YAML. The types
correspond to the TypeSpec-generated data model.

| Property      | Type                     | Description                                    |
| ------------- | ------------------------ | ---------------------------------------------- |
| `name`        | `string`                 | Prompt name identifier                         |
| `displayName` | `string`                 | Human-readable display name                    |
| `description` | `string`                 | Prompt description                             |
| `metadata`    | `dict`                   | Arbitrary metadata (authors, tags, version, etc.) |
| `model`       | `Model` or `string`      | Model configuration (see §2.4)                 |
| `inputs`      | `Property[]` or `dict`   | Input schema definition (see §2.6)             |
| `outputs`     | `Property[]` or `dict`   | Output schema definition (see §2.6)            |
| `tools`       | `Tool[]`                 | Tool definitions (see §2.8)                    |
| `template`    | `Template`               | Template engine configuration (see §2.7)       |

Unknown top-level properties SHOULD be preserved in `metadata` or ignored. Implementations
MUST NOT raise an error for unknown properties.

### §2.4 Model

The `model` property configures the LLM provider and parameters.

**Shorthand form**: When `model` is a plain string, it is equivalent to `Model(id: <string>)`.

```yaml
# Shorthand
model: gpt-4

# Equivalent expanded form
model:
  id: gpt-4
```

**Full Model properties**:

| Property     | Type             | Default   | Description                                         |
| ------------ | ---------------- | --------- | --------------------------------------------------- |
| `id`         | `string`         | —         | Model identifier (e.g., `gpt-4`, `text-embedding-3-small`) |
| `provider`   | `string`         | —         | Provider key: `openai`, `azure`, `anthropic`, `foundry`, etc. |
| `apiType`    | `string`         | `"chat"`  | API type: `chat`, `embedding`, `image`, `responses` |
| `connection` | `Connection`     | —         | Authentication and endpoint configuration           |
| `options`    | `ModelOptions`   | —         | Model parameters (temperature, tokens, etc.)        |

### §2.5 Connection

The `connection` property under `model` defines how to authenticate with the LLM provider.
Connection types are discriminated by the `kind` field:

| Kind          | Required Fields                | Description                             |
| ------------- | ------------------------------ | --------------------------------------- |
| `key`         | `endpoint`, `apiKey`           | API key authentication                  |
| `reference`   | `name`                         | Named reference to external config      |
| `remote`      | `endpoint`, `target`           | Remote connection with auth mode        |
| `anonymous`   | `endpoint`                     | No authentication                       |
| `foundry`     | `endpoint`                     | Microsoft Foundry connection             |
| `oauth`       | `endpoint`, `authenticationMode` | OAuth-based authentication            |

### §2.6 ModelOptions

| Property                  | Type       | Description                                |
| ------------------------- | ---------- | ------------------------------------------ |
| `temperature`             | `float`    | Sampling temperature (0.0–2.0)             |
| `maxOutputTokens`         | `integer`  | Maximum tokens in the completion           |
| `topP`                    | `float`    | Nucleus sampling threshold                 |
| `topK`                    | `integer`  | Top-K sampling (provider-dependent)        |
| `frequencyPenalty`        | `float`    | Frequency penalty (-2.0–2.0)              |
| `presencePenalty`         | `float`    | Presence penalty (-2.0–2.0)               |
| `seed`                    | `integer`  | Random seed for reproducibility            |
| `stopSequences`           | `string[]` | Sequences that stop generation             |
| `allowMultipleToolCalls`  | `boolean`  | Allow parallel tool calls                  |
| `additionalProperties`    | `dict`     | Provider-specific options (passthrough)    |

### §2.7 Input/Output Schema (Property)

Input and output schemas define the data contract for the prompt. Each property in the
schema is a `Property` object:

| Field          | Type       | Description                                         |
| -------------- | ---------- | --------------------------------------------------- |
| `kind`         | `string`   | Type discriminator (see below)                      |
| `description`  | `string`   | Human-readable description                          |
| `required`     | `boolean`  | Whether the input is required (default: `false`)    |
| `default`      | `any`      | Default value when input is not provided            |
| `example`      | `any`      | Example value (for documentation/testing)           |
| `enumValues`   | `any[]`    | Allowed values (enum constraint)                    |

**Property kinds**:

| Kind      | Description                                   | Category |
| --------- | --------------------------------------------- | -------- |
| `string`  | Text value                                    | Simple   |
| `integer` | Whole number                                  | Simple   |
| `float`   | Decimal number                                | Simple   |
| `boolean` | True/false                                    | Simple   |
| `array`   | List of values                                | Simple   |
| `object`  | Nested dictionary/map                         | Simple   |
| `thread`  | Conversation history (`Message[]`)            | Rich     |
| `image`   | Image data (URL or base64)                    | Rich     |
| `file`    | File data (URL or base64)                     | Rich     |
| `audio`   | Audio data (URL or base64)                    | Rich     |

Rich kinds (`thread`, `image`, `file`, `audio`) receive special handling during
rendering — see §5 for details.

**Scalar shorthand**: When a property value is a plain scalar instead of a `Property`
object, it MUST be interpreted as `Property(kind: <inferred>, default: <value>)`.

```yaml
# Shorthand
inputs:
  firstName: Jane

# Equivalent expanded form
inputs:
  firstName:
    kind: string
    default: Jane
```

Kind inference from scalar type: string → `"string"`, integer → `"integer"`,
float → `"float"`, boolean → `"boolean"`, list → `"array"`, dict → `"object"`.

### §2.8 Template

The `template` property selects the template engine and parser.

| Field    | Type     | Default                   | Description                    |
| -------- | -------- | ------------------------- | ------------------------------ |
| `format` | `Format` | `{kind: "jinja2"}`        | Template engine to use         |
| `parser` | `Parser` | `{kind: "prompty"}`       | Output parser to use           |

**Shorthand form**: When `template` is a plain string, it is the format kind:

```yaml
# Shorthand
template: jinja2

# Equivalent
template:
  format:
    kind: jinja2
  parser:
    kind: prompty
```

When `template` is omitted entirely, implementations MUST default to
`{format: {kind: "jinja2"}, parser: {kind: "prompty"}}`.

### §2.9 Tools

Tools are defined as a list under the `tools` frontmatter property. Each tool has a
`kind` discriminator that determines its type and required fields.

**Common fields** (all tool kinds):

| Field        | Type       | Description                               |
| ------------ | ---------- | ----------------------------------------- |
| `name`       | `string`   | Tool name (unique within the agent)       |
| `kind`       | `string`   | Tool type discriminator                   |
| `description`| `string`   | Human-readable tool description           |
| `bindings`   | `dict`     | Static parameter bindings (see §2.9.1)    |

**Tool kinds**:

| Kind       | Type           | Additional Fields                                      |
| ---------- | -------------- | ------------------------------------------------------ |
| `function` | `FunctionTool` | `parameters` (`list[Property]`), `strict` (boolean)    |
| `prompty`  | `PromptyTool`  | `path` (string), `mode` (`single` or `agentic`)        |
| `mcp`      | `McpTool`      | `connection`, `serverName`, `approvalMode`, `allowedTools` |
| `openapi`  | `OpenApiTool`  | `connection`, `specification` (path or URL)             |
| `*`        | `CustomTool`   | `connection`, `options` — wildcard catch-all            |

Any `kind` value that does not match `function`, `prompty`, `mcp`, or `openapi` MUST
be loaded as a `CustomTool` (the wildcard `*` catch-all).

#### §2.9.1 Tool Bindings

Bindings are static parameter values that are injected when a tool is executed but
MUST NOT appear in the tool definition sent to the LLM. This allows prompts to bind
context (user IDs, session tokens, API keys) without exposing them in the tool schema.

```yaml
tools:
  - name: get_user_orders
    kind: function
    description: Get orders for a user
    parameters:
      properties:
        - name: user_id
          kind: string
          required: true
        - name: limit
          kind: integer
          default: 10
    bindings:
      user_id: ${env:CURRENT_USER_ID}
```

**Binding behavior**:

1. When converting tools to wire format (§7), parameters listed in `bindings` MUST be
   **stripped** from the tool's parameter schema sent to the LLM.
2. When executing a tool call from the LLM's response, bound parameters MUST be
   **injected** into the tool's arguments before invocation.
3. If the LLM provides a value for a bound parameter, the binding MUST take precedence.

#### §2.9.2 PromptyTool

The `prompty` tool kind allows one `.prompty` file to invoke another as a tool:

```yaml
tools:
  - name: summarize
    kind: prompty
    path: ./summarize.prompty
    mode: single
    description: Summarize a block of text
```

| Field  | Type     | Default    | Description                                        |
| ------ | -------- | ---------- | -------------------------------------------------- |
| `path` | `string` | —          | Relative path to the `.prompty` file               |
| `mode` | `string` | `"single"` | `single`: one-shot call. `agentic`: full agent loop |

When the LLM invokes this tool:

1. Load the referenced `.prompty` file via `load(path)`.
2. If `mode` is `"single"`: call `invoke(path, arguments)` — one pass, no tool loop.
3. If `mode` is `"agentic"`: call `turn(child_agent, arguments, tools=child_agent_tools)` — full agent loop
   with any tools defined in the referenced prompty.
4. Return the result as the tool's output.

### §2.10 Role Markers

Role markers in the markdown body define message boundaries. Each marker produces a new
message in the parsed `Message[]` list.

**Recognized roles**: `system`, `user`, `assistant`

**Syntax**:

```
role:
role[key=value, key2=value2]:
```

Role markers MUST be on their own line (possibly with leading whitespace or a leading
`#` for markdown heading compatibility). Role names are case-insensitive.

**Examples of valid role markers**:

```
system:
user:
assistant:
  user:
# system:
assistant[nonce=abc123]:
```

**Content between markers** becomes the message content. Leading and trailing blank lines
within a message MUST be trimmed.

**Default role**: If the body has content before any role marker, implementations MUST
treat it as a `system` message.

### §2.11 Reference Resolution

String values in the frontmatter MAY contain `${protocol:value}` references that are
resolved during loading (§4).

#### `${env:VAR_NAME}`

Resolves to the value of environment variable `VAR_NAME`.

- If `VAR_NAME` is not set, implementations MUST raise a `ValueError` (or equivalent).

#### `${env:VAR_NAME:default}`

Resolves to the value of `VAR_NAME`, or `default` if the variable is not set.

- The `default` is everything after the second `:` in the expression.

#### `${file:relative/path}`

Loads file content relative to the `.prompty` file's directory.

- If the file has a `.json` extension, it MUST be parsed as JSON.
- If the file has a `.yaml` or `.yml` extension, it MUST be parsed as YAML.
- All other extensions MUST be read as raw text.
- If the file does not exist, implementations MUST raise a `FileNotFoundError`.

**Resolution scope**: References are resolved in ALL string values throughout the
frontmatter dict tree, not just at the top level. Implementations MUST walk the entire
dict recursively.

---

## §3 Tracing (Core Infrastructure)

Tracing is the cross-cutting observability layer that wraps every pipeline stage.
It is **not optional**: conformant implementations MUST implement the core tracing
infrastructure. Individual backends beyond the `.tracy` file backend are SHOULD/MAY.

### §3.1 Tracer Registry

The tracer registry manages named tracing backends. It MUST be thread-safe.

**Operations**:

| Operation                   | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `add(name, factory)`        | Register a named backend factory                     |
| `remove(name)`              | Unregister a named backend                           |
| `clear()`                   | Remove all registered backends                       |
| `start(spanName) → emitter` | Open ALL registered backends, return a fan-out emitter |

**Factory signature**:

```
factory: (spanName: string) → ContextManager<(key: string, value: any) → void>
```

A factory receives a span name and returns a context manager. On enter, the context
manager yields an emitter function `(key, value) → void`. On exit, the span ends.

**Fan-out**: `start(spanName)` MUST invoke every registered factory and return a
composite emitter that forwards every `(key, value)` call to all active backends
simultaneously. If any individual backend raises an error, it MUST NOT prevent other
backends from receiving the emission.

**Thread safety**: The registry MUST be safe for concurrent `add`/`remove`/`start` calls
from multiple threads or async tasks.

### §3.2 The `@trace` Decorator

The `@trace` decorator (or equivalent wrapper mechanism) instruments a function with
automatic span creation, input capture, and result capture.

**Algorithm**:

```
function trace(fn, options?):
  return wrapped_fn(*args, **kwargs):
    1. signature ← module_name + "." + qualified_name(fn)
    2. bound_args ← bind function parameters to (args, kwargs)
    3. Remove 'self' from bound_args (if present)
    4. If options.ignore_params specified:
         Remove those parameter names from bound_args
    5. emitter ← Tracer.start(signature)
    6. emitter("signature", signature)
    7. emitter("inputs", {name: to_dict(value) for name, value in bound_args})
    8. try:
         result ← call fn(*args, **kwargs)
         emitter("result", to_dict(result))
         return result
       catch error:
         emitter("result", {
           "exception": type_name(error),
           "message": str(error),
           "traceback": format_traceback(error)
         })
         re-raise error
       finally:
         end span (exit context manager)
```

**Requirements**:

- MUST work on async functions (awaiting the result within the span).
- SHOULD work on sync functions.
- SHOULD support custom attributes via decorator arguments or options.
- MUST NOT alter the return value or exception behavior of the wrapped function.
- If no backends are registered, the decorator MUST still call the original function
  (tracing becomes a no-op, not a failure).

### §3.3 Serialization (`to_dict`)

Before emitting values to backends, all values MUST be serialized to a JSON-safe
representation.

**Conversion rules** (applied recursively):

| Input Type             | Output                                |
| ---------------------- | ------------------------------------- |
| `string`               | Passthrough                           |
| `int`, `float`, `bool` | Passthrough                           |
| `null` / `None`        | `null`                                |
| `datetime`             | ISO 8601 string (e.g., `"2026-04-04T12:00:00Z"`) |
| `dataclass` / model    | Dict representation (field → value)   |
| `Path` / file path     | String representation                 |
| `list` / array         | Recursive `to_dict` on each element   |
| `dict` / map           | Recursive `to_dict` on each value     |
| Everything else        | `str(value)` (string coercion)        |

### §3.4 Redaction

Before emitting values to any backend, implementations MUST redact sensitive data.

**Sensitive key detection**: A key is sensitive if it contains any of the following
substrings (case-insensitive match):

- `secret`
- `password`
- `api_key`
- `apikey`
- `token`
- `auth`
- `credential`
- `cookie`

Note: `key` alone is NOT sensitive (too broad). Only compound forms like `api_key`,
`apiKey`, `secret_key` trigger redaction.

**Redacted value**: `"[REDACTED]"` (or language-idiomatic equivalent).

**Scope**: Redaction applies recursively to all dict keys at every nesting level in the
serialized `inputs` and `result` values. Redaction MUST occur before the value reaches
any backend — including the `.tracy` file backend.

### §3.5 Usage Hoisting

Token usage information MUST be propagated from child spans to parent spans.
The tracer MUST preserve the original field names from each provider's response
(e.g. `prompt_tokens`, `input_tokens`, `completion_tokens`, `output_tokens`,
`total_tokens`, `cached_tokens`, etc.) and accumulate them by key.

**Well-known field names**:

| Field Name            | Providers                                  |
| --------------------- | ------------------------------------------ |
| `prompt_tokens`       | OpenAI Chat Completions                    |
| `completion_tokens`   | OpenAI Chat Completions                    |
| `input_tokens`        | Anthropic, OpenAI Responses API            |
| `output_tokens`       | Anthropic, OpenAI Responses API            |
| `total_tokens`        | OpenAI (both APIs)                         |

**Algorithm**:

```
function hoist_usage(span):
  If span.result contains a "usage" field:
    For each (key, value) in span.result.usage where value is numeric:
      span.__usage[key] += value
  For each child in span.__frames:
    hoist_usage(child)  // recursive — deepest spans propagate first
    For each (key, value) in child.__usage:
      span.__usage[key] += value
```

The tracer does NOT normalize or rename fields — it passes through whatever the
provider returns. Consumers (trace viewers, dashboards) SHOULD handle both
naming conventions when displaying token counts. A recommended approach:

- **Input tokens**: use `input_tokens` if present, else `prompt_tokens`
- **Output tokens**: use `output_tokens` if present, else `completion_tokens`
- **Total tokens**: use `total_tokens` if present, else sum all values

Usage hoisting enables the root span to report aggregate token consumption across the
entire pipeline execution, including agent loops with multiple LLM calls.

### §3.6 Built-in Backends

#### §3.6.1 `.tracy` File Backend — MUST Implement

Every conformant implementation MUST provide a `.tracy` file backend that writes
structured JSON traces to disk.

**File naming**: `<sanitized_span_name>.<YYYYMMDD.HHMMSS>.tracy`

- `sanitized_span_name`: the root span name with filesystem-unsafe characters replaced
  by underscores.
- Timestamp: UTC time when the root span **ends**.

**File is written only when the root span ends** — intermediate spans accumulate in
memory.

**JSON schema**:

```json
{
  "runtime": "<language_name>",
  "version": "<prompty_library_version>",
  "trace": {
    "name": "<span_name>",
    "__time": {
      "start": "<ISO8601_UTC>",
      "end": "<ISO8601_UTC>",
      "duration": "<milliseconds_as_number>"
    },
    "signature": "<module.function_name>",
    "inputs": { "<param_name>": "<serialized_value>", "..." : "..." },
    "result": "<serialized_value>",
    "__frames": [
      {
        "name": "<child_span_name>",
        "__time": { "..." : "..." },
        "signature": "...",
        "inputs": { "..." : "..." },
        "result": "...",
        "__frames": []
      }
    ],
    "__usage": {
      "prompt_tokens": 0,
      "completion_tokens": 0,
      "total_tokens": 0
    }
  }
}
```

**Field definitions**:

| Field        | Type     | Description                                             |
| ------------ | -------- | ------------------------------------------------------- |
| `runtime`    | `string` | Language/runtime name (e.g., `"python"`, `"csharp"`, `"javascript"`) |
| `version`    | `string` | Prompty library version (e.g., `"2.0.0"`)               |
| `name`       | `string` | Span name                                               |
| `__time`     | `object` | Timing information                                      |
| `signature`  | `string` | Fully-qualified function signature                      |
| `inputs`     | `object` | Serialized input parameters (redacted)                  |
| `result`     | `any`    | Serialized return value (redacted)                      |
| `__frames`   | `array`  | Child spans (recursive, same structure)                 |
| `__usage`    | `object` | Aggregated token usage (hoisted from children)          |

The `__` prefix on internal fields (`__time`, `__frames`, `__usage`) distinguishes them
from user-emitted keys.

#### §3.6.2 Console Tracer — SHOULD Implement

Implementations SHOULD provide a console tracer that prints span start/end events to
stderr (or the platform-equivalent diagnostic output).

**Output format** (RECOMMENDED):

```
[prompty] ▶ <span_name>
[prompty] ◀ <span_name> (<duration_ms>ms)
```

#### §3.6.3 OpenTelemetry Backend — SHOULD Implement

Implementations SHOULD provide an OpenTelemetry tracing backend that conforms to the
[OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

**Span attributes mapping**:

| Prompty Concept              | OTel Attribute                   | Value                              |
| ---------------------------- | -------------------------------- | ---------------------------------- |
| API type                     | `gen_ai.operation.name`          | `"chat"`, `"embeddings"`, `"turn"`, `"execute_tool"` |
| Provider name                | `gen_ai.provider.name`           | `"openai"`, `"microsoft.foundry"`, `"anthropic"` |
| Model ID                     | `gen_ai.request.model`           | From `agent.model.id`              |
| Temperature                  | `gen_ai.request.temperature`     | From `agent.model.options.temperature` |
| Max tokens                   | `gen_ai.request.max_tokens`      | From `agent.model.options.maxOutputTokens` |
| Input token count            | `gen_ai.usage.input_tokens`      | From response usage                |
| Output token count           | `gen_ai.usage.output_tokens`     | From response usage                |
| Finish reasons               | `gen_ai.response.finish_reasons` | From response choices              |
| Response ID                  | `gen_ai.response.id`             | From response                      |
| Response model               | `gen_ai.response.model`          | From response                      |

**Span events** (opt-in — implementations MAY emit these):

| Event Name                  | Content                          |
| --------------------------- | -------------------------------- |
| `gen_ai.input.messages`     | Messages sent to LLM             |
| `gen_ai.output.messages`    | Messages received from LLM       |
| `gen_ai.system_instructions`| System message content           |
| `gen_ai.tool.definitions`   | Tool definitions sent to LLM     |

**Span kinds**:

- `CLIENT` for remote LLM API calls (executor).
- `INTERNAL` for local processing (renderer, parser, processor).

**Agent and tool spans**:

- Agent loop spans: `gen_ai.operation.name = "turn"`, with `gen_ai.agent.name`.
- Tool execution spans: `gen_ai.operation.name = "execute_tool"`.

**Error handling**: On error, set span status to `ERROR` and record `error.type` attribute.

### §3.7 Extensibility

Users add custom backends by implementing the factory interface and calling
`add(name, factory)` on the tracer registry.

**Example use cases**:
- Database logging (write spans to a SQL or NoSQL store)
- Webhook notifications (POST span data to an HTTP endpoint)
- Custom dashboards (stream span data to a visualization tool)
- Cost tracking (aggregate `__usage` across runs)

Backends MUST NOT block the pipeline — if a backend is slow, it SHOULD buffer or
flush asynchronously. A failing backend MUST NOT cause the pipeline to fail.

---

## §4 Loading

### §4.1 Public API

| Function     | Signature                          | Returns       |
| ------------ | ---------------------------------- | ------------- |
| `load`       | `(path: string) → PromptAgent`     | PromptAgent   |
| `load_async` | `(path: string) → PromptAgent`     | PromptAgent   |

Both functions MUST be traced: emit a `load` span with `inputs = {path: <path>}` and
`result = {agent_name: <name>, ...}`.

### §4.2 Algorithm

```
function load(path):
  1. path ← resolve_to_absolute(path)
  2. If file at path does not exist:
       RAISE FileNotFoundError("File not found: {path}")
  3. contents ← read_file_utf8(path)
  4. data ← parse_frontmatter(contents):
       a. If contents does not start with "---" or "+++" (ignoring leading whitespace):
            RETURN {instructions: contents}
       b. Apply reference regex (§2.2) to contents
       c. If regex does not match:
            RAISE ValueError("Malformed frontmatter in {path}")
       d. frontmatter_yaml ← regex group 1
       e. body ← regex group 2
       f. parsed ← yaml_parse(frontmatter_yaml)
       g. If parsed is not a dict:
            RAISE ValueError("Frontmatter must be a YAML mapping")
       h. parsed["instructions"] ← body
       i. RETURN parsed
  5. data ← resolve_references(data, base_dir=parent(path)):
       Walk every value in data recursively:
       For each string value matching ${protocol:content}:
         protocol ← lowercase text before first ":"
         content ← text after first ":"
         SWITCH protocol:
           CASE "env":
             var_name, _, default ← content.partition(":")
             value ← environment_variable(var_name)
             IF value is not set:
               IF default is not empty:
                 REPLACE with default
               ELSE:
                 RAISE ValueError("Environment variable '{var_name}' not set")
             ELSE:
               REPLACE with value
           CASE "file":
             file_path ← resolve(base_dir / content)
             IF file does not exist:
               RAISE FileNotFoundError("Referenced file '{content}' not found")
             extension ← file_path.suffix.lower()
             IF extension == ".json":
               REPLACE with json_parse(read_file(file_path))
             ELIF extension in (".yaml", ".yml"):
               REPLACE with yaml_parse(read_file(file_path))
             ELSE:
               REPLACE with read_file_text(file_path)
           DEFAULT:
             Leave value unchanged (unknown protocol)
  6. Apply shorthand expansions:
       a. IF data["model"] is a string:
            data["model"] ← {id: data["model"]}
       b. IF data["template"] is missing:
            data["template"] ← {format: {kind: "jinja2"}, parser: {kind: "prompty"}}
       c. IF data["template"] is a string:
            data["template"] ← {format: {kind: data["template"]}, parser: {kind: "prompty"}}
       d. For each property in data["inputs"] (if dict form):
            IF value is a scalar (not a dict):
              Convert to Property(kind: infer_kind(value), default: value)
  7. Inject kind:
       data["kind"] ← "prompt"
       // .prompty files always produce PromptAgents
  8. agent ← load_typed_agent(data)
       // Use the generated model loader for the target language
       // This validates types and produces a PromptAgent instance
  9. RETURN agent
```

### §4.3 Dotenv Loading

Loading `.env` files is an **application-level concern**, not a runtime library
responsibility. Runtime libraries MUST NOT automatically load `.env` files as a
side effect of `load()`. Applications and tools (e.g., VS Code extensions, CLI
runners) SHOULD load `.env` files before invoking `load()` so that `${env:}`
references resolve correctly.

`.env` file format: One `KEY=VALUE` pair per line. Lines starting with `#` are comments.
Blank lines are ignored. Values MAY be quoted with single or double quotes.

Variables loaded from `.env` MUST NOT override variables already set in the actual
environment. Environment variables take precedence.

### §4.4 Shorthand Reference

| Shorthand                | Expanded Form                                                       |
| ------------------------ | ------------------------------------------------------------------- |
| `model: "gpt-4"`        | `model: {id: "gpt-4"}`                                             |
| `template: "jinja2"`    | `template: {format: {kind: "jinja2"}, parser: {kind: "prompty"}}`   |
| `inputs.X: "Jane"`      | `inputs.X: {kind: "string", default: "Jane"}`                      |
| `inputs.X: 42`          | `inputs.X: {kind: "integer", default: 42}`                         |
| `inputs.X: 3.14`        | `inputs.X: {kind: "float", default: 3.14}`                         |
| `inputs.X: true`        | `inputs.X: {kind: "boolean", default: true}`                       |
| `inputs.X: [1, 2, 3]`  | `inputs.X: {kind: "array", default: [1, 2, 3]}`                    |
| `inputs.X: {a: 1}`     | `inputs.X: {kind: "object", default: {a: 1}}`                      |

### §4.5 Error Conditions

| Condition                                  | Error Type            |
| ------------------------------------------ | --------------------- |
| File does not exist                        | `FileNotFoundError`   |
| Malformed frontmatter (markers but no match) | `ValueError`        |
| Frontmatter is not a YAML mapping          | `ValueError`          |
| `${env:VAR}` where VAR is not set (no default) | `ValueError`     |
| `${file:path}` where file does not exist   | `FileNotFoundError`   |
| Invalid YAML in frontmatter               | `ValueError` (or YAML parse error) |

---

## §5 Rendering

### §5.1 Public API

| Function       | Signature                            | Returns          |
| -------------- | ------------------------------------ | ---------------- |
| `render`       | `(agent, inputs) → string`           | Rendered string  |
| `render_async` | `(agent, inputs) → string`           | Rendered string  |

Both functions MUST be traced: emit a `render` span.

### §5.2 Rich Kinds

The following property kinds contain structured data that cannot be directly interpolated
into a template string:

```
RICH_KINDS = {thread, image, file, audio}
```

| Kind     | Contains                    | Rendering Behavior         | Resolution Point |
| -------- | --------------------------- | -------------------------- | ---------------- |
| `thread` | `Message[]` (history)       | Nonce → expanded in parser | §6 (parsing)     |
| `image`  | Image data/URL              | Nonce → resolved in wire   | §7 (execution)   |
| `file`   | File data/URL               | Nonce → resolved in wire   | §7 (execution)   |
| `audio`  | Audio data/URL              | Nonce → resolved in wire   | §7 (execution)   |

All rich kinds are replaced with nonce strings during rendering. Only `thread` is
expanded back into `Message[]` during parsing (§6). The others are resolved during
wire format conversion (§7).

### §5.3 Nonce Format

```
__PROMPTY_THREAD_<hex8>_<propertyName>__
```

| Component      | Description                                              |
| -------------- | -------------------------------------------------------- |
| `__PROMPTY_THREAD_` | Fixed prefix (identifies Prompty nonces)             |
| `<hex8>`       | 8 bytes of cryptographic random data, hex-encoded (16 chars) |
| `<propertyName>` | The input property name (for debuggability)            |
| `__`           | Fixed suffix                                             |

**Example**: `__PROMPTY_THREAD_a1b2c3d4e5f6a7b8_conversation__`

**Requirements**:

- MUST use cryptographically secure random bytes (not pseudo-random sequences).
- MUST be unique per render invocation (a new nonce for each call to `render`).
- The nonce-to-value mapping MUST be stored in thread-safe per-request storage.
- Nonce generation and storage MUST be thread-safe.

### §5.4 Algorithm

```
function render(agent, inputs):
  1. validated_inputs ← validate_inputs(agent, inputs)  // §12
  2. prepared_inputs ← {}
     nonce_map ← {}  // thread-safe map
     FOR EACH property in agent.inputs:
       name ← property.name
       value ← validated_inputs[name]
       IF property.kind IN RICH_KINDS:
         nonce ← "__PROMPTY_THREAD_" + crypto_random_hex(8) + "_" + name + "__"
         prepared_inputs[name] ← nonce
         nonce_map[nonce] ← value
       ELSE:
         prepared_inputs[name] ← value
  3. renderer ← get_renderer(agent.template.format.kind)
       // Look up via invoker discovery (§11)
       // Default: "jinja2" → Jinja2-compatible engine
       //          "mustache" → Mustache engine
       // Unknown key → RAISE InvokerError
  4. rendered ← renderer.render(agent.instructions, prepared_inputs)
  5. Store nonce_map in per-request thread-safe storage
       // The parser (§6) needs this to expand thread nonces
  6. RETURN rendered
```

### §5.5 Jinja2 Common Subset (Conformance Floor)

The default renderer (format kind `"jinja2"`) MUST support the following Jinja2 template
features as a conformance floor:

**MUST support**:

| Feature            | Syntax                                        |
| ------------------ | --------------------------------------------- |
| Variable output    | `{{variable}}`, `{{object.property}}`         |
| Conditionals       | `{% if cond %}...{% elif %}...{% else %}...{% endif %}` |
| Loops              | `{% for item in list %}...{% endfor %}`       |
| Comments           | `{# comment text #}`                          |
| Filter: `default`  | `{{var\|default("fallback")}}`                 |
| Filter: `upper`    | `{{var\|upper}}`                               |
| Filter: `lower`    | `{{var\|lower}}`                               |
| Filter: `join`     | `{{list\|join(", ")}}`                         |
| Filter: `length`   | `{{list\|length}}`                             |
| Filter: `trim`     | `{{var\|trim}}`                                |

**MAY support**:

- Template inheritance (`{% extends %}`, `{% block %}`)
- Macros (`{% macro name(args) %}...{% endmacro %}`)
- Custom filters (registered by the implementation)
- Advanced expressions and tests (`is defined`, `is none`, etc.)

**Sandboxing**: The template engine SHOULD run in sandboxed mode where available, to
prevent template injection attacks. Implementations MUST NOT allow templates to execute
arbitrary code, access the filesystem, or make network calls.

### §5.6 Custom Renderers

Implementations MAY support additional template engines beyond Jinja2 and Mustache via
the invoker discovery mechanism (§11). Custom renderers MUST implement the same interface:

```
interface Renderer:
  render(template: string, inputs: dict) → string
  render_async(template: string, inputs: dict) → string
```

### §5.7 Error Conditions

| Condition                                     | Error Type      |
| --------------------------------------------- | --------------- |
| Unknown template format kind (no renderer)    | `InvokerError`  |
| Template syntax error (invalid Jinja2, etc.)  | `ValueError`    |
| Missing required input (not in inputs dict)   | `ValueError`    |

---

## §6 Parsing

### §6.1 Public API

| Function      | Signature                              | Returns      |
| ------------- | -------------------------------------- | ------------ |
| `parse`       | `(agent, rendered) → Message[]`        | Message list |
| `parse_async` | `(agent, rendered) → Message[]`        | Message list |

Both functions MUST be traced: emit a `parse` span.

### §6.2 Role Boundary Regex

```
^\s*#?\s*(system|user|assistant)(\[(\w+\s*=\s*"?[^"]*"?\s*,?\s*)+\])?\s*:\s*$
```

**Flags**: case-insensitive (`i`).

**Match groups**:

| Group | Content                                    | Example              |
| ----- | ------------------------------------------ | -------------------- |
| 1     | Role name                                  | `system`, `user`     |
| 2     | Attribute block (optional)                 | `[nonce=abc123]`     |
| 3     | Last attribute key=value (capture artifact)| `nonce=abc123`       |

**Valid matches**:

```
system:                          → role="system", attrs={}
user:                            → role="user", attrs={}
  assistant:                     → role="assistant", attrs={}
# system:                        → role="system", attrs={}
assistant[nonce=abc123]:         → role="assistant", attrs={nonce: "abc123"}
user[nonce=abc, name="test"]:    → role="user", attrs={nonce: "abc", name: "test"}
```

### §6.3 Injection Defense (Pre-render Nonce)

To defend against template injection (where user-provided input could contain role
markers that alter message structure), implementations SHOULD support a strict parsing
mode.

**Pre-render step** (before template rendering):

```
function pre_render(instructions, render_nonce):
  lines ← instructions.split("\n")
  FOR EACH line in lines:
    IF line matches role boundary regex:
      role ← extracted role name
      existing_attrs ← extracted attributes (if any)
      Inject nonce: rebuild line as "role[nonce=<render_nonce>, ...existing_attrs]:"
  RETURN modified instructions joined by "\n"
```

**Post-parse validation** (during parsing):

```
When a role boundary with a nonce attribute is encountered:
  IF attrs["nonce"] != expected_render_nonce:
    RAISE ValueError("Role marker nonce mismatch — possible injection")
  Remove "nonce" from attrs (internal use only)
```

This mechanism ensures that role boundaries present in the original template are
distinguished from role boundaries injected via user input.

### §6.4 Parsing Algorithm

```
function parse(agent, rendered):
  1. nonce_map ← retrieve from per-request thread-safe storage (set by render, §5)
  2. messages ← []
     current_role ← null
     current_content ← []
     current_attrs ← {}
  3. FOR EACH line in rendered.split("\n"):
       IF line matches role boundary regex:
         IF current_role is not null:
           // Flush accumulated content as a message
           content_text ← join(current_content, "\n")
           content_text ← trim_blank_lines(content_text)
           message ← Message(
             role: current_role,
             content: [TextPart(kind: "text", value: content_text)],
             metadata: current_attrs if non-empty else null
           )
           messages.append(message)
         // Start new message
         current_role ← lowercase(regex_group_1)
         current_attrs ← parse_attributes(regex_group_2)  // {} if no attrs
         current_content ← []
       ELSE:
         current_content.append(line)
  4. // Flush final message
     IF current_role is not null:
       content_text ← join(current_content, "\n")
       content_text ← trim_blank_lines(content_text)
       message ← Message(
         role: current_role,
         content: [TextPart(kind: "text", value: content_text)],
         metadata: current_attrs if non-empty else null
       )
       messages.append(message)
     ELSE IF current_content is not empty:
       // Content before any role marker → default to system
       content_text ← join(current_content, "\n")
       content_text ← trim_blank_lines(content_text)
       messages.append(Message(
         role: "system",
         content: [TextPart(kind: "text", value: content_text)]
       ))
  5. // Expand thread nonces
     expanded ← []
     FOR EACH message in messages:
       text_value ← message.content[0].value  // TextPart
       IF text_value contains a thread nonce (matching __PROMPTY_THREAD_<hex>_<name>__):
         // Split content around the nonce
         // Text before nonce → message with current role (if non-empty)
         // Nonce → replaced with Message[] from nonce_map
         // Text after nonce → message with current role (if non-empty)
         thread_messages ← nonce_map[matched_nonce]
         IF thread_messages is a list of Message objects:
           // Insert the thread messages at this position
           before_text ← text before nonce (trimmed)
           after_text ← text after nonce (trimmed)
           IF before_text is not empty:
             expanded.append(Message(role: message.role, content: [TextPart(value: before_text)]))
           expanded.extend(thread_messages)
           IF after_text is not empty:
             expanded.append(Message(role: message.role, content: [TextPart(value: after_text)]))
         ELSE:
           // Not a valid thread — keep the nonce as literal text
           expanded.append(message)
       ELSE:
         expanded.append(message)
     messages ← expanded
  6. RETURN messages
```

### §6.5 Message Structure

```
Message:
  role:     string           // "system" | "user" | "assistant"
  content:  ContentPart[]    // List of content parts
  metadata: dict | null      // Optional attributes from role markers

ContentPart = TextPart | ImagePart | AudioPart | FilePart

TextPart:
  kind:  "text"
  value: string              // The text content

ImagePart:
  kind:      "image"
  value:     string           // URL or base64-encoded data
  mediaType: string | null    // MIME type (e.g., "image/png")
  detail:    string | null    // Detail level (e.g., "auto", "low", "high")

AudioPart:
  kind:      "audio"
  value:     string           // URL or base64-encoded data
  mediaType: string | null    // MIME type (e.g., "audio/wav")

FilePart:
  kind:      "file"
  value:     string           // URL or base64-encoded data
  mediaType: string | null    // MIME type
```

### §6.6 Content Handling Rules

**Blank line trimming**: Leading and trailing blank lines within each message's content
MUST be trimmed. Internal blank lines MUST be preserved.

**Inline images**: Markdown image syntax (`![alt](url)`) in message content MUST be
preserved as literal text within a `TextPart`. Implementations MUST NOT automatically
parse inline markdown images into `ImagePart` objects. Image inputs should be provided
via `kind: image` input properties, which follow the nonce replacement path.

**Empty messages**: If a role marker is followed by another role marker with no content
between them (or only blank lines), the resulting message MUST have
`content: [TextPart(kind: "text", value: "")]`. Empty messages MUST NOT be silently
discarded.

### §6.7 Thread Expansion

Thread expansion occurs after all role markers have been parsed into messages. It
replaces nonce placeholders with actual `Message[]` conversation history.

**Expansion rules**:

1. Scan each message's text content for nonce patterns matching
   `__PROMPTY_THREAD_<hex16>_<name>__`.
2. Look up the nonce in `nonce_map` (populated during rendering, §5).
3. If the mapped value is a `Message[]`:
   - Split the containing message at the nonce boundary.
   - Insert the thread's messages at that position in the message list.
   - Any text before the nonce becomes a separate message with the same role.
   - Any text after the nonce becomes a separate message with the same role.
4. If the mapped value is not a `Message[]`, treat the nonce as literal text (no expansion).

**Thread messages preserve their original roles**: A thread may contain messages with
roles different from the containing message's role. After expansion, the thread's
messages appear in the final list with their original roles intact.

### §6.8 Error Conditions

| Condition                                        | Error Type    |
| ------------------------------------------------ | ------------- |
| Nonce mismatch in strict mode                    | `ValueError`  |
| Unknown parser kind (no parser found via discovery) | `InvokerError` |

---

## §7 Wire Format

This section defines how the internal `Message[]` representation (produced by
the parser in §5) is converted to the wire format expected by each LLM
provider's API. Implementations MUST support at least one provider; OpenAI
Chat Completions is the reference format.

### §7.1 OpenAI Chat Completions

#### §7.1.1 Message Conversion

Each internal `Message` MUST be converted to the OpenAI wire format before
submission. The algorithm is:

```
function message_to_wire(message) → dict:
  wire = { role: message.role }

  // Metadata pass-through (tool_call_id, name, tool_calls, etc.)
  if message.metadata exists and is non-empty:
    merge metadata keys into wire

  // Content: single TextPart → string; otherwise → array of content parts
  if message.content has exactly 1 element AND that element is a TextPart:
    wire.content = message.content[0].value        // plain string
  else:
    wire.content = [part_to_wire(part) for part in message.content]

  return wire
```

Implementations MUST preserve the single-string optimisation for messages
containing exactly one `TextPart`. Multi-part messages MUST use the array
form.

#### §7.1.2 Part Conversion

Each `ContentPart` MUST be mapped to the corresponding OpenAI content-block
type:

```
function part_to_wire(part) → dict:
  match part.kind:
    "text"  → { type: "text", text: part.value }
    "image" → { type: "image_url",
                image_url: { url: part.value,
                             detail: part.detail if present } }
    "audio" → { type: "input_audio",
                input_audio: { data: part.value,
                               format: map_audio_format(part.mediaType) } }
    "file"  → { type: "file", file: { url: part.value } }
```

**Audio format mapping.** The `mediaType` field MUST be mapped as follows:

| `mediaType` value              | API `format` value |
| ------------------------------ | ------------------ |
| `audio/wav`, `audio/x-wav`    | `wav`              |
| `audio/mp3`, `audio/mpeg`     | `mp3`              |
| `audio/flac`                  | `flac`             |
| `audio/ogg`                   | `ogg`              |
| any other `audio/*`           | strip `audio/` prefix |

Implementations MUST NOT send an empty `detail` field; it SHOULD be omitted
when no detail level is specified on the `ImagePart`.

#### §7.1.3 Tool Conversion

All tool kinds MUST be projected as OpenAI function definitions in the wire
`tools` array so the LLM can discover and invoke them. Each tool kind requires
a different projection strategy, but the wire format is always the same:
`{ type: "function", function: { name, description, parameters } }`.

**Projection by tool kind:**

| Tool Kind    | Projection Strategy                                                        |
| ------------ | -------------------------------------------------------------------------- |
| `function`   | Already function-shaped — convert `parameters` (`list[Property]`) to JSON Schema directly |
| `prompty`    | Load child `.prompty` file, project its `inputs` as the function's `parameters` |
| `mcp`        | Resolve MCP server connection, discover its tools, project each as a function definition |
| `openapi`    | Parse OpenAPI specification, project each operation as a function definition |
| custom (`*`) | Look up in tool registry, use registered function signature               |

The agent loop (§9) intercepts tool calls from the LLM response and routes
them to the appropriate handler based on the original tool kind.

```
function tools_to_wire(tools, inputs) → list | null:
  wire_tools = []

  for tool in tools:
    func_defs = project_tool(tool)
    for func_def in func_defs:
      // Strip bound parameters — these are injected at call time, not
      // exposed to the LLM.
      if tool.bindings:
        params = func_def.function.parameters
        for bound_param in tool.bindings:
          remove bound_param from params.properties
          remove bound_param from params.required (if present)

      // Strict mode: flag lives on function definition (NOT inside schema)
      if tool.strict:
        func_def.function.strict = true
        func_def.function.parameters.additionalProperties = false

      wire_tools.append(func_def)

  return wire_tools if non-empty else null


function project_tool(tool) → list of func_defs:
  match tool.kind:
    "function":
      return [{
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: schema_to_wire(tool.parameters)
        }
      }]

    "prompty":
      // Load child prompty to extract its input schema
      child = load(tool.path)
      params = schema_to_wire(child.inputs)
      return [{
        type: "function",
        function: {
          name: tool.name,
          description: tool.description or child.description,
          parameters: params
        }
      }]

    "mcp":
      // Resolve MCP server → returns list of tool definitions
      mcp_tools = resolve_mcp_server(tool.connection, tool.serverName)
      if tool.allowedTools:
        mcp_tools = filter(mcp_tools, name in tool.allowedTools)
      return [mcp_tool_to_func_def(t) for t in mcp_tools]

    "openapi":
      // Parse OpenAPI spec → returns list of operation definitions
      operations = parse_openapi_spec(tool.specification, tool.connection)
      return [openapi_op_to_func_def(op) for op in operations]

    default:  // CustomTool (wildcard *)
      // Look up in tool registry for function signature
      handler = get_tool(tool.name)
      return [{
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: handler.parameters_schema
        }
      }]
```

> **Note**: `McpTool` and `OpenApiTool` can project to **multiple** function
> definitions (one per MCP tool or API operation). All other kinds project to
> exactly one. The agent loop uses the tool name to route calls back to the
> correct handler.

When `tools_to_wire` returns `null`, the `tools` key MUST be omitted from the
request entirely (not sent as an empty array).

#### §7.1.4 Schema Conversion

A `list[Property]` (used for `inputs`, `outputs`, and `FunctionTool.parameters`)
MUST be converted to a JSON Schema object for wire transmission:

```
function schema_to_wire(properties: list[Property]) → dict:
  schema = { type: "object", properties: {}, required: [] }

  for prop in properties:
    prop_schema = { type: map_kind_to_json_type(prop.kind) }
    if prop.description:
      prop_schema.description = prop.description
    if prop.enumValues:
      prop_schema.enum = prop.enumValues
    schema.properties[prop.name] = prop_schema
    if prop.required:
      schema.required.append(prop.name)

  if schema.required is empty:
    delete schema.required

  return schema
```

**Kind → JSON Schema type mapping.** Implementations MUST use this table:

| Property `kind` | JSON Schema `type` |
| --------------- | ------------------ |
| `string`        | `string`           |
| `integer`       | `integer`          |
| `float`         | `number`           |
| `boolean`       | `boolean`          |
| `array`         | `array`            |
| `object`        | `object`           |

#### §7.1.5 Options Mapping

`ModelOptions` fields MUST be mapped to OpenAI request parameters:

```
function build_options(model_options) → dict:
  opts = {}
  if model_options is null:
    return opts

  mapping = {
    temperature      → temperature,
    maxOutputTokens  → max_completion_tokens,   // NOT max_tokens (deprecated)
    topP             → top_p,
    frequencyPenalty → frequency_penalty,
    presencePenalty  → presence_penalty,
    stopSequences    → stop,
    seed             → seed
  }

  for each field in model_options:
    if field.name in mapping:
      opts[mapping[field.name]] = field.value

  // Pass through additionalProperties unmapped
  if model_options.additionalProperties:
    for key, value in model_options.additionalProperties:
      if key not in opts:
        opts[key] = value

  return opts
```

> **IMPORTANT:** Implementations MUST map `maxOutputTokens` to
> `max_completion_tokens`, not `max_tokens`. The `max_tokens` parameter is
> deprecated by OpenAI and is incompatible with o-series reasoning models.

#### §7.1.6 Structured Output

When `agent.outputs` is non-empty, the executor MUST convert it to an
OpenAI `response_format` parameter:

```
function output_schema_to_wire(outputs: list[Property]) → dict | null:
  if outputs is empty:
    return null

  json_schema = schema_to_wire(outputs)
  json_schema.additionalProperties = false

  return {
    type: "json_schema",
    json_schema: {
      name: "structured_output",
      strict: true,
      schema: json_schema
    }
  }
```

The processor MUST JSON-parse the response content when `outputs` is
present (see §8.1).

#### §7.1.7 Full Chat Request Building

```
function build_chat_args(agent, messages) → dict:
  args = {
    model: agent.model.id,
    messages: [message_to_wire(m) for m in messages],
    **build_options(agent.model.options)
  }

  tools = tools_to_wire(agent.tools, null)
  if tools:
    args.tools = tools

  response_format = output_schema_to_wire(agent.outputs)
  if response_format:
    args.response_format = response_format

  return args
```

#### §7.1.8 Tracing Requirements

The executor MUST emit an `execute` trace span with the following
[OpenTelemetry Semantic Conventions for GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
attributes:

| Attribute                        | Value                       |
| -------------------------------- | --------------------------- |
| `gen_ai.operation.name`          | `"chat"`                    |
| `gen_ai.provider.name`          | `agent.model.provider`      |
| `gen_ai.request.model`          | `agent.model.id`            |
| All request options              | `gen_ai.request.*`          |
| `gen_ai.usage.input_tokens`     | From response usage         |
| `gen_ai.usage.output_tokens`    | From response usage         |
| `gen_ai.response.finish_reasons`| From response choices       |
| `gen_ai.response.id`            | From response id            |

### §7.2 OpenAI Embeddings

When `agent.model.apiType` is `"embedding"`, the executor MUST build an
embeddings request:

```
function build_embedding_args(agent, messages) → dict:
  // Extract text content from all messages
  texts = []
  for msg in messages:
    for part in msg.content:
      if part.kind == "text":
        texts.append(part.value)

  input = texts[0] if len(texts) == 1 else texts

  return {
    model: agent.model.id,
    input: input
  }
```

Implementations MUST use a single string when there is exactly one text
input and an array of strings when there are multiple.

**Tracing:** The span MUST set `gen_ai.operation.name = "embeddings"`.

### §7.3 OpenAI Images

When `agent.model.apiType` is `"image"`, the executor MUST build an image
generation request:

```
function build_image_args(agent, messages) → dict:
  // Extract prompt from last user message
  prompt = ""
  for msg in reversed(messages):
    if msg.role == "user":
      for part in msg.content:
        if part.kind == "text":
          prompt = part.value
          break
      break

  args = { model: agent.model.id, prompt: prompt }

  // Pass through model options (size, quality, n, etc.)
  opts = build_options(agent.model.options)
  args.update(opts)

  return args
```

The prompt MUST be extracted from the last `user`-role message. If no user
message exists, the prompt MUST be the empty string.

### §7.4 OpenAI Responses API

The Responses API uses a different request/response model from Chat
Completions. When `agent.model.apiType` is `"responses"`, the executor
MUST use this wire format instead of the Chat Completions format.

#### §7.4.1 Request Format

```
function build_responses_args(agent, messages) → dict:
  input_items = []

  for msg in messages:
    item = { role: msg.role }

    // Function-call metadata from a previous agent-loop iteration
    if msg.metadata and "responses_function_call" in msg.metadata:
      input_items.append(msg.metadata["responses_function_call"])
      input_items.append({
        type: "function_call_output",
        call_id: msg.metadata.get("tool_call_id"),
        output: msg.content[0].value if msg.content else ""
      })
      continue

    // Normal message
    if len(msg.content) == 1 and msg.content[0].kind == "text":
      item.content = msg.content[0].value
    else:
      item.content = [part_to_wire(part) for part in msg.content]

    input_items.append(item)

  args = { model: agent.model.id, input: input_items }

  // Tools
  tools = tools_to_wire(agent.tools, null)
  if tools:
    args.tools = tools

  // Structured output
  if agent.outputs:
    schema = schema_to_wire(agent.outputs)
    schema.additionalProperties = false
    args.text = {
      format: {
        type: "json_schema",
        name: "structured_output",
        strict: true,
        schema: schema
      }
    }

  return args
```

Response processing for the Responses API is defined in §8.4.

### §7.5 Anthropic Messages API

Anthropic's Messages API differs from OpenAI in several key ways.
Implementations MAY support Anthropic as a provider.

```
function build_anthropic_args(agent, messages) → dict:
  // Anthropic REQUIRES the system message as a separate top-level field
  system_text = null
  non_system = []

  for msg in messages:
    if msg.role == "system":
      system_text = extract_text(msg)
    else:
      non_system.append(anthropic_message(msg))

  args = {
    model: agent.model.id,
    messages: non_system,
    max_tokens: agent.model.options.maxOutputTokens or 4096
  }

  if system_text:
    args.system = system_text

  // Options mapping (Anthropic-specific)
  if agent.model.options:
    if agent.model.options.temperature is not null:
      args.temperature = agent.model.options.temperature
    if agent.model.options.topP is not null:
      args.top_p = agent.model.options.topP
    if agent.model.options.topK is not null:
      args.top_k = agent.model.options.topK
    if agent.model.options.stopSequences is not null:
      args.stop_sequences = agent.model.options.stopSequences

  // Tools
  if agent.tools:
    tools = [anthropic_tool(t) for t in agent.tools if t.kind == "function"]
    if tools:
      args.tools = tools

  return args
```

**Anthropic tool format:**

```
function anthropic_tool(tool) → dict:
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema_to_wire(tool.parameters)
  }
```

**Anthropic message format:**

```
function anthropic_message(msg) → dict:
  // Anthropic always uses an array of typed content blocks
  blocks = []
  for part in msg.content:
    match part.kind:
      "text"  → blocks.append({ type: "text", text: part.value })
      "image" → blocks.append({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: part.mediaType,
                    data: part.value
                  }
                })

  return { role: msg.role, content: blocks }
```

Implementations MUST always use the array-of-blocks form for Anthropic
messages, even when there is only one text block.

### §7.6 Options Mapping Table

The following table defines the canonical mapping from Prompty `ModelOptions`
fields to provider-specific parameter names. Implementations MUST respect
these mappings for each supported provider.

| Prompty (`ModelOptions`) | OpenAI Chat           | Anthropic Messages | Notes                                    |
| ------------------------ | --------------------- | ------------------ | ---------------------------------------- |
| `temperature`            | `temperature`         | `temperature`      |                                          |
| `maxOutputTokens`        | `max_completion_tokens` | `max_tokens`     | OpenAI deprecated `max_tokens`           |
| `topP`                   | `top_p`               | `top_p`            |                                          |
| `topK`                   | —                     | `top_k`            | OpenAI does not support                  |
| `frequencyPenalty`       | `frequency_penalty`   | —                  | Anthropic does not support               |
| `presencePenalty`        | `presence_penalty`    | —                  | Anthropic does not support               |
| `stopSequences`          | `stop`                | `stop_sequences`   | Different parameter name                 |
| `seed`                   | `seed`                | —                  | Anthropic does not support               |

When a provider does not support an option, the implementation MUST silently
ignore it (MUST NOT raise an error).

### §7.7 Structured Output

When `agent.outputs` is non-empty, the following two-phase process applies:

1. **Request phase:** The executor MUST convert the output schema to the
   provider's structured-output mechanism (e.g., `response_format` for
   OpenAI, or constrained decoding where supported).
2. **Response phase:** The processor MUST JSON-parse the content string from
   the response and return the parsed object instead of a raw string. If
   parsing fails, the processor SHOULD return the raw string as a fallback.

See §7.1.6 for the OpenAI wire format and §8.1 for processing details.

### §7.8 Adding a New Provider

To add support for a new LLM provider, an implementation MUST:

1. Implement the executor interface (`execute` / `execute_async`) as defined
   in §11.3.
2. Implement the processor interface (`process` / `process_async`) as defined
   in §11.3.
3. Register both via the invoker discovery mechanism (§11.3) under the
   provider key (e.g., `"anthropic"`).
4. Document the wire-format mappings (message conversion, tool format, options
   mapping) in a provider-specific subsection.

**User-Agent headers.** Implementations SHOULD send
`User-Agent: prompty/<version>` on all API requests to aid provider-side
diagnostics.

---

## §8 Processing

Processing extracts the final result from raw LLM API responses. Every
pipeline invocation that calls an executor MUST subsequently call the
processor.

**Public API:**

- `process(agent, response) → result`
- `process_async(agent, response) → result`

Both variants MUST emit a `process` trace span.

### §8.1 Chat Completion Processing

```
function process_chat(agent, response) → result:
  choice = response.choices[0]
  message = choice.message

  // Tool calls take priority
  if message.tool_calls and len(message.tool_calls) > 0:
    return [
      ToolCall(
        id:        tc.id,
        name:      tc.function.name,
        arguments: tc.function.arguments
      )
      for tc in message.tool_calls
    ]

  // Normal content
  content = message.content or ""

  // Structured output: JSON-parse if outputs is defined
  if agent.outputs and content:
    try:
      return json_parse(content)
    except ParseError:
      return content    // fallback to raw string

  return content
```

The processor MUST check for tool calls before extracting content. When
tool calls are present, the content field MUST be ignored and the full list
of `ToolCall` objects returned.

### §8.2 Embedding Processing

```
function process_embedding(agent, response) → result:
  data = response.data

  if len(data) == 0:
    raise ValueError("Empty embedding response")

  if len(data) == 1:
    return data[0].embedding    // single float[]

  return [item.embedding for item in data]    // list of float[]
```

Implementations MUST return a single vector (not a list of one) when
exactly one embedding is present.

### §8.3 Image Processing

```
function process_image(agent, response) → result:
  data = response.data

  if len(data) == 0:
    raise ValueError("Empty image response")

  results = []
  for item in data:
    if item.url:
      results.append(item.url)
    elif item.b64_json:
      results.append(item.b64_json)

  if len(results) == 1:
    return results[0]    // single string

  return results         // list of strings
```

`url` MUST be preferred over `b64_json` when both are present on the same
item.

### §8.4 Responses API Processing

```
function process_responses(agent, response) → result:
  // Error check
  if response.error:
    raise ValueError(response.error.message)

  // Function calls
  function_calls = [
    item for item in response.output
    if item.type == "function_call"
  ]

  if function_calls:
    return [
      ToolCall(
        id:        fc.call_id,
        name:      fc.name,
        arguments: fc.arguments
      )
      for fc in function_calls
    ]

  // Text output
  output_text = response.output_text    // convenience accessor

  // Structured output
  if agent.outputs and output_text:
    try:
      return json_parse(output_text)
    except ParseError:
      return output_text

  return output_text
```

### §8.5 Anthropic Processing

```
function process_anthropic(agent, response) → result:
  // Tool use blocks take priority
  tool_blocks = [
    b for b in response.content
    if b.type == "tool_use"
  ]

  if tool_blocks:
    return [
      ToolCall(
        id:        b.id,
        name:      b.name,
        arguments: json_serialize(b.input)
      )
      for b in tool_blocks
    ]

  // Text content
  text_blocks = [
    b for b in response.content
    if b.type == "text"
  ]
  content = text_blocks[0].text if text_blocks else ""

  // Structured output
  if agent.outputs and content:
    try:
      return json_parse(content)
    except ParseError:
      return content

  return content
```

Note: Anthropic returns `tool_use` blocks with `input` as a parsed dict.
The processor MUST re-serialize the `input` dict to a JSON string in the
`ToolCall.arguments` field so that all providers return arguments in the
same format (JSON string).

### §8.6 Streaming Processing

Streaming responses MUST be processed incrementally. The processor consumes
chunks from a `PromptyStream` (§10) and yields extracted deltas:

```
function process_stream(response_stream) → generator:
  // response_stream is a PromptyStream wrapping the raw SDK iterator
  tool_calls = {}    // accumulate partial tool calls by index

  for chunk in response_stream:
    delta = chunk.choices[0].delta if chunk.choices else null
    if delta is null:
      continue

    // Content chunks
    if delta.content:
      yield delta.content

    // Tool call chunks (accumulated by index)
    if delta.tool_calls:
      for tc_chunk in delta.tool_calls:
        idx = tc_chunk.index
        if idx not in tool_calls:
          tool_calls[idx] = ToolCall(
            id:        tc_chunk.id,
            name:      tc_chunk.function.name,
            arguments: ""
          )
        if tc_chunk.function.arguments:
          tool_calls[idx].arguments += tc_chunk.function.arguments

    // Refusal
    if delta.refusal:
      raise ValueError("Model refused: " + delta.refusal)

  // After stream exhaustion, yield accumulated tool calls
  if tool_calls:
    for idx in sorted(tool_calls.keys()):
      yield tool_calls[idx]
```

### §8.7 ToolCall Structure

All processors MUST return tool calls using this structure:

```
ToolCall:
  id:        string    // unique identifier assigned by the API
  name:      string    // function name to invoke
  arguments: string    // JSON-encoded arguments string
```

The `arguments` field MUST always be a JSON string, regardless of provider.
Callers MUST `json_parse(tool_call.arguments)` to obtain the argument dict.

### §8.8 Structured Result Casting

When `outputs` (outputSchema) is defined on an agent, the processor returns structured
JSON from the LLM. Implementations MUST provide an optimal path from raw JSON to typed
objects without an unnecessary intermediate dict round-trip.

#### §8.8.1 StructuredResult

When `outputs` is defined and the processor successfully parses the response as JSON,
the result MUST be returned as a **StructuredResult** — a wrapper that:

1. **Behaves as a native dict/object** — `result["key"]`, `result.key`, iteration, etc.
   all work identically to a plain dict/object. Existing non-generic code MUST NOT break.
2. **Carries the raw JSON string** — accessible as `result._raw_json` (Python),
   `result[StructuredResultSymbol]` (TypeScript), or `result.RawJson` (C#).

Implementations MUST subclass or extend the language's native dict/object type so that
`StructuredResult` passes `isinstance(result, dict)` (Python), `typeof result === "object"`
(TypeScript), or `result is IDictionary<string, object?>` (C#) checks.

If JSON parsing fails, the processor MUST fall back to returning the raw string as before.

#### §8.8.2 cast

Implementations MUST provide a standalone `cast` function:

```
function cast<T>(result, target_type) → T:
  1. If result is a StructuredResult:
       json_str ← result._raw_json
     Else if result is a string:
       json_str ← result
     Else:
       json_str ← json_serialize(result)
  2. RETURN deserialize<T>(json_str, target_type)
```

The function MUST deserialize directly from the raw JSON string to the target type.
It MUST NOT go through an intermediate dict when the raw JSON is available.

**Language-specific target types:**

- **Python**: `dataclasses.dataclass`, `TypedDict`, Pydantic `BaseModel` (if installed).
  For Pydantic models, implementations SHOULD use `model_validate_json()` for optimal
  deserialization. For dataclasses, implementations SHOULD use `json.loads()` + constructor.
- **TypeScript**: Type parameter `T` with optional runtime validator function
  `(data: unknown) => T` (e.g., Zod `.parse`). Without a validator, returns `JSON.parse()`
  with the type assertion `as T`.
- **C#**: Generic type parameter `T`. Uses `JsonSerializer.Deserialize<T>()` from
  `System.Text.Json`.

#### §8.8.3 Generic Overloads

Implementations MUST provide generic/typed overloads for `invoke` and `turn`:

```
function invoke<T>(path, inputs, target_type) → T:
  result ← invoke(path, inputs)
  RETURN cast<T>(result, target_type)

function turn<T>(agent_or_path, inputs, options, target_type) → T:
  result ← turn(agent_or_path, inputs, options)
  RETURN cast<T>(result, target_type)
```

These overloads SHOULD bypass the intermediate dict when possible — if the processor
provides a `StructuredResult`, the raw JSON flows directly to `cast<T>()`.

**Language-specific signatures:**

- **Python**: `invoke(..., target_type=WeatherResponse)` — keyword argument.
  Async variant: `invoke_async(..., target_type=WeatherResponse)`.
  Turn variant: `turn(..., target_type=WeatherResponse)`.
- **TypeScript**: `invoke<WeatherResponse>(..., { validator? })` — generic type
  parameter with optional runtime validator.
  Turn variant: `turn<WeatherResponse>(...)`.
- **C#**: `InvokeAsync<WeatherResponse>(...)` — generic method overload.
  Turn variant: `TurnAsync<WeatherResponse>(...)`.

The non-generic versions MUST remain unchanged for backward compatibility.

---

## §9 Agent Loop

The agent loop enables multi-turn tool-calling workflows. It calls the LLM,
inspects the response for tool calls, executes them, appends results to the
conversation, and re-calls the LLM—repeating until the LLM produces a normal
(non-tool-call) response.

The agent loop is owned by `turn()` when the `tools` option is provided.
It is NOT a separate public API — `turn` is the entry point that dispatches
to the agent loop internally.

**Public API:**

- `turn(agent_or_path, inputs, tools=...) → result`
- `turn_async(agent_or_path, inputs, tools=...) → result`

Both MUST emit a `turn` trace span that wraps
the entire loop including all inner `execute` and `execute_tool` spans.

### §9.1 Constants

| Constant           | Default | Notes                          |
| ------------------ | ------- | ------------------------------ |
| `MAX_ITERATIONS`   | `10`    | MAY be configurable at runtime |
| `MAX_LLM_RETRIES`  | `3`     | MAY be configurable at runtime (§9.10) |

### §9.2 Algorithm

```
function turn(agent_or_path, inputs, tools=null) → result:
  // Step 1: Resolve agent
  if agent_or_path is a string path:
    agent = load(agent_or_path)
  else:
    agent = agent_or_path

  // Step 2: Prepare initial messages
  messages = prepare(agent, inputs)

  // Step 3: Merge runtime tools into the agent
  if tools is not null:
    merge tools into agent.tools
    merge tool handlers into tool registry

  // Step 4: Iteration counter
  iteration = 0

  // Step 5: Loop
  loop:
    // 5a. Guard against infinite loops
    if iteration >= MAX_ITERATIONS:
      raise RuntimeError(
        "Agent loop exceeded " + MAX_ITERATIONS + " iterations"
      )

    // 5b. Call the LLM (with retry — see §9.10)
    llm_attempts = 0
    loop:
      try:
        response = execute_llm(agent, messages)      // raw API call
        break
      catch error:
        llm_attempts += 1
        if llm_attempts >= MAX_LLM_RETRIES:
          raise ExecuteError(
            message: str(error),
            messages: messages   // MUST include conversation state
          )
        backoff = min(2^llm_attempts + jitter(), 60)
        sleep(backoff)

    // 5c. Process response
    result = process(agent, response)

    // 5d. Check for tool calls
    if result is a list of ToolCall:
      tool_calls = result
      tool_results = []

      // Execute each tool call
      for tool_call in tool_calls:
        TRACE: emit "execute_tool" span for tool_call.name

        // Look up handler — two-layer dispatch (§11.2)
        tool_def = find_tool_definition(agent, tool_call.name)

        // Layer 1: explicit name override
        handler = get_tool(tool_call.name)

        // Parse arguments (with resilient fallback — see §9.8)
        args = resilient_json_parse(tool_call.arguments)

        // Apply bindings (inject bound values from inputs)
        args = apply_bindings(tool_def, args, inputs)

        // Execute tool handler (with error safety — see §9.9)
        try:
          if handler is not null:
            // Name registry hit — direct call
            tool_result = handler(args)
          else:
            // Layer 2: kind handler fallback
            kind_handler = get_tool_handler(tool_def.kind)
            if kind_handler is null:
              raise ValueError(
                "No handler registered for tool: " + tool_call.name
                + " (kind: " + tool_def.kind + ")"
              )
            tool_result = kind_handler(tool_def, args, agent, inputs)
        catch error:
          // Tool handler failures MUST NOT kill the agent loop (§9.9)
          tool_result = "Error: Tool '" + tool_call.name + "' failed: " + str(error)
          emit event("error", { message: tool_result })

        tool_results.append({ tool_call_id: tool_call.id, result: str(tool_result) })

      // Delegate message formatting to the executor (§9.4)
      executor = get_executor(agent.model.provider)
      text_content = extract_text_content(response)  // may be null
      tool_messages = executor.FormatToolMessages(
        response, tool_calls, tool_results, text_content
      )
      append tool_messages to messages

      iteration += 1
      continue loop

    // 5e. Normal response (no tool calls) — return
    return result
```

### §9.3 Streaming in Agent Mode

When streaming is enabled during agent mode, implementations SHOULD forward
content chunks to the caller where possible rather than buffering the entire
response. The key constraint: tool call arguments arrive incrementally and
MUST be fully accumulated before tool execution.

**Detection strategy:** LLM streaming APIs send `tool_calls` deltas from the
start of a response — they do not appear after content deltas. Implementations
SHOULD use the first chunk's delta to determine the response type:

```
When response is a stream:
  1. Begin consuming chunks through the processor.
  2. If tool_calls are detected (present in early chunks):
     - MUST accumulate ALL chunks to collect complete tool call data
       (function names + full argument JSON).
     - MUST NOT yield content to the caller for this iteration.
     - Execute tools, append results, re-loop.
  3. If only content is detected (no tool_calls):
     - This is the final response — SHOULD yield content chunks
       through a PromptyStream to the caller as they arrive.
     - Return the stream (caller consumes at their pace).
```

This means intermediate iterations (tool calls) are buffered internally,
while the **final iteration** (content only) is streamed through to the
caller. The caller sees a normal `PromptyStream` for the final answer.

Implementations that cannot distinguish early MAY fall back to fully
consuming the stream before deciding, but this is not preferred.

### §9.4 `FormatToolMessages` — Provider Hook

The agent loop MUST NOT contain provider-specific message-building logic.
Instead, each executor MUST implement a `FormatToolMessages` method that
converts raw tool call data and tool results into the provider's wire format.
This keeps the pipeline fully provider-agnostic.

**Signature:**

```
executor.FormatToolMessages(
  raw_response,    // original LLM response (may be null for streaming)
  tool_calls,      // list of { id, name, arguments }
  tool_results,    // list of { tool_call_id, result } (same order as tool_calls)
  text_content      // any text content from the response (may be null/empty)
) → list<Message>
```

**Parameters:**

| Parameter      | Type                          | Notes                                                  |
| -------------- | ----------------------------- | ------------------------------------------------------ |
| `raw_response` | provider response or null     | Original API response object; needed by Anthropic to preserve content blocks. May be null in streaming path. |
| `tool_calls`   | list of `{ id, name, arguments }` | Normalized tool call data extracted from the response. `arguments` is a JSON string. |
| `tool_results` | list of `{ tool_call_id, result }` | Results from executing each tool, in the same order as `tool_calls`. |
| `text_content` | string or null                | Any text content from the response alongside tool calls (e.g., Anthropic thinking text). |

**Return value:** A `list<Message>` to append to the conversation. The number
and structure of messages is provider-specific (see §9.5 for examples).

**Contract:**

- Every executor MUST implement `FormatToolMessages`.
- The pipeline MUST call `FormatToolMessages` after dispatching all tool calls
  and collecting results — never build tool messages directly.
- Executors that share a wire format (e.g., Foundry extends OpenAI) MAY
  inherit the implementation from a base class.

### §9.5 Provider-Specific Tool Message Formats

The following examples show what each executor's `FormatToolMessages` returns.
These are the provider's wire format — the pipeline treats them as opaque
`Message` objects.

**OpenAI Chat Completions:**

Returns 1 assistant message + N tool messages (one per tool call):

```
[
  // Assistant message with tool calls
  {
    role: "assistant",
    tool_calls: [
      {
        id: "call_123",
        type: "function",
        function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" }
      }
    ]
  },
  // One tool message per result
  {
    role: "tool",
    content: "72°F and sunny",
    tool_call_id: "call_123"
  }
]
```

**Anthropic:**

Returns 1 assistant message + 1 user message (batched tool results):

```
[
  // Assistant message — MUST preserve ALL content blocks (text + tool_use)
  {
    role: "assistant",
    content: [<original content blocks from API response>]
  },
  // ALL tool results in ONE user message
  {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "toolu_123", content: "72°F and sunny" },
      { type: "tool_result", tool_use_id: "toolu_456", content: "Pizza Palace" }
    ]
  }
]
```

Anthropic implementations MUST batch all tool results into a single `user`
message. Sending individual `user` messages per tool result is incorrect and
will cause API errors.

**OpenAI Responses API:**

Returns N×2 messages (one function_call + one function_call_output per tool):

```
[
  // Original function_call item
  {
    type: "function_call",
    id: "fc_123",
    call_id: "call_123",
    name: "get_weather",
    arguments: "{\"city\":\"Paris\"}"
  },
  // Function call output
  {
    type: "function_call_output",
    call_id: "call_123",
    output: "72°F and sunny"
  }
]
```

### §9.6 Bindings Injection

During tool execution, bound parameters MUST be injected into the arguments
before calling the handler:

```
function apply_bindings(tool, args, inputs) → dict:
  if tool.bindings is null:
    return args

  for param_name, binding in tool.bindings:
    input_name = binding.input    // e.g., "preferred_unit"
    if input_name in inputs:
      args[param_name] = inputs[input_name]

  return args
```

Bindings MUST override any value the LLM may have generated for the same
parameter name.

### §9.7 PromptyTool Execution

A `PromptyTool` references another `.prompty` file to be invoked as a tool:

```
function execute_prompty_tool(tool, args, parent_inputs) → result:
  // Resolve path relative to the parent .prompty file
  child_agent = load(tool.path)

  // Merge: LLM-provided args + bindings from parent inputs
  merged = apply_bindings(tool, args, parent_inputs)

  match tool.mode:
    "single":
      // One LLM call — no agent loop
      return run(child_agent, merged)
    "agentic":
      // Full agent loop — child may call tools too
      return turn(child_agent, merged, tools=child_agent_tools)
```

Child `PromptyTool` execution MUST inherit the parent's tracer registry,
producing nested trace spans that show the full call hierarchy.

### §9.8 Resilient Argument Parsing

LLMs frequently produce malformed JSON in tool call arguments — markdown
code fences wrapping JSON, trailing commas, or JSON embedded in prose text.
Implementations SHOULD attempt recovery using the following fallback chain
when `json_parse` fails on the raw argument string:

```
function resilient_json_parse(raw_arguments) → dict:
  // Strategy 1: Direct parse
  try:
    return json_parse(raw_arguments)
  catch: pass

  // Strategy 2: Strip markdown code fences
  stripped = regex_replace(raw_arguments,
    /^\s*```(?:json)?\s*\n?(.*?)\n?\s*```\s*$/s, "$1")
  if stripped != raw_arguments:
    try:
      return json_parse(stripped)
    catch: pass

  // Strategy 3: Extract first balanced JSON block
  block = extract_first_json_block(raw_arguments)  // find first { to matching }
  if block is not null:
    try:
      return json_parse(block)
    catch: pass

  // Strategy 4: Strip trailing commas before } or ]
  cleaned = regex_replace(raw_arguments, /,\s*([}\]])/g, "$1")
  try:
    return json_parse(cleaned)
  catch: pass

  // All strategies failed — return error as tool result
  return null  // caller MUST convert to error tool result
```

**Requirements:**

- Implementations SHOULD attempt all four strategies in order.
- When a non-direct strategy succeeds, implementations SHOULD log a warning
  indicating which fallback was used (e.g., "Parsed tool arguments after
  stripping markdown fences").
- If all strategies fail, implementations MUST NOT substitute a silent empty
  object (`{}`). The parse failure MUST be reported as a string tool result
  (e.g., `"Error: Invalid JSON in tool arguments: {error}"`) so the LLM
  can see the error and retry.
- `extract_first_json_block` MUST respect string escapes (do not match
  braces inside quoted strings).

### §9.9 Tool Execution Error Safety

Tool handlers are user-provided code. Implementations MUST catch exceptions
(or panics, in languages that distinguish them) raised by tool handlers
during execution. This applies to all tool dispatch paths: direct name
handlers (§9.2 Layer 1), kind handlers (§9.2 Layer 2), and PromptyTool
execution (§9.7).

**Requirements:**

- Caught errors MUST be converted to a string tool result:
  `"Error: Tool '{name}' failed: {message}"`
- An `error` event (§13.1) MUST be emitted with the error details.
- The agent loop MUST NOT terminate due to a tool handler failure — the
  error result is fed back to the LLM as the tool's response, allowing
  the model to recover or try an alternative approach.
- For languages with both exceptions and panics (e.g., Rust), both MUST
  be caught. For languages with only exceptions (e.g., Python, TypeScript),
  catching exceptions is sufficient.
- `ValueError` for "Tool not registered" (§12.4) is NOT subject to this
  rule — a missing handler indicates a configuration error, not a runtime
  failure, and SHOULD still raise.

### §9.10 LLM Call Retry

Long-running agent loops accumulate valuable state across iterations. A
transient LLM failure at iteration N should not discard the work from
iterations 1 through N-1. Implementations SHOULD retry the `execute_llm`
call within the agent loop before raising to the caller.

**Constants:**

| Constant           | Default | Notes                          |
| ------------------ | ------- | ------------------------------ |
| `MAX_LLM_RETRIES`  | `3`     | MAY be configurable at runtime |

**Algorithm:**

```
// Inside the agent loop, replacing the direct execute_llm call:
llm_attempts = 0
loop:
  try:
    response = execute_llm(agent, messages)
    break  // success
  catch error:
    llm_attempts += 1
    if llm_attempts >= MAX_LLM_RETRIES:
      raise ExecuteError(
        message: str(error),
        messages: messages   // MUST include conversation state
      )
    backoff = min(2^llm_attempts + jitter(), 60)  // exponential backoff, capped at 60s
    sleep(backoff)
```

**Requirements:**

- This retry is independent of any HTTP-level retry inside the executor.
  The loop retries calling the executor as a black box — this also gives
  the runtime an opportunity to refresh credentials, failover connections,
  or recover from transient executor state between attempts.
- Retry SHOULD apply to all executor failures, not just specific HTTP
  status codes. The loop does not inspect the error type — it simply
  retries the call.
- When all retries are exhausted, the raised error MUST include the
  accumulated `messages` list so the caller can resume by passing them
  back as thread input on a subsequent `turn()` call.
- Implementations SHOULD emit a `status` event (§13.1) before each retry
  (e.g., `"LLM call failed, retrying (attempt 2/3)..."`).
- Retry MUST respect the cancellation token (§13.2) — if cancellation is
  signaled during a backoff wait, the loop MUST stop retrying immediately.
- During non-agent `invoke()` calls (single LLM call, no tool loop),
  implementations MAY apply the same retry logic but are not required to.

---

## §10 Streaming

Streaming wraps raw SDK iterators to enable tracing and item accumulation.

### §10.1 PromptyStream

```
PromptyStream:
  // Constructor
  constructor(raw_iterator):
    self.raw = raw_iterator
    self.items = []

  // Sync iteration
  __iter__():
    for item in self.raw:
      self.items.append(item)
      yield item
    // On exhaustion:
    TRACE: emit "PromptyStream" span with result = self.items

  // Async iteration
  __aiter__():
    async for item in self.raw:
      self.items.append(item)
      yield item
    // On exhaustion:
    TRACE: emit "PromptyStream" span with result = self.items
```

**Requirements:**

- Implementations MUST support async iteration (`AsyncIterator` /
  `AsyncIterable` or language equivalent).
- Implementations SHOULD support sync iteration when the language allows it.
- Implementations MUST accumulate all items for tracing.
- Implementations MUST flush accumulated items to the tracer on exhaustion
  (not on each individual item).

### §10.2 Processor Integration

The processor wraps the raw SDK stream in a `PromptyStream`, then yields
processed content:

```
async function process_stream(agent, raw_stream) → async generator:
  prompty_stream = PromptyStream(raw_stream)

  async for chunk in prompty_stream:
    // Extract delta content / tool calls from chunk
    yield processed_delta
```

The `PromptyStream` wrapper MUST be the innermost wrapper around the SDK
iterator. Any processing logic operates on top of it.

### §10.3 Refusal Handling

If a streaming chunk contains a `refusal` field (OpenAI-specific),
implementations MUST raise a `ValueError` with the refusal message
immediately upon encountering the chunk. The stream MUST NOT continue after
a refusal is detected.

---

## §11 Registries & Plugin Discovery

### §11.1 Connection Registry

The connection registry stores pre-configured LLM clients for reuse across
prompts.

**API:**

| Function                          | Description                                |
| --------------------------------- | ------------------------------------------ |
| `register_connection(name, client)` | Store a named client/connection            |
| `get_connection(name) → client`     | Retrieve by name; return `null` if absent  |
| `clear_connections()`               | Remove all entries (for testing)            |

- All registry operations MUST be thread-safe.
- The registry MUST be a process-global singleton (or equivalent
  language-idiomatic scope).

**Usage:** When an executor encounters a `ReferenceConnection`
(`kind: "reference"`), it MUST look up `connection.name` in the connection
registry to obtain the pre-configured client. If the name is not found, the
executor MUST raise an error.

### §11.2 Tool Registry

The tool registry provides two layers of dispatch for tool execution in the
agent loop (§9):

1. **Name registry** — per-tool handlers keyed by tool name. Explicit
   overrides and user-provided function callables live here.
2. **Kind handlers** — per-kind handlers keyed by tool kind (`"function"`,
   `"prompty"`, `"mcp"`, `"openapi"`, `"*"`). These are extensible fallbacks
   that handle entire categories of tools without per-name registration.

When the agent loop needs to execute a tool call, it resolves the handler
using the dispatch order defined below.

#### Name Registry API

| Function                        | Description                              |
| ------------------------------- | ---------------------------------------- |
| `register_tool(name, handler)`  | Store a per-name tool handler            |
| `get_tool(name) → handler`     | Retrieve by name; return `null` if absent |
| `clear_tools()`                 | Remove all name entries (for testing)    |

- All registry operations MUST be thread-safe.
- The name registry MUST be a process-global singleton.

#### Kind Handler API

| Function                               | Description                                       |
| -------------------------------------- | ------------------------------------------------- |
| `register_tool_handler(kind, handler)` | Store a kind handler; replaces any existing        |
| `get_tool_handler(kind) → handler`    | Retrieve by kind; return `null` if absent          |
| `clear_tool_handlers()`               | Remove all kind entries (for testing)              |

- Kind handlers MUST be a process-global singleton.
- Implementations SHOULD register built-in kind handlers for `"function"` and
  `"prompty"` at startup. Handlers for `"mcp"`, `"openapi"`, and `"*"`
  (custom) MAY be registered by extension packages.

#### Dispatch Order

When resolving a tool call with name `N` and tool definition kind `K`:

```
1. handler = get_tool(N)
   → if found, execute handler(args) and return result

2. handler = get_tool_handler(K)
   → if found, execute handler(tool_def, args, agent, inputs) and return result

3. raise ValueError("No handler registered for tool: " + N + " (kind: " + K + ")")
```

The name registry (layer 1) always takes priority, allowing users to override
any tool — including built-in prompty tools — with a custom callable.

#### Built-in Kind Handlers

| Tool Kind    | Handler Behaviour                                             |
| ------------ | ------------------------------------------------------------- |
| `"function"` | Look up callable in name registry, call `handler(args)`       |
| `"prompty"`  | Load child `.prompty` via `tool.path`, execute per §9.6       |
| `"mcp"`      | Send tool-call request via MCP client protocol                |
| `"openapi"`  | Make HTTP call per OpenAPI specification                      |
| `"*"`        | Delegate to user-provided handler's `execute(args)` method   |

Implementations that do not yet support a kind SHOULD register a handler that
raises `NotImplementedError` with a descriptive message, rather than leaving
the kind unregistered.

#### Typed Tool Functions (`@tool` / `tool()` / `[Tool]`)

Each language provides a decorator or attribute that turns a regular typed
function into a tool handler. The decorator:

1. **Introspects the function signature** — parameter names, types, and
   defaults are mapped to `Property` objects using the type mapping table below.
2. **Builds a `FunctionTool` definition** — attached as `fn.__tool__` (or
   equivalent) for later inspection.
3. **Registers the handler** in the global name registry via
   `register_tool(name, fn)`.

The `.prompty` file MUST still declare all tools in frontmatter. The decorator
provides the **implementation** for declared tools — it does not replace the
declaration. The file is the single source of truth for what the LLM sees.

**Type mapping:**

| Python   | TypeScript  | C#                     | Schema Kind |
| -------- | ----------- | ---------------------- | ----------- |
| `str`    | `"string"`  | `string`               | `string`    |
| `int`    | `"integer"` | `int`, `long`          | `integer`   |
| `float`  | `"float"`   | `float`, `double`      | `float`     |
| `bool`   | `"boolean"` | `bool`                 | `boolean`   |
| `list`   | `"array"`   | `List<T>`, arrays      | `array`     |
| `dict`   | `"object"`  | `Dictionary<,>`        | `object`    |

TypeScript cannot introspect types at runtime, so parameters MUST be declared
explicitly in the wrapper options.

#### `bind_tools` — Bridging Declarations and Handlers

`bind_tools` validates that decorated tool functions match the tool
declarations in an agent's frontmatter, and returns a handler dictionary
suitable for `turn`.

**Signature:**

```
function bind_tools(agent, tools) → dict[str, callable]:
  agent:  A loaded Prompty agent
  tools:  A list of @tool-decorated functions (Python/TS) or an object
          instance with [Tool]-decorated methods (C#)
```

**Algorithm:**

```
function bind_tools(agent, tools):
  // 1. Build a map of provided handler names → functions
  handlers = {}
  for fn in tools:
    name = fn.__tool__.name
    if name in handlers:
      raise ValueError("Duplicate tool handler: " + name)
    handlers[name] = fn

  // 2. Get declared function tool names from agent.tools
  declared = set()
  for tool_def in agent.tools:
    if tool_def.kind == "function":
      declared.add(tool_def.name)

  // 3. Validate: every handler must match a declaration
  for name in handlers:
    if name not in declared:
      raise ValueError(
        "Tool handler '" + name + "' has no matching declaration "
        + "in agent.tools. Declared function tools: " + join(declared))

  // 4. Warn: every function declaration should have a handler
  for name in declared:
    if name not in handlers:
      warn("Tool '" + name + "' is declared in agent.tools but "
           + "no handler was provided to bind_tools()")

  // 5. Return the validated handler dict
  return handlers
```

**Requirements:**

- `bind_tools` MUST only validate against `kind: "function"` tools. Tools with
  other kinds (mcp, openapi, prompty, custom) are resolved by kind handlers
  and do not require function handlers.
- `bind_tools` MUST raise an error if a handler has no matching declaration.
  This catches typos and stale handlers early.
- `bind_tools` SHOULD warn (not error) if a declared function tool has no
  handler, since the tool may be handled by the name registry or kind handler.
- The returned dictionary MUST be suitable for passing as the `tools` parameter
  to `turn`.
- `bind_tools` MUST NOT mutate `agent.tools` or the global registry. It is a
  pure validation and extraction step.

**Language adaptations:**

| Language   | Signature                                           | Notes                            |
| ---------- | --------------------------------------------------- | -------------------------------- |
| Python     | `bind_tools(agent, [fn1, fn2, ...])` → `dict`      | Functions have `__tool__`        |
| TypeScript | `bindTools(agent, [fn1, fn2, ...])` → `Record`     | Functions have `__tool__`        |
| C#         | `ToolAttribute.BindTools(agent, instance)` → `Dictionary` | Reflects over `[Tool]` methods   |

### §11.3 Invoker Discovery

Renderers, parsers, executors, and processors are pluggable components
resolved at runtime via a discovery mechanism.

**API:**

| Function                          | Description                                      |
| --------------------------------- | ------------------------------------------------ |
| `get_renderer(key) → instance`    | Look up renderer by key                          |
| `get_parser(key) → instance`      | Look up parser by key                            |
| `get_executor(key) → instance`    | Look up executor by key                          |
| `get_processor(key) → instance`   | Look up processor by key                         |
| `clear_cache()`                   | Reset cached instances (for testing)             |

If no implementation is found for a given key, the implementation MUST raise
an `InvokerError` with a message identifying the missing component and key.

**Key resolution.** Each component type derives its lookup key from a
specific field on the `PromptAgent`:

| Component   | Key Source                     | Example Values                |
| ----------- | ------------------------------ | ----------------------------- |
| Renderer    | `agent.template.format.kind`   | `"jinja2"`, `"mustache"`     |
| Parser      | `agent.template.parser.kind`   | `"prompty"`                  |
| Executor    | `agent.model.provider`         | `"openai"`, `"foundry"`, `"anthropic"` |
| Processor   | `agent.model.provider`         | `"openai"`, `"foundry"`, `"anthropic"` |

**Discovery mechanism.** This specification defines the **contract** (lookup
by key → instance conforming to the protocol), not the mechanism. Each
language SHOULD use its own idiomatic approach:

| Language   | Recommended Mechanism                                      |
| ---------- | ---------------------------------------------------------- |
| Python     | `importlib.metadata.entry_points()` with groups `prompty.renderers`, `prompty.parsers`, `prompty.executors`, `prompty.processors` |
| TypeScript | Explicit `registerRenderer("jinja2", Jinja2Renderer)` calls |
| Go         | Interface implementations registered via `init()`          |
| C#         | Dependency injection or assembly scanning                  |

**Built-in registrations.** The following MUST or MAY be available without
additional configuration:

| Key         | Component            | Requirement | Notes                            |
| ----------- | -------------------- | ----------- | -------------------------------- |
| `jinja2`    | Renderer             | MUST        | Jinja2-compatible template engine |
| `mustache`  | Renderer             | MAY         | Mustache template engine          |
| `prompty`   | Parser               | MUST        | Role-marker chat parser           |
| `openai`    | Executor + Processor | MUST        | OpenAI Chat/Embedding/Image/Responses |
| `foundry`   | Executor + Processor | MAY         | Microsoft Foundry                     |
| `anthropic` | Executor + Processor | MAY         | Anthropic Messages                    |

#### §11.3.1 Protocol Interfaces

Every component MUST conform to its protocol. Implementations MUST provide
at least the async variants; sync variants SHOULD also be provided.

**RendererProtocol:**

```
RendererProtocol:
  render(agent: PromptAgent, inputs: dict) → string
  render_async(agent: PromptAgent, inputs: dict) → string
```

Receives the agent and user inputs. Returns the rendered template string
with all variables substituted.

**ParserProtocol:**

```
ParserProtocol:
  parse(agent: PromptAgent, rendered: string) → Message[]
  parse_async(agent: PromptAgent, rendered: string) → Message[]
```

Receives the agent and the rendered string. Returns an ordered list of
`Message` objects.

**ExecutorProtocol:**

```
ExecutorProtocol:
  execute(agent: PromptAgent, messages: Message[]) → raw_response
  execute_async(agent: PromptAgent, messages: Message[]) → raw_response
```

Receives the agent and parsed messages. Calls the LLM provider API.
Returns the raw SDK response object.

**ProcessorProtocol:**

```
ProcessorProtocol:
  process(agent: PromptAgent, response: any) → result
  process_async(agent: PromptAgent, response: any) → result
```

Receives the agent and raw response. Extracts and returns the final result
(string, parsed JSON object, list of embeddings, ToolCall list, etc.).

---

## §12 Cross-Cutting Concerns

### §12.1 Async Contract

All pipeline functions MUST have async variants. Pipeline functions SHOULD
also have sync variants where the language supports synchronous execution.

The following functions MUST exist in both sync and async forms:

| Sync                | Async                      |
| ------------------- | -------------------------- |
| `load`              | `load_async`               |
| `render`            | `render_async`             |
| `parse`             | `parse_async`              |
| `prepare`           | `prepare_async`            |
| `run`               | `run_async`                |
| `invoke`            | `invoke_async`             |
| `process`           | `process_async`            |
| `turn`              | `turn_async`               |

**Naming convention:** `function_name` for sync, `function_name_async` for
async. Language-idiomatic alternatives are acceptable (e.g., TypeScript MAY
provide only async functions since its ecosystem is async-first).

Registry operations (`register_connection`, `get_connection`,
`register_tool`, `get_tool`, `clear_cache`, etc.) are sync-only. They
perform in-memory lookups and MUST NOT perform I/O.

### §12.2 Input Validation

The `validate_inputs` function MUST be called as part of `prepare()`, before
rendering:

```
function validate_inputs(agent, inputs) → dict:
  validated = shallow_copy(inputs)

  for prop in agent.inputs:
    if prop.name not in validated:
      if prop.default is not null:
        validated[prop.name] = prop.default
      elif prop.required:
        raise ValueError("Missing required input: " + prop.name)
      // else: optional with no default — omit

  return validated
```

**Behaviour requirements:**

- MUST fill missing inputs from `default` when available.
- MUST raise `ValueError` for missing inputs that are `required` and have
  no `default`.
- MUST NOT raise for optional inputs with no value and no default — they
  are simply omitted from the validated dict.
- MUST NOT use `example` as a runtime value under any circumstances — it
  exists solely for documentation and tooling. Using `example` as a fallback
  is the fastest path to unexpected behavior.
- MUST NOT type-check input values (the template engine handles coercion).
- MUST NOT reject extra inputs not declared in `inputs` (they are
  passed through to the template).

### §12.3 Dotenv Loading

Loading `.env` files is an **application-level concern**. Runtime libraries
MUST NOT automatically load `.env` files as a side effect of loading a
`.prompty` file.

**Guidance for application authors:**

- Load `.env` files at application startup, before calling `load()`.
- Look for `.env` in the `.prompty` file's parent directory or the
  project root.
- Format: standard dotenv (`KEY=VALUE`, one per line, `#` comments,
  optional quoting).
- `.env` files MUST NOT override environment variables that are already set
  in the process environment.

### §12.4 Error Conditions

Implementations MUST raise appropriate errors for the conditions listed
below. This specification defines **what** error to raise and **when**; the
specific exception class SHOULD follow language idioms.

| Stage       | Condition                                  | Error Type          | Message Pattern                                     |
| ----------- | ------------------------------------------ | ------------------- | --------------------------------------------------- |
| Load        | File not found                             | FileNotFoundError   | `"Prompty file not found: {path}"`                  |
| Load        | Invalid YAML frontmatter                   | ValueError          | `"Invalid frontmatter YAML: {details}"`             |
| Load        | Missing env var (no default)               | ValueError          | `"Environment variable '{name}' not set"`           |
| Load        | Referenced file not found (`${file:}`)     | FileNotFoundError   | `"Referenced file not found: {path}"`               |
| Render      | Undefined template variable                | ValueError          | `"Undefined template variable: {name}"`             |
| Render      | Template syntax error                      | ValueError          | `"Template syntax error: {details}"`                |
| Parse       | Role marker nonce mismatch (strict mode)   | ValueError          | `"Role marker nonce mismatch (possible injection)"` |
| Execute     | Unsupported `apiType`                      | ValueError          | `"Unsupported API type: {type}"`                    |
| Execute     | Connection failure                         | ConnectionError     | Provider-specific message                           |
| Process     | Unexpected response format                 | ValueError          | `"Unexpected response format"`                      |
| Agent Loop  | Tool not registered                        | ValueError          | `"Tool not registered: {name}"`                     |
| Agent Loop  | Max iterations exceeded                    | RuntimeError        | `"Agent loop exceeded {n} iterations"`              |
| Agent Loop  | Model refusal                              | ValueError          | `"Model refused: {message}"`                        |
| Agent Loop  | LLM call failed (retries exhausted)        | ExecuteError        | `"LLM call failed after {n} retries: {message}"` — MUST include `messages` |
| Agent Loop  | Tool handler exception/panic               | *(not raised)*      | Converted to tool result string (§9.9)              |
| Discovery   | No implementation for key                  | InvokerError        | `"No {component} registered for key: {key}"`        |

### §12.5 Executor Retry

Executors SHOULD handle transient HTTP errors (status codes 429 and 5xx)
internally with retry and exponential backoff. This is independent of the
agent loop's LLM call retry (§9.10) — the executor retries the HTTP
request, while the loop retries calling the executor.

When retrying, executors SHOULD respect `Retry-After` headers when present.
The maximum number of internal retries is an implementation choice.
Executors MUST NOT retry on 4xx errors other than 429 by default.

### §12.6 Rich Kinds

`RICH_KINDS = { thread, image, file, audio }`

These are input property kinds that contain structured data requiring special
handling during rendering and parsing. They MUST NOT be passed directly to
the template engine as raw values.

| Kind     | Contains           | Rendering                | Parsing                         | Wire Format                |
| -------- | ------------------ | ------------------------ | ------------------------------- | -------------------------- |
| `thread` | `Message[]`        | Nonce replacement        | Expanded back to `Message[]`    | N/A (already messages)     |
| `image`  | Image data or URL  | Nonce replacement        | Preserved as nonce              | Resolved to `ImagePart`    |
| `file`   | File data or URL   | Nonce replacement        | Preserved as nonce              | Resolved to `FilePart`     |
| `audio`  | Audio data or URL  | Nonce replacement        | Preserved as nonce              | Resolved to `AudioPart`    |

**Nonce format:** All rich kinds use the same nonce format:

```
__PROMPTY_THREAD_<hex8>_<name>__
```

Where `<hex8>` is 8 random hexadecimal characters and `<name>` is the input
property name. The nonce MUST be unique per render invocation.

**Purpose:** The nonce prevents template engines from interpreting or
mangling structured data. During rendering, the structured value is replaced
with a nonce string. After parsing, the nonce is resolved back to the
appropriate content:

- **Thread nonces** are expanded during the parse/prepare phase into the
  actual `Message[]` sequence, spliced into the message list at the nonce's
  position.
- **Image, file, and audio nonces** are resolved during wire-format
  conversion (§7) when the actual `ImagePart`, `FilePart`, or `AudioPart`
  content types are constructed.

---

## §13 Agent Loop Extensions

The base agent loop (§9) handles the tool-call cycle. This section specifies
six extensions that make the loop production-ready: events, cancellation,
context window management, guardrails, steering, and parallel tool execution.

These extensions integrate with the existing §9.2 algorithm — specifically,
they wrap and extend the tool dispatch loop and the `FormatToolMessages`
hook (§9.4). Tool guardrail denials produce synthetic results that flow
through `FormatToolMessages` like any other tool result.

All extensions are opt-in — a conforming implementation MUST support the
base loop and MAY implement any combination of these extensions.

### §13.1 Agent Events

The agent loop MUST support an optional event callback that receives
structured events during execution. This enables real-time UIs, logging,
and coordination without coupling the loop to any particular output mechanism.

**Event Types:**

| Event Type          | Payload                                          | When Emitted                              |
| ------------------- | ------------------------------------------------ | ----------------------------------------- |
| `token`             | `{ token: string }`                              | Each content chunk during streaming       |
| `thinking`          | `{ token: string }`                              | Each reasoning/chain-of-thought chunk     |
| `tool_call_start`   | `{ name: string, arguments: string }`            | When a tool call is detected              |
| `tool_result`       | `{ name: string, result: string }`               | After a tool call completes               |
| `status`            | `{ message: string }`                            | Human-readable status updates             |
| `messages_updated`  | `{ messages: Message[] }`                        | After messages list is mutated            |
| `done`              | `{ response: string, messages: Message[] }`      | Final response produced                   |
| `error`             | `{ message: string }`                            | Non-fatal error (e.g., tool panic)        |
| `cancelled`         | `{}`                                             | Loop was cancelled via cancellation token |

**API:**

```
function turn(agent_or_path, inputs, tools=null,
              on_event=null, ...) → result:
  // on_event is Callable[[event_type: string, data: dict], None]
  // Called synchronously — MUST NOT throw
```

**Requirements:**

- Implementations MUST NOT skip `done` — it MUST be the last event emitted
  on successful completion.
- `messages_updated` MUST be emitted after every mutation to the message list
  (tool result appended, steering message injected, context trimmed).
- `token` events MUST be emitted when streaming is active and the final
  iteration produces content chunks.
- `tool_call_start` MUST be emitted before tool execution begins.
- `tool_result` MUST be emitted after tool execution completes.
- `error` is for non-fatal conditions — fatal errors MUST raise exceptions.
- Event callbacks MUST NOT block the loop. If an event callback raises,
  implementations SHOULD log the error and continue.

### §13.2 Cancellation

The agent loop MUST support cooperative cancellation via a token checked at
well-defined points during execution.

**CancellationToken:**

```
CancellationToken:
  cancelled: bool  // thread-safe, starts false

  cancel():
    self.cancelled = true

  is_cancelled → bool:
    return self.cancelled
```

**Check Points:**

The loop MUST check `cancel.is_cancelled` at these points:

1. **Top of each iteration** — before any work
2. **Before each LLM call** — after context trim, before HTTP request
3. **Before each tool execution** — between tool calls within one iteration

When cancellation is detected:

1. Emit `cancelled` event (if event callback is set)
2. Raise `CancelledError` (or language equivalent)
3. Do NOT execute any pending tool calls
4. Do NOT make any further LLM calls

**API:**

```
function turn(agent_or_path, inputs, tools=null,
              cancel=null, ...) → result:
```

**Language Mapping:**

Implementations SHOULD use the language's native cancellation mechanism
where one exists (e.g., standard library cancellation tokens, abort signals).
Where no native mechanism exists, a simple thread-safe boolean flag suffices.

### §13.3 Context Window Management

Long-running agent loops accumulate messages that may exceed the model's
context window. Implementations MUST support automatic context trimming
when a budget is specified.

**Algorithm:**

```
function trim_to_context_window(messages, budget_chars) → Message[]:
  1. total = estimate_chars(messages)
  2. if total <= budget_chars:
       return messages  // fits — no trimming

  3. Partition messages into:
     - system_messages: leading contiguous system-role messages
     - rest: everything after

  4. Reserve summary_budget = min(5000, budget_chars * 0.05)

  5. dropped = []
     while estimate_chars(system_messages + rest) > (budget_chars - summary_budget)
           AND len(rest) > 2:
       dropped.append(rest.pop(0))  // remove oldest non-system message

  6. summary = summarize_dropped(dropped)

  7. Insert summary as user message immediately after system_messages:
     summary_msg = Message(role: "user",
       content: [TextPart(value: "[Context summary: " + summary + "]")])

  8. return system_messages + [summary_msg] + rest
```

**Character Estimation:**

```
function estimate_chars(messages) → int:
  total = 0
  for msg in messages:
    total += len(msg.role) + 4  // role + delimiters
    for part in msg.content:
      if part is TextPart:
        total += len(part.value)
      else:
        total += 200  // fixed estimate for non-text parts
    if msg.metadata has "tool_calls":
      total += json_length(msg.metadata.tool_calls)
  return total
```

**Summarization:**

```
function summarize_dropped(messages) → string:
  lines = []
  for msg in messages:
    if msg.role == "user":
      lines.append("User asked: " + truncate(text_of(msg), 200))
    elif msg.role == "assistant":
      text = text_of(msg)
      if text:
        lines.append("Assistant: " + truncate(text, 200))
      if msg has tool_calls:
        names = [tc.name for tc in msg.tool_calls]
        lines.append("  Called tools: " + join(names, ", "))
    // Skip tool-result messages (captured in assistant summary)
  return join(lines, "\n")  // cap at ~4000 chars
```

**Optional LLM Compaction:**

Implementations MAY support a `compaction_provider` — a secondary LLM used
to produce a higher-quality summary of dropped messages. When provided:

1. Build a summarizer prompt with the dropped messages
2. Call the compaction provider (single-turn, no tools)
3. If the LLM returns a non-empty response, use it as the summary
4. If the call fails, fall back to `summarize_dropped()`

**API:**

```
function turn(agent_or_path, inputs, tools=null,
              context_budget=null, ...) → result:
  // context_budget is int (character count) or null (no trimming)
```

**Requirements:**

- System messages MUST never be dropped.
- At least 2 non-system messages MUST be preserved (the most recent user
  message and the conversation's anchor).
- Trimming MUST happen before each LLM call, after steering messages
  are drained (§13.5).
- When trimming occurs, a `messages_updated` event MUST be emitted.
- Implementations MUST NOT trim during non-agent `invoke()` calls.

### §13.4 Guardrails

Guardrails are validation hooks at three points in the agent loop: before
the LLM call (input), after the LLM response (output), and before each
tool execution (tool). Each hook returns allow or deny.

**GuardrailResult:**

```
GuardrailResult:
  allowed: bool
  reason: string | null  // required when allowed=false
```

**Guardrails Configuration:**

```
Guardrails:
  input:  Callable[[Message[]], GuardrailResult] | null
  output: Callable[[Message], GuardrailResult] | null
  tool:   Callable[[string, dict], GuardrailResult] | null
```

**Semantics:**

| Hook     | Input                      | On Deny                                                   |
| -------- | -------------------------- | --------------------------------------------------------- |
| `input`  | Full message list          | Abort loop, raise `GuardrailError`                        |
| `output` | Assistant response message | Abort loop, raise `GuardrailError`                        |
| `tool`   | Tool name + parsed args    | Skip tool, inject synthetic result: `"Tool denied: {reason}"` |

**Check Points in Loop:**

```
loop:
  // 1. Check input guardrail (full message list)
  if guardrails.input is not null:
    result = guardrails.input(messages)
    if not result.allowed:
      emit event("error", {message: "Input guardrail denied: " + result.reason})
      raise GuardrailError(result.reason)

  // 2. Call LLM
  response = execute_llm(agent, messages)
  assistant_msg = process(agent, response)

  // 3. Check output guardrail (assistant message)
  if guardrails.output is not null:
    result = guardrails.output(assistant_msg)
    if not result.allowed:
      emit event("error", {message: "Output guardrail denied: " + result.reason})
      raise GuardrailError(result.reason)

  // 4. For each tool call, check tool guardrail
  for tool_call in tool_calls:
    if guardrails.tool is not null:
      result = guardrails.tool(tool_call.name, tool_call.arguments)
      if not result.allowed:
        tool_result = "Tool denied by guardrail: " + result.reason
        // Do NOT execute the tool — use synthetic result
        continue
    // Execute tool normally
    tool_result = execute_tool(tool_call)

  // 5. Format tool messages via executor (§9.4)
  //    Denied tools produce synthetic results that flow through
  //    FormatToolMessages like any other tool result.
  tool_messages = executor.FormatToolMessages(
    response, tool_calls, tool_results, text_content
  )
  append tool_messages to messages
```

**Requirements:**

- Guardrail callbacks MUST be called synchronously with respect to the loop.
- For async loops, guardrail callbacks MAY be async.
- `GuardrailError` MUST include the deny reason.
- Tool guardrail denials MUST NOT abort the entire loop — only the
  individual tool is skipped.
- Input guardrail receives the full message list including any steering
  messages and after context trimming.

**API:**

```
function turn(agent_or_path, inputs, tools=null,
              guardrails=null, ...) → result:
```

### §13.5 Steering

Steering enables external code to inject user messages into a running agent
loop. This supports interactive scenarios where a user wants to redirect
the agent mid-execution (e.g., "actually focus on error handling").

**Steering Queue:**

```
Steering:
  queue: ThreadSafeQueue<string>

  send(message: string):
    // Enqueue a message to be injected at the next iteration
    queue.push(message)

  drain() → string[]:
    // Atomically remove and return all queued messages
    items = queue.take_all()
    return items

  has_pending → bool:
    return not queue.is_empty
```

**Integration with Agent Loop:**

```
loop:
  // Drain steering at the TOP of each iteration
  if steering is not null:
    pending = steering.drain()
    for msg_text in pending:
      user_msg = Message(role: "user",
        content: [TextPart(value: msg_text)])
      append user_msg to messages
    if len(pending) > 0:
      emit event("messages_updated", {messages})
      emit event("status", {message: "Injected " + len(pending) + " steering message(s)"})

  // Then: context trim, guardrails, LLM call, etc.
```

**Requirements:**

- Steering messages MUST be drained before context trimming (so they are
  visible to the input guardrail and may be trimmed if budget is tight).
- Steering messages MUST be appended as `role: "user"` messages.
- `send()` MUST be safe to call from any thread or async task.
- `drain()` MUST be atomic — no message is lost or duplicated.
- If no steering object is provided, the loop behaves as before.

**Thread Safety:**

`send()` MUST be safe to call from any thread or async task. `drain()` MUST
be atomic — no message is lost or duplicated. Implementations SHOULD use
the language's idiomatic concurrent queue or equivalent.

**API:**

```
function turn(agent_or_path, inputs, tools=null,
              steering=null, ...) → result:
```

### §13.6 Parallel Tool Execution

When the LLM returns multiple tool calls in a single response,
implementations MAY execute them concurrently instead of sequentially.

**API:**

```
function turn(agent_or_path, inputs, tools=null,
              parallel_tool_calls=false, ...) → result:
```

**Algorithm:**

```
if parallel_tool_calls AND len(tool_calls) > 1:
  // Execute all tools concurrently
  results = parallel_map(tool_calls, execute_tool)
  // Results are ordered to match tool_calls
else:
  // Sequential execution (default)
  results = [execute_tool(tc) for tc in tool_calls]
```

**Requirements:**

- Parallel execution MUST preserve result ordering — tool results MUST
  be appended to messages in the same order as the original tool calls.
- Each parallel tool execution MUST have its own trace span.
- If any tool raises an exception, other in-flight tools SHOULD be
  allowed to complete (do not cancel siblings).
- Tool guardrails (§13.4) MUST still be checked for each tool — denied
  tools receive synthetic results while other tools execute normally.
- `tool_call_start` and `tool_result` events MUST be emitted for each
  tool regardless of parallel or sequential execution.
- Implementations SHOULD use the language's idiomatic concurrency
  primitive for parallel execution (e.g., task groups, promise
  combinators, thread pools).

### §13.7 Unified Signature

The full `turn` signature with all extensions:

```
function turn(
  agent_or_path,              // string path or loaded agent
  inputs = null,              // input dictionary
  tools = null,               // tool handlers
  *,                          // keyword-only below
  max_iterations = 10,        // iteration cap
  max_llm_retries = 3,        // retry execute_llm on failure (§9.10)
  on_event = null,            // event callback
  cancel = null,              // cancellation token
  context_budget = null,      // character budget for context window
  guardrails = null,          // validation hooks
  steering = null,            // mid-loop message injection
  parallel_tool_calls = false,  // concurrent tool execution
  raw = false,                // return raw response (no processing)
  turn = null,                // turn number for trace labeling
) → result
```

**Execution Order Within Each Iteration:**

```
  1. Check cancellation
  2. Drain steering messages
  3. Trim context window (if budget set)
  4. Check input guardrail
  5. Call LLM with retry (§9.10 — up to max_llm_retries attempts)
  6. Process response (§9.2 step 5c)
  7. Check output guardrail
  8. If tool calls:
     a. Parse arguments with resilient fallback (§9.8)
     b. Check tool guardrails (per tool)
     c. Execute tools with error safety (§9.9), parallel or sequential
     d. Apply bindings (§9.6)
     e. Format tool messages via executor.FormatToolMessages (§9.4)
     f. Append to messages, emit messages_updated
     g. Continue loop
  9. Emit done, return result
```

---

## §14 Turns

A **turn** represents one user-message round-trip in a multi-turn conversation:
the user provides inputs (including the thread so far), the runtime prepares
messages, calls the LLM (possibly looping through tool calls), and returns a
result. Turns are the fundamental unit of conversational interaction and MUST
be traced as such.

`turn` is also the primary API for tool-calling (agent) workflows. When the
`tools` option is provided, `turn` owns the agent loop (§9) internally.

### §14.1 Motivation

Without turn boundaries, a multi-turn chat trace shows a flat sequence of
`prepare → executor → processor` calls with no way to tell which belong to
which user message. The `turn` function wraps each round-trip in a named trace
span, giving trace viewers, dashboards, and cost-tracking tools a clear grouping.

### §14.2 Public API

- `turn(agent_or_path, inputs, options?) → result`
- `turn_async(agent_or_path, inputs, options?) → result`

**Parameters:**

| Parameter       | Type                          | Required | Description                                      |
| --------------- | ----------------------------- | -------- | ------------------------------------------------ |
| `agent_or_path` | `string \| PromptAgent`       | Yes      | A loaded agent or a file path (loaded via `load()`) |
| `inputs`        | `dict<string, any>`           | Yes      | Inputs including the thread                      |
| `options.tools` | `dict<string, callable>`      | No       | Runtime tool handlers (triggers agent loop — §9)  |
| `options.raw`   | `bool`                        | No       | If true, skip processing (default: false)         |
| `options.turn`  | `int`                         | No       | Turn number for trace labeling (default: none)    |

When `agent_or_path` is a string, `turn` MUST call `load(agent_or_path)` to
resolve it to a `PromptAgent` before proceeding. This allows callers to pass
a file path directly for convenience, though pre-loading is preferred for
multi-turn conversations to avoid repeated file I/O.

**Return value:** The processed LLM result (string, structured data, tool calls,
or streaming iterator — same as `invoke`).

### §14.3 Algorithm

```
function turn(agent_or_path, inputs, options={}) → result:
  // Step 0: Resolve agent
  if agent_or_path is a string path:
    agent = load(agent_or_path)
  else:
    agent = agent_or_path

  label = "turn" + (" " + str(options.turn) if options.turn else "")

  TRACE: open span named label
    emit "signature" = "prompty.turn"
    emit "inputs"    = inputs

    // Step 1: Prepare messages (render + parse + thread expansion)
    messages = prepare(agent, inputs)

    // Step 2: Dispatch based on tool presence
    if options.tools is not null:
      // Agent mode: run the tool-calling loop (§9)
      // The agent loop calls executor + process directly (NOT via run())
      result = agent_loop(agent, messages, options.tools)
    else:
      // Simple mode: single LLM call
      // Calls executor + process directly (NOT via run())
      response = executor.execute(agent, messages)
      result = processor.process(agent, response)

    emit "result" = result
    return result
```

> **Note on `run()`**: Both `invoke` and `turn` call executor and processor
> directly — they do NOT delegate to `run()`. The `run()` function is a
> standalone building block with its own trace span, used when callers want
> to execute + process messages independently.

### §14.4 Relationship to Other Operations

| Operation | When to use                                                   |
| --------- | ------------------------------------------------------------- |
| `invoke`  | One-shot: load + prepare + execute + process, no conversation state |
| `turn`    | Conversational round: prepare + [agent loop] + process. Primary API for multi-turn and tool-calling. |
| `run`     | Standalone building block: execute + process from pre-built messages |

`invoke` accepts a file path and loads the agent internally for one-shot usage.
`turn` accepts either a pre-loaded agent or a file path — the caller typically
loads once and calls `turn` repeatedly as the conversation grows. This avoids
re-loading and re-parsing the `.prompty` file on every message.

### §14.5 Tracing

Each `turn` call MUST emit a trace span with the following attributes:

| Attribute    | Type     | Description                                        |
| ------------ | -------- | -------------------------------------------------- |
| `signature`  | `string` | `"prompty.turn"`                                   |
| `inputs`     | `any`    | The inputs dict (including thread)                 |
| `result`     | `any`    | The processed result                               |

The span name SHOULD include the turn number when provided (e.g., `"turn 3"`).
All inner spans (`prepare`, executor, processor, tool calls) nest inside the
turn span, making each round-trip a self-contained subtree.

**Target trace structures:**

One-shot (invoke — not a turn):
```
invoke > load > prepare > Executor > Processor
```

Chat turn (no tools):
```
turn 1 > prepare > Executor > Processor
```

Agent turn (with tools):
```
turn 1 > prepare > Executor > toolCalls > Executor > Processor
```

Standalone run:
```
run > Executor > Processor
```

### §14.6 Usage Pattern

```python
# Python example — multi-turn chat loop
agent = load("chat.prompty")
thread = []

while user_input := get_input():
    thread.append({ "role": "user", "content": user_input })
    inputs = { "firstName": "Jane", "query": thread }

    result = turn(agent, inputs, turn=len(thread) // 2)

    thread.append({ "role": "assistant", "content": result })
```

```python
# Python example — multi-turn with tool calling
agent = load("assistant.prompty")
thread = []
tools = bind_tools(agent, [get_weather, search_docs])

while user_input := get_input():
    thread.append({ "role": "user", "content": user_input })
    inputs = { "query": thread }

    result = turn(agent, inputs, tools=tools, turn=len(thread) // 2)

    thread.append({ "role": "assistant", "content": result })
```

```typescript
// TypeScript example — multi-turn chat loop
const agent = load("chat.prompty");
const thread: Message[] = [];
let turnCount = 0;

for (const userInput of messages) {
  thread.push({ role: "user", content: userInput });
  const inputs = { firstName: "Jane", query: thread };

  const result = await turn(agent, inputs, { turn: ++turnCount });

  thread.push({ role: "assistant", content: String(result) });
}
```

---

*End of Specification (Sections 1–14).*