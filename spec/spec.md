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

| Operation      | Composition                          | Description                            |
| -------------- | ------------------------------------ | -------------------------------------- |
| `prepare`      | render + parse + thread expansion    | Produce `Message[]` ready for the LLM  |
| `run`          | execute + process                    | Send messages to LLM, extract result   |
| `invoke`       | load + prepare + run                 | End-to-end from file path to result    |
| `invoke_agent` | load + prepare + run in agent loop   | With automatic tool-call handling      |

> **Naming note**: The pipeline stage that calls the LLM is called **execute** (the
> `ExecutorProtocol`). The top-level convenience functions that run the entire pipeline
> end-to-end are called **invoke** / **invoke_agent** to avoid ambiguity.

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
| `invoke`           | `(path, inputs) → result`                    | Processed result | §4–§8        |
| `invoke_agent`     | `(path, inputs, tools?) → result`            | Processed result | §4–§8 + loop |
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
3. If `mode` is `"agentic"`: call `invoke_agent(path, arguments)` — full agent loop
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
- Implementations SHOULD load `.env` files before resolving (see §4).

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

**Algorithm**:

```
function hoist_usage(span):
  If span.result contains a "usage" field:
    usage ← span.result.usage
    propagate to parent span as "__usage":
      __usage.prompt_tokens  += usage.prompt_tokens  (or usage.input_tokens)
      __usage.completion_tokens += usage.completion_tokens (or usage.output_tokens)
      __usage.total_tokens += usage.total_tokens
  For each child in span.__frames:
    hoist_usage(child)  // recursive — deepest spans propagate first
```

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
| API type                     | `gen_ai.operation.name`          | `"chat"`, `"embeddings"`, `"invoke_agent"`, `"execute_tool"` |
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

- Agent loop spans: `gen_ai.operation.name = "invoke_agent"`, with `gen_ai.agent.name`.
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

Implementations SHOULD load `.env` files before resolving `${env:}` references.

**Search order**: Starting from the `.prompty` file's directory, walk up parent
directories until a `.env` file is found or the filesystem root is reached.

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

---

## §9 Agent Loop

The agent loop enables multi-turn tool-calling workflows. It calls the LLM,
inspects the response for tool calls, executes them, appends results to the
conversation, and re-calls the LLM—repeating until the LLM produces a normal
(non-tool-call) response.

**Public API:**

- `invoke_agent(path_or_agent, inputs, tools?) → result`
- `invoke_agent_async(path_or_agent, inputs, tools?) → result`

Both MUST emit an `invoke_agent` trace span that wraps
the entire loop including all inner `execute` and `execute_tool` spans.

### §9.1 Constants

| Constant           | Default | Notes                          |
| ------------------ | ------- | ------------------------------ |
| `MAX_ITERATIONS`   | `10`    | MAY be configurable at runtime |

### §9.2 Algorithm

```
function invoke_agent(path_or_agent, inputs, tools=null) → result:
  // Step 1: Resolve agent
  if path_or_agent is a string path:
    agent = load(path_or_agent)
  else:
    agent = path_or_agent

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

    // 5b. Call the LLM
    response = execute_llm(agent, messages)      // raw API call

    // 5c. Process response
    result = process(agent, response)

    // 5d. Check for tool calls
    if result is a list of ToolCall:
      // Build assistant message preserving tool_calls in metadata
      assistant_msg = Message(
        role: "assistant",
        content: [],
        metadata: {
          tool_calls: [
            {
              id:       tc.id,
              type:     "function",
              function: { name: tc.name, arguments: tc.arguments }
            }
            for tc in result
          ]
        }
      )
      append assistant_msg to messages

      // Execute each tool call
      for tool_call in result:
        TRACE: emit "execute_tool" span for tool_call.name

        // Look up handler
        handler = get_tool(tool_call.name)
        if handler is null:
          raise ValueError("Tool not registered: " + tool_call.name)

        // Parse arguments
        args = json_parse(tool_call.arguments)

        // Apply bindings (inject bound values from inputs)
        args = apply_bindings(
          find_tool_definition(agent, tool_call.name),
          args,
          inputs
        )

        // Dispatch by tool kind
        tool_def = find_tool_definition(agent, tool_call.name)
        match tool_def.kind:
          "function":
            tool_result = handler(args)
          "prompty":
            tool_result = execute_prompty_tool(tool_def, args, inputs)
          "mcp":
            tool_result = mcp_client.call(tool_call.name, args)
          "openapi":
            tool_result = http_call(tool_def.specification, tool_call.name, args)
          default:   // CustomTool
            tool_result = handler.execute(args)

        // Build tool result message
        tool_msg = Message(
          role: "tool",
          content: [TextPart(value: str(tool_result))],
          metadata: { tool_call_id: tool_call.id }
        )
        append tool_msg to messages

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

### §9.4 Provider-Specific Tool Message Formats

Each provider has a different wire format for tool-call messages. The agent
loop MUST produce messages in the correct format for the active provider.

**OpenAI Chat Completions:**

```
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
}

// Tool result message
{
  role: "tool",
  content: "72°F and sunny",
  tool_call_id: "call_123"
}
```

**Anthropic:**

```
// Assistant message — MUST preserve ALL content blocks (text + tool_use)
{
  role: "assistant",
  content: [<original content blocks from API response>]
}

// Tool results — ALL results in ONE user message
{
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: "toolu_123", content: "72°F and sunny" },
    { type: "tool_result", tool_use_id: "toolu_456", content: "Pizza Palace" }
  ]
}
```

Anthropic implementations MUST batch all tool results into a single `user`
message. Sending individual `user` messages per tool result is incorrect and
will cause API errors.

**OpenAI Responses API:**

```
// MUST include original function_call item in input
{
  type: "function_call",
  id: "fc_123",
  call_id: "call_123",
  name: "get_weather",
  arguments: "{\"city\":\"Paris\"}"
}

// Function call output
{
  type: "function_call_output",
  call_id: "call_123",
  output: "72°F and sunny"
}
```

### §9.5 Bindings Injection

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

### §9.6 PromptyTool Execution

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
      return invoke_agent(child_agent, merged)
```

Child `PromptyTool` execution MUST inherit the parent's tracer registry,
producing nested trace spans that show the full call hierarchy.

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

The tool registry stores handlers that the agent loop invokes when the LLM
returns tool calls.

**API:**

| Function                        | Description                              |
| ------------------------------- | ---------------------------------------- |
| `register_tool(name, handler)`  | Store a tool handler                     |
| `get_tool(name) → handler`     | Retrieve by name; return `null` if absent |
| `clear_tools()`                 | Remove all entries (for testing)          |

- All registry operations MUST be thread-safe.
- The registry MUST be a process-global singleton.

**Handler types by tool kind:**

| Tool Kind   | Handler Type        | Behaviour                          |
| ----------- | ------------------- | ---------------------------------- |
| `function`  | callable(args) → result | Direct function call             |
| `prompty`   | PromptyTool config  | Load child `.prompty`, execute     |
| `mcp`       | MCP client          | Send MCP tool-call request         |
| `openapi`   | OpenAPI handler     | Make HTTP call per specification   |
| custom (`*`)| user-defined        | User-provided execution logic      |

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
| `invoke_agent`      | `invoke_agent_async`       |

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

Implementations SHOULD load `.env` files before resolving `${env:}`
references during the load phase.

**Requirements:**

- Look for `.env` in the `.prompty` file's parent directory.
- Implementations MAY additionally search parent directories.
- Format: standard dotenv (`KEY=VALUE`, one per line, `#` comments,
  optional quoting).
- `.env` files MUST NOT override environment variables that are already set
  in the process environment.

### §12.4 Headless Mode

Implementations MAY provide a convenience function for creating a
`PromptAgent` programmatically without a `.prompty` file:

```
function headless(options) → PromptAgent:
  options:
    api:        string = "chat"       // model.apiType
    content:    string = ""           // instructions / prompt text
    model:      string = ""           // model.id
    provider:   string = "openai"     // model.provider
    connection: dict   = null         // model.connection config
    options:    dict   = null         // model.options config

  agent = new PromptAgent()
  agent.name         = "headless"
  agent.kind         = "prompt"
  agent.model.id     = options.model
  agent.model.provider = options.provider
  agent.model.apiType  = options.api
  agent.instructions   = options.content

  if options.connection is not null:
    agent.model.connection = build_connection(options.connection)

  if options.options is not null:
    agent.model.options = build_model_options(options.options)

  // Store content in metadata for execute() to use when
  // no instructions/template rendering is needed
  agent.metadata = { "content": options.content }

  return agent
```

This is a convenience shortcut. The returned `PromptAgent` MUST be usable
with `execute()` and `process()` without further modification.

### §12.5 Error Conditions

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
| Discovery   | No implementation for key                  | InvokerError        | `"No {component} registered for key: {key}"`        |

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

*End of Part 2 (Sections 7–12).*