//! Spec vector tests for the **render** pipeline stage.
//!
//! Loads the 23 test cases from `spec/vectors/render/render_vectors.json` and
//! exercises the full render path: build a `Prompty` agent → register renderers
//! → call `prompty::pipeline::render()` → compare output.

use std::path::PathBuf;
use std::sync::Once;

use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use serde_json::Value;

static INIT: Once = Once::new();

/// Register the default renderers exactly once across all tests.
fn ensure_renderers() {
    INIT.call_once(|| {
        prompty::register_defaults();
    });
}

/// Repo-root-relative path to the render vectors JSON.
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
        .join("render")
        .join("render_vectors.json")
}

/// Load all 23 render vectors from the JSON file.
fn load_vectors() -> Vec<Value> {
    let raw = std::fs::read_to_string(vectors_path()).expect("failed to read render_vectors.json");
    serde_json::from_str::<Vec<Value>>(&raw).expect("failed to parse render_vectors.json")
}

/// Mustache engine names that we skip when no MustacheRenderer exists.
const MUSTACHE_VECTORS: &[&str] = &[
    "mustache_simple",
    "mustache_section",
    "mustache_inverted",
    "mustache_loop",
];

/// Build a `Prompty` agent from vector input fields.
///
/// For the `thread_nonce_injection` vector the agent needs a `kind: thread`
/// input declaration so that `prepare_render_inputs` replaces it with a nonce.
fn build_agent(name: &str, template: &str, engine: &str) -> Prompty {
    if name == "thread_nonce_injection" {
        let data = serde_json::json!({
            "name": "test",
            "kind": "prompt",
            "model": { "id": "test" },
            "instructions": template,
            "inputs": [
                { "name": "question", "kind": "string" },
                { "name": "conversation", "kind": "thread" }
            ],
            "template": {
                "format": { "kind": engine },
                "parser": { "kind": "prompty" }
            }
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    } else {
        let data = serde_json::json!({
            "name": "test",
            "kind": "prompt",
            "model": { "id": "test" },
            "instructions": template,
            "template": {
                "format": { "kind": engine },
                "parser": { "kind": "prompty" }
            }
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }
}

#[tokio::test]
async fn test_render_vectors() {
    ensure_renderers();

    let vectors = load_vectors();
    assert_eq!(vectors.len(), 23, "expected 23 render vectors");

    let has_mustache = prompty::has_renderer("mustache");

    for vec in &vectors {
        let name = vec["name"].as_str().expect("vector missing 'name'");
        let input = &vec["input"];
        let expected = &vec["expected"];

        let template = input["template"]
            .as_str()
            .expect("vector missing 'template'");
        let engine = input["engine"].as_str().expect("vector missing 'engine'");
        let inputs = &input["inputs"];

        // Skip mustache vectors when no MustacheRenderer is registered.
        if engine == "mustache" && !has_mustache {
            assert!(
                MUSTACHE_VECTORS.contains(&name),
                "unexpected mustache vector: {name}"
            );
            println!("SKIP: {name} — mustache renderer not implemented");
            continue;
        }

        let agent = build_agent(name, template, engine);

        let rendered = prompty::render(&agent, inputs)
            .await
            .unwrap_or_else(|e| panic!("[{name}] render failed: {e}"));

        // Check exact match if `expected.rendered` is present.
        if let Some(exp) = expected.get("rendered").and_then(Value::as_str) {
            assert_eq!(rendered, exp, "[{name}] rendered output mismatch");
        }

        // Check nonce regex pattern if `expected.nonce_pattern` is present.
        if let Some(pattern) = expected.get("nonce_pattern").and_then(Value::as_str) {
            let re = regex::Regex::new(pattern)
                .unwrap_or_else(|e| panic!("[{name}] invalid nonce_pattern regex: {e}"));
            assert!(
                re.is_match(&rendered),
                "[{name}] nonce pattern mismatch\n  pattern: {pattern}\n  got:     {rendered}"
            );
        }
    }
}
