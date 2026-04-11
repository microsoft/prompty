//! OpenTelemetry tracer backend.
//!
//! Registers a tracer factory that creates OTel spans for each Prompty trace span.
//! Matches TypeScript `tracing/otel.ts`.
//!
//! **Feature-gated**: requires `otel` feature in Cargo.toml.
//!
//! # Usage
//!
//! ```ignore
//! use prompty::tracing::{Tracer, otel_tracer};
//!
//! // Register the OTel tracer (after configuring your OTel pipeline)
//! Tracer::add("otel", otel_tracer());
//! ```

use std::sync::Mutex;

use opentelemetry::{
    KeyValue,
    trace::{Span, SpanKind, Status, Tracer as OtelTracer},
};
use opentelemetry_sdk::trace::SdkTracerProvider;
use serde_json::Value;

use super::tracer::{TracerBackend, TracerFactory};

// ---------------------------------------------------------------------------
// OTel backend — one per span
// ---------------------------------------------------------------------------

struct OtelSpanBackend {
    span: Mutex<opentelemetry::global::BoxedSpan>,
}

impl TracerBackend for OtelSpanBackend {
    fn emit(&self, key: &str, value: &Value) {
        let mut span = self.span.lock().unwrap();
        if key == "__end__" {
            span.end();
            return;
        }

        if key == "error" {
            let msg = value_to_string(value);
            span.set_status(Status::error(msg.clone()));
            span.record_error(&OtelError(msg));
            return;
        }

        // Flatten the value into OTel attributes.
        // For objects, use dotted keys (e.g., "model.id", "model.provider").
        // For arrays, JSON-stringify them (matching TypeScript behavior).
        flatten_to_attributes(&mut *span, key, value);
    }
}

/// Simple error type for recording OTel exceptions.
#[derive(Debug)]
struct OtelError(String);

impl std::fmt::Display for OtelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for OtelError {}

/// Flatten a JSON value into OTel span attributes.
fn flatten_to_attributes(span: &mut opentelemetry::global::BoxedSpan, key: &str, value: &Value) {
    match value {
        Value::String(s) => {
            span.set_attribute(KeyValue::new(key.to_string(), s.clone()));
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                span.set_attribute(KeyValue::new(key.to_string(), i));
            } else if let Some(f) = n.as_f64() {
                span.set_attribute(KeyValue::new(key.to_string(), f));
            }
        }
        Value::Bool(b) => {
            span.set_attribute(KeyValue::new(key.to_string(), *b));
        }
        Value::Null => {
            span.set_attribute(KeyValue::new(key.to_string(), "null".to_string()));
        }
        Value::Object(map) => {
            for (k, v) in map {
                let nested_key = format!("{key}.{k}");
                flatten_to_attributes(span, &nested_key, v);
            }
        }
        Value::Array(_) => {
            span.set_attribute(KeyValue::new(key.to_string(), value.to_string()));
        }
    }
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    }
}

// ---------------------------------------------------------------------------
// OTel factory
// ---------------------------------------------------------------------------

struct OtelTracerFactory;

impl TracerFactory for OtelTracerFactory {
    fn create(&self, signature: &str) -> Option<Box<dyn TracerBackend>> {
        let tracer = opentelemetry::global::tracer("prompty");
        let span = tracer
            .span_builder(signature.to_string())
            .with_kind(SpanKind::Internal)
            .start(&tracer);
        Some(Box::new(OtelSpanBackend {
            span: Mutex::new(span),
        }))
    }
}

/// Create an OpenTelemetry tracer factory.
///
/// Register it with `Tracer::add("otel", otel_tracer())`.
///
/// You must configure your OTel pipeline (e.g., OTLP exporter, stdout exporter)
/// *before* registering this factory.
pub fn otel_tracer() -> impl TracerFactory {
    OtelTracerFactory
}

/// Convenience: initialize a basic in-process OTel pipeline with stdout exporter
/// and register the tracer. Useful for development/debugging.
pub fn init_otel_stdout() -> impl TracerFactory {
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(opentelemetry_stdout::SpanExporter::default())
        .build();
    opentelemetry::global::set_tracer_provider(provider);
    OtelTracerFactory
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracing::tracer::Tracer;
    use serde_json::json;

    fn setup_noop_provider() {
        let provider = SdkTracerProvider::builder().build();
        opentelemetry::global::set_tracer_provider(provider);
    }

    #[test]
    fn test_otel_factory_creates_backend() {
        setup_noop_provider();

        let factory = OtelTracerFactory;
        let backend = factory.create("test.span");
        assert!(backend.is_some());

        let backend = backend.unwrap();
        backend.emit("key", &json!("value"));
        backend.emit("number", &json!(42));
        backend.emit("nested", &json!({"a": 1, "b": "two"}));
        backend.emit("error", &json!("something went wrong"));
        backend.emit("__end__", &Value::Null);
    }

    #[test]
    fn test_otel_tracer_registration() {
        setup_noop_provider();

        Tracer::clear();
        Tracer::add("otel", otel_tracer());

        let span = Tracer::start("test.otel.span");
        span.emit("greeting", &json!("hello"));
        span.end();

        Tracer::clear();
    }

    #[test]
    fn test_flatten_attributes() {
        setup_noop_provider();

        let factory = OtelTracerFactory;
        let backend = factory.create("flatten.test").unwrap();

        backend.emit("string_val", &json!("hello"));
        backend.emit("int_val", &json!(42));
        backend.emit("float_val", &json!(3.14));
        backend.emit("bool_val", &json!(true));
        backend.emit("null_val", &Value::Null);
        backend.emit("array_val", &json!([1, 2, 3]));
        backend.emit("object_val", &json!({"key": "value"}));
        backend.emit("__end__", &Value::Null);
    }
}
