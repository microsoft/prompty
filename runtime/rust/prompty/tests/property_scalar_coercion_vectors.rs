//! Cross-runtime Property scalar coercion tests backed by the shared model vectors.

use std::path::PathBuf;

use prompty::model::Property;
use prompty::model::context::LoadContext;
use serde_json::Value;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("runtime/rust/prompty must have a rust parent")
        .parent()
        .expect("runtime/rust must have a runtime parent")
        .parent()
        .expect("runtime must have a repository parent")
        .join("spec")
        .join("vectors")
        .join("model")
        .join("property_scalar_coercion_vectors.json")
}

#[test]
fn all_primitive_property_scalars_coerce_atomically() {
    let raw = std::fs::read_to_string(vectors_path())
        .expect("failed to read Property scalar coercion vectors");
    let document: Value =
        serde_json::from_str(&raw).expect("failed to parse Property scalar coercion vectors");
    let vector = &document["vectors"][0];
    assert_eq!(
        vector["name"], "all_primitive_property_scalars_coerce_atomically",
        "unexpected Property scalar coercion vector"
    );
    assert_eq!(vector["operation"], "load");

    let cases = vector["cases"]
        .as_array()
        .expect("Property scalar coercion vector must contain cases");
    let case_names: Vec<&str> = cases
        .iter()
        .map(|case| case["name"].as_str().expect("scalar case must have a name"))
        .collect();
    assert_eq!(case_names, ["string", "integer", "float", "boolean"]);

    let context = LoadContext::default();
    let mut failures = Vec::new();
    for case in cases {
        let case_name = case["name"].as_str().expect("scalar case must have a name");
        let loaded = Property::load_from_value(&case["input"], &context);
        let expected_kind = case["expected"]["kind"]
            .as_str()
            .expect("expected kind must be a string");
        if loaded.kind_str() != expected_kind {
            failures.push(format!(
                "[{case_name}] expected kind {expected_kind:?}, got {:?}",
                loaded.kind_str()
            ));
            continue;
        }
        if loaded.example.as_ref() != Some(&case["expected"]["example"]) {
            failures.push(format!(
                "[{case_name}] expected example {}, got {:?}",
                case["expected"]["example"], loaded.example
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
