//! PromptyTracer — `.tracy` JSON file backend.
//!
//! Writes one `.tracy` file per root span, containing the full trace tree.
//! File naming: `{signature}.{YYYYMMDD}.{HHMMSS}.tracy`
//!
//! Registration key: `"prompty"`

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Local};
use serde_json::{json, Map, Value};

use super::tracer::{TracerBackend, TracerFactory};

// ---------------------------------------------------------------------------
// Version (read from Cargo.toml at compile time)
// ---------------------------------------------------------------------------

const VERSION: &str = env!("CARGO_PKG_VERSION");

// ---------------------------------------------------------------------------
// Frame — a single span's data accumulator
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Frame {
    data: Map<String, Value>,
    start: DateTime<Local>,
    children: Vec<Frame>,
}

impl Frame {
    fn new(signature: &str) -> Self {
        Self {
            data: {
                let mut m = Map::new();
                m.insert("name".to_string(), Value::String(signature.to_string()));
                m
            },
            start: Local::now(),
            children: Vec::new(),
        }
    }

    fn emit(&mut self, key: &str, value: &Value) {
        // If the key already exists, convert to array (accumulate).
        if let Some(existing) = self.data.get_mut(key) {
            if let Value::Array(arr) = existing {
                arr.push(value.clone());
            } else {
                let prev = existing.clone();
                *existing = Value::Array(vec![prev, value.clone()]);
            }
        } else {
            self.data.insert(key.to_string(), value.clone());
        }
    }

    fn to_json(&self) -> Value {
        let mut obj = self.data.clone();

        // Time metadata
        let end = Local::now();
        let duration_ms = (end - self.start).num_milliseconds();
        obj.insert(
            "__time".to_string(),
            json!({
                "start": format_datetime(&self.start),
                "end": format_datetime(&end),
                "duration": duration_ms,
            }),
        );

        // Nested frames
        if !self.children.is_empty() {
            let frames: Vec<Value> = self.children.iter().map(|c| c.to_json()).collect();
            obj.insert("__frames".to_string(), Value::Array(frames));
        }

        // Hoist __usage from result, array results, and children
        let mut usage = Map::new();

        // 1. From result.usage (single object response)
        if let Some(result) = obj.get("result") {
            if let Some(result_obj) = result.as_object() {
                if let Some(u) = result_obj.get("usage") {
                    hoist_usage(u, &mut usage);
                }
            }
            // 2. From array results (streaming chunks)
            if let Some(result_arr) = result.as_array() {
                for item in result_arr {
                    if let Some(item_obj) = item.as_object() {
                        if let Some(u) = item_obj.get("usage") {
                            hoist_usage(u, &mut usage);
                        }
                    }
                }
            }
        }

        // 3. From child frames' __usage
        for child_json in obj.get("__frames").and_then(|f| f.as_array()).unwrap_or(&Vec::new()) {
            if let Some(child_usage) = child_json.get("__usage") {
                hoist_usage(child_usage, &mut usage);
            }
        }

        if !usage.is_empty() {
            obj.insert("__usage".to_string(), Value::Object(usage));
        }

        Value::Object(obj)
    }
}

fn format_datetime(dt: &DateTime<Local>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S%.3f000").to_string()
}

/// Merge numeric fields from a usage source into an accumulator.
///
/// Mirrors TypeScript's `hoistUsage()`: for each key in `src` whose value is a
/// number, add it to the running total in `acc`. Non-numeric/null values are skipped.
fn hoist_usage(src: &Value, acc: &mut Map<String, Value>) {
    if let Some(obj) = src.as_object() {
        for (key, value) in obj {
            // Try integer first to preserve i64 precision
            if let Some(n) = value.as_i64() {
                let current = acc.get(key).and_then(|v| v.as_i64()).unwrap_or(0);
                acc.insert(key.clone(), json!(current + n));
            } else if let Some(n) = value.as_f64() {
                let current = acc.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);
                acc.insert(key.clone(), json!(current + n));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Backend — receives events for a single span
// ---------------------------------------------------------------------------

struct PromptyBackend {
    /// Shared stack of frames. The last element is the "current" frame.
    stack: Arc<Mutex<Vec<Frame>>>,
    output_dir: PathBuf,
    is_root: bool,
}

impl TracerBackend for PromptyBackend {
    fn emit(&self, key: &str, value: &Value) {
        let mut stack = self.stack.lock().unwrap();

        if key == "__end__" {
            // Pop the current frame and attach it to the parent (or write file if root).
            if let Some(mut finished) = stack.pop() {
                if stack.is_empty() && self.is_root {
                    // Root span finished — write the .tracy file.
                    let trace_json = finished.to_json();
                    let output = json!({
                        "runtime": "rust",
                        "version": VERSION,
                        "trace": trace_json,
                    });
                    let sig = finished
                        .data
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    let filename = format!(
                        "{}.{}.{}.tracy",
                        sanitize_filename(sig),
                        finished.start.format("%Y%m%d"),
                        finished.start.format("%H%M%S"),
                    );
                    let path = self.output_dir.join(filename);
                    if let Ok(json_str) = serde_json::to_string_pretty(&output) {
                        let _ = std::fs::write(&path, json_str);
                    }
                } else if let Some(parent) = stack.last_mut() {
                    // Attach the finished child frame to its parent.
                    finished.data.remove("__end__");
                    parent.children.push(finished);
                }
            }
            return;
        }

        // Normal event — emit to the current (top-of-stack) frame.
        if let Some(current) = stack.last_mut() {
            current.emit(key, value);
        }
    }
}

fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect()
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/// Factory that creates `.tracy` file tracer backends.
pub struct PromptyTracer {
    output_dir: PathBuf,
}

impl PromptyTracer {
    /// Create a new factory that writes `.tracy` files to `output_dir`.
    pub fn new(output_dir: impl AsRef<Path>) -> Self {
        let dir = output_dir.as_ref().to_path_buf();
        let _ = std::fs::create_dir_all(&dir);
        Self { output_dir: dir }
    }

    /// Register this tracer globally under the name `"prompty"`.
    pub fn register(output_dir: impl AsRef<Path>) {
        let tracer = Self::new(output_dir);
        super::tracer::Tracer::add("prompty", tracer);
    }
}

impl TracerFactory for PromptyTracer {
    fn create(&self, signature: &str) -> Option<Box<dyn TracerBackend>> {
        let stack = Arc::new(Mutex::new(vec![Frame::new(signature)]));
        Some(Box::new(PromptyBackend {
            stack,
            output_dir: self.output_dir.clone(),
            is_root: true,
        }))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracing::tracer::Tracer;
    use serial_test::serial;
    use serde_json::json;
    use std::fs;

    #[test]
    fn test_frame_basic() {
        let mut frame = Frame::new("test_sig");
        frame.emit("key1", &json!("value1"));
        let output = frame.to_json();
        assert_eq!(output["name"], json!("test_sig"));
        assert_eq!(output["key1"], json!("value1"));
        assert!(output["__time"]["start"].is_string());
    }

    #[test]
    fn test_frame_duplicate_keys_become_array() {
        let mut frame = Frame::new("dup");
        frame.emit("step", &json!("one"));
        frame.emit("step", &json!("two"));
        let output = frame.to_json();
        assert_eq!(output["step"], json!(["one", "two"]));
    }

    #[test]
    fn test_sanitize_filename_special_chars() {
        assert_eq!(sanitize_filename("hello/world:test"), "hello_world_test");
        assert_eq!(sanitize_filename("simple"), "simple");
        assert_eq!(sanitize_filename("a-b_c.d"), "a-b_c.d");
    }

    #[test]
    #[serial]
    fn test_tracy_file_written() {
        Tracer::clear();
        let dir = std::env::temp_dir().join(format!("prompty_test_tracy_{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        PromptyTracer::register(&dir);

        let span = Tracer::start("test_write");
        span.emit("inputs", &json!({"x": 1}));
        span.emit("result", &json!("ok"));
        span.end();

        // Find the .tracy file.
        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "tracy"))
            .collect();
        assert_eq!(entries.len(), 1, "expected exactly one .tracy file");

        let content = fs::read_to_string(entries[0].path()).unwrap();
        let parsed: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["runtime"], json!("rust"));
        assert_eq!(parsed["version"], json!(VERSION));
        assert_eq!(parsed["trace"]["name"], json!("test_write"));
        assert_eq!(parsed["trace"]["inputs"], json!({"x": 1}));
        assert_eq!(parsed["trace"]["result"], json!("ok"));
        assert!(parsed["trace"]["__time"]["duration"].is_number());

        // Cleanup
        let _ = fs::remove_dir_all(&dir);
        Tracer::clear();
    }

    #[test]
    fn test_format_datetime_shape() {
        let dt = Local::now();
        let formatted = format_datetime(&dt);
        // Should be like "2025-01-15T14:30:45.123000"
        assert!(formatted.len() >= 23, "datetime too short: {formatted}");
        assert!(formatted.contains('T'));
    }

    #[test]
    fn test_hoist_usage_from_result() {
        let mut frame = Frame::new("executor");
        frame.emit(
            "result",
            &json!({
                "choices": [{"message": {"content": "hi"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
            }),
        );
        let output = frame.to_json();
        assert_eq!(output["__usage"]["prompt_tokens"], 10);
        assert_eq!(output["__usage"]["completion_tokens"], 5);
        assert_eq!(output["__usage"]["total_tokens"], 15);
    }

    #[test]
    fn test_hoist_usage_from_children() {
        let mut child1 = Frame::new("child1");
        child1.emit(
            "result",
            &json!({"usage": {"prompt_tokens": 10, "completion_tokens": 5}}),
        );
        let mut child2 = Frame::new("child2");
        child2.emit(
            "result",
            &json!({"usage": {"prompt_tokens": 20, "completion_tokens": 8}}),
        );

        let mut parent = Frame::new("parent");
        parent.children.push(child1);
        parent.children.push(child2);

        let output = parent.to_json();
        // Usage should be aggregated from children
        assert_eq!(output["__usage"]["prompt_tokens"], 30);
        assert_eq!(output["__usage"]["completion_tokens"], 13);
    }

    #[test]
    fn test_hoist_usage_ignores_non_numeric() {
        let mut acc = Map::new();
        hoist_usage(
            &json!({"prompt_tokens": 10, "model": "gpt-4", "null_field": null}),
            &mut acc,
        );
        assert_eq!(acc.len(), 1);
        assert_eq!(acc["prompt_tokens"], 10);
    }
}
