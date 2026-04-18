//! Convenience re-exports for common Prompty types.
//!
//! ```rust
//! use prompty::prelude::*;
//! ```

pub use crate::connections::{register_connection, with_connection};
pub use crate::interfaces::{ExecuteError, Executor, Processor};
pub use crate::loader::load;
pub use crate::model::Prompty;
pub use crate::pipeline::{
    AgentEvent, Compaction, EventCallback, ToolHandler, TurnOptions, TurnOptionsBuilder,
    invoke as invoke_agent, prepare, run, turn,
};
pub use crate::registry::{register_executor, register_processor};
pub use crate::tool_dispatch::{register_tool, register_tool_handler};
pub use crate::tracing::{Tracer, console_tracer, trace, trace_async};
pub use crate::types::{
    ContentPart, ContentPartKind, Message, PromptyStream, Role, StreamChunk, ToolCall,
};
