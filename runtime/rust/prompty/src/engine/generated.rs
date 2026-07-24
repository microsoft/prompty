//! Bridge generated live-invocation contracts into the durable Rust turn engine.
//!
//! The generated models are the public, cross-runtime provider boundary. The
//! engine keeps separate serde-backed records for checkpoints and reconciliation.

use std::sync::Arc;

use async_trait::async_trait;

use super::{
    CancellationToken, ModelInvocationRequest, ModelInvocationResponse, ModelPort, ModelStreamPort,
    PortError,
};
use crate::model::{
    InvocationUsage, ModelInvocationResponse as GeneratedResponse, ModelToolRequest,
};
use crate::types::Usage;

/// Live provider port whose request and response surfaces are generated from TypeSpec.
#[async_trait]
pub trait GeneratedModelPort: Send + Sync {
    /// Invoke the provider using the cross-runtime live-invocation contract.
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
        stream: &dyn ModelStreamPort,
    ) -> Result<GeneratedResponse, PortError>;
}

/// Adapts a generated provider port to the Rust engine's checkpoint-aware records.
pub struct GeneratedModelPortAdapter<P> {
    inner: Arc<P>,
}

impl<P> GeneratedModelPortAdapter<P> {
    /// Create an engine adapter for a generated provider port.
    pub fn new(inner: Arc<P>) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl<P> ModelPort for GeneratedModelPortAdapter<P>
where
    P: GeneratedModelPort,
{
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
        stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        // The engine's invocation request is now the generated cross-runtime
        // contract, so it crosses the provider boundary without a bridge.
        let response = self.inner.invoke(request, cancellation, stream).await?;
        engine_response(response)
    }
}

fn engine_response(response: GeneratedResponse) -> Result<ModelInvocationResponse, PortError> {
    let GeneratedResponse {
        output,
        usage,
        assistant_messages,
        tool_requests,
        next_context_state,
        metadata,
    } = response;
    let (next_portability, delegated_state) = next_context_state
        .map(|state| (Some(state.portability), Some(state.delegated_state)))
        .unwrap_or((None, None));

    Ok(ModelInvocationResponse {
        output,
        usage: usage.map(engine_usage).transpose()?,
        assistant_messages,
        tool_requests: tool_requests.into_iter().map(engine_tool_request).collect(),
        next_portability,
        delegated_state,
        metadata,
    })
}

fn engine_usage(usage: InvocationUsage) -> Result<Usage, PortError> {
    Ok(Usage {
        input_tokens: u64::try_from(usage.input_tokens)
            .map_err(|_| PortError::configuration("usage inputTokens cannot be negative"))?,
        output_tokens: u64::try_from(usage.output_tokens)
            .map_err(|_| PortError::configuration("usage outputTokens cannot be negative"))?,
        total_tokens: u64::try_from(usage.total_tokens)
            .map_err(|_| PortError::configuration("usage totalTokens cannot be negative"))?,
    })
}

fn engine_tool_request(request: ModelToolRequest) -> super::EngineToolRequest {
    super::EngineToolRequest {
        id: request.id,
        name: request.name,
        arguments: request.arguments.unwrap_or(serde_json::Value::Null),
        metadata: request.metadata,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn converts_generated_response_for_checkpointing() {
        let response = GeneratedResponse {
            output: Some(json!("done")),
            usage: Some(InvocationUsage {
                input_tokens: 12,
                output_tokens: 3,
                total_tokens: 15,
            }),
            assistant_messages: Vec::new(),
            tool_requests: vec![ModelToolRequest {
                id: "call_1".to_string(),
                name: "inspect".to_string(),
                arguments: Some(json!({ "path": "src" })),
                metadata: json!({ "provider": "test" }),
            }],
            next_context_state: Some(crate::model::InvocationContextState {
                portability: crate::model::InvocationContextPortability::Delegated,
                delegated_state: vec![crate::model::DelegatedStateReference {
                    provider: "openai".to_string(),
                    kind: "response".to_string(),
                    id: "resp_1".to_string(),
                    metadata: serde_json::Value::Null,
                }],
            }),
            metadata: serde_json::Value::Null,
        };

        let converted = engine_response(response).expect("generated response should be valid");

        assert_eq!(converted.usage.expect("usage").total_tokens, 15);
        assert_eq!(converted.tool_requests[0].arguments["path"], "src");
        assert_eq!(
            converted.next_portability,
            Some(crate::model::InvocationContextPortability::Delegated)
        );
        assert_eq!(
            converted.delegated_state.expect("delegated state")[0].id,
            "resp_1"
        );
    }

    #[test]
    fn rejects_negative_generated_usage() {
        let error = engine_usage(InvocationUsage {
            input_tokens: -1,
            output_tokens: 0,
            total_tokens: 0,
        })
        .expect_err("negative usage must not enter durable engine state");

        assert!(error.configuration_error);
    }
}
