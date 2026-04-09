//! OpenAI executor — sends requests to the OpenAI Chat Completions API.
//!
//! Dispatches on `agent.model.apiType` to call the appropriate endpoint:
//! `chat`, `embedding`, or `image`.

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{Executor, InvokerError};
use prompty::model::Prompty;
use prompty::types::Message;

use crate::wire;

/// OpenAI executor implementing the `Executor` trait.
pub struct OpenAIExecutor;

#[async_trait]
impl Executor for OpenAIExecutor {
    async fn execute(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent
            .model
            .api_type
            .as_deref()
            .unwrap_or("chat");

        let (url, body) = match api_type {
            "chat" | "agent" => {
                let args = wire::build_chat_args(agent, messages);
                let url = build_url(agent, "/v1/chat/completions")?;
                (url, args)
            }
            "embedding" => {
                let args = wire::build_embedding_args(agent, messages);
                let url = build_url(agent, "/v1/embeddings")?;
                (url, args)
            }
            "image" => {
                let args = wire::build_image_args(agent, messages);
                let url = build_url(agent, "/v1/images/generations")?;
                (url, args)
            }
            other => {
                return Err(InvokerError::Execute(
                    format!("Unsupported apiType: {other}").into(),
                ));
            }
        };

        let api_key = get_api_key(agent)?;
        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
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
                format!("OpenAI API error (HTTP {status}): {body_text}").into(),
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
        _raw_response: &serde_json::Value,
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        wire::format_tool_messages(tool_calls, tool_results)
    }
}

impl OpenAIExecutor {
    /// Build the request args without sending — useful for testing wire format.
    pub fn build_args(
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");
        Ok(match api_type {
            "chat" | "agent" => wire::build_chat_args(agent, messages),
            "embedding" => wire::build_embedding_args(agent, messages),
            "image" => wire::build_image_args(agent, messages),
            other => {
                return Err(InvokerError::Execute(
                    format!("Unsupported apiType: {other}").into(),
                ));
            }
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn build_url(agent: &Prompty, path: &str) -> Result<String, InvokerError> {
    let conn = &agent.model.connection;
    let endpoint = conn
        .get("endpoint")
        .and_then(|e| e.as_str())
        .unwrap_or("https://api.openai.com");

    let base = endpoint.trim_end_matches('/');
    Ok(format!("{base}{path}"))
}

fn get_api_key(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = &agent.model.connection;

    // Try connection.apiKey first
    if let Some(key) = conn.get("apiKey").or(conn.get("api_key")).and_then(|k| k.as_str()) {
        if !key.is_empty() {
            return Ok(key.to_string());
        }
    }

    // Fall back to OPENAI_API_KEY env var
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(InvokerError::Execute(
        "No API key found. Set OPENAI_API_KEY or configure model.connection.apiKey"
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
        let agent = make_agent(json!({"id": "gpt-4"}));
        let url = build_url(&agent, "/v1/chat/completions").unwrap();
        assert_eq!(url, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_build_url_custom_endpoint() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://custom.openai.com/",
                "apiKey": "sk-test"
            }
        }));
        let url = build_url(&agent, "/v1/chat/completions").unwrap();
        assert_eq!(url, "https://custom.openai.com/v1/chat/completions");
    }

    #[test]
    fn test_get_api_key_from_connection() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://api.openai.com",
                "apiKey": "sk-from-connection"
            }
        }));
        let key = get_api_key(&agent).unwrap();
        assert_eq!(key, "sk-from-connection");
    }

    #[test]
    fn test_build_args_chat() {
        let agent = make_agent(json!({"id": "gpt-4", "apiType": "chat"}));
        let messages = vec![Message::text(prompty::Role::User, "Hello")];
        let args = OpenAIExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "gpt-4");
        assert!(args["messages"].is_array());
    }

    #[test]
    fn test_build_args_embedding() {
        let agent = make_agent(json!({"id": "text-embedding-3-small", "apiType": "embedding"}));
        let messages = vec![Message::text(prompty::Role::User, "Hello world")];
        let args = OpenAIExecutor::build_args(&agent, &messages).unwrap();
        assert_eq!(args["model"], "text-embedding-3-small");
        assert!(args.get("input").is_some());
    }
}
