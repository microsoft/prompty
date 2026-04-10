pub mod model;
pub mod loader;
pub mod types;
pub mod interfaces;
pub mod registry;
pub mod renderers;
pub mod parsers;
pub mod pipeline;
pub mod tracing;

// Re-export core types for convenience
pub use loader::{load, load_from_string, LoadError};
pub use model::Prompty;
pub use types::{
    AudioPart, ContentPart, FilePart, ImagePart, Message, PromptyStream, Role, TextPart,
    ThreadMarker, ToolCall,
};
pub use interfaces::{Executor, InvokerError, Parser, Processor, Renderer};
pub use registry::{
    clear_cache, has_executor, has_parser, has_processor, has_renderer,
    invoke_executor, invoke_format_tool_messages, invoke_parser, invoke_pre_render,
    invoke_processor, invoke_renderer, register_executor, register_parser,
    register_processor, register_renderer,
};
pub use pipeline::{
    invoke as invoke_agent, invoke_from_path, prepare, process, render, run, turn,
    validate_inputs, register_defaults, TurnOptions, ToolHandler, ToolFn, AsyncToolFn,
    AgentEvent, EventCallback,
};
pub use tracing::{console_tracer, sanitize_value, trace, trace_async, trace_span, trace_span_async, PromptyTracer, Tracer};
