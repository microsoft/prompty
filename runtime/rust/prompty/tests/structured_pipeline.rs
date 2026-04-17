//! Tests that `invoke()` and `run()` correctly unwrap the `__prompty_structured`
//! envelope before returning results to the caller.
//!
//! These tests use mock executor/processor pairs registered under unique keys
//! (same pattern as `agent_vectors.rs`). The mock processor wraps its output
//! in the structured envelope (simulating what `pipeline::process()` does when
//! `agent.outputs` is non-empty). `invoke()` and `run()` must call
//! `unwrap_structured()` so the caller sees clean data, not the envelope.

use async_trait::async_trait;
use serde_json::{Value, json};

use prompty::interfaces::{Executor, InvokerError, Processor};
use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use prompty::types::{Message, Role};

// ---------------------------------------------------------------------------
// MockExecutor — returns a canned chat-completion response
// ---------------------------------------------------------------------------

struct MockStructuredExecutor {
    response: Value,
}

impl MockStructuredExecutor {
    fn new(response: Value) -> Self {
        Self { response }
    }
}

#[async_trait]
impl Executor for MockStructuredExecutor {
    async fn execute(
        &self,
        _agent: &Prompty,
        _messages: &[Message],
    ) -> Result<Value, InvokerError> {
        Ok(self.response.clone())
    }
}

// ---------------------------------------------------------------------------
// MockStructuredProcessor — extracts content as parsed JSON (like a real
// processor). The pipeline's `process()` function then calls
// `wrap_structured_if_needed()` which wraps the result in the
// `__prompty_structured` envelope when the agent has `outputs`.
// `invoke()` and `run()` must then call `unwrap_structured()` to strip it.
// ---------------------------------------------------------------------------

struct MockStructuredProcessor;

#[async_trait]
impl Processor for MockStructuredProcessor {
    async fn process(&self, _agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        let content_str = response["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("{}");

        // Return parsed JSON object — the pipeline wraps this in the envelope
        let data: Value = serde_json::from_str(content_str).unwrap_or(json!(content_str));
        Ok(data)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Register mock executor + processor under a unique key.
fn register_structured_mocks(key: &str, response: Value) {
    prompty::register_executor(key, MockStructuredExecutor::new(response));
    prompty::register_processor(key, MockStructuredProcessor);
}

/// Build a Prompty agent with outputs defined (triggers structured wrapping).
fn build_structured_agent(provider_key: &str) -> Prompty {
    let data = json!({
        "name": "structured_test",
        "kind": "prompt",
        "model": {
            "id": "gpt-4",
            "provider": provider_key,
        },
        "instructions": "system:\nReturn JSON.\n\nuser:\n{{ question }}",
        "outputs": {
            "city": { "kind": "string" },
            "country": { "kind": "string" },
        },
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
    });
    Prompty::load_from_value(&data, &LoadContext::default())
}

/// Canned OpenAI-style chat completion with JSON content.
fn canned_response() -> Value {
    json!({
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": r#"{"city":"Paris","country":"France"}"#,
            },
            "finish_reason": "stop",
        }],
    })
}

/// The expected unwrapped data.
fn expected_data() -> Value {
    json!({"city": "Paris", "country": "France"})
}

// ===================================================================
// invoke() — one-shot pipeline must unwrap __prompty_structured
// ===================================================================

#[tokio::test]
async fn test_invoke_unwraps_structured_output() {
    let key = "structured_invoke_test";
    register_structured_mocks(key, canned_response());
    prompty::pipeline::register_defaults();

    let agent = build_structured_agent(key);
    let inputs = json!({"question": "What is the capital of France?"});

    let result = prompty::invoke_agent(&agent, Some(&inputs)).await.unwrap();

    // Must be the unwrapped data, NOT the __prompty_structured envelope
    assert_eq!(
        result,
        expected_data(),
        "invoke() should unwrap structured output"
    );
    assert!(
        result.get("__prompty_structured").is_none(),
        "invoke() result must not contain __prompty_structured marker"
    );
}

// ===================================================================
// run() — executor+process must unwrap __prompty_structured
// ===================================================================

#[tokio::test]
async fn test_run_unwraps_structured_output() {
    let key = "structured_run_test";
    register_structured_mocks(key, canned_response());
    prompty::pipeline::register_defaults();

    let agent = build_structured_agent(key);

    // Pre-prepare messages (what `prepare()` would produce)
    let messages = vec![
        Message::with_text(Role::System, "Return JSON."),
        Message::with_text(Role::User, "What is the capital of France?"),
    ];

    let result = prompty::run(&agent, &messages).await.unwrap();

    // Must be the unwrapped data, NOT the __prompty_structured envelope
    assert_eq!(
        result,
        expected_data(),
        "run() should unwrap structured output"
    );
    assert!(
        result.get("__prompty_structured").is_none(),
        "run() result must not contain __prompty_structured marker"
    );
}

// ===================================================================
// Sanity: non-structured output passes through unchanged
// ===================================================================

/// A processor that returns plain text (no structured wrapping).
struct MockPlainProcessor;

#[async_trait]
impl Processor for MockPlainProcessor {
    async fn process(&self, _agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        let content = response["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");
        Ok(Value::String(content.to_string()))
    }
}

#[tokio::test]
async fn test_invoke_plain_output_unchanged() {
    let key = "plain_invoke_test";
    let response = json!({
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "The capital of France is Paris.",
            },
            "finish_reason": "stop",
        }],
    });
    prompty::register_executor(key, MockStructuredExecutor::new(response));
    prompty::register_processor(key, MockPlainProcessor);
    prompty::pipeline::register_defaults();

    // Agent WITHOUT outputs — no structured wrapping expected
    let data = json!({
        "name": "plain_test",
        "kind": "prompt",
        "model": {
            "id": "gpt-4",
            "provider": key,
        },
        "instructions": "system:\nYou are helpful.\n\nuser:\n{{ question }}",
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());
    let inputs = json!({"question": "Capital of France?"});

    let result = prompty::invoke_agent(&agent, Some(&inputs)).await.unwrap();

    assert_eq!(
        result.as_str().unwrap(),
        "The capital of France is Paris.",
        "plain text should pass through unchanged"
    );
}

#[tokio::test]
async fn test_run_plain_output_unchanged() {
    let key = "plain_run_test";
    let response = json!({
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "42",
            },
            "finish_reason": "stop",
        }],
    });
    prompty::register_executor(key, MockStructuredExecutor::new(response));
    prompty::register_processor(key, MockPlainProcessor);
    prompty::pipeline::register_defaults();

    let data = json!({
        "name": "plain_run",
        "kind": "prompt",
        "model": {
            "id": "gpt-4",
            "provider": key,
        },
        "instructions": "system:\nAnswer.\n\nuser:\nWhat is 6*7?",
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" },
        },
    });
    let agent = Prompty::load_from_value(&data, &LoadContext::default());
    let messages = vec![
        Message::with_text(Role::System, "Answer."),
        Message::with_text(Role::User, "What is 6*7?"),
    ];

    let result = prompty::run(&agent, &messages).await.unwrap();
    assert_eq!(result.as_str().unwrap(), "42");
}
