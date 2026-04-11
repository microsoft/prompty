//! Tracer registry, span emission, and `trace` wrapper.
//!
//! The registry holds named tracer factories. When a span starts, each factory
//! is called with the span signature; factories that return `Some` produce a
//! backend that receives key/value events for that span.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};
use std::time::Instant;

use regex::Regex;
use serde_json::Value;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A tracer backend receives events for a single span.
///
/// Each event is a key/value pair. The special key `__end__` signals the span
/// has finished.
pub trait TracerBackend: Send + Sync {
    fn emit(&self, key: &str, value: &Value);
}

/// A tracer factory creates a backend for a given span signature.
///
/// Returning `None` means this factory is not interested in the span.
pub trait TracerFactory: Send + Sync {
    fn create(&self, signature: &str) -> Option<Box<dyn TracerBackend>>;
}

/// A live span that fans out events to all active backends.
pub struct SpanEmitter {
    backends: Vec<Box<dyn TracerBackend>>,
    start: Instant,
}

impl SpanEmitter {
    /// Emit a key/value event to all backends.
    pub fn emit(&self, key: &str, value: &Value) {
        for b in &self.backends {
            // Swallow backend errors (like the TS implementation).
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                b.emit(key, value);
            }));
        }
    }

    /// Close the span: emit `duration_ms` and `__end__`.
    pub fn end(self) {
        let duration_ms = self.start.elapsed().as_millis() as u64;
        self.emit("duration_ms", &Value::from(duration_ms));
        self.emit("__end__", &Value::Null);
    }
}

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

type FactoryMap = HashMap<String, Box<dyn TracerFactory>>;

fn registry() -> &'static RwLock<FactoryMap> {
    static REG: OnceLock<RwLock<FactoryMap>> = OnceLock::new();
    REG.get_or_init(|| RwLock::new(HashMap::new()))
}

/// The `Tracer` namespace — manages the global set of tracer factories.
pub struct Tracer;

impl Tracer {
    /// Register a named tracer factory.
    pub fn add(name: &str, factory: impl TracerFactory + 'static) {
        let mut map = registry().write().unwrap();
        map.insert(name.to_string(), Box::new(factory));
    }

    /// Remove a tracer factory by name.
    pub fn remove(name: &str) {
        let mut map = registry().write().unwrap();
        map.remove(name);
    }

    /// Remove all tracer factories.
    pub fn clear() {
        let mut map = registry().write().unwrap();
        map.clear();
    }

    /// Start a new span. Calls each registered factory with the signature and
    /// collects the backends that opted in.
    pub fn start(signature: &str) -> SpanEmitter {
        let map = registry().read().unwrap();
        let mut backends = Vec::new();
        for factory in map.values() {
            if let Some(backend) = factory.create(signature) {
                backends.push(backend);
            }
        }
        SpanEmitter {
            backends,
            start: Instant::now(),
        }
    }
}

// ---------------------------------------------------------------------------
// trace() wrapper
// ---------------------------------------------------------------------------

/// Execute `f` inside a traced span. Emits `inputs`, `result` or `error`,
/// `duration_ms`, and `__end__`.
pub fn trace<F, T>(name: &str, inputs: &Value, f: F) -> Result<T, Box<dyn std::error::Error>>
where
    F: FnOnce() -> Result<T, Box<dyn std::error::Error>>,
    T: serde::Serialize,
{
    let span = Tracer::start(name);
    span.emit("inputs", &sanitize_value("inputs", inputs));

    match f() {
        Ok(result) => {
            if let Ok(val) = serde_json::to_value(&result) {
                span.emit("result", &val);
            }
            span.end();
            Ok(result)
        }
        Err(err) => {
            span.emit("error", &Value::String(err.to_string()));
            span.end();
            Err(err)
        }
    }
}

/// Execute `body(span)` inside a traced span. The body receives the span
/// emitter for manual event emission.
pub fn trace_span<F, T>(name: &str, body: F) -> Result<T, Box<dyn std::error::Error>>
where
    F: FnOnce(&SpanEmitter) -> Result<T, Box<dyn std::error::Error>>,
{
    let span = Tracer::start(name);
    match body(&span) {
        Ok(result) => {
            span.end();
            Ok(result)
        }
        Err(err) => {
            span.emit("error", &Value::String(err.to_string()));
            span.end();
            Err(err)
        }
    }
}

/// Async version of `trace_span`. Execute an async body inside a traced span.
/// The body receives a shared reference to the span emitter for manual event
/// emission. The span is automatically ended (with `duration_ms` and `__end__`)
/// when the body completes.
pub async fn trace_span_async<F, Fut, T>(
    name: &str,
    body: F,
) -> Result<T, Box<dyn std::error::Error>>
where
    F: FnOnce(std::sync::Arc<SpanEmitter>) -> Fut,
    Fut: std::future::Future<Output = Result<T, Box<dyn std::error::Error>>>,
{
    let span = std::sync::Arc::new(Tracer::start(name));
    match body(std::sync::Arc::clone(&span)).await {
        Ok(result) => {
            // Unwrap the Arc — we're the only holder after body completes.
            if let Ok(owned) = std::sync::Arc::try_unwrap(span) {
                owned.end();
            }
            Ok(result)
        }
        Err(err) => {
            span.emit("error", &Value::String(err.to_string()));
            if let Ok(owned) = std::sync::Arc::try_unwrap(span) {
                owned.end();
            }
            Err(err)
        }
    }
}

/// Async version of `trace`. Wraps an async function with automatic input/output tracing.
pub async fn trace_async<F, Fut, T>(
    name: &str,
    inputs: &Value,
    f: F,
) -> Result<T, Box<dyn std::error::Error>>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, Box<dyn std::error::Error>>>,
    T: serde::Serialize,
{
    let span = Tracer::start(name);
    span.emit("inputs", &sanitize_value("inputs", inputs));

    match f().await {
        Ok(result) => {
            if let Ok(val) = serde_json::to_value(&result) {
                span.emit("result", &val);
            }
            span.end();
            Ok(result)
        }
        Err(err) => {
            span.emit("error", &Value::String(err.to_string()));
            span.end();
            Err(err)
        }
    }
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/// Check if a key matches sensitive patterns that should be redacted.
fn is_sensitive_key(key: &str) -> bool {
    static PAT: OnceLock<Regex> = OnceLock::new();
    let pat = PAT.get_or_init(|| {
        Regex::new(r"(?i)secret|password|credential|passphrase|bearer|cookie|authorization|api[_.]?key|token|auth")
            .unwrap()
    });

    if !pat.is_match(key) {
        return false;
    }

    // Exclude false positives that the TS version handles with lookahead:
    // "tokens" should NOT match (token(?!s) in TS)
    // "authors" should NOT match (auth(?!ors?\b) in TS)
    let lower = key.to_lowercase();
    if lower.contains("tokens") && !lower.contains("token_") && !lower.contains("token.") {
        return false;
    }
    if lower.contains("authors") || lower.contains("author") && !lower.contains("auth_") {
        // "author" / "authors" → not sensitive
        // But "auth_header" → sensitive (contains "auth" without "author")
        let auth_pos = lower.find("auth").unwrap();
        let after = &lower[auth_pos..];
        if after.starts_with("author") {
            return false;
        }
    }
    true
}

const REDACTED: &str = "***REDACTED***";

/// Recursively redact values whose keys match the sensitive pattern.
pub fn sanitize_value(key: &str, value: &Value) -> Value {
    if is_sensitive_key(key) {
        return Value::String(REDACTED.to_string());
    }
    match value {
        Value::Object(map) => {
            let sanitized: serde_json::Map<String, Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), sanitize_value(k, v)))
                .collect();
            Value::Object(sanitized)
        }
        Value::Array(arr) => {
            let sanitized: Vec<Value> = arr.iter().map(|v| sanitize_value(key, v)).collect();
            Value::Array(sanitized)
        }
        _ => value.clone(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;
    use std::sync::{Arc, Mutex};

    // A simple in-memory backend for testing.
    struct MemoryBackend {
        events: Arc<Mutex<Vec<(String, Value)>>>,
    }

    impl TracerBackend for MemoryBackend {
        fn emit(&self, key: &str, value: &Value) {
            let mut events = self.events.lock().unwrap();
            events.push((key.to_string(), value.clone()));
        }
    }

    struct MemoryFactory {
        events: Arc<Mutex<Vec<(String, Value)>>>,
    }

    impl TracerFactory for MemoryFactory {
        fn create(&self, _signature: &str) -> Option<Box<dyn TracerBackend>> {
            Some(Box::new(MemoryBackend {
                events: Arc::clone(&self.events),
            }))
        }
    }

    fn setup_memory_tracer() -> Arc<Mutex<Vec<(String, Value)>>> {
        Tracer::clear();
        let events = Arc::new(Mutex::new(Vec::new()));
        Tracer::add(
            "test",
            MemoryFactory {
                events: events.clone(),
            },
        );
        events
    }

    #[test]
    #[serial]
    fn test_trace_success() {
        let events = setup_memory_tracer();
        let result: Result<String, _> =
            trace("test_span", &json!({"x": 1}), || Ok("hello".to_string()));
        assert_eq!(result.unwrap(), "hello");

        let ev = events.lock().unwrap();
        assert_eq!(ev[0].0, "inputs");
        assert_eq!(ev[1].0, "result");
        assert_eq!(ev[1].1, json!("hello"));
        assert_eq!(ev[2].0, "duration_ms");
        assert_eq!(ev[3].0, "__end__");
        Tracer::clear();
    }

    #[test]
    #[serial]
    fn test_trace_error() {
        let events = setup_memory_tracer();
        let result: Result<String, _> = trace("err_span", &json!(null), || Err("boom".into()));
        assert!(result.is_err());

        let ev = events.lock().unwrap();
        assert_eq!(ev[0].0, "inputs");
        assert_eq!(ev[1].0, "error");
        assert_eq!(ev[1].1, json!("boom"));
        assert_eq!(ev[2].0, "duration_ms");
        assert_eq!(ev[3].0, "__end__");
        Tracer::clear();
    }

    #[test]
    #[serial]
    fn test_trace_span_manual() {
        let events = setup_memory_tracer();
        let result: Result<i32, _> = trace_span("manual", |span| {
            span.emit("step", &json!("one"));
            span.emit("step", &json!("two"));
            Ok(42)
        });
        assert_eq!(result.unwrap(), 42);

        let ev = events.lock().unwrap();
        assert_eq!(ev[0].0, "step");
        assert_eq!(ev[0].1, json!("one"));
        assert_eq!(ev[1].0, "step");
        assert_eq!(ev[1].1, json!("two"));
        assert_eq!(ev[2].0, "duration_ms");
        assert_eq!(ev[3].0, "__end__");
        Tracer::clear();
    }

    #[test]
    #[serial]
    fn test_tracer_add_remove() {
        Tracer::clear();
        let events = Arc::new(Mutex::new(Vec::new()));
        Tracer::add(
            "a",
            MemoryFactory {
                events: events.clone(),
            },
        );

        // Span should reach the backend.
        let span = Tracer::start("sig");
        span.emit("x", &json!(1));
        span.end();
        assert!(!events.lock().unwrap().is_empty());

        // After remove, no more events.
        Tracer::remove("a");
        events.lock().unwrap().clear();
        let span = Tracer::start("sig");
        span.emit("x", &json!(2));
        span.end();
        assert!(events.lock().unwrap().is_empty());
        Tracer::clear();
    }

    #[test]
    #[serial]
    fn test_sanitize_api_key() {
        let input = json!({"api_key": "sk-123", "name": "test"});
        let sanitized = sanitize_value("root", &input);
        assert_eq!(sanitized["api_key"], json!("***REDACTED***"));
        assert_eq!(sanitized["name"], json!("test"));
    }

    #[test]
    #[serial]
    fn test_sanitize_password() {
        let input = json!({"password": "hunter2", "data": "visible"});
        let sanitized = sanitize_value("root", &input);
        assert_eq!(sanitized["password"], json!("***REDACTED***"));
        assert_eq!(sanitized["data"], json!("visible"));
    }

    #[test]
    #[serial]
    fn test_sanitize_nested() {
        let input = json!({"config": {"secret": "shh", "host": "localhost"}});
        let sanitized = sanitize_value("root", &input);
        assert_eq!(sanitized["config"]["secret"], json!("***REDACTED***"));
        assert_eq!(sanitized["config"]["host"], json!("localhost"));
    }

    #[test]
    #[serial]
    fn test_sanitize_bearer_token() {
        let input = json!({"bearer": "abc", "token": "xyz", "tokens": "visible"});
        let sanitized = sanitize_value("root", &input);
        assert_eq!(sanitized["bearer"], json!("***REDACTED***"));
        assert_eq!(sanitized["token"], json!("***REDACTED***"));
        // "tokens" should NOT be redacted (regex has negative lookahead)
        assert_eq!(sanitized["tokens"], json!("visible"));
    }

    #[test]
    #[serial]
    fn test_sanitize_preserves_authors() {
        // "auth" pattern should not match "authors"
        let input = json!({"authors": ["Alice", "Bob"]});
        let sanitized = sanitize_value("root", &input);
        assert_eq!(sanitized["authors"], json!(["Alice", "Bob"]));
    }

    #[test]
    #[serial]
    fn test_sanitize_top_level_key() {
        // If the top-level key itself is sensitive, the whole value is redacted.
        let val = json!({"nested": "data"});
        let sanitized = sanitize_value("api_key", &val);
        assert_eq!(sanitized, json!("***REDACTED***"));
    }
}
