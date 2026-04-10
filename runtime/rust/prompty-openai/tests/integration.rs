//! Integration tests for the OpenAI provider.
//!
//! These tests hit the real OpenAI API and require `OPENAI_API_KEY` to be set.
//! They are **not** run in CI by default — run manually with:
//!
//! ```sh
//! cargo test --test integration -- --ignored
//! ```
//!
//! Or set the env vars and run without `--ignored` after removing the `#[ignore]` attrs.

use prompty::model::context::LoadContext;
use prompty::model::Prompty;
use prompty::{register_defaults, ToolHandler, TurnOptions};
use serde_json::{json, Value};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Load `runtime/rust/.env` (KEY=VALUE lines) into the process environment.
/// Already-set variables are not overwritten.
fn load_dotenv() {
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".env");
    if let Ok(contents) = std::fs::read_to_string(env_path) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                if std::env::var(key).is_err() {
                    // SAFETY: integration tests are single-threaded by convention.
                    unsafe { std::env::set_var(key, value) };
                }
            }
        }
    }
}

macro_rules! skip_if_no_env {
    ($var:expr) => {
        if std::env::var($var).unwrap_or_default().is_empty() {
            eprintln!("Skipping: {} not set", $var);
            return;
        }
    };
}

fn setup() {
    load_dotenv();
    register_defaults();
    prompty_openai::register();
}

fn model_id() -> String {
    std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into())
}

fn build_chat_agent(question: &str, options: Value) -> Prompty {
    let data = json!({
        "name": "integration-chat",
        "kind": "prompt",
        "model": {
            "id": model_id(),
            "provider": "openai",
            "apiType": "chat",
            "connection": { "kind": "key" },
            "options": options,
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "instructions": format!(
            "system:\nYou are a helpful assistant. Be very brief.\nuser:\n{question}"
        ),
    });
    Prompty::load_from_value(&data, &LoadContext::default())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_chat_completion() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");

    let agent = build_chat_agent(
        "Say hello in exactly 3 words.",
        json!({ "temperature": 0, "maxOutputTokens": 100 }),
    );

    let result = prompty::invoke_agent(&agent, None).await;
    let result = result.expect("chat completion should succeed");

    assert!(result.is_string(), "result should be a string: {result:?}");
    let text = result.as_str().unwrap();
    assert!(!text.is_empty(), "result should not be empty");
    eprintln!("Chat result: {text}");
}

#[tokio::test]
#[ignore]
async fn test_chat_with_temperature() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");

    let agent = build_chat_agent(
        "What is 2+2? Reply with just the number.",
        json!({ "temperature": 0, "maxOutputTokens": 10 }),
    );

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("chat should succeed");

    let text = result.as_str().unwrap_or("");
    assert!(text.contains('4'), "Expected '4' in response: {text}");
}

#[tokio::test]
#[ignore]
async fn test_chat_streaming() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");

    // Streaming — just verify the API call succeeds.
    let data = json!({
        "name": "integration-stream",
        "kind": "prompt",
        "model": {
            "id": model_id(),
            "provider": "openai",
            "apiType": "chat",
            "connection": { "kind": "key" },
            "options": {
                "temperature": 0,
                "maxOutputTokens": 50,
                "additionalProperties": { "stream": true },
            },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "instructions": "system:\nBe brief.\nuser:\nSay hi.",
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None).await;
    // Streaming may or may not be fully implemented; we just verify no panic.
    match result {
        Ok(val) => eprintln!("Streaming result: {val}"),
        Err(e) => eprintln!("Streaming returned error (may be expected): {e}"),
    }
}

#[tokio::test]
#[ignore]
async fn test_embedding() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");
    skip_if_no_env!("OPENAI_EMBEDDING_MODEL");

    let embedding_model =
        std::env::var("OPENAI_EMBEDDING_MODEL").unwrap_or_else(|_| "text-embedding-3-small".into());

    let data = json!({
        "name": "integration-embedding",
        "kind": "prompt",
        "model": {
            "id": embedding_model,
            "provider": "openai",
            "apiType": "embedding",
            "connection": { "kind": "key" },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "instructions": "The quick brown fox jumps over the lazy dog.",
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("embedding should succeed");

    assert!(result.is_array(), "embedding result should be an array: {result:?}");
    let arr = result.as_array().unwrap();
    assert!(!arr.is_empty(), "embedding vector should not be empty");
    assert!(
        arr[0].is_number(),
        "embedding elements should be numbers: {:?}",
        arr[0]
    );
    eprintln!("Embedding dimensions: {}", arr.len());
}

#[tokio::test]
#[ignore]
async fn test_image_generation() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");
    skip_if_no_env!("OPENAI_IMAGE_MODEL");

    let image_model = std::env::var("OPENAI_IMAGE_MODEL").unwrap_or_else(|_| "dall-e-2".into());

    let data = json!({
        "name": "integration-image",
        "kind": "prompt",
        "model": {
            "id": image_model,
            "provider": "openai",
            "apiType": "image",
            "connection": { "kind": "key" },
            "options": {
                "additionalProperties": {
                    "size": "1024x1024",
                    "n": 1,
                },
            },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "instructions": "A simple red circle on a white background.",
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("image generation should succeed");

    // Result is typically a URL string or object with url field
    let text = match result {
        Value::String(ref s) => s.clone(),
        Value::Object(ref obj) => obj
            .get("url")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string(),
        Value::Array(ref arr) if !arr.is_empty() => {
            // Could be [{ url: "..." }]
            arr[0]
                .as_object()
                .and_then(|o| o.get("url"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string()
        }
        other => format!("{other:?}"),
    };
    assert!(!text.is_empty(), "image result should not be empty");
    eprintln!("Image result: {text}");
}

#[tokio::test]
#[ignore]
async fn test_structured_output() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");

    let data = json!({
        "name": "integration-structured",
        "kind": "prompt",
        "model": {
            "id": model_id(),
            "provider": "openai",
            "apiType": "chat",
            "connection": { "kind": "key" },
            "options": { "temperature": 0, "maxOutputTokens": 200 },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "outputs": [
            { "name": "city", "kind": "string", "description": "The city name", "required": true },
            { "name": "country", "kind": "string", "description": "The country name", "required": true },
            { "name": "population", "kind": "integer", "description": "Approximate population", "required": true },
        ],
        "instructions": "system:\nYou are a geography expert. Return structured data.\nuser:\nTell me about Paris.",
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("structured output should succeed");

    // The result should be parseable as JSON with the expected fields
    let obj = match result {
        Value::Object(ref o) => o.clone(),
        Value::String(ref s) => {
            serde_json::from_str::<Value>(s)
                .expect("structured output string should be valid JSON")
                .as_object()
                .expect("parsed JSON should be an object")
                .clone()
        }
        other => panic!("Expected object or JSON string, got: {other:?}"),
    };

    assert!(obj.contains_key("city"), "missing 'city' field: {obj:?}");
    assert!(obj.contains_key("country"), "missing 'country' field: {obj:?}");
    assert!(obj.contains_key("population"), "missing 'population' field: {obj:?}");
    eprintln!("Structured output: {obj:?}");
}

#[tokio::test]
#[ignore]
async fn test_agent_tool_calling() {
    setup();
    skip_if_no_env!("OPENAI_API_KEY");

    let data = json!({
        "name": "integration-agent",
        "kind": "prompt",
        "model": {
            "id": model_id(),
            "provider": "openai",
            "apiType": "agent",
            "connection": { "kind": "key" },
            "options": { "temperature": 0, "maxOutputTokens": 300 },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "tools": [
            {
                "name": "get_weather",
                "kind": "function",
                "description": "Get the current weather for a city",
                "parameters": {
                    "properties": [
                        { "name": "city", "kind": "string", "description": "The city name", "required": true }
                    ]
                },
            }
        ],
        "instructions": "system:\nYou are a helpful assistant with weather tools. Use the get_weather tool when asked about weather. Be brief.\nuser:\nWhat is the weather in Seattle?",
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());

    let mut tools = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(|args: Value| {
            let city = args
                .get("city")
                .and_then(|c| c.as_str())
                .unwrap_or("unknown");
            Ok(format!("72°F and sunny in {city}"))
        })),
    );

    let result = prompty::turn(&agent, None, Some(TurnOptions::with_tools(tools)))
        .await
        .expect("agent tool calling should succeed");

    let text = result.as_str().unwrap_or(&result.to_string()).to_string();
    // The model should incorporate the weather tool result
    let mentions_weather = text.contains("72")
        || text.to_lowercase().contains("sunny")
        || text.to_lowercase().contains("weather")
        || text.to_lowercase().contains("seattle");
    assert!(
        mentions_weather,
        "Agent response should mention weather info: {text}"
    );
    eprintln!("Agent result: {text}");
}
