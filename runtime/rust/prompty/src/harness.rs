//! Reference harness adapters for event, trace, permission, checkpoint, and tool protocols.

use std::collections::HashMap;
use std::error::Error;
use std::fs::{OpenOptions, create_dir_all};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};

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

pub struct ReferenceTurnRunner<S, J, C, P, H>
where
    S: EventSink,
    J: EventJournalWriter,
    C: CheckpointStore,
    P: PermissionResolver,
    H: HostToolExecutor,
{
    event_sink: S,
    journal: J,
    checkpoint_store: C,
    permission_resolver: P,
    host_tool_executor: H,
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
            event_sink,
            journal,
            checkpoint_store,
            permission_resolver,
            host_tool_executor,
            invoke_model,
            now,
            next_id,
        }
    }

    pub async fn run(&self, request: RunTurnRequest) -> Result<RunTurnResult, AdapterError> {
        let options = request.options.clone().unwrap_or_default();
        let max_iterations = options.max_iterations.unwrap_or(10).max(0) as usize;
        let inputs = if request.inputs.is_null() {
            json!({})
        } else {
            request.inputs.clone()
        };
        let mut checkpoints = Vec::new();
        let mut all_tool_results = Vec::new();
        let mut pending_tool_results = Vec::new();
        let mut output = None;
        let mut status = RunTurnStatus::Success;
        let mut iterations = 0i32;

        self.record_session(
            SessionEventType::Session_start,
            &request.session_id,
            &request.turn_id,
            json!({ "sessionId": request.session_id, "schemaVersion": "1" }),
        );
        self.record_turn(
            TurnEventType::Turn_start,
            &request.turn_id,
            0,
            json!({ "inputs": inputs, "maxIterations": max_iterations }),
        );

        for iteration in 0..max_iterations {
            iterations = iteration as i32 + 1;
            self.record_turn(
                TurnEventType::Llm_start,
                &request.turn_id,
                iteration,
                json!({ "attempt": 0 }),
            );
            let model_response = (self.invoke_model)(TurnModelRequest {
                session_id: request.session_id.clone(),
                turn_id: request.turn_id.clone(),
                iteration: iteration as i32,
                inputs: inputs.clone(),
                options: Some(options.clone()),
                tool_results: pending_tool_results.clone(),
            })?;
            self.record_turn(
                TurnEventType::Llm_complete,
                &request.turn_id,
                iteration,
                json!({}),
            );
            let checkpoint = self
                .save_checkpoint(
                    &request.session_id,
                    &request.turn_id,
                    iteration,
                    &model_response,
                )
                .await?;
            checkpoints.push(checkpoint);

            if model_response.tool_requests.is_empty() {
                output = model_response.output;
                break;
            }

            pending_tool_results = Vec::new();
            for tool_request in model_response.tool_requests {
                let tool_result = self
                    .resolve_and_execute_tool(&request.turn_id, iteration, &tool_request)
                    .await?;
                pending_tool_results.push(tool_result.clone());
                all_tool_results.push(tool_result);
            }

            self.record_turn(
                TurnEventType::Messages_updated,
                &request.turn_id,
                iteration,
                json!({
                    "toolResults": pending_tool_results
                        .iter()
                        .map(|result| result.to_value(&SaveContext::new()))
                        .collect::<Vec<_>>()
                }),
            );
        }

        if output.is_none() && !pending_tool_results.is_empty() {
            status = RunTurnStatus::Error;
            output = Some(json!({ "message": "Maximum turn iterations reached" }));
            self.record_turn(
                TurnEventType::Error,
                &request.turn_id,
                iterations as usize,
                json!({
                    "errorKind": "max_iterations",
                    "message": "Maximum turn iterations reached"
                }),
            );
        }

        self.record_turn(
            TurnEventType::Turn_end,
            &request.turn_id,
            iterations as usize,
            json!({ "iterations": iterations, "status": status.as_str(), "response": output }),
        );
        self.record_session(
            SessionEventType::Session_end,
            &request.session_id,
            &request.turn_id,
            json!({ "sessionId": request.session_id, "status": status.as_str(), "reason": "turn_complete" }),
        );
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
            iterations,
            tool_results: all_tool_results,
            checkpoints,
        })
    }

    async fn save_checkpoint(
        &self,
        session_id: &str,
        turn_id: &str,
        iteration: usize,
        response: &TurnModelResponse,
    ) -> Result<Checkpoint, AdapterError> {
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
            id: Some(format!("{turn_id}-checkpoint-{iteration}")),
            session_id: Some(session_id.to_string()),
            turn_id: Some(turn_id.to_string()),
            checkpoint_number: Some(iteration as i32 + 1),
            title: format!("Turn {turn_id} iteration {iteration}"),
            state,
            created_at: Some((self.now)()),
            ..Default::default()
        };
        let saved = self.checkpoint_store.save(&checkpoint).await?;
        self.record_session(
            SessionEventType::Checkpoint_created,
            session_id,
            turn_id,
            json!({
                "checkpointId": saved.id,
                "checkpointNumber": saved.checkpoint_number
            }),
        );
        Ok(saved)
    }

    async fn resolve_and_execute_tool(
        &self,
        turn_id: &str,
        iteration: usize,
        tool_request: &HostToolRequest,
    ) -> Result<HostToolResult, AdapterError> {
        let permission = PermissionRequest {
            request_id: Some(
                tool_request
                    .request_id
                    .as_ref()
                    .map(|request_id| format!("{request_id}-permission"))
                    .unwrap_or_else(|| (self.next_id)("permission")),
            ),
            tool_call_id: tool_request.tool_call_id.clone(),
            permission: "tool.execute".to_string(),
            target: Some(tool_request.tool_name.clone()),
            details: tool_request.to_value(&SaveContext::new()),
            ..Default::default()
        };
        self.record_turn(
            TurnEventType::Permission_requested,
            turn_id,
            iteration,
            permission.to_value(&SaveContext::new()),
        );
        let decision = self.permission_resolver.request(&permission).await?;
        self.record_turn(
            TurnEventType::Permission_completed,
            turn_id,
            iteration,
            decision.to_value(&SaveContext::new()),
        );

        if !decision.approved {
            return Ok(HostToolResult {
                request_id: tool_request.request_id.clone(),
                tool_call_id: tool_request.tool_call_id.clone(),
                tool_name: tool_request.tool_name.clone(),
                success: false,
                result: Some(
                    json!({ "message": decision.reason.unwrap_or_else(|| "Permission denied".to_string()) }),
                ),
                error_kind: Some("permission_denied".to_string()),
                ..Default::default()
            });
        }

        self.record_turn(
            TurnEventType::Tool_execution_start,
            turn_id,
            iteration,
            tool_request.to_value(&SaveContext::new()),
        );
        let result = self.host_tool_executor.execute(tool_request).await?;
        self.record_turn(
            TurnEventType::Tool_execution_complete,
            turn_id,
            iteration,
            result.to_value(&SaveContext::new()),
        );
        self.record_turn(
            TurnEventType::Tool_result,
            turn_id,
            iteration,
            result.to_value(&SaveContext::new()),
        );
        Ok(result)
    }

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
}
