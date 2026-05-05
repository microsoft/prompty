# Prompty Runtime Implementation Guide

This guide summarizes the current cross-language runtime architecture. The
canonical type model lives in `schema/model/` and is emitted into each runtime by
the Prompty schema emitter.

## Runtime responsibilities

Every runtime should implement the same high-level flow:

1. **Load** a `.prompty` file into a typed `Prompty` object.
2. **Render** `instructions` with input values.
3. **Parse** role-marked rendered text into `Message` values.
4. **Execute** messages with a provider-specific executor.
5. **Process** the provider response into a clean result.
6. **Turn** through tool calls when agentic execution is requested.

The `.prompty` file format is YAML frontmatter plus a Markdown body. The
frontmatter maps to the Prompty TypeSpec model, and the Markdown body becomes
`instructions`.

## Source of truth

- Type shapes are defined in `schema/model/`.
- Generated runtime models are checked in under each runtime package.
- Generated schema reference docs are checked in under
  `web/src/content/docs/reference/`.
- Generated files should not be edited by hand. Change TypeSpec or the emitter,
  then run `cd schema && npm run build`.

## Core pipeline APIs

Runtime naming should be idiomatic, but the logical APIs are:

| API | Purpose |
| --- | --- |
| `load` | Read `.prompty` and construct `Prompty` |
| `render` | Template `instructions` with inputs |
| `parse` | Convert rendered role markers into messages |
| `prepare` | Validate inputs, render, parse, and expand thread inputs |
| `run` | Execute prepared messages and process the response |
| `invoke` | One-shot load/prepare/run |
| `turn` | Agentic loop with tool calling |
| `process` | Convert raw provider response into clean result |
| `validateInputs` | Apply defaults and enforce required inputs |

## Frontmatter fields

Root `.prompty` frontmatter uses the emitted `Prompty` type. Common fields:

- `name`, `displayName`, `description`, `metadata`
- `model`
- `inputs`
- `outputs`
- `tools`
- `template`

Thread inputs use `kind: thread` inside `inputs`. Structured output uses
`outputs`.

## Protocols and registries

Runtimes should expose pluggable protocols for:

- renderers
- parsers
- executors
- processors

Provider packages register executors/processors by provider name. Renderers and
parsers are registered by `template.format.kind` and `template.parser.kind`.

## Tool dispatch

Tool definitions live on `Prompty.tools`; implementations are supplied at
runtime.

Dispatch order:

1. Per-call tools passed to `turn`.
2. Global name registry entries such as `registerTool` / `register_tool`.
3. Kind handlers such as `registerToolHandler` / `register_tool_handler`.
4. Wildcard kind handler (`"*"`), when supported.
5. Error-shaped result or runtime error if no implementation exists.

Bindings inject parent prompt inputs into tool arguments at execution time.
Bound parameters should not be exposed as model-controllable schema parameters.

## Provider behavior

Provider packages are responsible for:

- converting `Message` and `Tool` values into provider wire formats
- mapping `model.options` to provider options
- converting `outputs` into structured-output provider parameters
- handling streaming chunks
- converting provider tool calls into Prompty `ToolCall` values
- processing embeddings, images, chat/responses output, and structured output

## Validation expectations

Before publishing runtime changes:

1. Regenerate schema output with `cd schema && npm run build`.
2. Run runtime unit tests.
3. Run provider-specific tests for wire format changes.
4. Run binding/tool dispatch tests when tool schemas or agent turns change.
5. Run docs build with `cd web && npm run build`.
6. Check that README and API reference examples use current API names.

See `web/src/content/docs/contributing/publishing-rubric.mdx` for the release
checklist.
