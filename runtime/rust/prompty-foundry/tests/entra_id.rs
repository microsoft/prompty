//! Integration tests for Entra ID (keyless / DefaultAzureCredential) auth.
//!
//! These tests verify that the Foundry executor can authenticate via
//! `DefaultAzureCredential` when no API key is provided. They require:
//!   - `AZURE_OPENAI_ENDPOINT`
//!   - `AZURE_OPENAI_CHAT_DEPLOYMENT`
//!   - `AZURE_TENANT_ID` (so DefaultAzureCredential picks the right tenant)
//!   - A valid Azure identity (e.g. Azure CLI login, managed identity, etc.)
//!
//! Run with:
//! ```sh
//! cargo test -p prompty-foundry --features entra_id --test entra_id -- --ignored --test-threads=1
//! ```

#![cfg(feature = "entra_id")]

use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use prompty::{TurnOptions, register_defaults};
use serde_json::{Value, json};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
                    // SAFETY: integration tests run with --test-threads=1.
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
    prompty_foundry::register();
}

fn chat_deployment() -> String {
    std::env::var("AZURE_OPENAI_CHAT_DEPLOYMENT").unwrap_or_else(|_| "gpt-4o-mini".into())
}

fn endpoint() -> String {
    std::env::var("AZURE_OPENAI_ENDPOINT").unwrap_or_default()
}

/// Temporarily remove `AZURE_OPENAI_API_KEY` so the executor takes the Entra ID
/// path. Returns the old value (if any) so the caller can restore it.
fn suppress_api_key() -> Option<String> {
    let old = std::env::var("AZURE_OPENAI_API_KEY").ok();
    // SAFETY: integration tests run with --test-threads=1.
    unsafe { std::env::remove_var("AZURE_OPENAI_API_KEY") };
    old
}

/// Restore `AZURE_OPENAI_API_KEY` after the test.
fn restore_api_key(old: Option<String>) {
    // SAFETY: integration tests run with --test-threads=1.
    match old {
        Some(v) => unsafe { std::env::set_var("AZURE_OPENAI_API_KEY", v) },
        None => unsafe { std::env::remove_var("AZURE_OPENAI_API_KEY") },
    }
}

fn build_foundry_chat_agent(question: &str, options: Value) -> Prompty {
    let data = json!({
        "name": "entra-id-chat-test",
        "kind": "prompt",
        "model": {
            "id": chat_deployment(),
            "provider": "foundry",
            "apiType": "chat",
            "connection": {
                "kind": "foundry",
                "endpoint": endpoint(),
            },
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

/// Verify that `DefaultAzureCredential` can acquire a token for the
/// Azure Cognitive Services scope.
#[tokio::test]
#[ignore]
async fn test_entra_id_token_acquisition() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");

    use azure_core::credentials::TokenCredential;
    use azure_identity::DefaultAzureCredential;

    let credential =
        DefaultAzureCredential::new().expect("DefaultAzureCredential should be created");

    let token = credential
        .get_token(&["https://cognitiveservices.azure.com/.default"])
        .await
        .expect("Should acquire Entra ID token for Cognitive Services scope");

    assert!(
        !token.token.secret().is_empty(),
        "Token should not be empty"
    );
    eprintln!(
        "Entra ID token acquired successfully (length: {})",
        token.token.secret().len()
    );
}

/// Chat completion using `kind: "foundry"` + Entra ID (no API key).
#[tokio::test]
#[ignore]
async fn test_entra_id_chat_completion() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let old_key = suppress_api_key();

    let agent = build_foundry_chat_agent(
        "Say hello in exactly 3 words.",
        json!({ "temperature": 0, "maxOutputTokens": 100 }),
    );

    let result = prompty::invoke_agent(&agent, None).await;

    restore_api_key(old_key);

    let result = result.expect("Entra ID chat completion should succeed");
    assert!(result.is_string(), "result should be a string: {result:?}");
    let text = result.as_str().unwrap();
    assert!(!text.is_empty(), "result should not be empty");
    eprintln!("Entra ID chat result: {text}");
}

/// Streaming chat completion using `kind: "foundry"` + Entra ID (no API key).
#[tokio::test]
#[ignore]
async fn test_entra_id_chat_completion_streaming() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let old_key = suppress_api_key();

    let agent = build_foundry_chat_agent(
        "What is 2 + 2? Answer with just the number.",
        json!({ "temperature": 0, "maxOutputTokens": 50 }),
    );

    let result = prompty::turn(&agent, None, Some(TurnOptions::default())).await;

    restore_api_key(old_key);

    let result = result.expect("Entra ID streaming chat should succeed");
    let text = result.as_str().unwrap_or(&result.to_string()).to_string();
    assert!(!text.is_empty(), "streaming result should not be empty");
    eprintln!("Entra ID streaming result: {text}");
}

/// Structured output via `outputs` using Entra ID auth.
#[tokio::test]
#[ignore]
async fn test_entra_id_structured_output() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let old_key = suppress_api_key();

    let data = json!({
        "name": "entra-id-structured-test",
        "kind": "prompt",
        "model": {
            "id": chat_deployment(),
            "provider": "foundry",
            "apiType": "chat",
            "connection": {
                "kind": "foundry",
                "endpoint": endpoint(),
            },
            "options": { "temperature": 0, "maxOutputTokens": 200 },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "outputs": [
            { "name": "city", "kind": "string", "description": "The city name", "required": true },
            { "name": "country", "kind": "string", "description": "The country name", "required": true },
        ],
        "instructions": "system:\nYou are a geography expert. Return structured data.\nuser:\nTell me about Paris.",
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None).await;

    restore_api_key(old_key);

    let result = result.expect("Entra ID structured output should succeed");
    let obj = match result {
        Value::Object(ref o) => o.clone(),
        Value::String(ref s) => serde_json::from_str::<Value>(s)
            .expect("structured output string should be valid JSON")
            .as_object()
            .expect("parsed JSON should be an object")
            .clone(),
        other => panic!("Expected object or JSON string, got: {other:?}"),
    };

    assert!(obj.contains_key("city"), "missing 'city' field: {obj:?}");
    assert!(
        obj.contains_key("country"),
        "missing 'country' field: {obj:?}"
    );
    eprintln!("Entra ID structured output: {obj:?}");
}

/// Agent with tool calling using Entra ID auth.
#[tokio::test]
#[ignore]
async fn test_entra_id_agent_tool_calling() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let old_key = suppress_api_key();

    let data = json!({
        "name": "entra-id-agent-test",
        "kind": "prompt",
        "model": {
            "id": chat_deployment(),
            "provider": "foundry",
            "apiType": "agent",
            "connection": {
                "kind": "foundry",
                "endpoint": endpoint(),
            },
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

    let mut tools = std::collections::HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        prompty::ToolHandler::Sync(Box::new(|args: Value| {
            let city = args
                .get("city")
                .and_then(|c| c.as_str())
                .unwrap_or("unknown");
            Ok(format!("72°F and sunny in {city}"))
        })),
    );

    let result = prompty::turn(&agent, None, Some(TurnOptions::with_tools(tools))).await;

    restore_api_key(old_key);

    let result = result.expect("Entra ID agent tool calling should succeed");
    let text = result.as_str().unwrap_or(&result.to_string()).to_string();
    let mentions_weather = text.contains("72")
        || text.to_lowercase().contains("sunny")
        || text.to_lowercase().contains("weather")
        || text.to_lowercase().contains("seattle");
    assert!(
        mentions_weather,
        "Agent response should mention weather info: {text}"
    );
    eprintln!("Entra ID agent result: {text}");
}
