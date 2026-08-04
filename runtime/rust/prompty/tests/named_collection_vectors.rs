//! Named-collection roundtrip tests backed by the shared model vectors.

use std::path::PathBuf;

use prompty::model::context::{LoadContext, SaveContext};
use prompty::model::Prompty;
use serde_json::{Map, Value};

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
        .join("named_collection_vectors.json")
}

fn semantic_entries(collection: &Value) -> Vec<Value> {
    match collection {
        Value::Array(entries) => entries
            .iter()
            .map(|entry| {
                let mut entry = entry
                    .as_object()
                    .expect("array-form named collection entries must be objects")
                    .clone();
                entry
                    .entry("name".to_string())
                    .or_insert_with(|| Value::String(String::new()));
                Value::Object(entry)
            })
            .collect(),
        Value::Object(entries) => entries
            .iter()
            .map(|(name, entry)| {
                let mut entry = entry
                    .as_object()
                    .expect("object-form named collection entries must be objects")
                    .clone();
                entry.insert("name".to_string(), Value::String(name.clone()));
                Value::Object(entry)
            })
            .collect(),
        value => panic!("named collection must be an array or object, got {value:?}"),
    }
}

fn assert_subset(actual: &Value, expected: &Value, path: &str) {
    match expected {
        Value::Object(expected) => {
            let actual = actual
                .as_object()
                .unwrap_or_else(|| panic!("[{path}] expected object, got {actual:?}"));
            for (key, expected_value) in expected {
                let actual_value = actual
                    .get(key)
                    .unwrap_or_else(|| panic!("[{path}] missing expected key {key:?}"));
                assert_subset(actual_value, expected_value, &format!("{path}.{key}"));
            }
        }
        Value::Array(expected) => {
            let actual = actual
                .as_array()
                .unwrap_or_else(|| panic!("[{path}] expected array, got {actual:?}"));
            assert_eq!(
                actual.len(),
                expected.len(),
                "[{path}] array length changed"
            );
            for (index, expected_value) in expected.iter().enumerate() {
                assert_subset(&actual[index], expected_value, &format!("{path}[{index}]"));
            }
        }
        expected => assert_eq!(actual, expected, "[{path}] value changed"),
    }
}

fn assert_collection(vector_name: &str, collection: &Value, expected: &Value) {
    let expected_format = expected["collectionFormat"]
        .as_str()
        .expect("roundtrip vector must declare collectionFormat");
    assert_eq!(
        if collection.is_array() {
            "array"
        } else if collection.is_object() {
            "object"
        } else {
            "invalid"
        },
        expected_format,
        "[{vector_name}] canonical collection format changed"
    );

    let actual_entries = semantic_entries(collection);
    let expected_entries = expected["entries"]
        .as_array()
        .expect("roundtrip vector must declare entries");
    assert_eq!(
        actual_entries.len(),
        expected_entries.len(),
        "[{vector_name}] named collection entry count changed"
    );

    if expected["preserveOrder"].as_bool() == Some(true) {
        for (index, expected_entry) in expected_entries.iter().enumerate() {
            assert_subset(
                &actual_entries[index],
                expected_entry,
                &format!("{vector_name}.entries[{index}]"),
            );
        }
    } else {
        let actual_by_name: Map<String, Value> = actual_entries
            .into_iter()
            .map(|entry| {
                let name = entry["name"]
                    .as_str()
                    .expect("semantic entry name must be a string")
                    .to_string();
                (name, entry)
            })
            .collect();
        for expected_entry in expected_entries {
            let name = expected_entry["name"]
                .as_str()
                .expect("expected entry name must be a string");
            let actual_entry = actual_by_name
                .get(name)
                .unwrap_or_else(|| panic!("[{vector_name}] missing named entry {name:?}"));
            assert_subset(
                actual_entry,
                expected_entry,
                &format!("{vector_name}.entries.{name}"),
            );
        }
    }
}

fn vectors() -> Vec<Value> {
    let raw =
        std::fs::read_to_string(vectors_path()).expect("failed to read named collection vectors");
    let document: Value =
        serde_json::from_str(&raw).expect("failed to parse named collection vectors");
    document["vectors"]
        .as_array()
        .expect("named collection vectors must contain a vectors array")
        .clone()
}

#[test]
fn named_collection_roundtrip_vectors() {
    for vector in vectors()
        .into_iter()
        .filter(|vector| vector["operation"] == "load-save-reload")
    {
        let name = vector["name"]
            .as_str()
            .expect("vector name must be a string");
        let json = serde_json::to_string(&vector["input"])
            .expect("named collection vector input must be JSON-compatible");
        let result = Prompty::from_json(&json, &LoadContext::default());

        let loaded =
            result.unwrap_or_else(|error| panic!("[{name}] valid collection failed: {error}"));
        let saved = loaded.to_value(&SaveContext::default());
        let collection_path = vector["collectionPath"]
            .as_str()
            .expect("roundtrip vector must declare collectionPath");
        let collection = saved
            .get(collection_path)
            .unwrap_or_else(|| panic!("[{name}] missing collection {collection_path:?}"));
        assert_collection(name, collection, &vector["expected"]);

        let saved_json =
            serde_json::to_string(&saved).expect("saved named collection must be JSON-compatible");
        let reloaded = Prompty::from_json(&saved_json, &LoadContext::default())
            .unwrap_or_else(|error| panic!("[{name}] saved collection failed: {error}"));
        let resaved = reloaded.to_value(&SaveContext::default());
        let reloaded_collection = resaved
            .get(collection_path)
            .unwrap_or_else(|| panic!("[{name}] reload lost collection {collection_path:?}"));
        assert_collection(name, reloaded_collection, &vector["expected"]);
    }
}

#[test]
fn named_collection_rejection_vectors() {
    for vector in vectors()
        .into_iter()
        .filter(|vector| vector["operation"] == "load-error")
    {
        let name = vector["name"]
            .as_str()
            .expect("vector name must be a string");
        let json = serde_json::to_string(&vector["input"])
            .expect("named collection vector input must be JSON-compatible");
        let error = match Prompty::from_json(&json, &LoadContext::default()) {
            Ok(_) => panic!("[{name}] invalid nested array was accepted"),
            Err(error) => error,
        };
        let diagnostic = error.to_string();
        let expected_path = vector["expected"]["path"]
            .as_str()
            .expect("error vector must declare path");
        let value_category = vector["expected"]["valueCategory"]
            .as_str()
            .expect("error vector must declare valueCategory");
        assert!(
            diagnostic.contains(expected_path),
            "[{name}] diagnostic did not identify path {expected_path:?}: {diagnostic}"
        );
        assert!(
            diagnostic.contains(value_category),
            "[{name}] diagnostic did not identify category {value_category:?}: {diagnostic}"
        );
    }
}
