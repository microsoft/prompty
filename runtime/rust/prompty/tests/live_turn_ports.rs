//! Public live-turn tests for host-owned canonical engine ports.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use prompty::interfaces::{Executor, InvokerError, Processor};
use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use prompty::types::Message;
use prompty::{
    CancellationToken, DurabilityPort, EngineCheckpoint, EngineEvent, EngineEventKind,
    EnginePermissionDecision, EngineToolRequest, PermissionPort, PortError, PostCommitPort,
    ToolHandler, ToolOutcome, TurnCommit, TurnEngineRequest, TurnOptions, TurnStatus,
    register_defaults, register_executor, register_processor, turn_with_engine_request,
};
use serde_json::{Value, json};

#[derive(Default)]
struct RecordingDurability {
    events: Mutex<Vec<EngineEvent>>,
    checkpoints: Mutex<Vec<EngineCheckpoint>>,
}

#[async_trait]
impl DurabilityPort for RecordingDurability {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        self.events
            .lock()
            .expect("events lock poisoned")
            .push(event.clone());
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        self.events
            .lock()
            .expect("events lock poisoned")
            .extend_from_slice(events);
        self.checkpoints
            .lock()
            .expect("checkpoints lock poisoned")
            .push(checkpoint.clone());
        Ok(())
    }
}

struct ScriptedExecutor {
    responses: Mutex<VecDeque<Value>>,
    observed_messages: Arc<Mutex<Vec<Vec<Message>>>>,
}

#[async_trait]
impl Executor for ScriptedExecutor {
    async fn execute(&self, _agent: &Prompty, messages: &[Message]) -> Result<Value, InvokerError> {
        self.observed_messages
            .lock()
            .expect("messages lock poisoned")
            .push(messages.to_vec());
        self.responses
            .lock()
            .expect("responses lock poisoned")
            .pop_front()
            .ok_or_else(|| {
                InvokerError::Other("scripted executor ran out of responses".to_string())
            })
    }
}

struct ToolCallProcessor;

#[async_trait]
impl Processor for ToolCallProcessor {
    async fn process(&self, _agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        let message = &response["choices"][0]["message"];
        if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
            if !tool_calls.is_empty() {
                return Ok(Value::Array(
                    tool_calls
                        .iter()
                        .map(|tool_call| {
                            json!({
                                "id": tool_call["id"],
                                "name": tool_call["function"]["name"],
                                "arguments": tool_call["function"]["arguments"],
                            })
                        })
                        .collect(),
                ));
            }
        }

        Ok(message["content"].clone())
    }
}

struct DenyWeather;

#[async_trait]
impl PermissionPort for DenyWeather {
    async fn authorize(
        &self,
        _request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        Ok(EnginePermissionDecision {
            approved: false,
            reason: Some("host policy denied weather access".to_string()),
            metadata: json!({ "errorKind": "host_policy_denied" }),
        })
    }
}

struct RecordingPostCommit {
    commits: Arc<Mutex<Vec<(TurnCommit, bool)>>>,
    fail: bool,
}

#[async_trait]
impl PostCommitPort for RecordingPostCommit {
    async fn after_commit(
        &self,
        _effect_id: &str,
        commit: &TurnCommit,
        cancellation: &CancellationToken,
    ) -> Result<(), PortError> {
        self.commits
            .lock()
            .expect("post-commit lock poisoned")
            .push((commit.clone(), cancellation.is_cancelled()));
        if self.fail {
            Err(PortError::new("injected post-commit failure"))
        } else {
            Ok(())
        }
    }
}

fn agent(provider: &str) -> Prompty {
    Prompty::load_from_value(
        &json!({
            "kind": "prompt",
            "name": "live-port-test",
            "model": { "id": "test-model", "provider": provider },
            "instructions": "system:\nYou are a test assistant.\n\nuser:\nHello",
        }),
        &LoadContext::default(),
    )
}

fn request(turn_id: &str) -> TurnEngineRequest {
    let mut request = TurnEngineRequest::new("live-port-session", turn_id, Vec::new());
    request.inputs = json!({});
    request
}

fn tool_response() -> Value {
    json!({
        "choices": [{
            "message": {
                "tool_calls": [{
                    "id": "weather-call",
                    "type": "function",
                    "function": { "name": "get_weather", "arguments": "{\"city\":\"Seattle\"}" },
                }],
            },
        }],
    })
}

fn text_response(text: &str) -> Value {
    json!({ "choices": [{ "message": { "content": text } }] })
}

fn event_position(events: &[EngineEvent], kind: EngineEventKind) -> usize {
    events
        .iter()
        .position(|event| event.kind == kind)
        .unwrap_or_else(|| panic!("missing {kind:?} in {events:?}"))
}

#[tokio::test]
async fn turn_with_engine_request_uses_host_permission_and_persists_denial() {
    register_defaults();
    let provider = "live_turn_host_permission";
    let observed_messages = Arc::new(Mutex::new(Vec::new()));
    register_executor(
        provider,
        ScriptedExecutor {
            responses: Mutex::new(VecDeque::from([
                tool_response(),
                text_response("denial was shown to the model"),
            ])),
            observed_messages: observed_messages.clone(),
        },
    );
    register_processor(provider, ToolCallProcessor);

    let durability = Arc::new(RecordingDurability::default());
    let mut tools = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(|_| Ok("tool must not execute".to_string()))),
    );
    let result = turn_with_engine_request(
        &agent(provider),
        request("host-permission-denial"),
        Some(
            TurnOptions::builder()
                .tools(tools)
                .permission(Arc::new(DenyWeather))
                .durability(durability.clone())
                .build(),
        ),
    )
    .await
    .expect("a denied tool result remains visible to the model");

    assert_eq!(result, json!("denial was shown to the model"));
    assert!(
        observed_messages
            .lock()
            .expect("messages lock poisoned")
            .iter()
            .flatten()
            .any(|message| message.text_content() == "host policy denied weather access")
    );

    let events = durability.events.lock().expect("events lock poisoned");
    assert!(
        event_position(&events, EngineEventKind::PermissionRequested)
            < event_position(&events, EngineEventKind::PermissionResolved)
    );
    assert!(
        event_position(&events, EngineEventKind::PermissionResolved)
            < event_position(&events, EngineEventKind::ToolExecutionCompleted)
    );
    drop(events);

    let checkpoints = durability
        .checkpoints
        .lock()
        .expect("checkpoints lock poisoned");
    assert!(checkpoints.iter().any(|checkpoint| {
        checkpoint.completed_tool_results.iter().any(|tool_result| {
            tool_result.outcome == ToolOutcome::Failed
                && tool_result.error_kind.as_deref() == Some("host_policy_denied")
                && tool_result.output == json!("host policy denied weather access")
        })
    }));
}

async fn assert_post_commit_hook(fail: bool, expected_terminal_event: EngineEventKind) {
    register_defaults();
    let provider = if fail {
        "live_turn_post_commit_failure"
    } else {
        "live_turn_post_commit_success"
    };
    let commits = Arc::new(Mutex::new(Vec::new()));
    register_executor(
        provider,
        ScriptedExecutor {
            responses: Mutex::new(VecDeque::from([text_response("committed output")])),
            observed_messages: Arc::new(Mutex::new(Vec::new())),
        },
    );
    register_processor(provider, ToolCallProcessor);

    let durability = Arc::new(RecordingDurability::default());
    let result = turn_with_engine_request(
        &agent(provider),
        request(provider),
        Some(
            TurnOptions::builder()
                .durability(durability.clone())
                .post_commit(Arc::new(RecordingPostCommit {
                    commits: commits.clone(),
                    fail,
                }))
                .build(),
        ),
    )
    .await;

    assert_eq!(
        result.expect("post-commit failure must not revoke a successful turn"),
        json!("committed output")
    );
    let commits = commits.lock().expect("post-commit lock poisoned");
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].0.status, TurnStatus::Success);
    assert_eq!(commits[0].0.output, Some(json!("committed output")));
    assert!(
        !commits[0].1,
        "the hook receives the turn cancellation token"
    );
    drop(commits);

    let events = durability.events.lock().expect("events lock poisoned");
    assert!(
        event_position(&events, EngineEventKind::TurnCommitted)
            < event_position(&events, EngineEventKind::PostCommitStarted)
    );
    assert!(
        event_position(&events, EngineEventKind::PostCommitStarted)
            < event_position(&events, expected_terminal_event)
    );
}

#[tokio::test]
async fn turn_with_engine_request_runs_supplied_post_commit_hook() {
    assert_post_commit_hook(false, EngineEventKind::PostCommitCompleted).await;
}

#[tokio::test]
async fn turn_with_engine_request_keeps_success_after_post_commit_failure() {
    assert_post_commit_hook(true, EngineEventKind::PostCommitFailed).await;
}
