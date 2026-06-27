use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use prompty::harness::{
    AllowAllPermissionResolver, CollectingEventSink, DenyAllPermissionResolver,
    FunctionHostToolExecutor, InMemoryCheckpointStore, JsonlEventJournalWriter,
};
use prompty::model::events::{
    checkpoint::Checkpoint,
    host_tool_request::HostToolRequest,
    permission_request::PermissionRequest,
    session_event::{SessionEvent, SessionEventType},
    session_summary::SessionSummary,
    turn_event::{TurnEvent, TurnEventType},
};
use prompty::model::pipeline::{
    checkpoint_store::CheckpointStore, event_journal_writer::EventJournalWriter, event_sink::EventSink,
    host_tool_executor::HostToolExecutor, permission_resolver::PermissionResolver,
};
use serde_json::{Value, json};

fn turn_event() -> TurnEvent {
    TurnEvent {
        id: "turn-event".to_string(),
        r#type: TurnEventType::Turn_start,
        timestamp: "2026-06-10T00:00:00Z".to_string(),
        payload: json!({ "phase": "start" }),
        ..Default::default()
    }
}

fn session_event() -> SessionEvent {
    SessionEvent {
        id: "session-event".to_string(),
        r#type: SessionEventType::Session_start,
        timestamp: "2026-06-10T00:00:00Z".to_string(),
        session_id: Some("session-1".to_string()),
        payload: json!({ "phase": "start" }),
        ..Default::default()
    }
}

#[test]
fn collecting_event_sink_captures_events() {
    let sink = CollectingEventSink::new();

    assert!(sink.emit_turn(&turn_event()));
    assert!(sink.emit_session(&session_event()));

    assert_eq!(sink.turn_events()[0].id, "turn-event");
    assert_eq!(sink.session_events()[0].id, "session-event");
}

#[test]
fn jsonl_event_journal_writer_writes_records() {
    let path = std::env::temp_dir().join(format!(
        "prompty-trace-{}.jsonl",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let writer = JsonlEventJournalWriter::new(&path);

    assert!(writer.append_turn(&turn_event()));
    assert!(writer.append_session(&session_event()));
    assert!(writer.close(&Some(SessionSummary {
        session_id: "session-1".to_string(),
        turns: Some(1),
        ..Default::default()
    })));

    let records: Vec<Value> = fs::read_to_string(&path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let _ = fs::remove_file(path);

    assert_eq!(records[0]["kind"], "turn");
    assert_eq!(records[0]["event"]["id"], "turn-event");
    assert_eq!(records[1]["kind"], "session");
    assert_eq!(records[1]["event"]["id"], "session-event");
    assert_eq!(records[2]["kind"], "summary");
    assert_eq!(records[2]["summary"]["sessionId"], "session-1");
}

#[test]
fn jsonl_event_journal_writer_returns_false_after_close() {
    let path = std::env::temp_dir().join(format!(
        "prompty-trace-closed-{}.jsonl",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let writer = JsonlEventJournalWriter::new(&path);

    assert!(writer.close(&None));
    assert!(!writer.append_turn(&turn_event()));
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn in_memory_checkpoint_store_stores_checkpoints() {
    let store = InMemoryCheckpointStore::new();
    let checkpoint = Checkpoint {
        id: Some("checkpoint-1".to_string()),
        session_id: Some("session-1".to_string()),
        title: "First".to_string(),
        ..Default::default()
    };

    assert_eq!(store.save(&checkpoint).await.unwrap().id, checkpoint.id);
    assert_eq!(
        store
            .load(&"session-1".to_string(), &"checkpoint-1".to_string())
            .await
            .unwrap()
            .unwrap()
            .title,
        "First"
    );
    assert!(
        store
            .load(&"session-1".to_string(), &"missing".to_string())
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        store
            .list_checkpoints(&"session-1".to_string())
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn in_memory_checkpoint_store_requires_keys() {
    let store = InMemoryCheckpointStore::new();

    assert!(
        store
            .save(&Checkpoint {
                id: Some("checkpoint-1".to_string()),
                ..Default::default()
            })
            .await
            .is_err()
    );
    assert!(
        store
            .save(&Checkpoint {
                session_id: Some("session-1".to_string()),
                ..Default::default()
            })
            .await
            .is_err()
    );
}

#[tokio::test]
async fn permission_resolvers_return_decisions() {
    let request = PermissionRequest {
        request_id: Some("permission-1".to_string()),
        tool_call_id: Some("tool-call-1".to_string()),
        permission: "tool.execute".to_string(),
        ..Default::default()
    };

    let allow = AllowAllPermissionResolver.request(&request).await.unwrap();
    let deny = DenyAllPermissionResolver.request(&request).await.unwrap();

    assert!(allow.approved);
    assert_eq!(allow.reason.as_deref(), Some("allow_all"));
    assert_eq!(allow.request_id.as_deref(), Some("permission-1"));
    assert_eq!(allow.tool_call_id.as_deref(), Some("tool-call-1"));
    assert!(!deny.approved);
    assert_eq!(deny.reason.as_deref(), Some("deny_all"));
}

#[tokio::test]
async fn function_host_tool_executor_executes_registered_handlers() {
    let mut handlers = HashMap::new();
    handlers.insert(
        "add".to_string(),
        Arc::new(
            |args: &Value,
             _request: &HostToolRequest|
             -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
                Ok(json!(
                    args["a"].as_i64().unwrap() + args["b"].as_i64().unwrap()
                ))
            },
        ) as Arc<_>,
    );
    let executor = FunctionHostToolExecutor::new(handlers);

    let result = executor
        .execute(&HostToolRequest {
            request_id: Some("exec-1".to_string()),
            tool_name: "add".to_string(),
            arguments: json!({ "a": 2, "b": 3 }),
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(result.success);
    assert_eq!(result.request_id.as_deref(), Some("exec-1"));
    assert_eq!(result.result, Some(json!(5)));
}

#[tokio::test]
async fn function_host_tool_executor_passes_empty_arguments() {
    let mut handlers = HashMap::new();
    handlers.insert(
        "count".to_string(),
        Arc::new(
            |args: &Value,
             _request: &HostToolRequest|
             -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
                Ok(json!(args.as_object().unwrap().len()))
            },
        ) as Arc<_>,
    );
    let executor = FunctionHostToolExecutor::new(handlers);

    let result = executor
        .execute(&HostToolRequest {
            tool_name: "count".to_string(),
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(result.success);
    assert_eq!(result.result, Some(json!(0)));
}

#[tokio::test]
async fn function_host_tool_executor_returns_failure_results() {
    let mut handlers = HashMap::new();
    handlers.insert(
        "fail".to_string(),
        Arc::new(
            |_args: &Value,
             _request: &HostToolRequest|
             -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
                Err(Box::new(std::io::Error::other("boom")))
            },
        ) as Arc<_>,
    );
    let executor = FunctionHostToolExecutor::new(handlers);

    let missing = executor
        .execute(&HostToolRequest {
            tool_name: "missing".to_string(),
            ..Default::default()
        })
        .await
        .unwrap();
    let thrown = executor
        .execute(&HostToolRequest {
            tool_name: "fail".to_string(),
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(!missing.success);
    assert_eq!(missing.error_kind.as_deref(), Some("not_found"));
    assert!(!thrown.success);
    assert_eq!(thrown.error_kind.as_deref(), Some("exception"));
    assert_eq!(thrown.result, Some(json!({ "message": "boom" })));
}
