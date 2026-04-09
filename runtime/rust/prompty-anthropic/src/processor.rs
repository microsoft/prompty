//! Anthropic processor — extracts results from Anthropic Messages API responses.
//!
//! Handles:
//! - Text responses: concatenates all `text` content blocks
//! - Tool use responses: extracts `tool_use` blocks into `ToolCall` structs
//! - Structured output: JSON-parses text when `outputs` is defined
//!
//! `tool_use` blocks take priority — if any exist, they're returned instead of text.

use async_trait::async_trait;
use serde_json::{json, Value};

use prompty::interfaces::{InvokerError, Processor};
use prompty::model::Prompty;
use prompty::types::ToolCall;

/// Anthropic processor implementing the `Processor` trait.
pub struct AnthropicProcessor;

#[async_trait]
impl Processor for AnthropicProcessor {
    async fn process(
        &self,
        agent: &Prompty,
        response: Value,
    ) -> Result<Value, InvokerError> {
        process_response(agent, &response)
    }
}

/// Process an Anthropic Messages API response.
///
/// This is the shared logic used by both the `AnthropicProcessor` trait impl
/// and can be called directly for testing.
pub fn process_response(agent: &Prompty, response: &Value) -> Result<Value, InvokerError> {
    let content = response
        .get("content")
        .and_then(|c| c.as_array())
        .ok_or_else(|| {
            InvokerError::Process(format!("Invalid Anthropic response: missing 'content' array").into())
        })?;

    // Extract tool_use blocks
    let tool_calls: Vec<ToolCall> = content
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .map(|block| ToolCall {
            id: block
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            arguments: block
                .get("input")
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .unwrap_or_default(),
        })
        .collect();

    // If there are tool calls, return them (tool calls take priority over text)
    if !tool_calls.is_empty() {
        let calls_json: Vec<Value> = tool_calls
            .iter()
            .map(|tc| {
                json!({
                    "id": tc.id,
                    "name": tc.name,
                    "arguments": tc.arguments,
                })
            })
            .collect();
        return Ok(Value::Array(calls_json));
    }

    // Extract and concatenate text blocks
    let text: String = content
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|block| block.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");

    // Check for structured output
    let has_outputs = agent
        .as_outputs()
        .map(|o| !o.is_empty())
        .unwrap_or(false);

    if has_outputs {
        // Parse text as JSON for structured output
        let parsed: Value = serde_json::from_str(&text).map_err(|e| {
            InvokerError::Process(format!("Failed to parse structured output: {e}").into())
        })?;
        return Ok(parsed);
    }

    Ok(Value::String(text))
}

/// Extract tool calls from an Anthropic response (for agent loop).
pub fn extract_tool_calls(response: &Value) -> Vec<ToolCall> {
    let content = match response.get("content").and_then(|c| c.as_array()) {
        Some(c) => c,
        None => return Vec::new(),
    };

    content
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .map(|block| ToolCall {
            id: block
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            arguments: block
                .get("input")
                .map(|v| serde_json::to_string(v).unwrap_or_default())
                .unwrap_or_default(),
        })
        .collect()
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent() -> Prompty {
        let data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {"id": "claude-3", "provider": "anthropic"},
            "instructions": "test"
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    fn make_agent_with_outputs() -> Prompty {
        let data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {"id": "claude-3", "provider": "anthropic"},
            "instructions": "test",
            "outputs": [
                {"name": "city", "kind": "string"},
                {"name": "temp", "kind": "integer"}
            ]
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[tokio::test]
    async fn test_process_text_response() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_01",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [{"type": "text", "text": "Hello!"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 3}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        assert_eq!(result, "Hello!");
    }

    #[tokio::test]
    async fn test_process_tool_use_response() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_02",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [{
                "type": "tool_use",
                "id": "toolu_1",
                "name": "get_weather",
                "input": {"city": "Paris"}
            }],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 25, "output_tokens": 20}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        let calls = result.as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "toolu_1");
        assert_eq!(calls[0]["name"], "get_weather");
        assert_eq!(calls[0]["arguments"], r#"{"city":"Paris"}"#);
    }

    #[tokio::test]
    async fn test_process_multiple_text_blocks() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_03",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [
                {"type": "text", "text": "Here is the answer:"},
                {"type": "text", "text": " The weather in Paris is sunny."}
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 15, "output_tokens": 12}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        assert_eq!(result, "Here is the answer: The weather in Paris is sunny.");
    }

    #[tokio::test]
    async fn test_process_structured_output() {
        let agent = make_agent_with_outputs();
        let response = json!({
            "id": "msg-struct",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "{\"city\": \"Paris\", \"temp\": 22}"}],
            "model": "claude-sonnet-4-20250514",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 20, "output_tokens": 10}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        assert_eq!(result["city"], "Paris");
        assert_eq!(result["temp"], 22);
    }

    #[test]
    fn test_extract_tool_calls() {
        let response = json!({
            "content": [
                {"type": "text", "text": "Let me check..."},
                {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Paris"}},
                {"type": "tool_use", "id": "toolu_2", "name": "get_time", "input": {"city": "Paris"}}
            ]
        });
        let calls = extract_tool_calls(&response);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "get_weather");
        assert_eq!(calls[1].name, "get_time");
    }

    #[test]
    fn test_extract_tool_calls_no_tools() {
        let response = json!({
            "content": [{"type": "text", "text": "Hello!"}]
        });
        let calls = extract_tool_calls(&response);
        assert!(calls.is_empty());
    }

    #[tokio::test]
    async fn test_tool_use_priority_over_text() {
        let agent = make_agent();
        let response = json!({
            "id": "msg_mixed",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-4-20250514",
            "content": [
                {"type": "text", "text": "Let me help you..."},
                {"type": "tool_use", "id": "toolu_1", "name": "search", "input": {"q": "rust"}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 30, "output_tokens": 25}
        });

        let result = AnthropicProcessor.process(&agent, response).await.unwrap();
        // Tool calls take priority
        assert!(result.is_array());
        assert_eq!(result.as_array().unwrap()[0]["name"], "search");
    }
}
