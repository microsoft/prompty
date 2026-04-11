//! Console tracer — logs span events to stderr.
//!
//! Registration key: `"console"`

use serde_json::Value;

use super::tracer::{TracerBackend, TracerFactory};

const MAX_VALUE_LEN: usize = 200;

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

struct ConsoleBackend {
    signature: String,
    printed_header: std::sync::atomic::AtomicBool,
}

impl TracerBackend for ConsoleBackend {
    fn emit(&self, key: &str, value: &Value) {
        if key == "__end__" {
            return;
        }

        // Print the header on the first event.
        if !self
            .printed_header
            .swap(true, std::sync::atomic::Ordering::Relaxed)
        {
            eprintln!("[Tracer] ── {}", self.signature);
        }

        let display = truncate_value(value);
        eprintln!("[Tracer]    {key}: {display}");
    }
}

fn truncate_value(value: &Value) -> String {
    let s = match value {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| format!("{value:?}")),
    };
    if s.len() > MAX_VALUE_LEN {
        format!("{}...", &s[..MAX_VALUE_LEN])
    } else {
        s
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/// Factory that creates console tracer backends.
pub struct ConsoleTracerFactory;

impl TracerFactory for ConsoleTracerFactory {
    fn create(&self, signature: &str) -> Option<Box<dyn TracerBackend>> {
        Some(Box::new(ConsoleBackend {
            signature: signature.to_string(),
            printed_header: std::sync::atomic::AtomicBool::new(false),
        }))
    }
}

/// Register the console tracer globally under the name `"console"`.
///
/// ```rust
/// use prompty::tracing::{console_tracer, Tracer};
/// console_tracer();
/// // Now all spans will log to stderr.
/// Tracer::remove("console"); // clean up
/// ```
pub fn console_tracer() {
    super::tracer::Tracer::add("console", ConsoleTracerFactory);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_truncate_short_string() {
        assert_eq!(truncate_value(&json!("hello")), "hello");
    }

    #[test]
    fn test_truncate_long_string() {
        let long = "a".repeat(300);
        let result = truncate_value(&Value::String(long));
        assert!(result.len() < 210);
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_truncate_number() {
        assert_eq!(truncate_value(&json!(42)), "42");
    }

    #[test]
    fn test_truncate_null() {
        assert_eq!(truncate_value(&json!(null)), "null");
    }

    #[test]
    fn test_truncate_object() {
        let val = json!({"a": 1});
        let result = truncate_value(&val);
        assert!(result.contains("\"a\""));
    }

    #[test]
    fn test_console_tracer_registers() {
        super::super::tracer::Tracer::clear();
        console_tracer();
        // Starting a span should succeed (factory returns Some).
        let span = super::super::tracer::Tracer::start("test_sig");
        span.emit("test_key", &json!("test_value"));
        span.end();
        super::super::tracer::Tracer::clear();
    }
}
