//! Anthropic executor — sends requests to the Anthropic Messages API.
//!
//! Only supports `apiType: "chat"` — Anthropic doesn't have embedding or image APIs.
//! Auth uses `x-api-key` header and `anthropic-version` header.

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{Executor, InvokerError};
use prompty::model::Prompty;
use prompty::types::Message;

use crate::wire;

/// Anthropic executor implementing the `Executor` trait.
pub struct AnthropicExecutor;

#[async_trait]
impl Executor for AnthropicExecutor {
    async fn execute(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");
        if api_type != "chat" && api_type != "agent" {
            return Err(InvokerError::Execute(
                format!("Anthropic only supports apiType 'chat', got: {api_type}").into(),
            ));
        }

        let body = wire::build_chat_args(agent, messages);
        let url = build_url(agent)?;
        let api_key = get_api_key(agent)?;

        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", wire::ANTHROPIC_VERSION)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read body".to_string());
            return Err(InvokerError::Execute(
                format!("Anthropic API error (HTTP {status}): {body_text}").into(),
            ));
        }

        let result: Value = response
            .json()
            .await
            .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;

        Ok(result)
    }

    fn format_tool_messages(
        &self,
        raw_response: &Value,
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        wire::format_tool_messages(raw_response, tool_calls, tool_results)
    }
}

impl AnthropicExecutor {
    /// Build the request args without sending — useful for testing wire format.
    pub fn build_args(
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");
        if api_type != "chat" && api_type != "agent" {
            return Err(InvokerError::Execute(
                format!("Anthropic only supports apiType 'chat', got: {api_type}").into(),
            ));
        }
        Ok(wire::build_chat_args(agent, messages))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_url(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = &agent.model.connection;
    let endpoint = conn
        .get("endpoint")
        .and_then(|e| e.as_str())
        .unwrap_or("https://api.anthropic.com");

    let base = endpoint.trim_end_matches('/');
    Ok(format!("{base}/v1/messages"))
}

fn get_api_key(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = &agent.model.connection;

    // Try connection.apiKey first
    if let Some(key) = conn
        .get("apiKey")
        .or(conn.get("api_key"))
        .and_then(|k| k.as_str())
    {
        if !key.is_empty() {
            return Ok(key.to_string());
        }
    }

    // Fall back to ANTHROPIC_API_KEY env var
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(InvokerError::Execute(
        "No API key found. Set ANTHROPIC_API_KEY or configure model.connection.apiKey"
            .to_string()
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::Prompty;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent(model_json: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": model_json,
        });
        data["instructions"] = json!("test");
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[test]
    fn test_build_url_default() {
        let agent = make_agent(json!({"id": "claude-3", "provider": "anthropic"}));
        let url = build_url(&agent).unwrap();
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
    }

    #[test]
    fn test_build_url_custom_endpoint() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": {
                "kind": "key",
                "endpoint": "https://custom.anthropic.com/",
                "apiKey": "test-key"
            }
        }));
        let url = build_url(&agent).unwrap();
        assert_eq!(url, "https://custom.anthropic.com/v1/messages");
    }

    #[test]
    fn test_get_api_key_from_connection() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "connection": {
                "kind": "key",
                "apiKey": "sk-from-connection"
            }
        }));
        let key = get_api_key(&agent).unwrap();
        assert_eq!(key, "sk-from-connection");
    }

    #[test]
    fn test_build_args_chat() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "apiType": "chat"
        }));
        let messages = vec![Message::text(prompty::Role::User, "Hello")];
        let args = AnthropicExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "claude-3");
        assert!(args["messages"].is_array());
        assert_eq!(args["max_tokens"], 4096);
    }

    #[test]
    fn test_build_args_rejects_embedding() {
        let agent = make_agent(json!({
            "id": "claude-3",
            "provider": "anthropic",
            "apiType": "embedding"
        }));
        let messages = vec![Message::text(prompty::Role::User, "Hello")];
        let result = AnthropicExecutor::build_args(&agent, &messages);
        assert!(result.is_err());
    }
}
