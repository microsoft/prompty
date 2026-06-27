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
    checkpoint::Checkpoint, host_tool_request::HostToolRequest, host_tool_result::HostToolResult,
    permission_decision::PermissionDecision, permission_request::PermissionRequest,
    session_event::SessionEvent, session_summary::SessionSummary, turn_event::TurnEvent,
};
use crate::model::pipeline::{
    checkpoint_store::CheckpointStore, event_journal_writer::EventJournalWriter,
    event_sink::EventSink, host_tool_executor::HostToolExecutor,
    permission_resolver::PermissionResolver,
};

type AdapterError = Box<dyn Error + Send + Sync>;
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
