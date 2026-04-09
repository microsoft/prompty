//! Wire format vector tests — validate against shared spec vectors.
//!
//! Reads `spec/vectors/wire/wire_vectors.json` and tests that our wire format
//! conversion matches the expected output for all OpenAI-provider vectors.

use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use prompty::types::{AudioPart, ContentPart, ImagePart, Message, Role, TextPart};
use prompty_openai::wire;
use serde_json::{json, Map, Value};

fn spec_root() -> std::path::PathBuf {
    // runtime/rust/ → project root → spec/
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
}

fn load_wire_vectors() -> Vec<Value> {
    let path = spec_root().join("vectors").join("wire").join("wire_vectors.json");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("Failed to read wire vectors at {}: {e}", path.display()));
    serde_json::from_str(&content).expect("Invalid JSON in wire_vectors.json")
}

/// Build messages from vector input content/messages format.
fn build_messages(input: &Value) -> Vec<Message> {
    let msgs = input["messages"].as_array().expect("messages should be array");
    msgs.iter()
        .map(|m| {
            let role = Role::from_str_opt(m["role"].as_str().unwrap()).unwrap();
            let content = m["content"].as_array().expect("content should be array");
            let parts: Vec<ContentPart> = content
                .iter()
                .map(|p| {
                    let kind = p["kind"].as_str().unwrap();
                    match kind {
                        "text" => ContentPart::Text(TextPart {
                            value: p["value"].as_str().unwrap().to_string(),
                        }),
                        "image" => ContentPart::Image(ImagePart {
                            source: p["value"].as_str().unwrap().to_string(),
                            detail: None,
                            media_type: p.get("mediaType").and_then(|v| v.as_str()).map(String::from),
                        }),
                        "audio" => ContentPart::Audio(AudioPart {
                            source: p["value"].as_str().unwrap().to_string(),
                            media_type: p.get("mediaType").and_then(|v| v.as_str()).map(String::from),
                        }),
                        _ => panic!("Unknown content kind: {kind}"),
                    }
                })
                .collect();
            Message {
                role,
                parts,
                metadata: serde_json::Map::new(),
            }
        })
        .collect()
}

/// Build a Prompty agent from vector input fields.
fn build_agent(input: &Value) -> Prompty {
    let model_id = input["model_id"].as_str().unwrap_or("gpt-4");
    let api_type = input.get("apiType").and_then(|v| v.as_str()).unwrap_or("chat");
    let provider = input.get("provider").and_then(|v| v.as_str()).unwrap_or("openai");

    let mut data = json!({
        "name": "test",
        "kind": "prompt",
        "model": {
            "id": model_id,
            "apiType": api_type,
            "provider": provider,
        },
        "instructions": "test",
    });

    if let Some(options) = input.get("options") {
        if options.is_object() && !options.as_object().unwrap().is_empty() {
            data["model"]["options"] = options.clone();
        }
    }

    if let Some(tools) = input.get("tools") {
        if tools.is_array() && !tools.as_array().unwrap().is_empty() {
            data["tools"] = tools.clone();
        }
    }

    if let Some(outputs) = input.get("outputs") {
        if outputs.is_array() && !outputs.as_array().unwrap().is_empty() {
            data["outputs"] = outputs.clone();
        }
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
            a.iter().all(|(k, v)| b.get(k).is_some_and(|bv| json_eq(v, bv)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(av, bv)| json_eq(av, bv))
        }
        _ => actual == expected,
    }
}

// ---------------------------------------------------------------------------
// Individual vector tests
// ---------------------------------------------------------------------------

macro_rules! wire_test {
    ($name:ident) => {
        #[test]
        fn $name() {
            let vectors = load_wire_vectors();
            let test_name = stringify!($name);
            let vector = vectors
                .iter()
                .find(|v| v["name"].as_str() == Some(test_name))
                .unwrap_or_else(|| panic!("Vector '{test_name}' not found"));

            let input = &vector["input"];
            let provider = input.get("provider").and_then(|v| v.as_str()).unwrap_or("openai");

            // Skip non-OpenAI vectors
            if provider != "openai" {
                return;
            }

            let agent = build_agent(input);
            let messages = build_messages(input);
            let api_type = input.get("apiType").and_then(|v| v.as_str()).unwrap_or("chat");

            let actual = match api_type {
                "chat" | "agent" => wire::build_chat_args(&agent, &messages),
                "embedding" => wire::build_embedding_args(&agent, &messages),
                "image" => wire::build_image_args(&agent, &messages),
                _ => panic!("Unknown apiType: {api_type}"),
            };

            let expected = &vector["expected"]["request_body"];

            assert!(
                json_eq(&actual, expected),
                "Vector '{test_name}' mismatch:\n  actual:   {}\n  expected: {}",
                serde_json::to_string_pretty(&actual).unwrap(),
                serde_json::to_string_pretty(expected).unwrap(),
            );
        }
    };
}

wire_test!(chat_simple);
wire_test!(chat_with_options);
wire_test!(chat_single_text_optimized);
wire_test!(chat_multipart_content);
wire_test!(chat_audio_part);
wire_test!(chat_audio_mp3);
wire_test!(tools_function_wire);
wire_test!(tools_strict_mode);
wire_test!(embedding_wire);
wire_test!(image_wire);
wire_test!(kind_to_json_type_mapping);
wire_test!(chat_image_part);
wire_test!(structured_output);
wire_test!(options_max_completion_tokens);
wire_test!(options_stop_sequences);
wire_test!(options_additional_properties);
