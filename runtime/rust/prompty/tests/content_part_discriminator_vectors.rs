//! Closed ContentPart discriminator tests backed by the shared model vectors.

use std::path::PathBuf;

use prompty::model::context::{LoadContext, SaveContext};
use prompty::model::ContentPart;
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
        .join("content_part_discriminator_vectors.json")
}

#[test]
fn content_part_discriminator_vectors() {
    let raw = std::fs::read_to_string(vectors_path())
        .expect("failed to read ContentPart discriminator vectors");
    let document: Value =
        serde_json::from_str(&raw).expect("failed to parse ContentPart discriminator vectors");
    let vectors = document["vectors"]
        .as_array()
        .expect("ContentPart discriminator vectors must contain a vectors array");
    let context = LoadContext::default();

    for vector in vectors {
        let name = vector["name"]
            .as_str()
            .expect("vector name must be a string");
        let input = &vector["input"];
        let json = serde_json::to_string(input).expect("vector input must be JSON-compatible");
        let result = ContentPart::from_json(&json, &context);

        match vector["operation"].as_str() {
            Some("load") => {
                let content_part = result.unwrap_or_else(|error| {
                    panic!("[{name}] known ContentPart failed to load: {error}")
                });
                assert_eq!(
                    content_part.to_value(&SaveContext::default()),
                    vector["expected"],
                    "[{name}] known ContentPart payload changed during load/save"
                );
            }
            Some("load-error") => {
                let error = match result {
                    Ok(_) => panic!(
                        "[{name}] closed ContentPart accepted unknown discriminator {:?}",
                        input["kind"]
                    ),
                    Err(error) => error,
                };
                let diagnostic = error.to_string();
                let discriminator = vector["expected"]["discriminator"]
                    .as_str()
                    .expect("error vector must declare the discriminator field");
                let value = vector["expected"]["value"]
                    .as_str()
                    .expect("error vector must declare the exact discriminator value");
                assert!(
                    diagnostic.contains(discriminator),
                    "[{name}] error diagnostic did not identify discriminator {discriminator:?}: {diagnostic}"
                );
                assert!(
                    diagnostic.contains(value),
                    "[{name}] error diagnostic did not preserve discriminator value {value:?}: {diagnostic}"
                );
            }
            operation => panic!("[{name}] unsupported vector operation: {operation:?}"),
        }
    }
}
