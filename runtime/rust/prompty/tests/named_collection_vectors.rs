//! Named-collection roundtrip tests backed by the shared model vectors.

use std::path::PathBuf;

use prompty::model::Prompty;
use prompty::model::context::{LoadContext, SaveContext};
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

    if let Some(wire_entries) = expected["wireEntries"].as_array() {
        let entries = collection
            .as_array()
            .unwrap_or_else(|| panic!("[{vector_name}] wire entry assertions require array form"));
        for assertion in wire_entries {
            let index = assertion["index"]
                .as_u64()
                .expect("wire entry assertion must declare an index")
                as usize;
            let entry = entries
                .get(index)
                .unwrap_or_else(|| panic!("[{vector_name}] missing wire entry at index {index}"))
                .as_object()
                .unwrap_or_else(|| {
                    panic!("[{vector_name}] wire entry at index {index} must be an object")
                });
            for field in assertion["absentFields"]
                .as_array()
                .expect("wire entry assertion must declare absentFields")
            {
                let field = field.as_str().expect("wire absent field must be a string");
                assert!(
                    !entry.contains_key(field),
                    "[{vector_name}] wire entry {index} unexpectedly serialized field {field:?}"
                );
            }
        }
    }

    let actual_entries = semantic_entries(collection);
    let expected_entries = expected["entries"]
        .as_array()
        .expect("roundtrip vector must declare entries");
    assert_eq!(
        actual_entries.len(),
        expected_entries.len(),
        "[{vector_name}] named collection entry count changed"
    );
    if let Some(absent_fields) = expected["absentEntryFields"].as_array() {
        for entry in &actual_entries {
            for field in absent_fields {
                let field = field.as_str().expect("absent entry field must be a string");
                assert!(
                    entry.get(field).is_none(),
                    "[{vector_name}] entry {:?} unexpectedly populated field {field:?}",
                    entry["name"]
                );
            }
        }
    }

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
fn unnamed_composite_omits_empty_name_stably() {
    let vector_name = "unnamed_composite_omits_empty_name_stably";
    let vector = vectors()
        .into_iter()
        .find(|vector| vector["name"] == vector_name)
        .expect("missing unnamed composite vector");
    let json = serde_json::to_string(&vector["input"])
        .expect("unnamed composite vector input must be JSON-compatible");
    let loaded = Prompty::from_json(&json, &LoadContext::default())
        .unwrap_or_else(|error| panic!("[{vector_name}] valid collection failed: {error}"));

    let loaded_inputs = loaded
        .inputs
        .as_ref()
        .unwrap_or_else(|| panic!("[{vector_name}] load lost inputs"));
    assert_eq!(
        loaded_inputs.len(),
        1,
        "[{vector_name}] load changed the entry count"
    );
    assert_eq!(
        loaded_inputs[0].name, "",
        "[{vector_name}] absent wire name did not materialize as an empty in-memory name"
    );

    let saved = loaded.to_value(&SaveContext::default());
    let collection = saved
        .get("inputs")
        .expect("[unnamed_composite_omits_empty_name_stably] first save lost inputs");
    assert_collection(vector_name, collection, &vector["expected"]);

    let saved_json = serde_json::to_string(&saved).expect("first save must remain JSON-compatible");
    let reloaded = Prompty::from_json(&saved_json, &LoadContext::default())
        .unwrap_or_else(|error| panic!("[{vector_name}] first save failed to reload: {error}"));
    let reloaded_inputs = reloaded
        .inputs
        .as_ref()
        .unwrap_or_else(|| panic!("[{vector_name}] reload lost inputs"));
    assert_eq!(
        reloaded_inputs[0].name, "",
        "[{vector_name}] reload changed the unnamed in-memory state"
    );
    let resaved = reloaded.to_value(&SaveContext::default());
    let reloaded_collection = resaved
        .get("inputs")
        .expect("[unnamed_composite_omits_empty_name_stably] reload/save lost inputs");
    assert_collection(vector_name, reloaded_collection, &vector["expected"]);
}

#[test]
fn name_keyed_property_scalars_infer_kind_and_default_without_degradation() {
    let vector_names = [
        "string_scalar_in_name_keyed_inputs_infers_property",
        "integer_scalar_in_name_keyed_inputs_infers_property",
        "float_scalar_in_name_keyed_inputs_infers_property",
        "boolean_scalar_in_name_keyed_inputs_infers_property",
    ];
    let all_vectors = vectors();
    let mut failures = Vec::new();

    for vector_name in vector_names {
        let vector = all_vectors
            .iter()
            .find(|candidate| candidate["name"] == vector_name)
            .unwrap_or_else(|| panic!("missing named collection vector {vector_name}"));
        let json = serde_json::to_string(&vector["input"])
            .expect("named collection vector input must be JSON-compatible");
        let loaded = match Prompty::from_json(&json, &LoadContext::default()) {
            Ok(loaded) => loaded,
            Err(error) => {
                failures.push(format!("[{vector_name}] valid scalar failed: {error}"));
                continue;
            }
        };
        let saved = loaded.to_value(&SaveContext::default());
        let collection_path = vector["collectionPath"]
            .as_str()
            .expect("scalar vector must declare collectionPath");
        let collection = match saved.get(collection_path) {
            Some(collection) => collection,
            None => {
                failures.push(format!(
                    "[{vector_name}] missing saved collection {collection_path:?}"
                ));
                continue;
            }
        };
        let actual_entries = semantic_entries(collection);
        let expected_entry = &vector["expected"]["entries"][0];
        let expected_name = expected_entry["name"]
            .as_str()
            .expect("expected scalar entry name must be a string");
        let actual_entry = match actual_entries
            .iter()
            .find(|entry| entry["name"] == expected_name)
        {
            Some(entry) => entry,
            None => {
                failures.push(format!(
                    "[{vector_name}] missing scalar entry {expected_name:?}"
                ));
                continue;
            }
        };

        let expected_kind = &expected_entry["kind"];
        if actual_entry["kind"].as_str().unwrap_or_default().is_empty() {
            failures.push(format!("[{vector_name}] silently produced an empty kind"));
        } else if actual_entry["kind"] != *expected_kind {
            failures.push(format!(
                "[{vector_name}] expected kind {expected_kind}, got {}",
                actual_entry["kind"]
            ));
        }
        if actual_entry["default"] != expected_entry["default"] {
            failures.push(format!(
                "[{vector_name}] expected default {}, got {}",
                expected_entry["default"], actual_entry["default"]
            ));
        }
        if let Some(example) = actual_entry.get("example") {
            failures.push(format!(
                "[{vector_name}] collection shorthand unexpectedly populated example {}",
                example
            ));
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n"));
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
