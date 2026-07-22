//! Foundry/Azure OpenAI processor — delegates to the OpenAI processor.
//!
//! Azure OpenAI uses the same response format as OpenAI, so we reuse
//! the OpenAI processor's `process_response` function directly.

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{InvokerError, Processor};
use prompty::model::{ModelInvocationRequest, ModelInvocationResponse, Prompty};

/// Foundry/Azure OpenAI processor implementing the `Processor` trait.
///
/// Delegates entirely to the OpenAI processor since Azure OpenAI
/// returns the same response format.
pub struct FoundryProcessor;

#[async_trait]
impl Processor for FoundryProcessor {
    async fn process(&self, agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        prompty_openai::process_response(agent, &response)
    }

    async fn process_with_context(
        &self,
        agent: &Prompty,
        response: Value,
        _request: &ModelInvocationRequest,
    ) -> Result<ModelInvocationResponse, InvokerError> {
        // Azure OpenAI's supported endpoints do not expose a continuation handle
        // that can recreate model-visible state, so retain the canonical
        // conversation as explicitly portable context.
        prompty_openai::process_invocation_response(agent, &response, "foundry", false)
    }

    async fn process_raw_with_context(
        &self,
        agent: &Prompty,
        response: Value,
        _request: &ModelInvocationRequest,
    ) -> Result<ModelInvocationResponse, InvokerError> {
        let mut mapped =
            prompty_openai::process_invocation_response(agent, &response, "foundry", false)?;
        mapped.output = Some(response);
        mapped.tool_requests.clear();
        Ok(mapped)
    }

    fn process_stream(
        &self,
        inner: std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
    ) -> Result<
        std::pin::Pin<Box<dyn futures::Stream<Item = prompty::types::StreamChunk> + Send>>,
        InvokerError,
    > {
        // Azure uses the same SSE chunk format as OpenAI
        prompty_openai::OpenAIProcessor.process_stream(inner)
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

    #[tokio::test]
    async fn test_context_response_is_portable_without_native_continuation() {
        let agent = make_agent();
        let response = json!({
            "object": "response",
            "id": "resp_not_reusable_by_foundry",
            "output_text": "Hello"
        });

        let result = FoundryProcessor
            .process_with_context(
                &agent,
                response,
                &ModelInvocationRequest::load_from_value(&json!({}), &LoadContext::default()),
            )
            .await
            .unwrap();

        let state = result.next_context_state.expect("context state");
        assert_eq!(
            state.portability,
            prompty::model::InvocationContextPortability::Portable
        );
        assert!(state.delegated_state.is_empty());
    }
}
