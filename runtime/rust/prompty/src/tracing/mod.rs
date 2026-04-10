//! Tracing module — observability for the Prompty pipeline.
//!
//! Provides a pluggable tracer registry with fan-out to multiple backends.
//! Built-in backends: console tracer and `.tracy` file tracer.

mod console;
mod prompty_tracer;
mod tracer;

pub use console::console_tracer;
pub use prompty_tracer::PromptyTracer;
pub use tracer::{sanitize_value, trace, trace_async, trace_span, trace_span_async, Tracer};
