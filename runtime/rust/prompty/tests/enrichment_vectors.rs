//! Enrichment vector tests — validate the shared model-capability enrichment
//! primitive against the cross-runtime fixtures in
//! `spec/vectors/discovery/enrichment_vectors.json`.
//!
//! These vectors exercise `prompty::discovery::enrich` in isolation (no provider
//! wire mapping, no network): load a base `ModelInfo` from `input`, enrich it for
//! the given `provider`, and assert the canonical `ModelInfo` output equals
//! `expected`. Every runtime is expected to load the same file and match, so the
//! fill-only-missing / longest-prefix algorithm stays consistent everywhere.

use prompty::model::ModelInfo;
use prompty::model::context::{LoadContext, SaveContext};
use serde_json::Value;

fn load_vectors() -> Vec<Value> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
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
        .filter(|e| e.get("operation").and_then(Value::as_str) == Some("enrich"))
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
fn enrichment_vectors_apply_fill_only_missing() {
    let vectors = load_vectors();
    let mut ran = 0;
    for vector in &vectors {
        let name = vector["name"].as_str().unwrap_or("<unnamed>");
        let provider = vector["provider"]
            .as_str()
            .unwrap_or_else(|| panic!("enrichment vector '{name}' missing 'provider'"));

        let mut info = ModelInfo::load_from_value(&vector["input"], &LoadContext::default());
        prompty::discovery::enrich(provider, &mut info);

        let actual = info.to_value(&SaveContext::default());
        let expected = &vector["expected"];
        assert!(
            json_eq(&actual, expected),
            "enrichment vector '{name}' mismatch:\n  actual:   {}\n  expected: {}",
            serde_json::to_string_pretty(&actual).unwrap(),
            serde_json::to_string_pretty(expected).unwrap(),
        );
        ran += 1;
    }
    assert!(ran > 0, "no enrichment vectors were exercised");
}
