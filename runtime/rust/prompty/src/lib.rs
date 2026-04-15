//! # Prompty — Rust Runtime
//!
//! Prompty is a markdown file format (`.prompty`) for LLM prompts.
//! YAML frontmatter defines model, connection, tools, and schema.
//! The markdown body becomes instructions with template variables.
//!
//! ## Core Pipeline
//!
//! The runtime provides 5 public functions (matching TypeScript, Python, C#):
//!
//! - [`load()`] — Parse a `.prompty` file → typed `Prompty` agent
//! - [`prepare()`] — Render template + parse role markers → `Vec<Message>`
//! - [`run()`] — Execute LLM call + process response (takes messages)
//! - [`invoke_agent()`] — One-shot: load → prepare → execute → process
//! - [`turn()`] — Conversation round with optional tool-calling agent loop
//!
//! ## Providers
//!
//! LLM providers are separate crates:
//! - `prompty-openai` — OpenAI API
//! - `prompty-foundry` — Azure OpenAI / Foundry
//! - `prompty-anthropic` — Anthropic Claude
//!
//! Register providers before calling pipeline functions:
//!
//! ```rust
//! use prompty::registry;
//!
//! // Register OpenAI (done by prompty_openai::register())
//! // registry::register_executor("openai", prompty_openai::OpenAIExecutor);
//! // registry::register_processor("openai", prompty_openai::OpenAIProcessor);
//! ```
//!
//! ## Features
//!
//! - `otel` — Enables OpenTelemetry tracing backend

pub mod connections;
pub mod context;
pub mod guardrails;
pub mod interfaces;
pub mod loader;
pub mod model;
pub mod parsers;
pub mod pipeline;
pub mod prelude;
pub mod registry;
pub mod renderers;
pub mod steering;
pub mod structured;
pub mod tool_dispatch;
pub mod tracing;
pub mod types;

// Re-export core types for convenience
pub use connections::{clear_connections, has_connection, register_connection, with_connection};
pub use context::{
    estimate_chars, format_dropped_messages, summarize_dropped, trim_to_context_window,
};
pub use guardrails::{
    GuardrailError, GuardrailPhase, GuardrailResult, Guardrails, InputGuardrail, OutputGuardrail,
    ToolGuardrail,
};
pub use interfaces::{ExecuteError, Executor, InvokerError, Parser, Processor, Renderer};
pub use loader::{LoadError, load, load_async, load_from_string};
pub use model::Prompty;
pub use pipeline::{
    AgentEvent, AsyncToolFn, Compaction, CompactionFn, EventCallback, ToolFn, ToolHandler,
    TurnOptions, TurnOptionsBuilder, invoke as invoke_agent, invoke_from_path, prepare, process,
    register_defaults, render, run, turn, turn_from_path, validate_inputs,
};
pub use registry::{
    clear_cache, has_executor, has_parser, has_processor, has_renderer, invoke_executor,
    invoke_format_tool_messages, invoke_parser, invoke_pre_render, invoke_processor,
    invoke_renderer, register_executor, register_parser, register_processor, register_renderer,
};
pub use steering::Steering;
pub use structured::{
    CastError, StructuredResult, cast, create_structured_result, from_structured_value,
    is_structured_result, to_structured_value, unwrap_structured,
};
pub use tool_dispatch::{
    ToolCallable, ToolHandlerError, ToolHandlerTrait, clear_tool_handlers, clear_tools,
    dispatch_tool as dispatch_tool_call, has_tool, has_tool_handler, register_tool,
    register_tool_handler,
};
pub use tracing::{
    PromptyTracer, Tracer, console_tracer, sanitize_value, trace, trace_async, trace_span,
    trace_span_async,
};
#[cfg(feature = "otel")]
pub use tracing::{init_otel_stdout, otel_tracer};
pub use types::{
    AudioPart, ContentPart, FilePart, ImagePart, Message, PromptyStream, Role, StreamChunk,
    TextPart, ThreadMarker, ToolCall, ToolResult, consume_stream_chunks,
};
