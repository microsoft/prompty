# prompty

**Prompty** is a Rust runtime for the [`.prompty`](https://github.com/microsoft/prompty) file format — a markdown-based asset class for LLM prompts. YAML frontmatter defines model configuration, connection details, tools, and schemas. The markdown body becomes templated instructions.

## Quick Start

```rust
use prompty::{load, prepare, run, turn, register_defaults};

// Register built-in renderers and parsers
register_defaults();

// Load a .prompty file into a typed agent
let agent = load("path/to/prompt.prompty")?;

// Render template + parse role markers → Vec<Message>
let messages = prepare(&agent, Some(&inputs)).await?;

// Execute LLM call + process response
let result = run(&agent, &messages).await?;

// Or do it all in one shot with agent loop support
let result = turn(&agent, Some(&inputs), None).await?;
```

## Pipeline

The runtime provides 5 public functions:

| Function | Description |
|----------|-------------|
| `load()` | Parse a `.prompty` file → typed `Prompty` agent |
| `prepare()` | Render template + parse role markers → `Vec<Message>` |
| `run()` | Execute LLM call + process response (takes messages) |
| `invoke_from_path()` | One-shot: load → prepare → execute → process |
| `turn()` | Conversation round with optional tool-calling agent loop |

## Providers

LLM providers are separate crates — register them before calling pipeline functions:

- [`prompty-openai`](https://crates.io/crates/prompty-openai) — OpenAI API
- [`prompty-foundry`](https://crates.io/crates/prompty-foundry) — Azure OpenAI / Foundry
- [`prompty-anthropic`](https://crates.io/crates/prompty-anthropic) — Anthropic Claude

```rust
// Register OpenAI provider
prompty_openai::register();
```

## Features

- `otel` — Enables OpenTelemetry tracing backend

## License

MIT — see [LICENSE](LICENSE) for details.
