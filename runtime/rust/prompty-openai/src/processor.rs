//! OpenAI processor — extracts results from OpenAI API responses.
//!
//! Handles chat completions, embeddings, and image generation responses.

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{InvokerError, Processor};
use prompty::model::Prompty;
use prompty::types::ToolCall;

/// OpenAI processor implementing the `Processor` trait.
pub struct OpenAIProcessor;

#[async_trait]
impl Processor for OpenAIProcessor {
    async fn process(
        &self,
        agent: &Prompty,
        response: Value,
    ) -> Result<Value, InvokerError> {
        process_response(agent, &response)
    }
}

/// Process an OpenAI API response, dispatching by response shape.
pub fn process_response(agent: &Prompty, response: &Value) -> Result<Value, InvokerError> {
    // ChatCompletion — has "choices"
    if let Some(choices) = response.get("choices").and_then(Value::as_array) {
        return process_chat_completion(agent, choices);
    }

    // Embedding — has "data" and "object" == "list"
    if response.get("object").and_then(Value::as_str) == Some("list") {
        if let Some(data) = response.get("data").and_then(Value::as_array) {
            return process_embedding(data);
        }
    }

    // Image — has "data" array with url/b64_json
    if let Some(data) = response.get("data").and_then(Value::as_array) {
        if data.iter().any(|d| d.get("url").is_some() || d.get("b64_json").is_some()) {
            return process_image(data);
        }
    }

    // Unknown response shape — return as-is
    Ok(response.clone())
}

// ---------------------------------------------------------------------------
// Chat completion
// ---------------------------------------------------------------------------

fn process_chat_completion(agent: &Prompty, choices: &[Value]) -> Result<Value, InvokerError> {
    let first = choices
        .first()
        .ok_or_else(|| InvokerError::Process("Empty choices array".to_string().into()))?;

    let message = first
        .get("message")
        .ok_or_else(|| InvokerError::Process("Missing message in choice".to_string().into()))?;

    // Tool calls take priority
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        if !tool_calls.is_empty() {
            let calls: Vec<Value> = tool_calls
                .iter()
                .map(|tc| {
                    let func = tc.get("function").unwrap_or(tc);
                    serde_json::json!({
                        "id": tc.get("id").and_then(Value::as_str).unwrap_or(""),
                        "name": func.get("name").and_then(Value::as_str).unwrap_or(""),
                        "arguments": func.get("arguments").and_then(Value::as_str).unwrap_or("{}"),
                    })
                })
                .collect();
            return Ok(Value::Array(calls));
        }
    }

    // Content
    let content = message.get("content");

    // Refusal
    if content.is_none() || content == Some(&Value::Null) {
        if let Some(refusal) = message.get("refusal").and_then(Value::as_str) {
            return Ok(Value::String(refusal.to_string()));
        }
    }

    let content_str = content
        .and_then(Value::as_str)
        .unwrap_or("");

    // Structured output: if agent has outputs, parse as JSON
    if let Some(outputs) = agent.as_outputs() {
        if !outputs.is_empty() {
            let parsed: Value = serde_json::from_str(content_str).map_err(|e| {
                InvokerError::Process(format!("Failed to parse structured output: {e}").into())
            })?;
            return Ok(parsed);
        }
    }

    Ok(Value::String(content_str.to_string()))
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

fn process_embedding(data: &[Value]) -> Result<Value, InvokerError> {
    let vectors: Vec<Value> = data
        .iter()
        .filter_map(|d| d.get("embedding").cloned())
        .collect();

    if vectors.len() == 1 {
        Ok(vectors.into_iter().next().unwrap())
    } else {
        Ok(Value::Array(vectors))
    }
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

fn process_image(data: &[Value]) -> Result<Value, InvokerError> {
    let urls: Vec<Value> = data
        .iter()
        .map(|d| {
            d.get("url")
                .or_else(|| d.get("b64_json"))
                .cloned()
                .unwrap_or(Value::Null)
        })
        .collect();

    if urls.len() == 1 {
        Ok(urls.into_iter().next().unwrap())
    } else {
        Ok(Value::Array(urls))
    }
}

// ---------------------------------------------------------------------------
// Extract tool calls helper (used by pipeline)
// ---------------------------------------------------------------------------

/// Try to extract tool calls from a processed response value.
pub fn extract_tool_calls(response: &Value) -> Option<Vec<ToolCall>> {
    let arr = response.as_array()?;
    let calls: Vec<ToolCall> = arr
        .iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_str()?.to_string();
            let name = v.get("name")?.as_str()?.to_string();
            let arguments = v.get("arguments")?.as_str()?.to_string();
            Some(ToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect();
    if calls.is_empty() { None } else { Some(calls) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent(outputs_json: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {"id": "gpt-4"},
            "instructions": "test",
        });
        if !outputs_json.is_null() {
            data["outputs"] = outputs_json;
        }
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[test]
    fn test_process_chat_content() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello!"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!("Hello!"));
    }

    #[test]
    fn test_process_chat_tool_calls() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": "{\"city\":\"SF\"}"
                        }
                    }]
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        let calls = result.as_array().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["name"], "get_weather");
        assert_eq!(calls[0]["id"], "call_1");
    }

    #[test]
    fn test_process_chat_refusal() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "refusal": "I can't do that"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!("I can't do that"));
    }

    #[test]
    fn test_process_structured_output() {
        let agent = make_agent(json!([
            {"name": "answer", "kind": "string", "required": true}
        ]));
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "{\"answer\": \"42\"}"
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result["answer"], "42");
    }

    #[test]
    fn test_process_embedding_single() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "object": "list",
            "data": [{
                "object": "embedding",
                "embedding": [0.1, 0.2, 0.3]
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!([0.1, 0.2, 0.3]));
    }

    #[test]
    fn test_process_embedding_multiple() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "object": "list",
            "data": [
                {"object": "embedding", "embedding": [0.1, 0.2]},
                {"object": "embedding", "embedding": [0.3, 0.4]}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!([[0.1, 0.2], [0.3, 0.4]]));
    }

    #[test]
    fn test_process_image_single() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "data": [{"url": "https://example.com/image.png"}]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!("https://example.com/image.png"));
    }

    #[test]
    fn test_process_image_multiple() {
        let agent = make_agent(Value::Null);
        let response = json!({
            "data": [
                {"url": "https://a.png"},
                {"url": "https://b.png"}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, json!(["https://a.png", "https://b.png"]));
    }

    #[test]
    fn test_extract_tool_calls() {
        let val = json!([
            {"id": "c1", "name": "fn1", "arguments": "{}"},
            {"id": "c2", "name": "fn2", "arguments": "{\"x\":1}"}
        ]);
        let calls = extract_tool_calls(&val).unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "fn1");
        assert_eq!(calls[1].name, "fn2");
    }

    #[test]
    fn test_extract_tool_calls_not_tool_response() {
        assert!(extract_tool_calls(&json!("Hello")).is_none());
        assert!(extract_tool_calls(&json!(42)).is_none());
    }

    // -----------------------------------------------------------------------
    // Edge cases: empty choices, missing message, malformed tool calls
    // -----------------------------------------------------------------------

    #[test]
    fn test_empty_choices_error() {
        let agent = Prompty::default();
        let response = json!({
            "choices": []
        });
        let err = process_response(&agent, &response).unwrap_err();
        assert!(err.to_string().contains("Empty choices"));
    }

    #[test]
    fn test_missing_message_error() {
        let agent = Prompty::default();
        let response = json!({
            "choices": [{"finish_reason": "stop"}]
        });
        let err = process_response(&agent, &response).unwrap_err();
        assert!(err.to_string().contains("Missing message"));
    }

    #[test]
    fn test_tool_calls_with_missing_fields() {
        let agent = Prompty::default();
        // Tool calls where some entries are malformed
        let response = json!({
            "choices": [{
                "message": {
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {"name": "test", "arguments": "{}"}
                        },
                        {
                            // Missing function block — should still extract with empty defaults
                            "id": "call_2"
                        }
                    ]
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["name"], "test");
        // Malformed entry should have empty defaults
        assert_eq!(arr[1]["name"], "");
    }

    #[test]
    fn test_null_content_no_refusal() {
        let agent = Prompty::default();
        let response = json!({
            "choices": [{
                "message": {
                    "content": null
                }
            }]
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_unknown_response_shape_passthrough() {
        let agent = Prompty::default();
        let response = json!({
            "unexpected": "format",
            "custom": 42
        });
        let result = process_response(&agent, &response).unwrap();
        assert_eq!(result, response);
    }

    #[test]
    fn test_extract_tool_calls_empty_array() {
        // Empty array should return None
        assert!(extract_tool_calls(&json!([])).is_none());
    }

    #[test]
    fn test_extract_tool_calls_array_with_non_tool_objects() {
        // Array of objects without proper tool call fields
        let val = json!([{"foo": "bar"}, {"baz": 42}]);
        assert!(extract_tool_calls(&val).is_none());
    }

    #[test]
    fn test_structured_output_invalid_json() {
        // Agent with outputs, but content is not valid JSON
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "structured",
            "model": "gpt-4",
            "outputs": [{"name": "result", "kind": "object"}],
            "instructions": "Return JSON"
        });
        let agent = Prompty::load_from_value(&data, &LoadContext::default());
        let response = json!({
            "choices": [{
                "message": {
                    "content": "this is not json"
                }
            }]
        });
        let err = process_response(&agent, &response).unwrap_err();
        assert!(err.to_string().contains("structured output"));
    }

    #[test]
    fn test_embedding_multiple_vectors() {
        let agent = Prompty::default();
        let response = json!({
            "object": "list",
            "data": [
                {"embedding": [0.1, 0.2]},
                {"embedding": [0.3, 0.4]}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn test_image_multiple_urls() {
        let agent = Prompty::default();
        let response = json!({
            "data": [
                {"url": "https://a.com/1.png"},
                {"url": "https://a.com/2.png"}
            ]
        });
        let result = process_response(&agent, &response).unwrap();
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }
}
