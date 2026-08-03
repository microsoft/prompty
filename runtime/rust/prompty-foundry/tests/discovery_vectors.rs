//! Model-discovery vector tests — validate the Foundry wire → `ModelInfo`
//! mapping against the shared spec vectors in `spec/vectors/discovery/`.
//!
//! Foundry exposes two response shapes: project `deployment` objects (flat v1
//! data-plane or nested ARM) and Azure OpenAI `catalog` model objects. The
//! shared fixture tags each vector with `shape` so the correct mapper runs.
//! The same fixture file is consumed by every runtime so all providers converge
//! on one canonical `ModelInfo` shape.

use prompty::model::context::SaveContext;
use prompty_foundry::models::{catalog_model_to_model_info, deployment_to_model_info};
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
        .join("vectors")
        .join("discovery")
        .join("discovery_vectors.json");
    let content = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "Failed to read discovery vectors at {}: {e}",
            path.display()
        )
    });
    let doc: Value =
        serde_json::from_str(&content).expect("Invalid JSON in discovery_vectors.json");
    doc["vectors"]
        .as_array()
        .expect("discovery_vectors.json must have a 'vectors' array")
        .clone()
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
fn foundry_discovery_vectors_map_to_canonical_model_info() {
    let vectors = load_vectors();
    let mut ran = 0;
    for vector in &vectors {
        if vector["provider"].as_str() != Some("foundry") {
            continue;
        }
        let name = vector["name"].as_str().unwrap_or("<unnamed>");
        let info = match vector["shape"].as_str() {
            Some("deployment") => deployment_to_model_info(&vector["input"]),
            Some("catalog") => catalog_model_to_model_info(&vector["input"]),
            other => panic!("discovery vector '{name}' has unknown foundry shape {other:?}"),
        };
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
    assert!(ran > 0, "no foundry discovery vectors were exercised");
}
