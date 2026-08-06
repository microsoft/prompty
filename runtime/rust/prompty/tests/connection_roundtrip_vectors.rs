//! Cross-runtime Connection roundtrip tests backed by the shared model vectors.

use std::path::PathBuf;

use prompty::model::Connection;
use prompty::model::context::{LoadContext, SaveContext};
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
        .join("connection_roundtrip_vectors.json")
}

#[test]
fn known_reference_connection_roundtrip_unchanged() {
    assert_connection_roundtrip_vector("known_reference_connection_roundtrip_unchanged");
}

#[test]
fn unknown_connection_kind_preserves_payload() {
    assert_connection_roundtrip_vector("unknown_connection_kind_preserves_payload");
}

#[test]
fn unknown_connection_case_collision_preserves_payload() {
    assert_connection_roundtrip_vector("unknown_connection_case_collision_preserves_payload");
}

fn assert_connection_roundtrip_vector(vector_name: &str) {
    let raw = std::fs::read_to_string(vectors_path())
        .expect("failed to read Connection roundtrip vectors");
    let document: Value =
        serde_json::from_str(&raw).expect("failed to parse Connection roundtrip vectors");
    let vector = document["vectors"]
        .as_array()
        .expect("Connection roundtrip vectors must contain a vectors array")
        .iter()
        .find(|candidate| candidate["name"] == vector_name)
        .unwrap_or_else(|| panic!("missing Connection roundtrip vector {vector_name}"));
    assert_eq!(
        vector["operation"], "load-save-reload",
        "[{vector_name}] unsupported vector operation"
    );

    let input = &vector["input"];
    let expected = &vector["expected"];
    let kind = input["kind"]
        .as_str()
        .expect("Connection kind must be a string");
    let load_context = LoadContext::default();
    let save_context = SaveContext::default();

    let loaded = Connection::load_from_value(input, &load_context);
    assert_eq!(
        loaded.kind_str(),
        kind,
        "[{vector_name}] load changed the discriminator"
    );

    let saved = loaded.to_value(&save_context);
    assert_eq!(
        saved, *expected,
        "[{vector_name}] save changed the Connection payload"
    );

    let reloaded = Connection::load_from_value(&saved, &load_context);
    let resaved = reloaded.to_value(&save_context);
    assert_eq!(
        resaved, *expected,
        "[{vector_name}] reload changed the Connection payload"
    );
}
