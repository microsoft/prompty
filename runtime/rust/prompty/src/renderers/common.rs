//! Shared rendering utilities — nonce injection for rich-kind inputs.
//!
//! Per the spec (§6.4), inputs with `kind` in [`RICH_KINDS`] are replaced with
//! nonce markers during rendering. The nonce format is:
//! `__PROMPTY_THREAD_<hex8>_<propertyName>__`

use std::collections::HashMap;

use rand::Rng;

use crate::model::Prompty;

/// Input kinds that receive nonce replacement during rendering.
pub const RICH_KINDS: &[&str] = &["thread", "image", "file", "audio"];

/// Generate a nonce marker: `__PROMPTY_THREAD_<hex8>_<name>__`
fn generate_nonce(name: &str) -> String {
    let mut rng = rand::rng();
    let hex: String = (0..8)
        .map(|_| format!("{:x}", rng.random_range(0..16u8)))
        .collect();
    format!("__PROMPTY_THREAD_{hex}_{name}__")
}

/// Prepare render inputs by replacing rich-kind values with nonce markers.
///
/// Returns `(modified_inputs, nonces_map)` where `nonces_map` maps
/// `property_name → nonce_string`.
///
/// The pipeline is responsible for passing the nonces to `expand_threads()`
/// after rendering and parsing — no global state is involved.
pub fn prepare_render_inputs(
    agent: &Prompty,
    inputs: &serde_json::Value,
) -> (serde_json::Value, HashMap<String, String>) {
    let mut modified = inputs.clone();
    let mut nonces = HashMap::new();

    // Get the agent's input definitions to determine rich kinds
    for prop in &agent.inputs {
        if RICH_KINDS.contains(&prop.kind_str()) {
            let nonce = generate_nonce(&prop.name);
            if let Some(obj) = modified.as_object_mut() {
                obj.insert(prop.name.clone(), serde_json::Value::String(nonce.clone()));
            }
            nonces.insert(prop.name.clone(), nonce);
        }
    }

    (modified, nonces)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::context::LoadContext;

    #[test]
    fn test_generate_nonce_format() {
        let nonce = generate_nonce("conversation");
        assert!(nonce.starts_with("__PROMPTY_THREAD_"));
        assert!(nonce.ends_with("_conversation__"));
        // 17 (prefix) + 8 (hex) + 1 (_) + 12 (name) + 2 (__) = 40
        assert_eq!(nonce.len(), 17 + 8 + 1 + "conversation".len() + 2);
    }

    #[test]
    fn test_generate_nonce_uniqueness() {
        let a = generate_nonce("test");
        let b = generate_nonce("test");
        // Extremely unlikely to collide with 8 hex chars
        assert_ne!(a, b);
    }

    #[test]
    fn test_prepare_render_inputs_no_rich_kinds() {
        let agent = Prompty::default();
        let inputs = serde_json::json!({"name": "Alice"});
        let (modified, nonces) = prepare_render_inputs(&agent, &inputs);
        assert!(nonces.is_empty());
        assert_eq!(modified, inputs);
    }

    #[test]
    fn test_prepare_render_inputs_with_thread_kind() {
        // Create an agent with a "thread" input kind
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "test",
            "model": "gpt-4",
            "inputs": [
                {"name": "conversation", "kind": "thread"},
                {"name": "question", "kind": "string", "default": "Hi"}
            ],
            "instructions": "system:\nHello"
        });
        let agent = Prompty::load_from_value(&data, &LoadContext::default());
        let inputs = serde_json::json!({
            "conversation": [{"role": "user", "content": "prior message"}],
            "question": "How are you?"
        });

        let (modified, nonces) = prepare_render_inputs(&agent, &inputs);

        // The thread input should have a nonce injected
        assert_eq!(nonces.len(), 1);
        assert!(nonces.contains_key("conversation"));
        let nonce = &nonces["conversation"];
        assert!(nonce.starts_with("__PROMPTY_THREAD_"));
        assert!(nonce.ends_with("_conversation__"));

        // The modified inputs should have the nonce string, not the original
        assert_eq!(modified["conversation"].as_str().unwrap(), nonce);
        // Non-rich input should be unchanged
        assert_eq!(modified["question"], "How are you?");
    }

    #[test]
    fn test_prepare_render_inputs_multiple_rich_kinds() {
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "test",
            "model": "gpt-4",
            "inputs": [
                {"name": "history", "kind": "thread"},
                {"name": "photo", "kind": "image"},
                {"name": "name", "kind": "string"}
            ],
            "instructions": "test"
        });
        let agent = Prompty::load_from_value(&data, &LoadContext::default());
        let inputs = serde_json::json!({
            "history": [],
            "photo": "data:image/png;base64,abc",
            "name": "Alice"
        });

        let (modified, nonces) = prepare_render_inputs(&agent, &inputs);

        // Both thread and image kinds should get nonces
        assert_eq!(nonces.len(), 2);
        assert!(nonces.contains_key("history"));
        assert!(nonces.contains_key("photo"));
        // String kind should NOT have a nonce
        assert_eq!(modified["name"], "Alice");
    }

    #[test]
    fn test_prepare_render_inputs_returns_nonces() {
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "test",
            "model": "gpt-4",
            "inputs": [
                {"name": "audio_clip", "kind": "audio"}
            ],
            "instructions": "test"
        });
        let agent = Prompty::load_from_value(&data, &LoadContext::default());
        let inputs = serde_json::json!({"audio_clip": "data:audio/wav;base64,abc"});

        let (_, nonces) = prepare_render_inputs(&agent, &inputs);
        assert!(nonces.contains_key("audio_clip"));
    }
}
