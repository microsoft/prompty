//! Model-discovery vector tests — validate the Anthropic wire → `ModelInfo`
//! mapping against the generated `vectors.json` (mapModel operation).
//!
//! The same fixture file is consumed by every runtime so all providers converge
//! on one canonical `ModelInfo` shape. This test only maps (no network), so it
//! exercises `models::model_info_from_wire` directly.

use prompty::model::context::SaveContext;
use prompty_anthropic::models::model_info_from_wire;
use serde_json::Value;

fn spec_root() -> std::path::PathBuf {
    // runtime/rust/<crate> → runtime/rust → runtime → repo root → spec/
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
}

fn load_vectors() -> Vec<Value> {
    let path = spec_root()
        .parent()
        .unwrap()
        .join("schema")
        .join("tsp-output")
        .join(".typra-generated")
        .join("vectors.json");
    let content = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("Failed to read vectors at {}: {e}", path.display())
    });
    let doc: Value = serde_json::from_str(&content).expect("Invalid JSON in vectors.json");
    doc["vectors"]
        .as_array()
        .expect("vectors.json must have a 'vectors' array")
        .iter()
        .filter(|e| e.get("operation").and_then(Value::as_str) == Some("mapModel"))
        .map(|e| e["vector"].clone())
        .collect()
}

/// Compare two JSON values, ignoring key order in objects.
fn json_eq(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|bv| json_eq(v, bv)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(av, bv)| json_eq(av, bv))
        }
        _ => actual == expected,
    }
}

#[test]
fn anthropic_discovery_vectors_map_to_canonical_model_info() {
    let vectors = load_vectors();
    let mut ran = 0;
    for vector in &vectors {
        if vector["provider"].as_str() != Some("anthropic") {
            continue;
        }
        let name = vector["name"].as_str().unwrap_or("<unnamed>");
        let info = model_info_from_wire(&vector["input"]);
        let actual = info.to_value(&SaveContext::default());
        let expected = &vector["expected"];
        assert!(
            json_eq(&actual, expected),
            "discovery vector '{name}' mismatch:\n  actual:   {}\n  expected: {}",
            serde_json::to_string_pretty(&actual).unwrap(),
            serde_json::to_string_pretty(expected).unwrap(),
        );
        ran += 1;
    }
    assert!(ran > 0, "no anthropic discovery vectors were exercised");
}
