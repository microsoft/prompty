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

`turn()` returns the same unwrapped payload as `run()` and `invoke_from_path()` for
structured output. `TurnOptions::validator` runs on that final payload after any output
guardrail rewrite and before the durable success commit; rejection records a failed turn.
`max_llm_retries` controls model attempts for both simple and tool-calling turns.

## Live turns, durability, and resume

`turn()` is the convenient live API. For hosts that own a session journal or need to
resume work, use `turn_with_engine_request()` with a stable `TurnEngineRequest` and
`TurnOptions { durability: Some(...), .. }`. The durability port receives ordered
semantic events and atomically persists each checkpoint with the event(s) it covers.
Live `AgentEvent` callbacks are projected **only after** that durable write succeeds.

For a host-controlled engine, construct `TurnEngine` with its ports and call `run()`.
This returns `TurnEngineResult`, including the `TurnCommit`, checkpoint-compatible
provider state, and a non-fatal `post_commit_error`. Resume requests are created from
the checkpoint and the journal's observed last sequence:

```rust
use prompty::{EngineCheckpoint, TurnEngineRequest};

fn resume_request(checkpoint: &EngineCheckpoint, last_journal_sequence: u64) -> TurnEngineRequest {
    TurnEngineRequest::resume_from(checkpoint, 10, last_journal_sequence)
}
```

Do not replay an indeterminate external effect. A checkpoint with
`reconciliation_required` must be resumed with
`TurnEngineRequest::resume_after_reconciliation()` for a tool effect, or
`TurnEngineRequest::resume_after_model_reconciliation()` for a provider invocation,
after the host has determined its outcome. `TurnCommit` and `EngineCheckpoint` preserve
`portability` and `delegated_state`; pass that state through unchanged so providers that
support continuation can continue the same conversation.

### Cancellation, streaming, permissions, and post-commit effects

- **Cancellation:** give `TurnOptions::cancelled` a shared `AtomicBool`, or pass a
  `CancellationToken` to `TurnEngine::run()`. Cancellation is cooperative and checked
  before model, tool, retry, policy, and commit boundaries. It produces a durable
  cancelled terminal status; cancellation during retry backoff stops the retry.
- **Streaming:** `model.options.additionalProperties.stream: true` forwards text and
  thinking deltas as `AgentEvent::Token` and `AgentEvent::Thinking`. Deltas are
  ephemeral—not journaled—and a stream-open failure may fall back to non-streaming only
  when the provider reports the request definitely was not dispatched. An indeterminate
  stream outcome requires reconciliation.
- **Permissions and tools:** install `TurnOptions::permission` to make the host the
  authorization authority. Without it, configured tool guardrails decide, otherwise
  requests are allowed for compatibility. Permission decisions and normalized tool
  outcomes are durable semantic events. Tool effects execute **sequentially**;
  `parallel_tool_calls: true` is rejected because durable ordering must remain
  deterministic.
- **Post-commit:** `TurnOptions::post_commit` runs only after a successful terminal
  commit. Its failure is recorded as a post-commit outcome but never rolls back a
  committed turn.

### Tracing

Register a `TracerFactory` with `Tracer::add()` to observe the pipeline. Live turns add
a focused `turn.engine` span with compact, durable lifecycle milestones: model attempts
and retries, checkpoint commits, permission decisions, tool outcomes, reconciliation,
terminal status, and post-commit status. Lifecycle projection is bounded and best-effort:
slow, failed, or saturated trace backends drop lifecycle telemetry rather than affecting
turn execution. It includes stable reason codes, not streamed deltas, model bodies,
provider error bodies, or callback payloads. Panics from tracer factories or backends are
isolated and cannot alter turn execution.

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
