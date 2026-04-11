//! Guardrails — input, output, and tool guardrails for the agent loop.
//!
//! Matches TypeScript `core/guardrails.ts`. Guardrails are optional hooks
//! that run before/after LLM calls and tool dispatch to enforce policies.

use crate::model::Prompty;
use crate::types::Message;

// ---------------------------------------------------------------------------
// GuardrailResult
// ---------------------------------------------------------------------------

/// The result of a guardrail check.
#[derive(Debug, Clone)]
pub struct GuardrailResult {
    /// Whether the operation is allowed.
    pub allowed: bool,
    /// Reason for denial (if `allowed == false`).
    pub reason: Option<String>,
    /// Optional rewrite of the input/output.
    pub rewrite: Option<serde_json::Value>,
}

impl GuardrailResult {
    /// Create an "allowed" result.
    pub fn allow() -> Self {
        Self {
            allowed: true,
            reason: None,
            rewrite: None,
        }
    }

    /// Create a "denied" result with a reason.
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            reason: Some(reason.into()),
            rewrite: None,
        }
    }

    /// Create an "allowed with rewrite" result.
    pub fn rewrite(rewrite: serde_json::Value) -> Self {
        Self {
            allowed: true,
            reason: None,
            rewrite: Some(rewrite),
        }
    }
}

// ---------------------------------------------------------------------------
// GuardrailError
// ---------------------------------------------------------------------------

/// Error thrown when a guardrail denies an operation.
#[derive(Debug, thiserror::Error)]
#[error("Guardrail denied: {reason}")]
pub struct GuardrailError {
    /// The reason for denial.
    pub reason: String,
    /// Which guardrail phase triggered the error.
    pub phase: GuardrailPhase,
}

/// Which phase the guardrail triggered in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardrailPhase {
    Input,
    Output,
    Tool,
}

// ---------------------------------------------------------------------------
// Guardrail function types
// ---------------------------------------------------------------------------

/// Input guardrail: checks messages before they're sent to the LLM.
pub type InputGuardrail = Box<
    dyn Fn(
            &[Message],
            &Prompty,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = GuardrailResult> + Send>>
        + Send
        + Sync,
>;

/// Output guardrail: checks the LLM response before returning.
pub type OutputGuardrail = Box<
    dyn Fn(
            &serde_json::Value,
            &Prompty,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = GuardrailResult> + Send>>
        + Send
        + Sync,
>;

/// Tool guardrail: checks before executing a tool call.
pub type ToolGuardrail = Box<
    dyn Fn(
            &str,
            &serde_json::Value,
            &Prompty,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = GuardrailResult> + Send>>
        + Send
        + Sync,
>;

// ---------------------------------------------------------------------------
// Guardrails config
// ---------------------------------------------------------------------------

/// Guardrail configuration for the agent loop.
///
/// All fields are optional — missing guardrails default to "allowed".
pub struct Guardrails {
    /// Checked before each LLM call.
    pub input: Option<InputGuardrail>,
    /// Checked after the final response (no more tool calls).
    pub output: Option<OutputGuardrail>,
    /// Checked before each tool execution.
    pub tool: Option<ToolGuardrail>,
}

impl Default for Guardrails {
    fn default() -> Self {
        Self {
            input: None,
            output: None,
            tool: None,
        }
    }
}

impl Guardrails {
    /// Run the input guardrail. Returns `GuardrailResult::allow()` if no guardrail is set.
    pub async fn check_input(&self, messages: &[Message], agent: &Prompty) -> GuardrailResult {
        match &self.input {
            Some(g) => g(messages, agent).await,
            None => GuardrailResult::allow(),
        }
    }

    /// Run the output guardrail. Returns `GuardrailResult::allow()` if no guardrail is set.
    pub async fn check_output(
        &self,
        response: &serde_json::Value,
        agent: &Prompty,
    ) -> GuardrailResult {
        match &self.output {
            Some(g) => g(response, agent).await,
            None => GuardrailResult::allow(),
        }
    }

    /// Run the tool guardrail. Returns `GuardrailResult::allow()` if no guardrail is set.
    pub async fn check_tool(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        agent: &Prompty,
    ) -> GuardrailResult {
        match &self.tool {
            Some(g) => g(tool_name, args, agent).await,
            None => GuardrailResult::allow(),
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Role;

    fn default_agent() -> Prompty {
        Prompty::default()
    }

    #[tokio::test]
    async fn test_no_guardrails_allow() {
        let g = Guardrails::default();
        let msgs = vec![Message::text(Role::User, "hello")];
        let result = g.check_input(&msgs, &default_agent()).await;
        assert!(result.allowed);
    }

    #[tokio::test]
    async fn test_input_guardrail_deny() {
        let g = Guardrails {
            input: Some(Box::new(|_msgs, _agent| {
                Box::pin(async { GuardrailResult::deny("PII detected") })
            })),
            ..Default::default()
        };
        let msgs = vec![Message::text(Role::User, "my SSN is 123-45-6789")];
        let result = g.check_input(&msgs, &default_agent()).await;
        assert!(!result.allowed);
        assert_eq!(result.reason.unwrap(), "PII detected");
    }

    #[tokio::test]
    async fn test_output_guardrail_allow() {
        let g = Guardrails {
            output: Some(Box::new(|_response, _agent| {
                Box::pin(async { GuardrailResult::allow() })
            })),
            ..Default::default()
        };
        let response = serde_json::json!("safe response");
        let result = g.check_output(&response, &default_agent()).await;
        assert!(result.allowed);
    }

    #[tokio::test]
    async fn test_tool_guardrail_deny() {
        let g = Guardrails {
            tool: Some(Box::new(|tool_name, _args, _agent| {
                let denied = tool_name == "dangerous_tool";
                Box::pin(async move {
                    if denied {
                        GuardrailResult::deny("Dangerous tool blocked")
                    } else {
                        GuardrailResult::allow()
                    }
                })
            })),
            ..Default::default()
        };
        let result = g
            .check_tool("dangerous_tool", &serde_json::json!({}), &default_agent())
            .await;
        assert!(!result.allowed);

        let result = g
            .check_tool("safe_tool", &serde_json::json!({}), &default_agent())
            .await;
        assert!(result.allowed);
    }

    #[tokio::test]
    async fn test_input_guardrail_rewrite() {
        let g = Guardrails {
            input: Some(Box::new(|_msgs, _agent| {
                Box::pin(async { GuardrailResult::rewrite(serde_json::json!("rewritten")) })
            })),
            ..Default::default()
        };
        let result = g
            .check_input(&[Message::text(Role::User, "hi")], &default_agent())
            .await;
        assert!(result.allowed);
        assert!(result.rewrite.is_some());
    }

    #[test]
    fn test_guardrail_error() {
        let err = GuardrailError {
            reason: "Policy violation".into(),
            phase: GuardrailPhase::Input,
        };
        assert_eq!(err.to_string(), "Guardrail denied: Policy violation");
        assert_eq!(err.phase, GuardrailPhase::Input);
    }
}
