//! Foundry/Azure OpenAI processor — delegates to the OpenAI processor.
//!
//! Azure OpenAI uses the same response format as OpenAI, so we reuse
//! the OpenAI processor's `process_response` function directly.

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{InvokerError, Processor};
use prompty::model::Prompty;

/// Foundry/Azure OpenAI processor implementing the `Processor` trait.
///
/// Delegates entirely to the OpenAI processor since Azure OpenAI
/// returns the same response format.
pub struct FoundryProcessor;

#[async_trait]
impl Processor for FoundryProcessor {
    async fn process(
        &self,
        agent: &Prompty,
        response: Value,
    ) -> Result<Value, InvokerError> {
        prompty_openai::process_response(agent, &response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent() -> Prompty {
        let data = json!({
            "name": "test",
            "kind": "prompt",
            "model": {
                "id": "gpt-4",
                "connection": {
                    "kind": "key",
                    "endpoint": "https://myresource.openai.azure.com",
                    "apiKey": "test-key"
                }
            },
            "instructions": "test"
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[tokio::test]
    async fn test_process_chat_response() {
        let agent = make_agent();
        let response = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello from Azure!"
                },
                "finish_reason": "stop"
            }]
        });

        let result = FoundryProcessor.process(&agent, response).await.unwrap();
        assert_eq!(result, "Hello from Azure!");
    }

    #[tokio::test]
    async fn test_process_embedding_response() {
        let agent = make_agent();
        let response = json!({
            "object": "list",
            "data": [
                {"object": "embedding", "embedding": [0.1, 0.2, 0.3], "index": 0}
            ]
        });

        let result = FoundryProcessor.process(&agent, response).await.unwrap();
        assert!(result.is_array());
    }
}
