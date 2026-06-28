use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use prompty::harness::{
    AllowAllPermissionResolver, CollectingEventSink, DenyAllPermissionResolver,
    FunctionHostToolExecutor, InMemoryCheckpointStore, JsonlEventJournalWriter,
    ReferenceTurnRunner,
};
use prompty::model::events::host_tool_request::HostToolRequest;
use prompty::model::pipeline::RunTurnRequest;
use prompty::model::pipeline::TurnModelRequest;
use prompty::model::pipeline::TurnModelResponse;
use prompty::model::pipeline::checkpoint_store::CheckpointStore;
use prompty::model::pipeline::run_turn_result::RunTurnStatus;
use prompty::model::pipeline::turn_options::TurnOptions;
use serde_json::{Value, json};

fn trace_path(prefix: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "{prefix}-{}.jsonl",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn fixed_ids() -> Arc<dyn Fn(&str) -> String + Send + Sync> {
    let index = Arc::new(Mutex::new(0));
    Arc::new(move |prefix: &str| {
        let mut index = index.lock().unwrap();
        *index += 1;
        format!("{prefix}-{index}")
    })
}

fn fixed_clock() -> Arc<dyn Fn() -> String + Send + Sync> {
    Arc::new(|| "2026-06-28T00:00:00Z".to_string())
}

fn run_request(session_id: &str, turn_id: &str) -> RunTurnRequest {
    RunTurnRequest {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        inputs: json!({}),
        options: None,
    }
}

fn records(path: &std::path::Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[tokio::test]
async fn reference_turn_runner_emits_journals_and_checkpoints() {
    let path = trace_path("prompty-turn");
    let sink = CollectingEventSink::new();
    let checkpoint_store = InMemoryCheckpointStore::new();
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        checkpoint_store.clone(),
        AllowAllPermissionResolver,
        FunctionHostToolExecutor::default(),
        Arc::new(|request: TurnModelRequest| {
            Ok(TurnModelResponse {
                output: Some(
                    json!({ "text": format!("hello {}", request.inputs["name"].as_str().unwrap()) }),
                ),
                checkpoint_state: json!({ "stable": true }),
                ..Default::default()
            })
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let result = runner
        .run(RunTurnRequest {
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            inputs: json!({ "name": "Ada" }),
            options: Some(TurnOptions {
                max_iterations: Some(3),
                ..Default::default()
            }),
        })
        .await
        .unwrap();

    assert_eq!(result.status, RunTurnStatus::Success);
    assert_eq!(result.iterations, 1);
    assert_eq!(result.output, Some(json!({ "text": "hello Ada" })));
    assert_eq!(
        sink.turn_events()
            .iter()
            .map(|event| event.r#type.to_string())
            .collect::<Vec<_>>(),
        vec!["turn_start", "llm_start", "llm_complete", "turn_end"]
    );
    assert_eq!(
        sink.session_events()
            .iter()
            .map(|event| event.r#type.to_string())
            .collect::<Vec<_>>(),
        vec!["session_start", "checkpoint_created", "session_end"]
    );
    let checkpoint = checkpoint_store
        .load(&"session-1".to_string(), &"turn-1-checkpoint-0".to_string())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(checkpoint.state["stable"], true);
    assert_eq!(
        records(&path)
            .iter()
            .map(|record| record["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "session", "turn", "turn", "turn", "session", "turn", "session", "summary"
        ]
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_executes_host_tools() {
    let path = trace_path("prompty-turn-tool");
    let sink = CollectingEventSink::new();
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
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        AllowAllPermissionResolver,
        FunctionHostToolExecutor::new(handlers),
        Arc::new(|request: TurnModelRequest| {
            if request.iteration == 0 {
                return Ok(TurnModelResponse {
                    tool_requests: vec![HostToolRequest {
                        request_id: Some("exec-1".to_string()),
                        tool_call_id: Some("call-1".to_string()),
                        tool_name: "add".to_string(),
                        arguments: json!({ "a": 2, "b": 3 }),
                        ..Default::default()
                    }],
                    ..Default::default()
                });
            }
            Ok(TurnModelResponse {
                output: Some(json!({ "toolResult": request.tool_results[0].result })),
                ..Default::default()
            })
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let result = runner
        .run(run_request("session-1", "turn-1"))
        .await
        .unwrap();

    assert_eq!(result.output, Some(json!({ "toolResult": 5 })));
    assert!(result.tool_results[0].success);
    assert_eq!(
        sink.turn_events()
            .iter()
            .map(|event| event.r#type.to_string())
            .collect::<Vec<_>>(),
        vec![
            "turn_start",
            "llm_start",
            "llm_complete",
            "permission_requested",
            "permission_completed",
            "tool_execution_start",
            "tool_execution_complete",
            "tool_result",
            "messages_updated",
            "llm_start",
            "llm_complete",
            "turn_end"
        ]
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_denied_permission_skips_execution() {
    let path = trace_path("prompty-turn-deny");
    let sink = CollectingEventSink::new();
    let mut handlers = HashMap::new();
    handlers.insert(
        "shell".to_string(),
        Arc::new(
            |_args: &Value,
             _request: &HostToolRequest|
             -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
                panic!("should not execute")
            },
        ) as Arc<_>,
    );
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        DenyAllPermissionResolver,
        FunctionHostToolExecutor::new(handlers),
        Arc::new(|request: TurnModelRequest| {
            if request.iteration == 0 {
                return Ok(TurnModelResponse {
                    tool_requests: vec![HostToolRequest {
                        request_id: Some("exec-1".to_string()),
                        tool_name: "shell".to_string(),
                        ..Default::default()
                    }],
                    ..Default::default()
                });
            }
            Ok(TurnModelResponse {
                output: Some(json!({ "denied": request.tool_results[0].error_kind })),
                ..Default::default()
            })
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let result = runner
        .run(run_request("session-1", "turn-1"))
        .await
        .unwrap();

    assert_eq!(
        result.output,
        Some(json!({ "denied": "permission_denied" }))
    );
    assert!(
        !sink
            .turn_events()
            .iter()
            .any(|event| event.r#type.to_string() == "tool_execution_start")
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_host_tool_failure_is_replayable() {
    let path = trace_path("prompty-turn-fail");
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
    let runner = ReferenceTurnRunner::new(
        CollectingEventSink::new(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        AllowAllPermissionResolver,
        FunctionHostToolExecutor::new(handlers),
        Arc::new(|request: TurnModelRequest| {
            if request.iteration == 0 {
                return Ok(TurnModelResponse {
                    tool_requests: vec![HostToolRequest {
                        request_id: Some("exec-1".to_string()),
                        tool_name: "fail".to_string(),
                        ..Default::default()
                    }],
                    ..Default::default()
                });
            }
            Ok(TurnModelResponse {
                output: Some(
                    request.tool_results[0].to_value(&prompty::model::context::SaveContext::new()),
                ),
                ..Default::default()
            })
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let result = runner
        .run(run_request("session-1", "turn-1"))
        .await
        .unwrap();

    assert_eq!(result.output.as_ref().unwrap()["success"], false);
    assert_eq!(result.output.as_ref().unwrap()["errorKind"], "exception");
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_deterministic_journal() {
    async fn run_once(path: &std::path::Path) -> Vec<Value> {
        let runner = ReferenceTurnRunner::new(
            CollectingEventSink::new(),
            JsonlEventJournalWriter::new(path),
            InMemoryCheckpointStore::new(),
            AllowAllPermissionResolver,
            FunctionHostToolExecutor::default(),
            Arc::new(|_request: TurnModelRequest| {
                Ok(TurnModelResponse {
                    output: Some(json!("done")),
                    ..Default::default()
                })
            }),
            fixed_clock(),
            fixed_ids(),
        );
        runner
            .run(run_request("session-1", "turn-1"))
            .await
            .unwrap();
        records(path)
    }

    let first_path = trace_path("prompty-turn-first");
    let second_path = trace_path("prompty-turn-second");
    assert_eq!(run_once(&first_path).await, run_once(&second_path).await);
    let _ = fs::remove_file(first_path);
    let _ = fs::remove_file(second_path);
}
