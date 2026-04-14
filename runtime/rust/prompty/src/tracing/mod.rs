//! Tracing module — observability for the Prompty pipeline.
//!
//! Provides a pluggable tracer registry with fan-out to multiple backends.
//! Built-in backends: console tracer and `.tracy` file tracer.
//! Optional: OpenTelemetry backend (feature-gated behind `otel`).

mod console;
#[cfg(feature = "otel")]
pub mod otel;
mod prompty_tracer;
mod tracer;

pub use console::console_tracer;
#[cfg(feature = "otel")]
pub use otel::{init_otel_stdout, otel_tracer};
pub use prompty_tracer::PromptyTracer;
pub use tracer::{
    SpanEmitter, Tracer, sanitize_value, trace, trace_async, trace_span, trace_span_async,
};
