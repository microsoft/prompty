//! Process vector tests — validate against shared spec vectors.
//!
//! Reads `spec/vectors/process/process_vectors.json` and tests that our processor
//! matches the expected output for all OpenAI-provider vectors.

use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use serde_json::{Value, json};

fn spec_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
}

fn load_process_vectors() -> Vec<Value> {
    let path = spec_root()
        .join("vectors")
        .join("process")
        .join("process_vectors.json");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read process vectors at {}: {e}", path.display()));
    serde_json::from_str(&content).expect("Invalid JSON in process_vectors.json")
}

fn build_agent_for_process(input: &Value) -> Prompty {
    let has_outputs = input
        .get("has_outputs")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut data = json!({
        "name": "test",
        "kind": "prompt",
        "model": {"id": "gpt-4", "provider": "openai"},
        "instructions": "test",
    });

    if has_outputs {
        data["outputs"] = json!([
            {"name": "result", "kind": "string"}
        ]);
    }

    Prompty::load_from_value(&data, &LoadContext::default())
}

/// Compare two JSON values, ignoring key order in objects.
fn json_eq(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            if a.len() != b.len() {
                return false;
            }
            a.iter()
                .all(|(k, v)| b.get(k).is_some_and(|bv| json_eq(v, bv)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(av, bv)| json_eq(av, bv))
        }
        _ => actual == expected,
    }
}

macro_rules! process_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let vectors = load_process_vectors();
            let test_name = stringify!($name);
            let vector = vectors
                .iter()
                .find(|v| v["name"].as_str() == Some(test_name))
                .unwrap_or_else(|| panic!("Process vector '{test_name}' not found"));

            let input = &vector["input"];
            let provider = input.get("provider").and_then(|v| v.as_str()).unwrap_or("");

            // Skip non-OpenAI vectors
            if provider != "openai" {
                return;
            }

            let agent = build_agent_for_process(input);
            let response = &input["response"];

            let result = prompty_openai::process_response(&agent, response);

            let expected = &vector["expected"]["result"];

            match result {
                Ok(actual) => {
                    // Handle edge cases with null/empty
                    if actual == Value::String(String::new())
                        && *expected == Value::String(String::new())
                    {
                        return;
                    }
                    if actual == Value::Null && *expected == Value::String(String::new()) {
                        return;
                    }
                    assert!(
                        json_eq(&actual, expected),
                        "Process vector '{test_name}' mismatch:\n  actual:   {}\n  expected: {}",
                        serde_json::to_string_pretty(&actual).unwrap(),
                        serde_json::to_string_pretty(expected).unwrap(),
                    );
                }
                Err(e) => {
                    // Some vectors expect errors
                    if vector["expected"].get("error").is_some() {
                        return;
                    }
                    panic!("Process vector '{test_name}' failed unexpectedly: {e}");
                }
            }
        }
    };
}

// All OpenAI process vectors
process_test!(chat_text_content);
process_test!(chat_tool_calls);
process_test!(chat_multiple_tool_calls);
process_test!(chat_structured_output);
process_test!(chat_structured_invalid_json);
process_test!(chat_refusal);
process_test!(chat_null_content);
process_test!(embedding_single);
process_test!(embedding_batch);
process_test!(image_url);
process_test!(image_b64);
process_test!(image_revised_prompt);
process_test!(chat_empty_content);
// Responses API vectors — skip if we don't support responses API yet
process_test!(responses_text);
process_test!(responses_tool_calls);
process_test!(responses_structured);
process_test!(responses_empty_output);
