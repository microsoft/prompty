//! Parse spec-vector tests — drives `parse_chat` against the shared
//! `spec/vectors/parse/parse_vectors.json` fixture (15 vectors).

use std::path::PathBuf;

use regex::Regex;
use serde_json::Value;

use prompty::parsers::parse_chat;
use prompty::types::{ContentPartKind, Message, Role};

/// Path to the parse vectors JSON file.
fn vectors_path() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent() // runtime/rust/
        .unwrap()
        .parent() // runtime/
        .unwrap()
        .parent() // repo root
        .unwrap()
        .join("spec")
        .join("vectors")
        .join("parse")
        .join("parse_vectors.json")
}

/// Load the parse vectors from disk.
fn load_parse_vectors() -> Vec<Value> {
    let raw = std::fs::read_to_string(vectors_path()).expect("parse_vectors.json should exist");
    serde_json::from_str(&raw).expect("parse_vectors.json should be a JSON array")
}

/// Extract concatenated text content from a message (mirrors `Message::text_content`).
fn text_content(msg: &Message) -> String {
    msg.parts
        .iter()
        .filter_map(|p| match &p.kind {
            ContentPartKind::TextPart { value, .. } => Some(value.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Manually expand thread nonce markers against provided `thread_inputs`.
///
/// The parser itself doesn't resolve nonces — that's the pipeline's job.
/// This helper simulates the expansion so we can verify the end-to-end
/// expected output from the spec vector.
fn manual_thread_expand(messages: &[Message], thread_inputs: &Value) -> Vec<Message> {
    let nonce_re =
        Regex::new(r"__PROMPTY_THREAD_([a-f0-9]+)_(\w+)__").expect("nonce regex is valid");

    let mut result: Vec<Message> = Vec::new();

    for msg in messages {
        let text = text_content(msg);
        if let Some(caps) = nonce_re.captures(&text) {
            let full_match = caps.get(0).unwrap();
            let input_name = caps.get(2).unwrap().as_str();
            let before = text[..full_match.start()].trim_matches('\n');
            let after = text[full_match.end()..].trim_matches('\n');

            if !before.is_empty() {
                result.push(Message::with_text(msg.role, before));
            }

            if let Some(thread_msgs) = thread_inputs.get(input_name).and_then(Value::as_array) {
                for tm in thread_msgs {
                    let role =
                        Role::from_str_opt(tm["role"].as_str().unwrap()).expect("valid role");
                    let text_val: String = tm["content"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|c| c["kind"] == "text")
                        .filter_map(|c| c["value"].as_str())
                        .collect();
                    result.push(Message::with_text(role, &text_val));
                }
            }

            if !after.is_empty() {
                result.push(Message::with_text(msg.role, after));
            }
        } else {
            result.push(msg.clone());
        }
    }

    result
}

/// Assert that two message lists match (role + text content).
fn assert_messages_eq(name: &str, actual: &[Message], expected: &[Value]) {
    assert_eq!(
        actual.len(),
        expected.len(),
        "[{name}] message count mismatch: got {}, expected {}",
        actual.len(),
        expected.len(),
    );

    for (i, exp) in expected.iter().enumerate() {
        let act = &actual[i];
        let exp_role = exp["role"].as_str().unwrap();
        assert_eq!(
            act.role.to_string(),
            exp_role,
            "[{name}] msg[{i}] role mismatch"
        );

        let exp_text: String = exp["content"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["kind"] == "text")
            .filter_map(|c| c["value"].as_str())
            .collect();
        let actual_text = text_content(act);
        assert_eq!(actual_text, exp_text, "[{name}] msg[{i}] text mismatch");
    }
}

#[test]
fn test_parse_vectors() {
    let vectors = load_parse_vectors();
    assert_eq!(vectors.len(), 15, "expected 15 parse vectors");

    let mut tested: Vec<String> = Vec::new();

    for vec in &vectors {
        let name = vec["name"].as_str().unwrap();
        let rendered = vec["input"]["rendered"].as_str().unwrap();
        let expected_messages = vec["expected"]["messages"].as_array().unwrap();

        let messages = parse_chat(rendered);

        if let Some(thread_inputs) = vec["input"].get("thread_inputs") {
            // Thread nonce expansion test — parse then manually expand
            let expanded = manual_thread_expand(&messages, thread_inputs);
            assert_messages_eq(name, &expanded, expected_messages);
        } else {
            assert_messages_eq(name, &messages, expected_messages);
        }

        tested.push(name.to_string());
    }

    // Verify all 15 expected vectors were present
    let expected_names = [
        "single_system",
        "system_user",
        "system_user_assistant",
        "multiline_content",
        "multiple_user_turns",
        "no_role_marker_defaults_to_system",
        "content_trimmed",
        "empty_content",
        "role_marker_at_line_start_only",
        "thread_nonce_expansion",
        "markdown_in_content",
        "consecutive_newlines_between_roles",
        "assistant_with_code_block",
        "multiple_assistant_turns",
        "role_marker_colon_in_content",
    ];
    for expected in &expected_names {
        assert!(
            tested.contains(&expected.to_string()),
            "missing vector: {expected}"
        );
    }
}
