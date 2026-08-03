//! Public live-turn behavior tests for output validation, retries, and result shape.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use prompty::interfaces::{Executor, InvokerError, Processor};
use prompty::model::context::LoadContext;
use prompty::model::{ModelInvocationRequest, Prompty};
use prompty::structured::to_structured_value;
use prompty::types::{Message, StreamChunk};
use prompty::{
    DurabilityPort, EngineEvent, EngineEventKind, PortError, TurnOptions, register_defaults,
    register_executor, register_processor, turn,
};
use serde_json::{Value, json};
use tokio::sync::Notify;

#[derive(Default)]
struct RecordingDurability {
    events: Mutex<Vec<EngineEvent>>,
}

#[async_trait]
impl DurabilityPort for RecordingDurability {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        self.events
            .lock()
            .expect("event lock poisoned")
            .push(event.clone());
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        _checkpoint: &prompty::EngineCheckpoint,
    ) -> Result<(), PortError> {
        self.events
            .lock()
            .expect("event lock poisoned")
            .extend_from_slice(events);
        Ok(())
    }
}

struct ScriptedExecutor {
    responses: Mutex<VecDeque<Result<Value, String>>>,
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl Executor for ScriptedExecutor {
    async fn execute(
        &self,
        _agent: &Prompty,
        _messages: &[Message],
    ) -> Result<Value, InvokerError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.responses
            .lock()
            .expect("response lock poisoned")
            .pop_front()
            .unwrap_or_else(|| Err("executor ran out of scripted responses".to_string()))
            .map_err(|message| InvokerError::Execute(message.into()))
    }
}

struct ContentProcessor;

#[async_trait]
impl Processor for ContentProcessor {
    async fn process(&self, _agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        Ok(response["choices"][0]["message"]["content"].clone())
    }
}

struct StructuredProcessor;

#[async_trait]
impl Processor for StructuredProcessor {
    async fn process(&self, _agent: &Prompty, _response: Value) -> Result<Value, InvokerError> {
        Ok(to_structured_value(&prompty::create_structured_result(
            json!({"city": "Paris", "country": "France"}),
            r#"{"city":"Paris","country":"France"}"#.to_string(),
        )))
    }
}

struct PendingAfterOpenStreamExecutor {
    opened: Arc<Notify>,
}

#[async_trait]
impl Executor for PendingAfterOpenStreamExecutor {
    async fn execute(
        &self,
        _agent: &Prompty,
        _messages: &[Message],
    ) -> Result<Value, InvokerError> {
        unreachable!("the test exercises the streaming path")
    }

    async fn execute_stream_with_context(
        &self,
        _agent: &Prompty,
        _request: &ModelInvocationRequest,
        _cancellation: &prompty::CancellationToken,
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        self.opened.notify_one();
        Ok(Box::pin(futures::stream::pending()))
    }
}

struct PendingStreamProcessor;

#[async_trait]
impl Processor for PendingStreamProcessor {
    async fn process(&self, _agent: &Prompty, _response: Value) -> Result<Value, InvokerError> {
        unreachable!("the test exercises the streaming path")
    }

    fn process_stream(
        &self,
        inner: std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = StreamChunk> + Send>>, InvokerError>
    {
        Ok(Box::pin(inner.map(|_| {
            StreamChunk::Text("unexpected stream item".to_string())
        })))
    }
}

fn agent(provider: &str) -> Prompty {
    Prompty::load_from_value(
        &json!({
            "kind": "prompt",
            "name": "live-turn-execution",
            "model": { "id": "test-model", "provider": provider },
            "instructions": "system:\nYou are a test assistant.\n\nuser:\nHello",
        }),
        &LoadContext::default(),
    )
}

fn completion(content: &str) -> Value {
    json!({ "choices": [{ "message": { "content": content } }] })
}

#[tokio::test]
async fn public_turn_validates_unwrapped_output_and_commits_rejection() {
    register_defaults();
    let provider = "live_turn_validator";
    let calls = Arc::new(AtomicUsize::new(0));
    register_executor(
        provider,
        ScriptedExecutor {
            responses: Mutex::new(VecDeque::from([Ok(completion("ignored"))])),
            calls: calls.clone(),
        },
    );
    register_processor(provider, StructuredProcessor);

    let durability = Arc::new(RecordingDurability::default());
    let error = turn(
        &agent(provider),
        None,
        Some(
            TurnOptions::builder()
                .durability(durability.clone())
                .validator(Box::new(|output| {
                    if output == &json!({"city": "Paris", "country": "France"}) {
                        Err("destination is not allowed".to_string())
                    } else {
                        Err(format!("validator received unexpected output: {output}"))
                    }
                }))
                .build(),
        ),
    )
    .await
    .expect_err("validator rejection must fail the turn");

    assert!(
        matches!(error, InvokerError::Validation(message) if message.contains("destination is not allowed"))
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let events = durability.events.lock().expect("event lock poisoned");
    assert!(events.iter().any(|event| {
        event.kind == EngineEventKind::Turn_failed
            && event
                .payload
                .as_ref()
                .map(|p| p["output"]["errorKind"] == "output_validation_failed")
                .unwrap_or(false)
    }));
    assert!(
        !events
            .iter()
            .any(|event| event.kind == EngineEventKind::Turn_committed)
    );
}

#[tokio::test]
async fn public_turn_unwraps_structured_output() {
    register_defaults();
    let provider = "live_turn_unwrapped_structured";
    register_executor(
        provider,
        ScriptedExecutor {
            responses: Mutex::new(VecDeque::from([Ok(completion("ignored"))])),
            calls: Arc::new(AtomicUsize::new(0)),
        },
    );
    register_processor(provider, StructuredProcessor);

    let result = turn(&agent(provider), None, None)
        .await
        .expect("structured turn should succeed");

    assert_eq!(result, json!({"city": "Paris", "country": "France"}));
    assert!(result.get("__prompty_structured").is_none());
}

#[tokio::test]
async fn public_turn_retries_non_agent_model_and_succeeds() {
    register_defaults();
    let provider = "live_turn_retry_success";
    let calls = Arc::new(AtomicUsize::new(0));
    register_executor(
        provider,
        ScriptedExecutor {
            responses: Mutex::new(VecDeque::from([
                Err("transient provider failure".to_string()),
                Ok(completion("recovered")),
            ])),
            calls: calls.clone(),
        },
    );
    register_processor(provider, ContentProcessor);

    let result = turn(
        &agent(provider),
        None,
        Some(TurnOptions::builder().max_llm_retries(2).build()),
    )
    .await
    .expect("second model attempt should succeed");

    assert_eq!(result, json!("recovered"));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn public_turn_reports_non_agent_retry_exhaustion() {
    register_defaults();
    let provider = "live_turn_retry_exhaustion";
    let calls = Arc::new(AtomicUsize::new(0));
    register_executor(
        provider,
        ScriptedExecutor {
            responses: Mutex::new(VecDeque::from([
                Err("persistent provider failure".to_string()),
                Err("persistent provider failure".to_string()),
            ])),
            calls: calls.clone(),
        },
    );
    register_processor(provider, ContentProcessor);

    let error = turn(
        &agent(provider),
        None,
        Some(TurnOptions::builder().max_llm_retries(2).build()),
    )
    .await
    .expect_err("all configured model attempts should be exhausted");

    assert!(matches!(error, InvokerError::ExecuteRetryExhausted(_)));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn public_streaming_turn_cancels_after_open_and_persists_terminal_event() {
    register_defaults();
    let provider = "live_turn_pending_stream_cancel";
    let opened = Arc::new(Notify::new());
    register_executor(
        provider,
        PendingAfterOpenStreamExecutor {
            opened: opened.clone(),
        },
    );
    register_processor(provider, PendingStreamProcessor);

    let cancelled = Arc::new(AtomicBool::new(false));
    let cancellation_task = {
        let opened = opened.clone();
        let cancelled = cancelled.clone();
        tokio::spawn(async move {
            opened.notified().await;
            cancelled.store(true, Ordering::Release);
        })
    };
    let durability = Arc::new(RecordingDurability::default());
    let mut streaming_agent = agent(provider);
    streaming_agent.model.options = Some(prompty::model::ModelOptions::load_from_value(
        &json!({"additionalProperties": {"stream": true}}),
        &LoadContext::default(),
    ));

    let result = tokio::time::timeout(
        Duration::from_millis(500),
        turn(
            &streaming_agent,
            None,
            Some(
                TurnOptions::builder()
                    .cancelled(cancelled)
                    .durability(durability.clone())
                    .build(),
            ),
        ),
    )
    .await
    .expect("post-open cancellation must not leave stream polling pending");
    cancellation_task
        .await
        .expect("cancellation task should complete");

    assert!(matches!(result, Err(InvokerError::Cancelled(_))));
    assert!(
        durability
            .events
            .lock()
            .expect("event lock poisoned")
            .iter()
            .any(|event| event.kind == EngineEventKind::Turn_cancelled),
        "durability must record the TurnCancelled terminal state"
    );
}
