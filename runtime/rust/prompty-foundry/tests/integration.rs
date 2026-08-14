//! Integration tests for the Azure OpenAI / Foundry provider.
//!
//! These tests hit the real Azure OpenAI API and require the following env vars:
//!   - `AZURE_OPENAI_API_KEY`
//!   - `AZURE_OPENAI_ENDPOINT`
//!   - `AZURE_OPENAI_CHAT_DEPLOYMENT`
//!
//! Run with:
//! ```sh
//! cargo test --test integration -- --ignored
//! ```

use prompty::model::Agent;
use prompty::model::context::LoadContext;
use prompty::{ToolHandler, TurnOptions, register_defaults};
use serde_json::{Value, json};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn load_dotenv() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    // Prefer the runtime-local `runtime/rust/.env`, then fall back to the
    // repository-root `.env` so a single root file can drive every provider's
    // live tests. Already-set variables are never overwritten.
    let candidates = [
        manifest.parent().map(|p| p.join(".env")),
        manifest.ancestors().nth(3).map(|p| p.join(".env")),
    ];
    for env_path in candidates.into_iter().flatten() {
        let Ok(contents) = std::fs::read_to_string(&env_path) else {
            continue;
        };
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
    prompty_foundry::register();
}

fn chat_deployment() -> String {
    std::env::var("AZURE_OPENAI_CHAT_DEPLOYMENT").unwrap_or_else(|_| "gpt-4o-mini".into())
}

fn endpoint() -> String {
    std::env::var("AZURE_OPENAI_ENDPOINT").unwrap_or_default()
}

fn build_azure_chat_agent(question: &str, options: Value) -> Agent {
    let data = json!({
        "name": "azure-integration-chat",
        "kind": "prompt",
        "model": {
            "id": chat_deployment(),
            "provider": "azure",
            "apiType": "chat",
            "connection": {
                "kind": "key",
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
    Agent::load_from_value(&data, &LoadContext::default())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_azure_chat_completion() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_API_KEY");
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let agent = build_azure_chat_agent(
        "Say hello in exactly 3 words.",
        json!({ "temperature": 0, "maxOutputTokens": 100 }),
    );

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("Azure chat completion should succeed");

    assert!(result.is_string(), "result should be a string: {result:?}");
    let text = result.as_str().unwrap();
    assert!(!text.is_empty(), "result should not be empty");
    eprintln!("Azure chat result: {text}");
}

#[tokio::test]
#[ignore]
async fn test_azure_embedding() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_API_KEY");
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");

    let embedding_deployment = std::env::var("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")
        .unwrap_or_else(|_| "text-embedding-3-small".into());

    let data = json!({
        "name": "azure-integration-embedding",
        "kind": "prompt",
        "model": {
            "id": embedding_deployment,
            "provider": "azure",
            "apiType": "embedding",
            "connection": {
                "kind": "key",
                "endpoint": endpoint(),
            },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
        "instructions": "The quick brown fox jumps over the lazy dog.",
    });
    let agent = Agent::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("Azure embedding should succeed");

    assert!(
        result.is_array(),
        "embedding result should be an array: {result:?}"
    );
    let arr = result.as_array().unwrap();
    assert!(!arr.is_empty(), "embedding vector should not be empty");
    assert!(
        arr[0].is_number(),
        "embedding elements should be numbers: {:?}",
        arr[0]
    );
    eprintln!("Azure embedding dimensions: {}", arr.len());
}

#[tokio::test]
#[ignore]
async fn test_azure_structured_output() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_API_KEY");
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let data = json!({
        "name": "azure-integration-structured",
        "kind": "prompt",
        "model": {
            "id": chat_deployment(),
            "provider": "azure",
            "apiType": "chat",
            "connection": {
                "kind": "key",
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
            { "name": "population", "kind": "integer", "description": "Approximate population", "required": true },
        ],
        "instructions": "system:\nYou are a geography expert. Return structured data.\nuser:\nTell me about Paris.",
    });
    let agent = Agent::load_from_value(&data, &LoadContext::default());

    let result = prompty::invoke_agent(&agent, None)
        .await
        .expect("Azure structured output should succeed");

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
    assert!(
        obj.contains_key("population"),
        "missing 'population' field: {obj:?}"
    );
    eprintln!("Azure structured output: {obj:?}");
}

#[tokio::test]
#[ignore]
async fn test_azure_agent_tool_calling() {
    setup();
    skip_if_no_env!("AZURE_OPENAI_API_KEY");
    skip_if_no_env!("AZURE_OPENAI_ENDPOINT");
    skip_if_no_env!("AZURE_OPENAI_CHAT_DEPLOYMENT");

    let data = json!({
        "name": "azure-integration-agent",
        "kind": "prompt",
        "model": {
            "id": chat_deployment(),
            "provider": "azure",
            "apiType": "agent",
            "connection": {
                "kind": "key",
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
    let agent = Agent::load_from_value(&data, &LoadContext::default());

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
        .expect("Azure agent tool calling should succeed");

    let text = result.as_str().unwrap_or(&result.to_string()).to_string();
    let mentions_weather = text.contains("72")
        || text.to_lowercase().contains("sunny")
        || text.to_lowercase().contains("weather")
        || text.to_lowercase().contains("seattle");
    assert!(
        mentions_weather,
        "Agent response should mention weather info: {text}"
    );
    eprintln!("Azure agent result: {text}");
}

/// Acquire an `https://ai.azure.com` bearer token from the Azure CLI login.
///
/// Returns `None` when the CLI is unavailable or not logged in so the test can
/// skip cleanly rather than fail. Handles the Windows `az.cmd` shim.
fn cli_ai_token() -> Option<String> {
    let args = [
        "account",
        "get-access-token",
        "--resource",
        "https://ai.azure.com",
        "--query",
        "accessToken",
        "-o",
        "tsv",
    ];
    let programs: &[&str] = if cfg!(windows) {
        &["az.cmd", "az"]
    } else {
        &["az"]
    };
    for program in programs {
        if let Ok(output) = std::process::Command::new(program).args(args).output() {
            if output.status.success() {
                let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !token.is_empty() {
                    return Some(token);
                }
            }
        }
    }
    None
}

/// Live discovery via the caller-supplied bearer-token path (as used by hosts
/// that already hold an interactive Entra token). Requires
/// `FOUNDRY_PROJECT_ENDPOINT` and an `az` login.
#[tokio::test]
#[ignore]
async fn test_foundry_list_deployments_with_cli_token() {
    setup();
    skip_if_no_env!("FOUNDRY_PROJECT_ENDPOINT");

    let Some(token) = cli_ai_token() else {
        eprintln!("Skipping: `az account get-access-token` unavailable");
        return;
    };

    let endpoint = std::env::var("FOUNDRY_PROJECT_ENDPOINT").unwrap();
    let connection = json!({
        "kind": "foundry",
        "endpoint": endpoint,
        "apiKey": token,
    });

    let models = prompty_foundry::list_models_async(&connection)
        .await
        .expect("foundry deployment listing should succeed");

    assert!(!models.is_empty(), "expected at least one deployment");
    let first = &models[0];
    assert!(!first.id.is_empty(), "deployment should have an id");
    assert!(
        first.display_name.is_some(),
        "v1 data-plane deployment should map a display name: {first:?}"
    );
    eprintln!(
        "Foundry deployments: {}",
        models
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
}
