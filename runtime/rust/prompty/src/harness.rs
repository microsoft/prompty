//! Reference harness adapters for event, trace, permission, checkpoint, and tool protocols.

use std::collections::HashMap;
use std::error::Error;
use std::fs::{OpenOptions, create_dir_all};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::engine::{
    AppendContextPackingStrategy, CancellationToken, Clock as EngineClock, ContextPipeline,
    DefaultConversationPort, DurabilityPort, EngineCheckpoint, EngineEvent, EngineEventKind,
    EnginePermissionDecision, EngineToolRequest, EngineToolResult, IdGenerator,
    ModelInvocationRequest, ModelInvocationResponse, ModelPort, NoopHostPolicyPort,
    NoopModelStreamPort, NoopPostCommitPort, NoopRetryPolicyPort, PermissionPort, PortError,
    ToolOutcome, ToolPort, TurnEngine, TurnEngineEffects, TurnEngineRequest, TurnStatus,
};
use crate::model::context::SaveContext;
use crate::model::events::{
    checkpoint::Checkpoint,
    host_tool_request::HostToolRequest,
    host_tool_result::HostToolResult,
    permission_decision::PermissionDecision,
    permission_request::PermissionRequest,
    session_event::{SessionEvent, SessionEventType},
    session_summary::{SessionSummary, SessionSummaryStatus},
    turn_event::{TurnEvent, TurnEventType},
};
use crate::model::pipeline::{
    checkpoint_store::CheckpointStore,
    event_journal_writer::EventJournalWriter,
    event_sink::EventSink,
    host_tool_executor::HostToolExecutor,
    permission_resolver::PermissionResolver,
    replay_journal_record::ReplayJournalRecord,
    replay_mismatch::ReplayMismatch,
    replay_verification_request::ReplayVerificationRequest,
    replay_verification_result::{ReplayVerificationResult, ReplayVerificationStatus},
    run_turn_request::RunTurnRequest,
    run_turn_result::{RunTurnResult, RunTurnStatus},
    turn_model_request::TurnModelRequest,
    turn_model_response::TurnModelResponse,
};

pub type AdapterError = Box<dyn Error + Send + Sync>;
type ToolHandler = dyn Fn(&Value, &HostToolRequest) -> Result<Value, AdapterError> + Send + Sync;

fn checkpoint_key(session_id: &str, checkpoint_id: &str) -> (String, String) {
    (session_id.to_string(), checkpoint_id.to_string())
}

fn require_checkpoint_key(checkpoint: &Checkpoint) -> Result<(String, String), AdapterError> {
    let session_id = checkpoint.session_id.clone().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Checkpoint session_id is required",
        )
    })?;
    let checkpoint_id = checkpoint.id.clone().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Checkpoint id is required",
        )
    })?;
    Ok(checkpoint_key(&session_id, &checkpoint_id))
}

/// Captures emitted turn and session events in memory.
#[derive(Debug, Clone, Default)]
pub struct CollectingEventSink {
    turn_events: Arc<Mutex<Vec<TurnEvent>>>,
    session_events: Arc<Mutex<Vec<SessionEvent>>>,
}

impl CollectingEventSink {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn turn_events(&self) -> Vec<TurnEvent> {
        self.turn_events
            .lock()
            .expect("turn events lock poisoned")
            .clone()
    }

    pub fn session_events(&self) -> Vec<SessionEvent> {
        self.session_events
            .lock()
            .expect("session events lock poisoned")
            .clone()
    }
}

impl EventSink for CollectingEventSink {
    fn emit_turn(&self, turn_event: &TurnEvent) -> bool {
        self.turn_events
            .lock()
            .expect("turn events lock poisoned")
            .push(turn_event.clone());
        true
    }

    fn emit_session(&self, session_event: &SessionEvent) -> bool {
        self.session_events
            .lock()
            .expect("session events lock poisoned")
            .push(session_event.clone());
        true
    }
}

/// Appends replayable event journal records as newline-delimited JSON.
#[derive(Debug)]
pub struct JsonlEventJournalWriter {
    path: PathBuf,
    closed: Mutex<bool>,
}

impl JsonlEventJournalWriter {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        if let Some(parent) = path.parent() {
            let _ = create_dir_all(parent);
        }
        Self {
            path,
            closed: Mutex::new(false),
        }
    }

    fn write(&self, record: Value) -> bool {
        let closed = self.closed.lock().expect("trace writer lock poisoned");
        if *closed {
            return false;
        }
        Self::append_record(&self.path, record)
    }

    fn append_record(path: &PathBuf, record: Value) -> bool {
        let mut file = match OpenOptions::new().create(true).append(true).open(path) {
            Ok(file) => file,
            Err(_) => return false,
        };
        writeln!(file, "{}", record).is_ok()
    }
}

impl EventJournalWriter for JsonlEventJournalWriter {
    fn append_turn(&self, turn_event: &TurnEvent) -> bool {
        self.write(json!({ "kind": "turn", "event": turn_event.to_value(&SaveContext::new()) }))
    }

    fn append_session(&self, session_event: &SessionEvent) -> bool {
        self.write(
            json!({ "kind": "session", "event": session_event.to_value(&SaveContext::new()) }),
        )
    }

    fn close(&self, summary: &Option<SessionSummary>) -> bool {
        let mut closed = self.closed.lock().expect("trace writer lock poisoned");
        if *closed {
            return false;
        }
        let wrote_summary = match summary {
            Some(summary) => Self::append_record(
                &self.path,
                json!({ "kind": "summary", "summary": summary.to_value(&SaveContext::new()) }),
            ),
            None => true,
        };
        if !wrote_summary {
            return false;
        }
        *closed = true;
        wrote_summary
    }
}

/// Verifies normalized replay journal records.
#[derive(Debug, Clone, Default)]
pub struct ReferenceReplayVerifier;

impl ReferenceReplayVerifier {
    pub fn verify(&self, request: ReplayVerificationRequest) -> ReplayVerificationResult {
        let expected = request.expected;
        let actual = request.actual;
        let max = expected.len().max(actual.len());
        let mut mismatches = Vec::new();

        for index in 0..max {
            let expected_record = expected.get(index).cloned();
            let actual_record = actual.get(index).cloned();
            if comparable_replay_record(expected_record.as_ref())
                != comparable_replay_record(actual_record.as_ref())
            {
                let message = if expected_record.is_none() {
                    "Unexpected extra replay record"
                } else if actual_record.is_none() {
                    "Missing replay record"
                } else {
                    "Replay record mismatch"
                };
                mismatches.push(ReplayMismatch {
                    index: index as i32,
                    expected: expected_record,
                    actual: actual_record,
                    message: message.to_string(),
                });
            }
        }

        ReplayVerificationResult {
            status: if mismatches.is_empty() {
                ReplayVerificationStatus::Passed
            } else {
                ReplayVerificationStatus::Failed
            },
            expected_count: expected.len() as i32,
            actual_count: actual.len() as i32,
            mismatches,
        }
    }
}

fn comparable_replay_record(record: Option<&ReplayJournalRecord>) -> Option<String> {
    record.map(|record| serde_json::to_string(&record.to_value(&SaveContext::new())).unwrap())
}

/// Stores checkpoints in memory by session and checkpoint identifier.
#[derive(Debug, Clone, Default)]
pub struct InMemoryCheckpointStore {
    checkpoints: Arc<Mutex<HashMap<(String, String), Checkpoint>>>,
}

impl InMemoryCheckpointStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl CheckpointStore for InMemoryCheckpointStore {
    async fn save(&self, checkpoint: &Checkpoint) -> Result<Checkpoint, AdapterError> {
        self.checkpoints
            .lock()
            .expect("checkpoint store lock poisoned")
            .insert(require_checkpoint_key(checkpoint)?, checkpoint.clone());
        Ok(checkpoint.clone())
    }

    async fn load(
        &self,
        session_id: &String,
        checkpoint_id: &String,
    ) -> Result<Option<Checkpoint>, AdapterError> {
        Ok(self
            .checkpoints
            .lock()
            .expect("checkpoint store lock poisoned")
            .get(&checkpoint_key(session_id, checkpoint_id))
            .cloned())
    }

    async fn list_checkpoints(&self, session_id: &String) -> Result<Vec<Checkpoint>, AdapterError> {
        let mut checkpoints: Vec<Checkpoint> = self
            .checkpoints
            .lock()
            .expect("checkpoint store lock poisoned")
            .values()
            .filter(|checkpoint| checkpoint.session_id.as_deref() == Some(session_id.as_str()))
            .cloned()
            .collect();
        checkpoints.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(checkpoints)
    }
}

/// Resolves every permission request as approved.
#[derive(Debug, Clone, Default)]
pub struct AllowAllPermissionResolver;

#[async_trait::async_trait]
impl PermissionResolver for AllowAllPermissionResolver {
    async fn request(
        &self,
        request: &PermissionRequest,
    ) -> Result<PermissionDecision, AdapterError> {
        Ok(PermissionDecision {
            request_id: request.request_id.clone(),
            tool_call_id: request.tool_call_id.clone(),
            permission: request.permission.clone(),
            approved: true,
            reason: Some("allow_all".to_string()),
            result: Value::Null,
        })
    }
}

/// Resolves every permission request as denied.
#[derive(Debug, Clone, Default)]
pub struct DenyAllPermissionResolver;

#[async_trait::async_trait]
impl PermissionResolver for DenyAllPermissionResolver {
    async fn request(
        &self,
        request: &PermissionRequest,
    ) -> Result<PermissionDecision, AdapterError> {
        Ok(PermissionDecision {
            request_id: request.request_id.clone(),
            tool_call_id: request.tool_call_id.clone(),
            permission: request.permission.clone(),
            approved: false,
            reason: Some("deny_all".to_string()),
            result: Value::Null,
        })
    }
}

/// Dispatches host tool requests to registered local functions.
#[derive(Clone, Default)]
pub struct FunctionHostToolExecutor {
    handlers: Arc<HashMap<String, Arc<ToolHandler>>>,
}

impl FunctionHostToolExecutor {
    pub fn new(handlers: HashMap<String, Arc<ToolHandler>>) -> Self {
        Self {
            handlers: Arc::new(handlers),
        }
    }
}

#[async_trait::async_trait]
impl HostToolExecutor for FunctionHostToolExecutor {
    async fn execute(&self, request: &HostToolRequest) -> Result<HostToolResult, AdapterError> {
        let started = Instant::now();
        let Some(handler) = self.handlers.get(&request.tool_name) else {
            return Ok(HostToolResult {
                request_id: request.request_id.clone(),
                tool_call_id: request.tool_call_id.clone(),
                tool_name: request.tool_name.clone(),
                success: false,
                result: Some(
                    json!({ "message": format!("No host tool registered for '{}'", request.tool_name) }),
                ),
                exit_code: None,
                duration_ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                error_kind: Some("not_found".to_string()),
                telemetry: Value::Null,
            });
        };

        let empty_arguments;
        let arguments = if request.arguments.is_null() {
            empty_arguments = Value::Object(serde_json::Map::new());
            &empty_arguments
        } else {
            &request.arguments
        };

        match handler(arguments, request) {
            Ok(result) => Ok(HostToolResult {
                request_id: request.request_id.clone(),
                tool_call_id: request.tool_call_id.clone(),
                tool_name: request.tool_name.clone(),
                success: true,
                result: Some(result),
                exit_code: None,
                duration_ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                error_kind: None,
                telemetry: Value::Null,
            }),
            Err(error) => Ok(HostToolResult {
                request_id: request.request_id.clone(),
                tool_call_id: request.tool_call_id.clone(),
                tool_name: request.tool_name.clone(),
                success: false,
                result: Some(json!({ "message": error.to_string() })),
                exit_code: None,
                duration_ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                error_kind: Some("exception".to_string()),
                telemetry: Value::Null,
            }),
        }
    }
}

type ModelCallback =
    dyn Fn(TurnModelRequest) -> Result<TurnModelResponse, AdapterError> + Send + Sync;
type Clock = dyn Fn() -> String + Send + Sync;
type IdFactory = dyn Fn(&str) -> String + Send + Sync;

fn port_error(stage: &str, error: impl std::fmt::Display) -> PortError {
    PortError::new(format!("{stage}: {error}"))
}

fn host_request(request: &EngineToolRequest) -> Result<HostToolRequest, PortError> {
    request
        .metadata
        .get("hostToolRequest")
        .map(|value| {
            HostToolRequest::load_from_value(value, &crate::model::context::LoadContext::new())
        })
        .ok_or_else(|| {
            PortError::configuration("engine tool request is missing hostToolRequest metadata")
        })
}

fn build_permission_request(request: &HostToolRequest, next_id: &IdFactory) -> PermissionRequest {
    PermissionRequest {
        request_id: Some(
            request
                .request_id
                .as_ref()
                .map(|id| format!("{id}-permission"))
                .unwrap_or_else(|| next_id("permission")),
        ),
        tool_call_id: request.tool_call_id.clone(),
        permission: "tool.execute".to_string(),
        target: Some(request.tool_name.clone()),
        details: request.to_value(&SaveContext::new()),
        ..Default::default()
    }
}

fn host_result(result: &EngineToolResult) -> Result<HostToolResult, PortError> {
    result
        .metadata
        .get("hostToolResult")
        .map(|value| {
            HostToolResult::load_from_value(value, &crate::model::context::LoadContext::new())
        })
        .ok_or_else(|| PortError::new("engine tool result is missing hostToolResult metadata"))
}

struct ReferenceModelPort {
    callback: Arc<ModelCallback>,
    options: crate::model::pipeline::turn_options::TurnOptions,
    inputs: Value,
    pending_results: Arc<Mutex<Vec<HostToolResult>>>,
    adapter_failure: Arc<Mutex<Option<String>>>,
}

#[async_trait]
impl ModelPort for ReferenceModelPort {
    async fn invoke(
        &self,
        request: &ModelInvocationRequest,
        _cancellation: &CancellationToken,
        _stream: &dyn crate::engine::ModelStreamPort,
    ) -> Result<ModelInvocationResponse, PortError> {
        let tool_results = std::mem::take(
            &mut *self
                .pending_results
                .lock()
                .expect("reference tool results lock poisoned"),
        );
        let response = (self.callback)(TurnModelRequest {
            session_id: request.context.session_id.clone(),
            turn_id: request.context.turn_id.clone(),
            iteration: request.context.iteration,
            inputs: self.inputs.clone(),
            options: Some(self.options.clone()),
            tool_results,
        })
        .map_err(|error| {
            let message = format!("reference model callback: {error}");
            *self
                .adapter_failure
                .lock()
                .expect("reference adapter failure lock poisoned") = Some(message.clone());
            PortError::new(message)
        })?;
        let response_value = response.to_value(&SaveContext::new());

        let tool_requests = response
            .tool_requests
            .iter()
            .enumerate()
            .map(|(index, host)| {
                let request_id = host
                    .request_id
                    .clone()
                    .or_else(|| host.tool_call_id.clone())
                    .unwrap_or_else(|| {
                        format!("reference-tool-{}-{index}", request.context.iteration)
                    });
                EngineToolRequest {
                    id: request_id,
                    name: host.tool_name.clone(),
                    arguments: host.arguments.clone(),
                    metadata: json!({
                        "hostToolRequest": host.to_value(&SaveContext::new()),
                    }),
                }
            })
            .collect();

        Ok(ModelInvocationResponse {
            output: response.output,
            usage: None,
            assistant_messages: Vec::new(),
            tool_requests,
            next_portability: None,
            delegated_state: None,
            metadata: json!({
                "referenceResponse": response_value,
            }),
        })
    }
}

struct ReferencePermissionPort<P> {
    resolver: Arc<P>,
    pending_results: Arc<Mutex<Vec<HostToolResult>>>,
    all_results: Arc<Mutex<Vec<HostToolResult>>>,
    adapter_failure: Arc<Mutex<Option<String>>>,
    permission_requests: Arc<Mutex<HashMap<String, PermissionRequest>>>,
}

#[async_trait]
impl<P> PermissionPort for ReferencePermissionPort<P>
where
    P: PermissionResolver + Send + Sync,
{
    async fn authorize(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EnginePermissionDecision, PortError> {
        let permission = self
            .permission_requests
            .lock()
            .expect("reference permission requests lock poisoned")
            .get(&request.id)
            .cloned()
            .ok_or_else(|| {
                PortError::configuration(format!(
                    "permission request '{}' was not projected",
                    request.id
                ))
            })?;
        let decision = self.resolver.request(&permission).await.map_err(|error| {
            let message = format!("reference permission resolver: {error}");
            *self
                .adapter_failure
                .lock()
                .expect("reference adapter failure lock poisoned") = Some(message.clone());
            PortError::new(message)
        })?;
        if !decision.approved {
            let host = host_request(request)?;
            let result = HostToolResult {
                request_id: host.request_id.or_else(|| Some(request.id.clone())),
                tool_call_id: host.tool_call_id,
                tool_name: host.tool_name,
                success: false,
                result: Some(json!({
                    "message": decision
                        .reason
                        .clone()
                        .unwrap_or_else(|| "Permission denied".to_string())
                })),
                error_kind: Some("permission_denied".to_string()),
                ..Default::default()
            };
            self.pending_results
                .lock()
                .expect("reference tool results lock poisoned")
                .push(result.clone());
            self.all_results
                .lock()
                .expect("reference all tool results lock poisoned")
                .push(result);
        }
        Ok(EnginePermissionDecision {
            approved: decision.approved,
            reason: decision.reason.clone(),
            metadata: json!({
                "permissionDecision": decision.to_value(&SaveContext::new()),
            }),
        })
    }
}

struct ReferenceToolPort<H> {
    executor: Arc<H>,
    pending_results: Arc<Mutex<Vec<HostToolResult>>>,
    all_results: Arc<Mutex<Vec<HostToolResult>>>,
    adapter_failure: Arc<Mutex<Option<String>>>,
}

#[async_trait]
impl<H> ToolPort for ReferenceToolPort<H>
where
    H: HostToolExecutor + Send + Sync,
{
    async fn execute(
        &self,
        request: &EngineToolRequest,
        _cancellation: &CancellationToken,
    ) -> Result<EngineToolResult, PortError> {
        let host_request = host_request(request)?;
        let result = self
            .executor
            .execute(&host_request)
            .await
            .map_err(|error| {
                let message = format!("reference host tool executor: {error}");
                *self
                    .adapter_failure
                    .lock()
                    .expect("reference adapter failure lock poisoned") = Some(message.clone());
                PortError::configuration(message)
            })?;
        self.pending_results
            .lock()
            .expect("reference tool results lock poisoned")
            .push(result.clone());
        self.all_results
            .lock()
            .expect("reference all tool results lock poisoned")
            .push(result.clone());
        Ok(engine_tool_result(request, &result))
    }
}

fn engine_tool_result(request: &EngineToolRequest, result: &HostToolResult) -> EngineToolResult {
    EngineToolResult {
        request_id: request.id.clone(),
        name: request.name.clone(),
        outcome: if result.success {
            ToolOutcome::Success
        } else {
            ToolOutcome::Failed
        },
        output: result.result.clone().unwrap_or(Value::Null),
        error_kind: result.error_kind.clone(),
        metadata: json!({
            "hostToolResult": result.to_value(&SaveContext::new()),
        }),
    }
}

struct InternalEngineClock;

impl EngineClock for InternalEngineClock {
    fn now(&self) -> String {
        "1970-01-01T00:00:00Z".to_string()
    }
}

#[derive(Default)]
struct EngineIds(Mutex<u64>);

impl IdGenerator for EngineIds {
    fn next_id(&self, kind: &str) -> String {
        let mut index = self.0.lock().expect("engine id lock poisoned");
        *index += 1;
        format!("{kind}-{index}")
    }
}

struct ReferenceDurability<S, J, C> {
    event_sink: Arc<S>,
    journal: Arc<J>,
    checkpoint_store: Arc<C>,
    checkpoints: Arc<Mutex<Vec<Checkpoint>>>,
    pending_results: Arc<Mutex<Vec<HostToolResult>>>,
    adapter_failure: Arc<Mutex<Option<String>>>,
    permission_requests: Arc<Mutex<HashMap<String, PermissionRequest>>>,
    now: Arc<Clock>,
    next_id: Arc<IdFactory>,
}

impl<S, J, C> ReferenceDurability<S, J, C>
where
    S: EventSink,
    J: EventJournalWriter,
    C: CheckpointStore,
{
    fn record_turn(&self, r#type: TurnEventType, turn_id: &str, iteration: usize, payload: Value) {
        let event = TurnEvent {
            id: (self.next_id)("turn-event"),
            r#type,
            timestamp: (self.now)(),
            turn_id: Some(turn_id.to_string()),
            iteration: Some(iteration as i32),
            payload,
            ..Default::default()
        };
        self.event_sink.emit_turn(&event);
        self.journal.append_turn(&event);
    }

    fn record_session(
        &self,
        r#type: SessionEventType,
        session_id: &str,
        turn_id: &str,
        payload: Value,
    ) {
        let event = SessionEvent {
            id: (self.next_id)("session-event"),
            r#type,
            timestamp: (self.now)(),
            session_id: Some(session_id.to_string()),
            turn_id: Some(turn_id.to_string()),
            payload,
            ..Default::default()
        };
        self.event_sink.emit_session(&event);
        self.journal.append_session(&event);
    }

    async fn save_model_checkpoint(&self, event: &EngineEvent) -> Result<Checkpoint, PortError> {
        let iteration = event.iteration.unwrap_or_default();
        let response = TurnModelResponse::load_from_value(
            &event.payload["metadata"]["referenceResponse"],
            &crate::model::context::LoadContext::new(),
        );
        let mut state = json!({
            "iteration": iteration,
            "output": response.output,
            "toolRequests": response
                .tool_requests
                .iter()
                .map(|request| request.to_value(&SaveContext::new()))
                .collect::<Vec<_>>()
        });
        if let (Some(target), Some(extra)) =
            (state.as_object_mut(), response.checkpoint_state.as_object())
        {
            for (key, value) in extra {
                target.insert(key.clone(), value.clone());
            }
        }
        let checkpoint = Checkpoint {
            id: Some(format!("{}-checkpoint-{iteration}", event.turn_id)),
            session_id: Some(event.session_id.clone()),
            turn_id: Some(event.turn_id.clone()),
            checkpoint_number: Some(iteration as i32 + 1),
            title: format!("Turn {} iteration {iteration}", event.turn_id),
            state,
            created_at: Some((self.now)()),
            ..Default::default()
        };
        let saved = self
            .checkpoint_store
            .save(&checkpoint)
            .await
            .map_err(|error| port_error("reference checkpoint store", error))?;
        self.checkpoints
            .lock()
            .expect("reference checkpoints lock poisoned")
            .push(saved.clone());
        self.record_session(
            SessionEventType::Checkpoint_created,
            &event.session_id,
            &event.turn_id,
            json!({
                "checkpointId": saved.id,
                "checkpointNumber": saved.checkpoint_number
            }),
        );
        Ok(saved)
    }

    fn project_event(&self, event: &EngineEvent) -> Result<(), PortError> {
        let iteration = event.iteration.unwrap_or_default();
        match event.kind {
            EngineEventKind::TurnStarted => {
                self.record_session(
                    SessionEventType::Session_start,
                    &event.session_id,
                    &event.turn_id,
                    json!({ "sessionId": event.session_id, "schemaVersion": "1" }),
                );
                self.record_turn(
                    TurnEventType::Turn_start,
                    &event.turn_id,
                    0,
                    json!({
                        "inputs": event.payload.get("inputs").cloned().unwrap_or_else(|| json!({})),
                        "maxIterations": event.payload["maxIterations"],
                    }),
                );
            }
            EngineEventKind::ModelInvocationStarted => self.record_turn(
                TurnEventType::Llm_start,
                &event.turn_id,
                iteration,
                json!({ "attempt": event.payload["attempt"] }),
            ),
            EngineEventKind::ModelInvocationCompleted
            | EngineEventKind::ModelInvocationReconciled => self.record_turn(
                TurnEventType::Llm_complete,
                &event.turn_id,
                iteration,
                json!({}),
            ),
            EngineEventKind::PermissionRequested => {
                let engine_request: EngineToolRequest =
                    serde_json::from_value(event.payload["toolRequest"].clone())
                        .map_err(|error| port_error("reference permission event", error))?;
                let host = host_request(&engine_request)?;
                let permission = build_permission_request(&host, self.next_id.as_ref());
                self.permission_requests
                    .lock()
                    .expect("reference permission requests lock poisoned")
                    .insert(engine_request.id.clone(), permission.clone());
                self.record_turn(
                    TurnEventType::Permission_requested,
                    &event.turn_id,
                    iteration,
                    permission.to_value(&SaveContext::new()),
                );
            }
            EngineEventKind::PermissionResolved => {
                let decision = event.payload["decision"]["metadata"]["permissionDecision"].clone();
                self.record_turn(
                    TurnEventType::Permission_completed,
                    &event.turn_id,
                    iteration,
                    decision,
                );
            }
            EngineEventKind::ToolExecutionStarted => {
                let engine_request: EngineToolRequest =
                    serde_json::from_value(event.payload["toolRequest"].clone())
                        .map_err(|error| port_error("reference tool event", error))?;
                self.record_turn(
                    TurnEventType::Tool_execution_start,
                    &event.turn_id,
                    iteration,
                    host_request(&engine_request)?.to_value(&SaveContext::new()),
                );
            }
            EngineEventKind::ToolExecutionCompleted => {
                let engine_result: EngineToolResult =
                    serde_json::from_value(event.payload["toolResult"].clone())
                        .map_err(|error| port_error("reference tool result event", error))?;
                let Ok(result) = host_result(&engine_result) else {
                    return Ok(());
                };
                let payload = result.to_value(&SaveContext::new());
                self.record_turn(
                    TurnEventType::Tool_execution_complete,
                    &event.turn_id,
                    iteration,
                    payload.clone(),
                );
            }
            EngineEventKind::ToolResultCommitted => {
                let engine_result: EngineToolResult =
                    serde_json::from_value(event.payload["toolResult"].clone())
                        .map_err(|error| port_error("reference tool result event", error))?;
                let result = self.host_result(&engine_result)?;
                let payload = result.to_value(&SaveContext::new());
                self.record_turn(
                    TurnEventType::Tool_result,
                    &event.turn_id,
                    iteration,
                    payload,
                );
            }
            EngineEventKind::TurnCommitted
            | EngineEventKind::TurnFailed
            | EngineEventKind::TurnCancelled
            | EngineEventKind::TurnReconciliationRequired => {
                if self
                    .adapter_failure
                    .lock()
                    .expect("reference adapter failure lock poisoned")
                    .is_some()
                {
                    return Ok(());
                }
                let iterations = self
                    .checkpoints
                    .lock()
                    .expect("reference checkpoints lock poisoned")
                    .len();
                let status = match event.kind {
                    EngineEventKind::TurnCommitted => RunTurnStatus::Success,
                    EngineEventKind::TurnCancelled => RunTurnStatus::Cancelled,
                    _ => RunTurnStatus::Error,
                };
                let mut output = event.payload["output"].clone();
                let mut error_payload = output.clone();
                if output.get("errorKind").and_then(Value::as_str) == Some("max_iterations") {
                    error_payload = json!({
                        "errorKind": "max_iterations",
                        "message": "Maximum turn iterations reached",
                    });
                    output = json!({ "message": "Maximum turn iterations reached" });
                }
                if event.kind == EngineEventKind::TurnFailed {
                    self.record_turn(
                        TurnEventType::Error,
                        &event.turn_id,
                        iterations,
                        error_payload,
                    );
                }
                self.record_turn(
                    TurnEventType::Turn_end,
                    &event.turn_id,
                    iterations,
                    json!({
                        "iterations": iterations,
                        "status": status.as_str(),
                        "response": output,
                    }),
                );
                self.record_session(
                    SessionEventType::Session_end,
                    &event.session_id,
                    &event.turn_id,
                    json!({
                        "sessionId": event.session_id,
                        "status": status.as_str(),
                        "reason": "turn_complete",
                    }),
                );
            }
            _ => {}
        }
        Ok(())
    }

    fn host_result(&self, engine_result: &EngineToolResult) -> Result<HostToolResult, PortError> {
        host_result(engine_result).or_else(|_| {
            self.pending_results
                .lock()
                .expect("reference tool results lock poisoned")
                .iter()
                .find(|result| {
                    result.request_id.as_deref() == Some(engine_result.request_id.as_str())
                })
                .cloned()
                .ok_or_else(|| {
                    PortError::new("engine tool result is missing hostToolResult metadata")
                })
        })
    }
}

#[async_trait]
impl<S, J, C> DurabilityPort for ReferenceDurability<S, J, C>
where
    S: EventSink + Send + Sync,
    J: EventJournalWriter + Send + Sync,
    C: CheckpointStore + Send + Sync,
{
    async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
        self.project_event(event)
    }

    async fn append_with_checkpoint(
        &self,
        events: &[EngineEvent],
        checkpoint: &EngineCheckpoint,
    ) -> Result<(), PortError> {
        for event in events {
            self.project_event(event)?;
            if matches!(
                event.kind,
                EngineEventKind::ModelInvocationCompleted
                    | EngineEventKind::ModelInvocationReconciled
            ) {
                self.save_model_checkpoint(event).await?;
            }
        }
        if events
            .iter()
            .any(|event| event.kind == EngineEventKind::ConversationUpdated)
            || (events.iter().any(|event| {
                matches!(
                    event.kind,
                    EngineEventKind::ToolExecutionCompleted | EngineEventKind::ToolResultCommitted
                )
            }) && checkpoint.pending_tool_requests.is_empty()
                && checkpoint.pending_model_response.is_none())
        {
            let results = self
                .pending_results
                .lock()
                .expect("reference tool results lock poisoned")
                .iter()
                .map(|result| result.to_value(&SaveContext::new()))
                .collect::<Vec<_>>();
            self.record_turn(
                TurnEventType::Messages_updated,
                &checkpoint.turn_id,
                checkpoint.iteration,
                json!({ "toolResults": results }),
            );
        }
        Ok(())
    }
}

pub struct ReferenceTurnRunner<S, J, C, P, H>
where
    S: EventSink,
    J: EventJournalWriter,
    C: CheckpointStore,
    P: PermissionResolver,
    H: HostToolExecutor,
{
    event_sink: Arc<S>,
    journal: Arc<J>,
    checkpoint_store: Arc<C>,
    permission_resolver: Arc<P>,
    host_tool_executor: Arc<H>,
    invoke_model: Arc<ModelCallback>,
    now: Arc<Clock>,
    next_id: Arc<IdFactory>,
}

impl<S, J, C, P, H> ReferenceTurnRunner<S, J, C, P, H>
where
    S: EventSink,
    J: EventJournalWriter,
    C: CheckpointStore,
    P: PermissionResolver,
    H: HostToolExecutor,
{
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        event_sink: S,
        journal: J,
        checkpoint_store: C,
        permission_resolver: P,
        host_tool_executor: H,
        invoke_model: Arc<ModelCallback>,
        now: Arc<Clock>,
        next_id: Arc<IdFactory>,
    ) -> Self {
        Self {
            event_sink: Arc::new(event_sink),
            journal: Arc::new(journal),
            checkpoint_store: Arc::new(checkpoint_store),
            permission_resolver: Arc::new(permission_resolver),
            host_tool_executor: Arc::new(host_tool_executor),
            invoke_model,
            now,
            next_id,
        }
    }

    pub async fn run(&self, request: RunTurnRequest) -> Result<RunTurnResult, AdapterError>
    where
        S: Send + Sync + 'static,
        J: Send + Sync + 'static,
        C: Send + Sync + 'static,
        P: Send + Sync + 'static,
        H: Send + Sync + 'static,
    {
        let options = request.options.clone().unwrap_or_default();
        let max_iterations = options.max_iterations.unwrap_or(10).max(0) as usize;
        let inputs = if request.inputs.is_null() {
            json!({})
        } else {
            request.inputs.clone()
        };
        let pending_results = Arc::new(Mutex::new(Vec::new()));
        let all_results = Arc::new(Mutex::new(Vec::new()));
        let checkpoints = Arc::new(Mutex::new(Vec::new()));
        let adapter_failure = Arc::new(Mutex::new(None));
        let permission_requests = Arc::new(Mutex::new(HashMap::new()));
        let durability = Arc::new(ReferenceDurability {
            event_sink: self.event_sink.clone(),
            journal: self.journal.clone(),
            checkpoint_store: self.checkpoint_store.clone(),
            checkpoints: checkpoints.clone(),
            pending_results: pending_results.clone(),
            adapter_failure: adapter_failure.clone(),
            permission_requests: permission_requests.clone(),
            now: self.now.clone(),
            next_id: self.next_id.clone(),
        });
        let engine = TurnEngine::new(
            ContextPipeline::new(Arc::new(AppendContextPackingStrategy)),
            TurnEngineEffects {
                model: Arc::new(ReferenceModelPort {
                    callback: self.invoke_model.clone(),
                    options: options.clone(),
                    inputs: inputs.clone(),
                    pending_results: pending_results.clone(),
                    adapter_failure: adapter_failure.clone(),
                }),
                stream: Arc::new(NoopModelStreamPort),
                policy: Arc::new(NoopHostPolicyPort),
                retry: Arc::new(NoopRetryPolicyPort),
                conversation: Arc::new(DefaultConversationPort),
                permission: Arc::new(ReferencePermissionPort {
                    resolver: self.permission_resolver.clone(),
                    pending_results: pending_results.clone(),
                    all_results: all_results.clone(),
                    adapter_failure: adapter_failure.clone(),
                    permission_requests,
                }),
                tools: Arc::new(ReferenceToolPort {
                    executor: self.host_tool_executor.clone(),
                    pending_results,
                    all_results: all_results.clone(),
                    adapter_failure: adapter_failure.clone(),
                }),
                durability,
                post_commit: Arc::new(NoopPostCommitPort),
                clock: Arc::new(InternalEngineClock),
                ids: Arc::new(EngineIds::default()),
            },
        );
        let mut engine_request =
            TurnEngineRequest::new(&request.session_id, &request.turn_id, Vec::new());
        engine_request.inputs = inputs.clone();
        engine_request.max_iterations = max_iterations;
        engine_request.final_output_ready = max_iterations == 0;
        engine_request.max_model_attempts = 1;
        let result = engine
            .run(engine_request, CancellationToken::new())
            .await
            .map_err(|error| -> AdapterError { Box::new(error) })?;
        if let Some(message) = adapter_failure
            .lock()
            .expect("reference adapter failure lock poisoned")
            .take()
        {
            return Err(Box::new(std::io::Error::other(message)));
        }

        let status = match result.commit.status {
            TurnStatus::Success => RunTurnStatus::Success,
            TurnStatus::Cancelled => RunTurnStatus::Cancelled,
            TurnStatus::Failed | TurnStatus::ReconciliationRequired => RunTurnStatus::Error,
        };
        let output = if status == RunTurnStatus::Error
            && result
                .commit
                .output
                .as_ref()
                .and_then(|value| {
                    value
                        .get("errorKind")
                        .and_then(Value::as_str)
                        .filter(|kind| *kind == "max_iterations")
                })
                .is_some()
        {
            Some(json!({ "message": "Maximum turn iterations reached" }))
        } else {
            result.commit.output
        };
        let checkpoints = checkpoints
            .lock()
            .expect("reference checkpoints lock poisoned")
            .clone();
        let tool_results = all_results
            .lock()
            .expect("reference all tool results lock poisoned")
            .clone();
        let summary_status = if status == RunTurnStatus::Success {
            SessionSummaryStatus::Success
        } else {
            SessionSummaryStatus::Error
        };
        self.journal.close(&Some(SessionSummary {
            session_id: request.session_id.clone(),
            status: Some(summary_status),
            turns: Some(1),
            checkpoints: Some(checkpoints.len() as i32),
            ..Default::default()
        }));

        Ok(RunTurnResult {
            session_id: request.session_id,
            turn_id: request.turn_id,
            status,
            output,
            iterations: result.commit.iterations as i32,
            tool_results,
            checkpoints,
        })
    }
}
