use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use async_trait::async_trait;
use prompty::{
    AllowAllPermissions, AppendContextPackingStrategy, CancellationToken, Clock, ContextCandidate,
    ContextError, ContextPipeline, ContextPortability, ContextRequest, ContextSource,
    ConversationPort, DefaultConversationPort, DelegatedStateReference, DurabilityPort,
    EngineCheckpoint, EngineEvent, EngineEventKind, EnginePermissionDecision, EngineToolRequest,
    EngineToolResult, FinalOutputPolicyRequest, FinalOutputPolicyResult, HostPolicyError,
    HostPolicyPort, HostPolicyRequest, HostPolicyResult, IdGenerator, InvocationContextState,
    Message, ModelInvocationRequest, ModelInvocationResponse, ModelPort, ModelStreamChunk,
    ModelStreamPort, NoopDurabilityPort, NoopHostPolicyPort, NoopModelStreamPort,
    NoopPostCommitPort, NoopRetryPolicyPort, PermissionPort, PortError, PostCommitPort,
    RetryPolicyError, RetryPolicyPort, RetryPolicyRequest, Role, ToolOutcome, ToolPort, TurnCommit,
    TurnEngine, TurnEngineEffects, TurnEngineError, TurnEngineRequest, TurnStatus,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFile {
    version: String,
    cases: Vec<TurnVector>,
}

struct IndeterminateTools;

#[async_trait]
impl ToolPort for IndeterminateTools {
    async fn execute(
        &self,
        _request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError> {
        Err(PortError::indeterminate(
            "connection dropped after dispatch",
        ))
    }
}

struct UnknownTools;

#[async_trait]
impl ToolPort for UnknownTools {
    async fn execute(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError> {
        Err(PortError::configuration(format!(
            "unknown tool '{}'",
            request.name
        )))
    }
}

#[derive(Default)]
struct RecordingStream(Mutex<Vec<ModelStreamChunk>>);

#[async_trait]
impl ModelStreamPort for RecordingStream {
    async fn emit(&self, chunk: ModelStreamChunk) {
        self.0.lock().unwrap().push(chunk);
    }
}

struct StreamingModel;

#[async_trait]
impl ModelPort for StreamingModel {
    async fn invoke(
        &self,
        _request: &ModelInvocationRequest,
        _cancellation: &CancellationToken,
        stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        stream
            .emit(ModelStreamChunk::Text("hello".to_string()))
            .await;
        Ok(ModelInvocationResponse {
            output: Some(Value::String("hello".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        })
    }
}

struct CancellingModel;

#[async_trait]
impl ModelPort for CancellingModel {
    async fn invoke(
        &self,
        _request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
        _stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        cancellation.cancel();
        Ok(ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "should-not-run".to_string(),
                name: "echo".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        })
    }
}

struct CancellingFinalModel;

#[async_trait]
impl ModelPort for CancellingFinalModel {
    async fn invoke(
        &self,
        _request: &ModelInvocationRequest,
        cancellation: &CancellationToken,
        _stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        cancellation.cancel();
        Ok(ModelInvocationResponse {
            output: Some(Value::String("must not commit".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        })
    }
}

struct IndeterminateModel {
    calls: AtomicU64,
}

#[async_trait]
impl ModelPort for IndeterminateModel {
    async fn invoke(
        &self,
        _request: &ModelInvocationRequest,
        _cancellation: &CancellationToken,
        _stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err(PortError::indeterminate(
            "provider timed out after accepting the request",
        ))
    }
}

struct FailingPermissions;

#[async_trait]
impl PermissionPort for FailingPermissions {
    async fn authorize(
        &self,
        _request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        Err(PortError::new("permission service unavailable"))
    }
}

struct CancellingPermissions;

#[async_trait]
impl PermissionPort for CancellingPermissions {
    async fn authorize(
        &self,
        _request: &EngineToolRequest,
        cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        cancellation.cancel();
        Ok(EnginePermissionDecision {
            approved: true,
            reason: None,
            metadata: Value::Null,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnVector {
    name: String,
    #[serde(default)]
    cancel_before_run: bool,
    messages: Vec<VectorMessage>,
    model: Vec<VectorModelResponse>,
    #[serde(default)]
    tool_outputs: HashMap<String, String>,
    #[serde(default)]
    deny_tools: HashSet<String>,
    expected: VectorExpected,
}

#[derive(Debug, Deserialize)]
struct VectorMessage {
    role: String,
    content: String,
}

#[tokio::test]
async fn indeterminate_tool_effect_stops_for_reconciliation() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call-unknown".to_string(),
                name: "external-write".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let post_commit = Arc::new(RecordingPostCommit::default());
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            Arc::new(IndeterminateTools),
            Arc::new(RecordingEvents::default()),
            checkpoints.clone(),
            post_commit.clone(),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-indeterminate",
                "turn-indeterminate",
                vec![Message::with_text(Role::User, "write externally")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Reconciliation_required);
    assert_eq!(result.tool_results[0].outcome, ToolOutcome::Indeterminate);
    assert_eq!(model.requests.lock().unwrap().len(), 1);
    assert!(post_commit.0.lock().unwrap().is_empty());
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "effect_outcome_unknown"
    );

    let checkpoint = checkpoints.0.lock().unwrap().last().unwrap().clone();
    assert!(checkpoint.reconciliation_required);
    assert!(
        TurnEngineRequest::resume_after_model_reconciliation(
            &checkpoint,
            3,
            checkpoint.last_sequence as u64,
            ModelInvocationResponse {
                output: Some(Value::String("wrong resolution type".to_string())),
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: Vec::new(),
                next_context_state: None,
                metadata: Value::Null,
            },
        )
        .is_err()
    );
    assert_eq!(
        checkpoint.completed_tool_results[0].outcome,
        ToolOutcome::Indeterminate
    );
    let resumed_model = Arc::new(IndeterminateModel {
        calls: AtomicU64::new(0),
    });
    let resumed = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            resumed_model.clone(),
            Arc::new(IndeterminateTools),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    )
    .run(
        TurnEngineRequest::resume_from(&checkpoint, 3, 20),
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(resumed.commit.status, TurnStatus::Reconciliation_required);
    assert_eq!(resumed_model.calls.load(Ordering::SeqCst), 0);

    let resolved_model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("reconciled".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let resolved_request = TurnEngineRequest::resume_after_reconciliation(
        &checkpoint,
        2,
        20,
        EngineToolResult {
            request_id: "call-unknown".to_string(),
            name: "external-write".to_string(),
            outcome: ToolOutcome::Success,
            output: Some(Value::String("confirmed complete".to_string())),
            error_kind: None,
            metadata: Value::Null,
        },
    )
    .unwrap();
    let resolved_events = Arc::new(RecordingEvents::default());
    let resolved_checkpoints = Arc::new(RecordingCheckpoints::default());
    let resolved = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            resolved_model.clone(),
            Arc::new(IndeterminateTools),
            resolved_events.clone(),
            resolved_checkpoints.clone(),
            Arc::new(RecordingPostCommit::default()),
        ),
    )
    .run(resolved_request, CancellationToken::new())
    .await
    .unwrap();
    assert_eq!(resolved.commit.status, TurnStatus::Success);
    assert_eq!(
        resolved_checkpoints.0.lock().unwrap()[0].completed_tool_results[0].outcome,
        ToolOutcome::Success
    );
    assert!(
        resolved_events
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| event.kind == EngineEventKind::Tool_result_reconciled)
    );
    assert!(
        resolved_model.requests.lock().unwrap()[0]
            .context
            .messages
            .iter()
            .any(|message| message.text_content() == "confirmed complete")
    );
    assert_eq!(
        resolved_model.requests.lock().unwrap()[0].context.iteration,
        1
    );
}

#[tokio::test]
async fn model_stream_chunks_use_the_ephemeral_stream_port() {
    let stream = Arc::new(RecordingStream::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model: Arc::new(StreamingModel),
            stream: stream.clone(),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(VectorPermissions {
                denied: HashSet::new(),
            }),
            tools: Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            durability: Arc::new(RecordingDurability {
                events: Arc::new(RecordingEvents::default()),
                checkpoints: Arc::new(RecordingCheckpoints::default()),
            }),
            post_commit: Arc::new(RecordingPostCommit::default()),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-stream",
                "turn-stream",
                vec![Message::with_text(Role::User, "stream")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(
        stream.0.lock().unwrap().as_slice(),
        &[ModelStreamChunk::Text("hello".to_string())]
    );
}

#[tokio::test]
async fn portable_assistant_history_is_checkpointed_and_reused_after_tool_round() {
    let mut assistant = Message::with_text(Role::Assistant, "");
    assistant.metadata_mut().insert(
        "tool_calls".to_string(),
        serde_json::json!([{
            "id": "call_1",
            "type": "function",
            "function": {"name": "weather", "arguments": "{\"city\":\"Paris\"}"},
        }]),
    );
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([
            ModelInvocationResponse {
                output: None,
                usage: None,
                assistant_messages: vec![assistant],
                tool_requests: vec![EngineToolRequest {
                    id: "call_1".to_string(),
                    name: "weather".to_string(),
                    arguments: Some(serde_json::json!({"city": "Paris"})),
                    metadata: Value::Null,
                }],
                next_context_state: Some(InvocationContextState {
                    portability: ContextPortability::Portable,
                    delegated_state: Vec::new(),
                }),
                metadata: Value::Null,
            },
            ModelInvocationResponse {
                output: Some(Value::String("sunny".to_string())),
                usage: None,
                assistant_messages: vec![Message::with_text(Role::Assistant, "sunny")],
                tool_requests: Vec::new(),
                next_context_state: Some(InvocationContextState {
                    portability: ContextPortability::Portable,
                    delegated_state: Vec::new(),
                }),
                metadata: Value::Null,
            },
        ])),
        requests: Mutex::new(Vec::new()),
    });
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::from([("call_1".to_string(), "22C".to_string())]),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            checkpoints.clone(),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "portable-history-session",
                "portable-history-turn",
                vec![Message::with_text(Role::User, "weather in Paris")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    let checkpoint = checkpoints
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|checkpoint| {
            checkpoint.completed_model_iterations == 1
                && checkpoint.pending_model_response.is_none()
                && checkpoint.messages.len() == 3
        })
        .cloned()
        .expect("tool exchange must checkpoint portable assistant and result messages");
    let requests = model.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[1].context.messages, checkpoint.messages);
    assert_eq!(requests[1].context.messages[1].role, Role::Assistant);
    assert_eq!(
        requests[1].context.messages[1].metadata["tool_calls"][0]["id"],
        "call_1"
    );
    assert_eq!(
        requests[1].context.messages[2].metadata["tool_call_id"],
        "call_1"
    );
}

#[tokio::test]
async fn cancellation_after_model_completion_prevents_tool_execution() {
    let tools = Arc::new(VectorTools {
        outputs: HashMap::new(),
        calls: Mutex::new(Vec::new()),
    });
    let post_commit = Arc::new(RecordingPostCommit::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            Arc::new(CancellingModel),
            tools.clone(),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            post_commit.clone(),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-cancel",
                "turn-cancel",
                vec![Message::with_text(Role::User, "cancel")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Cancelled);
    assert!(tools.calls.lock().unwrap().is_empty());
    assert!(post_commit.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancellation_after_final_model_response_prevents_success_commit() {
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            Arc::new(CancellingFinalModel),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-cancel-final",
                "turn-cancel-final",
                vec![Message::with_text(Role::User, "cancel")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Cancelled);
}

#[tokio::test]
async fn indeterminate_model_invocation_is_not_retried() {
    let model = Arc::new(IndeterminateModel {
        calls: AtomicU64::new(0),
    });
    let events = Arc::new(RecordingEvents::default());
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            events.clone(),
            checkpoints.clone(),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-model-unknown",
                "turn-model-unknown",
                vec![Message::with_text(Role::User, "invoke")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Reconciliation_required);
    assert_eq!(model.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "model_outcome_unknown"
    );
    let reconciliation = result.commit.model_reconciliation.as_ref().unwrap();
    assert!(reconciliation.invocation_id.starts_with("invocation-"));
    assert_eq!(reconciliation.request.context.messages.len(), 1);
    let checkpoint = checkpoints.0.lock().unwrap().last().unwrap().clone();
    assert!(checkpoint.reconciliation_required);
    assert_eq!(checkpoint.stable_prefix_messages, 1);
    assert_eq!(
        checkpoint
            .model_reconciliation
            .as_ref()
            .unwrap()
            .invocation_id,
        reconciliation.invocation_id
    );
    assert!(
        TurnEngineRequest::resume_after_reconciliation(
            &checkpoint,
            3,
            checkpoint.last_sequence as u64,
            EngineToolResult {
                request_id: "not-a-tool".to_string(),
                name: "not-a-tool".to_string(),
                outcome: ToolOutcome::Success,
                output: Some(Value::Null),
                error_kind: None,
                metadata: Value::Null,
            },
        )
        .is_err()
    );
    assert!(
        events
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| event.kind == EngineEventKind::Model_reconciliation_required)
    );

    let unresolved_model = Arc::new(IndeterminateModel {
        calls: AtomicU64::new(0),
    });
    let unresolved = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            unresolved_model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    )
    .run(
        TurnEngineRequest::resume_from(&checkpoint, 3, checkpoint.last_sequence as u64),
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        unresolved.commit.status,
        TurnStatus::Reconciliation_required
    );
    assert_eq!(unresolved_model.calls.load(Ordering::SeqCst), 0);

    let resolved_request = TurnEngineRequest::resume_after_model_reconciliation(
        &checkpoint,
        3,
        checkpoint.last_sequence as u64,
        ModelInvocationResponse {
            output: Some(Value::String("provider-confirmed".to_string())),
            usage: None,
            assistant_messages: vec![Message::with_text(Role::Assistant, "provider-confirmed")],
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: serde_json::json!({"providerResponseId": "resp-confirmed"}),
        },
    )
    .unwrap();
    let resolved_model = Arc::new(IndeterminateModel {
        calls: AtomicU64::new(0),
    });
    let resolved_events = Arc::new(RecordingEvents::default());
    let resolved = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            resolved_model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            resolved_events.clone(),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    )
    .run(resolved_request, CancellationToken::new())
    .await
    .unwrap();
    assert_eq!(resolved.commit.status, TurnStatus::Success);
    assert_eq!(
        resolved.commit.output,
        Some(Value::String("provider-confirmed".to_string()))
    );
    assert_eq!(resolved_model.calls.load(Ordering::SeqCst), 0);
    assert!(resolved.commit.model_reconciliation.is_none());
    assert!(
        resolved_events
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| event.kind == EngineEventKind::Model_invocation_reconciled)
    );
}

#[tokio::test]
async fn permission_port_failure_commits_a_failed_turn() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call-permission".to_string(),
                name: "restricted".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model,
            stream: Arc::new(NoopModelStreamPort),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(FailingPermissions),
            tools: Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            durability: Arc::new(RecordingDurability {
                events: events.clone(),
                checkpoints: Arc::new(RecordingCheckpoints::default()),
            }),
            post_commit: Arc::new(RecordingPostCommit::default()),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-permission-error",
                "turn-permission-error",
                vec![Message::with_text(Role::User, "authorize")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Failed);
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "permission_error"
    );
    assert_eq!(
        events.0.lock().unwrap().last().unwrap().kind,
        EngineEventKind::Turn_failed
    );
}

#[tokio::test]
async fn unknown_tool_is_a_terminal_configuration_failure() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call-missing".to_string(),
                name: "missing".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model,
            Arc::new(UnknownTools),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-unknown-tool",
                "turn-unknown-tool",
                vec![Message::with_text(Role::User, "call missing")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Failed);
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "tool_configuration_error"
    );
    assert!(result.tool_results.is_empty());
}

#[tokio::test]
async fn cancellation_after_permission_prevents_tool_execution() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call-cancelled".to_string(),
                name: "write".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let tools = Arc::new(VectorTools {
        outputs: HashMap::new(),
        calls: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model,
            stream: Arc::new(NoopModelStreamPort),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(CancellingPermissions),
            tools: tools.clone(),
            durability: Arc::new(RecordingDurability {
                events: Arc::new(RecordingEvents::default()),
                checkpoints: Arc::new(RecordingCheckpoints::default()),
            }),
            post_commit: Arc::new(RecordingPostCommit::default()),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-cancel-permission",
                "turn-cancel-permission",
                vec![Message::with_text(Role::User, "write")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Cancelled);
    assert!(tools.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn durability_failure_after_tool_effect_returns_recovery_state() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call-durable".to_string(),
                name: "write".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let tools = Arc::new(VectorTools {
        outputs: HashMap::from([("call-durable".to_string(), "written".to_string())]),
        calls: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model,
            stream: Arc::new(NoopModelStreamPort),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(VectorPermissions {
                denied: HashSet::new(),
            }),
            tools: tools.clone(),
            durability: Arc::new(FailingAtomicDurability {
                events: Arc::new(RecordingEvents::default()),
                atomic_calls: AtomicU64::new(0),
            }),
            post_commit: Arc::new(RecordingPostCommit::default()),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let error = engine
        .run(
            TurnEngineRequest::new(
                "session-durability",
                "turn-durability",
                vec![Message::with_text(Role::User, "write")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();

    match error {
        TurnEngineError::RecoveryRequired {
            request_id,
            checkpoint,
            tool_results,
            ..
        } => {
            assert_eq!(request_id, "call-durable");
            assert!(checkpoint.pending_model_response.is_some());
            assert_eq!(checkpoint.completed_tool_results[0].model_text(), "written");
            assert_eq!(tool_results.len(), 1);
        }
        other => panic!("expected recovery state, got {other}"),
    }
    assert_eq!(tools.calls.lock().unwrap().as_slice(), &["call-durable"]);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorModelResponse {
    output: Option<Value>,
    assistant: Option<String>,
    #[serde(default)]
    tools: Vec<EngineToolRequest>,
    next_portability: Option<ContextPortability>,
    delegated_state: Option<Vec<DelegatedStateReference>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorExpected {
    status: TurnStatus,
    output: Option<Value>,
    iterations: usize,
    snapshots: usize,
    tool_results: usize,
    #[serde(default)]
    tool_result_order: Vec<String>,
    #[serde(default)]
    snapshot_portability: Vec<ContextPortability>,
    #[serde(default)]
    snapshot_stable_prefixes: Vec<usize>,
    commit_portability: Option<ContextPortability>,
    delegated_state: Option<usize>,
    #[serde(default)]
    event_kinds: Vec<EngineEventKind>,
}

struct ScriptedModel {
    responses: Mutex<VecDeque<ModelInvocationResponse>>,
    requests: Mutex<Vec<ModelInvocationRequest>>,
}

#[async_trait]
impl ModelPort for ScriptedModel {
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        _cancellation: &CancellationToken,
        _stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        self.requests.lock().unwrap().push(request.clone());
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| PortError::new("scripted model response exhausted"))
    }
}

struct VectorPermissions {
    denied: HashSet<String>,
}

#[async_trait]
impl PermissionPort for VectorPermissions {
    async fn authorize(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        let approved = !self.denied.contains(&request.name);
        Ok(EnginePermissionDecision {
            approved,
            reason: (!approved).then(|| "denied by vector".to_string()),
            metadata: Value::Null,
        })
    }
}

struct VectorTools {
    outputs: HashMap<String, String>,
    calls: Mutex<Vec<String>>,
}

#[async_trait]
impl ToolPort for VectorTools {
    async fn execute(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError> {
        self.calls.lock().unwrap().push(request.id.clone());
        Ok(EngineToolResult {
            request_id: request.id.clone(),
            name: request.name.clone(),
            outcome: ToolOutcome::Success,
            output: Some(Value::String(
                self.outputs.get(&request.id).cloned().unwrap_or_else(|| {
                    request.arguments.clone().unwrap_or(Value::Null).to_string()
                }),
            )),
            error_kind: None,
            metadata: Value::Null,
        })
    }
}

#[derive(Default)]
struct RecordingEvents(Mutex<Vec<EngineEvent>>);

struct RecordingDurability {
    events: Arc<RecordingEvents>,
    checkpoints: Arc<RecordingCheckpoints>,
}

#[async_trait]
impl DurabilityPort for RecordingDurability {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        self.events.0.lock().unwrap().push(event.clone());
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        self.events.0.lock().unwrap().extend_from_slice(events);
        self.checkpoints.0.lock().unwrap().push(checkpoint.clone());
        Ok(())
    }
}

struct FailingAtomicDurability {
    events: Arc<RecordingEvents>,
    atomic_calls: AtomicU64,
}

struct FailingPostCommitCompletionDurability {
    events: Arc<RecordingEvents>,
}

#[async_trait]
impl DurabilityPort for FailingPostCommitCompletionDurability {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        if event.kind == EngineEventKind::Post_commit_completed {
            return Err(PortError::new("journal unavailable after consolidation"));
        }
        self.events.0.lock().unwrap().push(event.clone());
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        _checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        self.events.0.lock().unwrap().extend_from_slice(events);
        Ok(())
    }
}

#[async_trait]
impl DurabilityPort for FailingAtomicDurability {
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        self.events.0.lock().unwrap().push(event.clone());
        Ok(())
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        _checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        if self.atomic_calls.fetch_add(1, Ordering::SeqCst) == 0 {
            self.events.0.lock().unwrap().extend_from_slice(events);
            Ok(())
        } else {
            Err(PortError::new("atomic durability unavailable"))
        }
    }
}

#[derive(Default)]
struct RecordingCheckpoints(Mutex<Vec<EngineCheckpoint>>);

#[derive(Default)]
struct RecordingPostCommit(Mutex<Vec<TurnCommit>>);

#[async_trait]
impl PostCommitPort for RecordingPostCommit {
    async fn after_commit(
        &self,
        _effect_id: &str,
        commit: &TurnCommit,
        _cancellation: &CancellationToken,
    ) -> Result<(), PortError> {
        self.0.lock().unwrap().push(commit.clone());
        Ok(())
    }
}

#[derive(Default)]
struct RecordingPostCommitIds(Mutex<Vec<String>>);

#[async_trait]
impl PostCommitPort for RecordingPostCommitIds {
    async fn after_commit(
        &self,
        effect_id: &str,
        _commit: &TurnCommit,
        _cancellation: &CancellationToken,
    ) -> Result<(), PortError> {
        self.0.lock().unwrap().push(effect_id.to_string());
        Ok(())
    }
}

struct FailingPostCommit;

#[async_trait]
impl PostCommitPort for FailingPostCommit {
    async fn after_commit(
        &self,
        _effect_id: &str,
        _commit: &TurnCommit,
        _cancellation: &CancellationToken,
    ) -> Result<(), PortError> {
        Err(PortError::new("consolidation unavailable"))
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> String {
        "2026-07-21T00:00:00Z".to_string()
    }
}

#[derive(Default)]
struct SequentialIds(AtomicU64);

impl IdGenerator for SequentialIds {
    fn next_id(&self, kind: &str) -> String {
        format!("{kind}-{}", self.0.fetch_add(1, Ordering::Relaxed) + 1)
    }
}

fn vector_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
        .join("vectors")
        .join("engine")
        .join("turn_vectors.json")
}

fn load_vectors() -> VectorFile {
    serde_json::from_str(&std::fs::read_to_string(vector_path()).unwrap()).unwrap()
}

fn to_message(message: &VectorMessage) -> Message {
    let role = match message.role.as_str() {
        "system" => Role::System,
        "assistant" => Role::Assistant,
        "tool" => Role::Tool,
        _ => Role::User,
    };
    Message::with_text(role, message.content.clone())
}

fn to_response(response: &VectorModelResponse) -> ModelInvocationResponse {
    let next_context_state = match (response.next_portability, &response.delegated_state) {
        (None, None) => None,
        (portability, delegated) => Some(InvocationContextState {
            portability: portability.unwrap_or(ContextPortability::Portable),
            delegated_state: delegated.clone().unwrap_or_default(),
        }),
    };
    ModelInvocationResponse {
        output: response.output.clone(),
        usage: None,
        assistant_messages: response
            .assistant
            .iter()
            .map(|text| Message::with_text(Role::Assistant, text.clone()))
            .collect(),
        tool_requests: response.tools.clone(),
        next_context_state,
        metadata: Value::Null,
    }
}

#[tokio::test]
async fn canonical_turn_engine_matches_vectors() {
    let vectors = load_vectors();
    assert_eq!(vectors.version, "1");

    for vector in vectors.cases {
        let model = Arc::new(ScriptedModel {
            responses: Mutex::new(vector.model.iter().map(to_response).collect()),
            requests: Mutex::new(Vec::new()),
        });
        let tools = Arc::new(VectorTools {
            outputs: vector.tool_outputs,
            calls: Mutex::new(Vec::new()),
        });
        let events = Arc::new(RecordingEvents::default());
        let checkpoints = Arc::new(RecordingCheckpoints::default());
        let post_commit = Arc::new(RecordingPostCommit::default());
        let engine = TurnEngine::new(
            ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
            TurnEngineEffects {
                model: model.clone(),
                stream: Arc::new(NoopModelStreamPort),
                policy: Arc::new(NoopHostPolicyPort),
                retry: Arc::new(NoopRetryPolicyPort),
                conversation: Arc::new(DefaultConversationPort),
                permission: Arc::new(VectorPermissions {
                    denied: vector.deny_tools,
                }),
                tools: tools.clone(),
                durability: Arc::new(RecordingDurability {
                    events: events.clone(),
                    checkpoints: checkpoints.clone(),
                }),
                post_commit: post_commit.clone(),
                clock: Arc::new(FixedClock),
                ids: Arc::new(SequentialIds::default()),
            },
        );
        let cancellation = CancellationToken::new();
        if vector.cancel_before_run {
            cancellation.cancel();
        }
        let result = engine
            .run(
                TurnEngineRequest::new(
                    format!("session-{}", vector.name),
                    format!("turn-{}", vector.name),
                    vector.messages.iter().map(to_message).collect(),
                ),
                cancellation,
            )
            .await
            .unwrap_or_else(|error| panic!("{} failed: {error}", vector.name));

        assert_eq!(
            result.commit.status, vector.expected.status,
            "{} status",
            vector.name
        );
        assert_eq!(
            result.commit.output, vector.expected.output,
            "{} output",
            vector.name
        );
        assert_eq!(
            result.commit.iterations as usize, vector.expected.iterations,
            "{} iterations",
            vector.name
        );
        assert_eq!(
            result.snapshots.len(),
            vector.expected.snapshots,
            "{} snapshots",
            vector.name
        );
        assert_eq!(
            result.tool_results.len(),
            vector.expected.tool_results,
            "{} tool results",
            vector.name
        );
        assert_eq!(
            result
                .tool_results
                .iter()
                .map(|result| result.request_id.clone())
                .collect::<Vec<_>>(),
            vector.expected.tool_result_order,
            "{} tool order",
            vector.name
        );
        if !vector.expected.snapshot_portability.is_empty() {
            assert_eq!(
                result
                    .snapshots
                    .iter()
                    .map(|snapshot| snapshot.context_state.portability)
                    .collect::<Vec<_>>(),
                vector.expected.snapshot_portability,
                "{} portability",
                vector.name
            );
        }
        if !vector.expected.snapshot_stable_prefixes.is_empty() {
            assert_eq!(
                result
                    .snapshots
                    .iter()
                    .map(|snapshot| snapshot.stable_prefix_messages as usize)
                    .collect::<Vec<_>>(),
                vector.expected.snapshot_stable_prefixes,
                "{} stable prefixes",
                vector.name
            );
        }
        if let Some(portability) = vector.expected.commit_portability {
            assert_eq!(
                result.commit.context_state.portability, portability,
                "{} commit portability",
                vector.name
            );
        }
        if let Some(count) = vector.expected.delegated_state {
            assert_eq!(
                result.commit.context_state.delegated_state.len(),
                count,
                "{} delegated state",
                vector.name
            );
        }
        let recorded_events = events.0.lock().unwrap().clone();
        assert!(
            recorded_events
                .windows(2)
                .all(|pair| pair[0].sequence + 1 == pair[1].sequence),
            "{} event sequences",
            vector.name
        );
        if !vector.expected.event_kinds.is_empty() {
            assert_eq!(
                recorded_events
                    .iter()
                    .map(|event| event.kind)
                    .collect::<Vec<_>>(),
                vector.expected.event_kinds,
                "{} events",
                vector.name
            );
        }
        assert_eq!(
            post_commit.0.lock().unwrap().len(),
            usize::from(vector.expected.status == TurnStatus::Success),
            "{} post commit",
            vector.name
        );
        assert_eq!(
            model.requests.lock().unwrap().len(),
            vector.expected.snapshots,
            "{} model invocations",
            vector.name
        );
    }
}

struct FlakyModel {
    failures_remaining: AtomicU64,
    snapshot_ids: Mutex<Vec<String>>,
    response: ModelInvocationResponse,
}

#[async_trait]
impl ModelPort for FlakyModel {
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        _cancellation: &CancellationToken,
        _stream: &dyn ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        self.snapshot_ids
            .lock()
            .unwrap()
            .push(request.context.id.clone());
        if self
            .failures_remaining
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_sub(1)
            })
            .is_ok()
        {
            return Err(PortError::new("transient model failure"));
        }
        Ok(self.response.clone())
    }
}

struct FailingTools;

#[async_trait]
impl ToolPort for FailingTools {
    async fn execute(
        &self,
        _request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError> {
        Err(PortError::new("simulated tool failure"))
    }
}

struct MemorySource;

#[async_trait]
impl ContextSource for MemorySource {
    fn name(&self) -> &str {
        "memory"
    }

    async fn load(&self, _request: &ContextRequest) -> Result<Vec<ContextCandidate>, ContextError> {
        Ok(vec![ContextCandidate {
            id: "memory-1".to_string(),
            source: "memory".to_string(),
            messages: vec![Message::with_text(
                Role::System,
                "Remembered preference: concise output",
            )],
            metadata: Value::Null,
        }])
    }
}

struct InputEchoSource;

#[async_trait]
impl ContextSource for InputEchoSource {
    fn name(&self) -> &str {
        "inputs"
    }

    async fn load(&self, request: &ContextRequest) -> Result<Vec<ContextCandidate>, ContextError> {
        let tenant = request
            .inputs
            .as_ref()
            .and_then(|inputs| inputs.get("tenant"))
            .cloned()
            .unwrap_or(Value::Null);
        Ok(vec![ContextCandidate {
            id: "input-tenant".to_string(),
            source: "inputs".to_string(),
            messages: vec![Message::with_text(
                Role::System,
                format!("Tenant: {}", tenant),
            )],
            metadata: Value::Null,
        }])
    }
}

fn effects(
    model: Arc<dyn ModelPort>,
    tools: Arc<dyn ToolPort>,
    events: Arc<RecordingEvents>,
    checkpoints: Arc<RecordingCheckpoints>,
    post_commit: Arc<dyn PostCommitPort>,
) -> TurnEngineEffects {
    TurnEngineEffects {
        model,
        stream: Arc::new(NoopModelStreamPort),
        policy: Arc::new(NoopHostPolicyPort),
        retry: Arc::new(NoopRetryPolicyPort),
        conversation: Arc::new(DefaultConversationPort),
        permission: Arc::new(VectorPermissions {
            denied: HashSet::new(),
        }),
        tools,
        durability: Arc::new(RecordingDurability {
            events,
            checkpoints,
        }),
        post_commit,
        clock: Arc::new(FixedClock),
        ids: Arc::new(SequentialIds::default()),
    }
}

#[tokio::test]
async fn retry_reuses_the_same_context_snapshot() {
    let model = Arc::new(FlakyModel {
        failures_remaining: AtomicU64::new(1),
        snapshot_ids: Mutex::new(Vec::new()),
        response: ModelInvocationResponse {
            output: Some(Value::String("recovered".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        },
    });
    let events = Arc::new(RecordingEvents::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            events.clone(),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-retry",
                "turn-retry",
                vec![Message::with_text(Role::User, "retry")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(result.snapshots.len(), 1);
    let snapshot_ids = model.snapshot_ids.lock().unwrap();
    assert_eq!(snapshot_ids.len(), 2);
    assert_eq!(snapshot_ids[0], snapshot_ids[1]);
    assert!(
        events
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|event| event.kind == EngineEventKind::Model_invocation_failed)
    );
}

#[tokio::test]
async fn tool_failure_is_committed_as_a_model_visible_result() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([
            ModelInvocationResponse {
                output: None,
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: vec![EngineToolRequest {
                    id: "call-fail".to_string(),
                    name: "failing".to_string(),
                    arguments: Some(Value::Null),
                    metadata: Value::Null,
                }],
                next_context_state: None,
                metadata: Value::Null,
            },
            ModelInvocationResponse {
                output: Some(Value::String("recovered from tool failure".to_string())),
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: Vec::new(),
                next_context_state: None,
                metadata: Value::Null,
            },
        ])),
        requests: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            Arc::new(FailingTools),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-tool-failure",
                "turn-tool-failure",
                vec![Message::with_text(Role::User, "use the tool")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(result.tool_results[0].outcome, ToolOutcome::Failed);
    assert_eq!(
        result.tool_results[0].error_kind.as_deref(),
        Some("tool_error")
    );
    let requests = model.requests.lock().unwrap();
    assert!(
        requests[1]
            .context
            .messages
            .iter()
            .any(|message| message.text_content().contains("simulated tool failure"))
    );
}

#[tokio::test]
async fn no_op_durability_allows_tool_turns_without_a_state_store() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([
            ModelInvocationResponse {
                output: None,
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: vec![EngineToolRequest {
                    id: "call-project-files".to_string(),
                    name: "list_project_files".to_string(),
                    arguments: Some(Value::Null),
                    metadata: Value::Null,
                }],
                next_context_state: None,
                metadata: Value::Null,
            },
            ModelInvocationResponse {
                output: Some(Value::String("Project files inspected.".to_string())),
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: Vec::new(),
                next_context_state: None,
                metadata: Value::Null,
            },
        ])),
        requests: Mutex::new(Vec::new()),
    });
    let tools = Arc::new(VectorTools {
        outputs: HashMap::from([("call-project-files".to_string(), "src/main.rs".to_string())]),
        calls: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model: model.clone(),
            stream: Arc::new(NoopModelStreamPort),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(AllowAllPermissions),
            tools: tools.clone(),
            durability: Arc::new(NoopDurabilityPort),
            post_commit: Arc::new(NoopPostCommitPort),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-no-store",
                "turn-no-store",
                vec![Message::with_text(Role::User, "Inspect the project")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(
        result.commit.output,
        Some(Value::String("Project files inspected.".to_string()))
    );
    assert_eq!(
        tools.calls.lock().unwrap().as_slice(),
        &["call-project-files"]
    );
    assert_eq!(model.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn memory_recall_composes_as_a_context_source() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("concise".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy))
            .with_source(Arc::new(MemorySource)),
        effects(
            model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    engine
        .run(
            TurnEngineRequest::new(
                "session-memory",
                "turn-memory",
                vec![Message::with_text(Role::User, "respond")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    let requests = model.requests.lock().unwrap();
    assert!(
        requests[0]
            .context
            .messages
            .iter()
            .any(|message| message.text_content().contains("Remembered preference"))
    );
    assert_eq!(requests[0].context.decisions[0].candidate_id, "memory-1");
}

#[tokio::test]
async fn resume_continues_after_the_checkpoint_sequence_and_iteration() {
    let checkpoint = EngineCheckpoint {
        id: "checkpoint-1".to_string(),
        session_id: "session-resume".to_string(),
        turn_id: "turn-resume".to_string(),
        run_id: "run-test".to_string(),
        parent_run_id: None,
        delegation_depth: 0,
        iteration: 0,
        last_sequence: 12,
        messages: vec![
            Message::with_text(Role::User, "start"),
            Message::tool_result("call-complete", "already committed"),
        ],
        stable_prefix_messages: 1,
        inputs: Some(serde_json::json!({ "tenant": "contoso" })),
        active_invocation_id: None,
        pending_tool_requests: Vec::new(),
        completed_tool_results: Vec::new(),
        completed_model_iterations: 1,
        reconciliation_required: false,
        model_reconciliation: None,
        pending_output: None,
        final_output_ready: false,
        pending_model_response: None,
        resume_same_iteration: false,
        policy_applied_for_iteration: false,
        context_state: InvocationContextState {
            portability: ContextPortability::Portable,
            delegated_state: Vec::new(),
        },
        metadata: Value::Null,
    };
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("resumed".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy))
            .with_source(Arc::new(InputEchoSource)),
        effects(
            model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            events.clone(),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );
    let resumed_request = TurnEngineRequest::resume_from(&checkpoint, 3, 20);
    assert_eq!(resumed_request.stable_prefix_messages, 1);

    let result = engine
        .run(resumed_request, CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(events.0.lock().unwrap()[0].sequence, 21);
    let requests = model.requests.lock().unwrap();
    assert_eq!(requests[0].context.iteration, 1);
    assert_eq!(requests[0].context.stable_prefix_messages, 1);
    assert!(
        requests[0]
            .context
            .messages
            .iter()
            .any(|message| message.text_content().contains("contoso"))
    );
    assert!(
        result
            .commit
            .messages
            .iter()
            .any(|message| message.text_content() == "already committed")
    );

    let mut legacy_value = serde_json::to_value(&checkpoint).unwrap();
    legacy_value
        .as_object_mut()
        .unwrap()
        .remove("stablePrefixMessages");
    let legacy_checkpoint: EngineCheckpoint = serde_json::from_value(legacy_value).unwrap();
    assert_eq!(legacy_checkpoint.stable_prefix_messages, 0);
}

#[tokio::test]
async fn resume_commits_checkpointed_final_model_response_without_reinvoking() {
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let post_commit_ids = Arc::new(RecordingPostCommitIds::default());
    let initial = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            Arc::new(ScriptedModel {
                responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
                    output: Some(Value::String("checkpointed".to_string())),
                    usage: None,
                    assistant_messages: Vec::new(),
                    tool_requests: Vec::new(),
                    next_context_state: None,
                    metadata: Value::Null,
                }])),
                requests: Mutex::new(Vec::new()),
            }),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            checkpoints.clone(),
            post_commit_ids.clone(),
        ),
    );
    initial
        .run(
            TurnEngineRequest::new(
                "session-final-checkpoint",
                "turn-final-checkpoint",
                vec![Message::with_text(Role::User, "finish")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    let checkpoint = checkpoints.0.lock().unwrap()[0].clone();
    assert!(checkpoint.final_output_ready);
    let resumed_model = Arc::new(IndeterminateModel {
        calls: AtomicU64::new(0),
    });
    let resumed = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            resumed_model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            post_commit_ids.clone(),
        ),
    )
    .run(
        TurnEngineRequest::resume_from(&checkpoint, 3, checkpoint.last_sequence as u64),
        CancellationToken::new(),
    )
    .await
    .unwrap();

    assert_eq!(resumed.commit.status, TurnStatus::Success);
    assert_eq!(
        resumed.commit.output,
        Some(Value::String("checkpointed".to_string()))
    );
    assert_eq!(resumed_model.calls.load(Ordering::SeqCst), 0);
    let ids = post_commit_ids.0.lock().unwrap();
    assert_eq!(ids.len(), 2);
    assert_eq!(ids[0], ids[1]);
}

#[tokio::test]
async fn resume_continues_remaining_tools_without_replaying_completed_effects() {
    let checkpoint = EngineCheckpoint {
        id: "checkpoint-partial-tools".to_string(),
        session_id: "session-partial-tools".to_string(),
        turn_id: "turn-partial-tools".to_string(),
        run_id: "run-test".to_string(),
        parent_run_id: None,
        delegation_depth: 0,
        iteration: 0,
        last_sequence: 8,
        messages: vec![
            Message::with_text(Role::User, "run both"),
            Message::tool_result("call-first", "first complete"),
        ],
        stable_prefix_messages: 1,
        inputs: Some(Value::Null),
        active_invocation_id: Some("invocation-original".to_string()),
        pending_tool_requests: vec![EngineToolRequest {
            id: "call-second".to_string(),
            name: "second".to_string(),
            arguments: Some(Value::Null),
            metadata: Value::Null,
        }],
        completed_tool_results: vec![EngineToolResult {
            request_id: "call-first".to_string(),
            name: "first".to_string(),
            outcome: ToolOutcome::Success,
            output: Some(Value::String("first complete".to_string())),
            error_kind: None,
            metadata: Value::Null,
        }],
        completed_model_iterations: 1,
        reconciliation_required: false,
        model_reconciliation: None,
        pending_output: None,
        final_output_ready: false,
        pending_model_response: None,
        resume_same_iteration: false,
        policy_applied_for_iteration: false,
        context_state: InvocationContextState {
            portability: ContextPortability::Portable,
            delegated_state: Vec::new(),
        },
        metadata: Value::Null,
    };
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("all complete".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let tools = Arc::new(VectorTools {
        outputs: HashMap::from([("call-second".to_string(), "second complete".to_string())]),
        calls: Mutex::new(Vec::new()),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            tools.clone(),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::resume_from(&checkpoint, 3, checkpoint.last_sequence as u64),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(result.commit.iterations, 2);
    assert_eq!(tools.calls.lock().unwrap().as_slice(), &["call-second"]);
    let requests = model.requests.lock().unwrap();
    assert!(
        requests[0]
            .context
            .messages
            .iter()
            .any(|message| message.text_content() == "first complete")
    );
    assert!(
        requests[0]
            .context
            .messages
            .iter()
            .any(|message| message.text_content() == "second complete")
    );
}

#[tokio::test]
async fn resume_after_final_iteration_tools_commits_max_iterations_failure() {
    let checkpoint = EngineCheckpoint {
        id: "checkpoint-exhausted".to_string(),
        session_id: "session-exhausted".to_string(),
        turn_id: "turn-exhausted".to_string(),
        run_id: "run-test".to_string(),
        parent_run_id: None,
        delegation_depth: 0,
        iteration: 0,
        last_sequence: 10,
        messages: vec![
            Message::with_text(Role::User, "run"),
            Message::tool_result("call-final", "complete"),
        ],
        stable_prefix_messages: 1,
        inputs: Some(Value::Null),
        active_invocation_id: Some("invocation-final".to_string()),
        pending_tool_requests: Vec::new(),
        completed_tool_results: vec![EngineToolResult {
            request_id: "call-final".to_string(),
            name: "final".to_string(),
            outcome: ToolOutcome::Success,
            output: Some(Value::String("complete".to_string())),
            error_kind: None,
            metadata: Value::Null,
        }],
        completed_model_iterations: 1,
        reconciliation_required: false,
        model_reconciliation: None,
        pending_output: None,
        final_output_ready: false,
        pending_model_response: None,
        resume_same_iteration: false,
        policy_applied_for_iteration: false,
        context_state: InvocationContextState {
            portability: ContextPortability::Portable,
            delegated_state: Vec::new(),
        },
        metadata: Value::Null,
    };
    let model = Arc::new(IndeterminateModel {
        calls: AtomicU64::new(0),
    });
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model.clone(),
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            Arc::new(RecordingEvents::default()),
            Arc::new(RecordingCheckpoints::default()),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::resume_from(&checkpoint, 1, checkpoint.last_sequence as u64),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Failed);
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "max_iterations"
    );
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn post_commit_failure_does_not_uncommit_the_turn() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("committed".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model,
            stream: Arc::new(NoopModelStreamPort),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(VectorPermissions {
                denied: HashSet::new(),
            }),
            tools: Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            durability: Arc::new(RecordingDurability {
                events: events.clone(),
                checkpoints: Arc::new(RecordingCheckpoints::default()),
            }),
            post_commit: Arc::new(FailingPostCommit),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-post-commit",
                "turn-post-commit",
                vec![Message::with_text(Role::User, "finish")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(
        result.post_commit_error.as_deref(),
        Some("consolidation unavailable")
    );
    assert_eq!(
        events.0.lock().unwrap().last().unwrap().kind,
        EngineEventKind::Post_commit_failed
    );
}

#[tokio::test]
async fn post_commit_completion_journal_failure_is_non_fatal() {
    let post_commit = Arc::new(RecordingPostCommit::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        TurnEngineEffects {
            model: Arc::new(ScriptedModel {
                responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
                    output: Some(Value::String("committed".to_string())),
                    usage: None,
                    assistant_messages: Vec::new(),
                    tool_requests: Vec::new(),
                    next_context_state: None,
                    metadata: Value::Null,
                }])),
                requests: Mutex::new(Vec::new()),
            }),
            stream: Arc::new(NoopModelStreamPort),
            policy: Arc::new(NoopHostPolicyPort),
            retry: Arc::new(NoopRetryPolicyPort),
            conversation: Arc::new(DefaultConversationPort),
            permission: Arc::new(VectorPermissions {
                denied: HashSet::new(),
            }),
            tools: Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            durability: Arc::new(FailingPostCommitCompletionDurability {
                events: Arc::new(RecordingEvents::default()),
            }),
            post_commit: post_commit.clone(),
            clock: Arc::new(FixedClock),
            ids: Arc::new(SequentialIds::default()),
        },
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-post-commit-journal",
                "turn-post-commit-journal",
                vec![Message::with_text(Role::User, "finish")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(post_commit.0.lock().unwrap().len(), 1);
    assert!(
        result
            .post_commit_error
            .as_deref()
            .is_some_and(|message| message.contains("completion event"))
    );
}

struct RewritingPolicy;

#[async_trait]
impl HostPolicyPort for RewritingPolicy {
    async fn before_model(
        &self,
        mut request: HostPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<HostPolicyResult, HostPolicyError> {
        request
            .messages
            .push(Message::with_text(Role::User, "persisted steering"));
        Ok(HostPolicyResult {
            messages: request.messages,
            stable_prefix_messages: request.stable_prefix_messages,
            metadata: serde_json::json!({"source": "test"}),
        })
    }

    async fn before_commit(
        &self,
        _request: FinalOutputPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<FinalOutputPolicyResult, HostPolicyError> {
        Ok(FinalOutputPolicyResult {
            output: Some(Value::String("policy rewrite".to_string())),
            metadata: Value::Null,
        })
    }
}

#[tokio::test]
async fn host_policy_rewrites_are_checkpointed_before_model_effects() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("model output".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let mut engine_effects = effects(
        model.clone(),
        Arc::new(VectorTools {
            outputs: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }),
        events.clone(),
        checkpoints.clone(),
        Arc::new(RecordingPostCommit::default()),
    );
    engine_effects.policy = Arc::new(RewritingPolicy);
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        engine_effects,
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-policy",
                "turn-policy",
                vec![Message::with_text(Role::User, "base")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(
        result.commit.output,
        Some(Value::String("policy rewrite".to_string()))
    );
    assert!(
        model.requests.lock().unwrap()[0]
            .context
            .messages
            .iter()
            .any(|message| message.text_content() == "persisted steering")
    );
    let checkpoints = checkpoints.0.lock().unwrap();
    assert!(checkpoints[0].resume_same_iteration);
    assert!(checkpoints[0].policy_applied_for_iteration);
    assert!(
        checkpoints[0]
            .messages
            .iter()
            .any(|message| message.text_content() == "persisted steering")
    );
    let policy_checkpoint = checkpoints[0].clone();
    drop(checkpoints);
    let event_kinds = events
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.kind)
        .collect::<Vec<_>>();
    assert!(
        event_kinds
            .iter()
            .position(|kind| *kind == EngineEventKind::Policy_applied)
            < event_kinds
                .iter()
                .position(|kind| *kind == EngineEventKind::Model_invocation_started)
    );

    let resumed_model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String(
                "resumed without duplicate policy".to_string(),
            )),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let mut resumed_effects = effects(
        resumed_model.clone(),
        Arc::new(VectorTools {
            outputs: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }),
        Arc::new(RecordingEvents::default()),
        Arc::new(RecordingCheckpoints::default()),
        Arc::new(RecordingPostCommit::default()),
    );
    resumed_effects.policy = Arc::new(DenyingPolicy);
    let resumed = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        resumed_effects,
    )
    .run(
        TurnEngineRequest::resume_from(
            &policy_checkpoint,
            10,
            policy_checkpoint.last_sequence as u64,
        ),
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(resumed.commit.status, TurnStatus::Success);
    assert_eq!(resumed_model.requests.lock().unwrap().len(), 1);
}

struct DenyingPolicy;

#[async_trait]
impl HostPolicyPort for DenyingPolicy {
    async fn before_model(
        &self,
        _request: HostPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<HostPolicyResult, HostPolicyError> {
        Err(HostPolicyError::new(
            "input_guardrail_denied",
            "Input guardrail denied: blocked",
        ))
    }

    async fn before_commit(
        &self,
        request: FinalOutputPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<FinalOutputPolicyResult, HostPolicyError> {
        Ok(FinalOutputPolicyResult {
            output: request.output,
            metadata: Value::Null,
        })
    }
}

struct CancellingFinalPolicy;

#[async_trait]
impl HostPolicyPort for CancellingFinalPolicy {
    async fn before_model(
        &self,
        request: HostPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<HostPolicyResult, HostPolicyError> {
        Ok(HostPolicyResult {
            messages: request.messages,
            stable_prefix_messages: request.stable_prefix_messages,
            metadata: Value::Null,
        })
    }

    async fn before_commit(
        &self,
        _request: FinalOutputPolicyRequest,
        cancellation: &CancellationToken,
    ) -> Result<FinalOutputPolicyResult, HostPolicyError> {
        cancellation.cancel();
        tokio::task::yield_now().await;
        Err(HostPolicyError::new(
            "output_guardrail_denied",
            "Output guardrail denied: blocked",
        ))
    }
}

#[tokio::test]
async fn cancellation_during_failing_final_policy_commits_cancelled() {
    let events = Arc::new(RecordingEvents::default());
    let mut engine_effects = effects(
        Arc::new(ScriptedModel {
            responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
                output: Some(Value::String("model output".to_string())),
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: Vec::new(),
                next_context_state: None,
                metadata: Value::Null,
            }])),
            requests: Mutex::new(Vec::new()),
        }),
        Arc::new(VectorTools {
            outputs: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }),
        events.clone(),
        Arc::new(RecordingCheckpoints::default()),
        Arc::new(RecordingPostCommit::default()),
    );
    engine_effects.policy = Arc::new(CancellingFinalPolicy);
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        engine_effects,
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-policy-cancel",
                "turn-policy-cancel",
                vec![Message::with_text(Role::User, "cancel")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Cancelled);
    let events = events.0.lock().unwrap();
    let terminal_events = events
        .iter()
        .filter(|event| {
            matches!(
                event.kind,
                EngineEventKind::Turn_committed
                    | EngineEventKind::Turn_cancelled
                    | EngineEventKind::Turn_failed
                    | EngineEventKind::Turn_reconciliation_required
            )
        })
        .map(|event| event.kind)
        .collect::<Vec<_>>();
    assert_eq!(
        terminal_events,
        vec![EngineEventKind::Turn_cancelled],
        "cancellation is the only terminal lifecycle event"
    );
}

#[tokio::test]
async fn policy_failure_is_typed_and_never_retried_as_a_model_failure() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::new()),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let mut engine_effects = effects(
        model.clone(),
        Arc::new(VectorTools {
            outputs: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }),
        events.clone(),
        Arc::new(RecordingCheckpoints::default()),
        Arc::new(RecordingPostCommit::default()),
    );
    engine_effects.policy = Arc::new(DenyingPolicy);
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        engine_effects,
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-policy-deny",
                "turn-policy-deny",
                vec![Message::with_text(Role::User, "blocked")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Failed);
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "input_guardrail_denied"
    );
    assert!(model.requests.lock().unwrap().is_empty());
    assert!(
        events
            .0
            .lock()
            .unwrap()
            .iter()
            .all(|event| event.kind != EngineEventKind::Model_invocation_failed)
    );
}

#[derive(Default)]
struct RecordingRetryPolicy(AtomicU64);

#[async_trait]
impl RetryPolicyPort for RecordingRetryPolicy {
    async fn backoff(
        &self,
        _request: &RetryPolicyRequest,
        _cancellation: &CancellationToken,
    ) -> Result<(), RetryPolicyError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn retry_policy_runs_between_retryable_model_attempts() {
    let model = Arc::new(FlakyModel {
        failures_remaining: AtomicU64::new(1),
        snapshot_ids: Mutex::new(Vec::new()),
        response: ModelInvocationResponse {
            output: Some(Value::String("recovered".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        },
    });
    let retry = Arc::new(RecordingRetryPolicy::default());
    let mut engine_effects = effects(
        model,
        Arc::new(VectorTools {
            outputs: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }),
        Arc::new(RecordingEvents::default()),
        Arc::new(RecordingCheckpoints::default()),
        Arc::new(RecordingPostCommit::default()),
    );
    engine_effects.retry = retry.clone();
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        engine_effects,
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-retry-policy",
                "turn-retry-policy",
                vec![Message::with_text(Role::User, "retry")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(retry.0.load(Ordering::SeqCst), 1);
}

#[derive(Default)]
struct RecordingConversation(Mutex<Vec<Vec<String>>>);

impl ConversationPort for RecordingConversation {
    fn format_tool_exchange(
        &self,
        response: &ModelInvocationResponse,
        results: &[EngineToolResult],
    ) -> Result<Vec<Message>, PortError> {
        let ordered = response
            .tool_requests
            .iter()
            .map(|request| {
                results
                    .iter()
                    .find(|result| result.request_id == request.id)
                    .unwrap()
                    .model_text()
            })
            .collect::<Vec<_>>();
        self.0.lock().unwrap().push(ordered.clone());
        Ok(vec![Message::with_text(
            Role::User,
            format!("batched:{}", ordered.join(",")),
        )])
    }
}

struct FailingConversation;

impl ConversationPort for FailingConversation {
    fn format_tool_exchange(
        &self,
        _response: &ModelInvocationResponse,
        _results: &[EngineToolResult],
    ) -> Result<Vec<Message>, PortError> {
        Err(PortError::configuration(
            "conversation adapter rejected batch",
        ))
    }
}

#[tokio::test]
async fn conversation_failure_occurs_after_the_tool_result_is_durable() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: None,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: vec![EngineToolRequest {
                id: "call-durable-format".to_string(),
                name: "write".to_string(),
                arguments: Some(Value::Null),
                metadata: Value::Null,
            }],
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let mut engine_effects = effects(
        model,
        Arc::new(VectorTools {
            outputs: HashMap::from([("call-durable-format".to_string(), "written".to_string())]),
            calls: Mutex::new(Vec::new()),
        }),
        events.clone(),
        checkpoints.clone(),
        Arc::new(RecordingPostCommit::default()),
    );
    engine_effects.conversation = Arc::new(FailingConversation);
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        engine_effects,
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-format-failure",
                "turn-format-failure",
                vec![Message::with_text(Role::User, "write")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Failed);
    assert_eq!(
        result.commit.output.as_ref().unwrap()["errorKind"],
        "conversation_format_error"
    );
    assert!(checkpoints.0.lock().unwrap().iter().any(|checkpoint| {
        checkpoint.pending_tool_requests.is_empty()
            && checkpoint.pending_model_response.is_some()
            && checkpoint
                .completed_tool_results
                .iter()
                .any(|result| result.request_id == "call-durable-format")
    }));
    let kinds = events
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.kind)
        .collect::<Vec<_>>();
    assert!(
        kinds
            .iter()
            .position(|kind| *kind == EngineEventKind::Tool_execution_completed)
            < kinds
                .iter()
                .position(|kind| *kind == EngineEventKind::Turn_failed)
    );
}

#[tokio::test]
async fn conversation_port_formats_a_complete_ordered_tool_batch_once() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([
            ModelInvocationResponse {
                output: None,
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: vec![
                    EngineToolRequest {
                        id: "call-a".to_string(),
                        name: "a".to_string(),
                        arguments: Some(Value::Null),
                        metadata: Value::Null,
                    },
                    EngineToolRequest {
                        id: "call-b".to_string(),
                        name: "b".to_string(),
                        arguments: Some(Value::Null),
                        metadata: Value::Null,
                    },
                ],
                next_context_state: None,
                metadata: Value::Null,
            },
            ModelInvocationResponse {
                output: Some(Value::String("done".to_string())),
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: Vec::new(),
                next_context_state: None,
                metadata: Value::Null,
            },
        ])),
        requests: Mutex::new(Vec::new()),
    });
    let conversation = Arc::new(RecordingConversation::default());
    let events = Arc::new(RecordingEvents::default());
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let mut engine_effects = effects(
        model.clone(),
        Arc::new(VectorTools {
            outputs: HashMap::from([
                ("call-a".to_string(), "A".to_string()),
                ("call-b".to_string(), "B".to_string()),
            ]),
            calls: Mutex::new(Vec::new()),
        }),
        events.clone(),
        checkpoints.clone(),
        Arc::new(RecordingPostCommit::default()),
    );
    engine_effects.conversation = conversation.clone();
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        engine_effects,
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "session-conversation",
                "turn-conversation",
                vec![Message::with_text(Role::User, "run")],
            ),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    assert_eq!(result.commit.status, TurnStatus::Success);
    assert_eq!(
        conversation.0.lock().unwrap().as_slice(),
        &[vec!["A".to_string(), "B".to_string()]]
    );
    assert!(
        model.requests.lock().unwrap()[1]
            .context
            .messages
            .iter()
            .any(|message| message.text_content() == "batched:A,B")
    );
    let event_kinds = events
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.kind)
        .collect::<Vec<_>>();
    assert_eq!(
        event_kinds
            .iter()
            .filter(|kind| **kind == EngineEventKind::Tool_execution_completed)
            .count(),
        2
    );
    assert_eq!(
        event_kinds
            .iter()
            .filter(|kind| **kind == EngineEventKind::Tool_result_committed)
            .count(),
        2
    );
    assert!(
        event_kinds
            .iter()
            .rposition(|kind| *kind == EngineEventKind::Tool_execution_completed)
            < event_kinds
                .iter()
                .position(|kind| *kind == EngineEventKind::Tool_result_committed)
    );
    assert!(
        event_kinds
            .iter()
            .rposition(|kind| *kind == EngineEventKind::Tool_result_committed)
            < event_kinds
                .iter()
                .position(|kind| *kind == EngineEventKind::Conversation_updated)
    );
    let checkpoints = checkpoints.0.lock().unwrap();
    assert!(
        checkpoints
            .iter()
            .any(|checkpoint| checkpoint.pending_model_response.is_some())
    );
    assert!(checkpoints.iter().any(|checkpoint| {
        checkpoint.pending_model_response.is_none()
            && checkpoint
                .messages
                .iter()
                .any(|message| message.text_content() == "batched:A,B")
    }));
    let durable_tool_checkpoint = checkpoints
        .iter()
        .find(|checkpoint| {
            checkpoint.pending_tool_requests.is_empty()
                && checkpoint.pending_model_response.is_some()
                && checkpoint.completed_tool_results.len() == 2
        })
        .unwrap()
        .clone();
    drop(checkpoints);

    let resumed_model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("resumed".to_string())),
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let resumed_conversation = Arc::new(RecordingConversation::default());
    let mut resumed_effects = effects(
        resumed_model.clone(),
        Arc::new(VectorTools {
            outputs: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }),
        Arc::new(RecordingEvents::default()),
        Arc::new(RecordingCheckpoints::default()),
        Arc::new(RecordingPostCommit::default()),
    );
    resumed_effects.conversation = resumed_conversation.clone();
    let resumed = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        resumed_effects,
    )
    .run(
        TurnEngineRequest::resume_from(
            &durable_tool_checkpoint,
            2,
            durable_tool_checkpoint.last_sequence as u64,
        ),
        CancellationToken::new(),
    )
    .await
    .unwrap();

    assert_eq!(resumed.commit.status, TurnStatus::Success);
    assert_eq!(resumed_conversation.0.lock().unwrap().len(), 1);
    assert_eq!(
        resumed_model.requests.lock().unwrap()[0].context.iteration,
        1
    );
}

#[test]
fn cancellation_token_can_bridge_an_existing_shared_flag() {
    let shared = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let token = CancellationToken::from_shared(shared.clone());
    assert!(!token.is_cancelled());
    shared.store(true, Ordering::Release);
    assert!(token.is_cancelled());
}

#[test]
fn delegated_under_nests_one_level_and_carries_parent() {
    let request = TurnEngineRequest::new(
        "identity-session",
        "identity-turn",
        vec![Message::with_text(Role::User, "hello")],
    )
    .with_run_id("run-child")
    .delegated_under("run-parent", 2);

    assert_eq!(request.run_id, "run-child");
    assert_eq!(request.parent_run_id.as_deref(), Some("run-parent"));
    assert_eq!(request.delegation_depth, 3);
}

#[tokio::test]
async fn run_identity_round_trips_through_persisted_event_and_checkpoint_json() {
    let model = Arc::new(ScriptedModel {
        responses: Mutex::new(VecDeque::from([ModelInvocationResponse {
            output: Some(Value::String("done".to_string())),
            usage: None,
            assistant_messages: vec![Message::with_text(Role::Assistant, "done")],
            tool_requests: Vec::new(),
            next_context_state: None,
            metadata: Value::Null,
        }])),
        requests: Mutex::new(Vec::new()),
    });
    let events = Arc::new(RecordingEvents::default());
    let checkpoints = Arc::new(RecordingCheckpoints::default());
    let engine = TurnEngine::new(
        ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
        effects(
            model,
            Arc::new(VectorTools {
                outputs: HashMap::new(),
                calls: Mutex::new(Vec::new()),
            }),
            events.clone(),
            checkpoints.clone(),
            Arc::new(RecordingPostCommit::default()),
        ),
    );

    let result = engine
        .run(
            TurnEngineRequest::new(
                "identity-session",
                "identity-turn",
                vec![Message::with_text(Role::User, "hello")],
            )
            .with_run_id("run-child")
            .delegated_under("run-parent", 2),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.commit.status, TurnStatus::Success);

    // Persisted event JSON must carry run identity in canonical camelCase.
    let event = events.0.lock().unwrap().first().cloned().expect("event");
    let event_json = serde_json::to_value(&event).unwrap();
    assert_eq!(event_json["runId"], "run-child");
    assert_eq!(event_json["parentRunId"], "run-parent");
    assert_eq!(event_json["delegationDepth"], 3);
    let event_back: EngineEvent = serde_json::from_value(event_json).unwrap();
    assert_eq!(event_back.run_id, "run-child");
    assert_eq!(event_back.parent_run_id.as_deref(), Some("run-parent"));
    assert_eq!(event_back.delegation_depth, 3);

    // Persisted checkpoint JSON must carry the same run identity in camelCase.
    let checkpoint = checkpoints
        .0
        .lock()
        .unwrap()
        .first()
        .cloned()
        .expect("checkpoint");
    let checkpoint_json = serde_json::to_value(&checkpoint).unwrap();
    assert_eq!(checkpoint_json["runId"], "run-child");
    assert_eq!(checkpoint_json["parentRunId"], "run-parent");
    assert_eq!(checkpoint_json["delegationDepth"], 3);
    let checkpoint_back: EngineCheckpoint = serde_json::from_value(checkpoint_json).unwrap();
    assert_eq!(checkpoint_back.run_id, "run-child");
    assert_eq!(checkpoint_back.parent_run_id.as_deref(), Some("run-parent"));
    assert_eq!(checkpoint_back.delegation_depth, 3);
}
