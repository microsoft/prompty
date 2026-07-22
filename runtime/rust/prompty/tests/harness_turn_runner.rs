use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use prompty::harness::{
    AdapterError, AllowAllPermissionResolver, CollectingEventSink, DenyAllPermissionResolver,
    FunctionHostToolExecutor, InMemoryCheckpointStore, JsonlEventJournalWriter,
    ReferenceTurnRunner,
};
use prompty::model::events::host_tool_request::HostToolRequest;
use prompty::model::events::permission_decision::PermissionDecision;
use prompty::model::events::permission_request::PermissionRequest;
use prompty::model::pipeline::RunTurnRequest;
use prompty::model::pipeline::TurnModelRequest;
use prompty::model::pipeline::TurnModelResponse;
use prompty::model::pipeline::checkpoint_store::CheckpointStore;
use prompty::model::pipeline::host_tool_executor::HostToolExecutor;
use prompty::model::pipeline::permission_resolver::PermissionResolver;
use prompty::model::pipeline::run_turn_result::RunTurnStatus;
use prompty::model::pipeline::turn_options::TurnOptions;
use serde::Deserialize;
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

#[derive(Debug, Deserialize)]
struct ReplayVectors {
    version: i32,
    clock: String,
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "turnId")]
    turn_id: String,
    scenarios: Vec<ReplayScenario>,
}

#[derive(Debug, Deserialize)]
struct ReplayScenario {
    name: String,
    inputs: Option<Value>,
    #[serde(rename = "maxIterations")]
    max_iterations: Option<i32>,
    expected: Vec<String>,
}

#[derive(Clone)]
struct ScenarioPermissionResolver {
    approved: bool,
}

struct FailingHostToolExecutor;

#[async_trait::async_trait]
impl HostToolExecutor for FailingHostToolExecutor {
    async fn execute(
        &self,
        _request: &HostToolRequest,
    ) -> Result<prompty::model::events::host_tool_result::HostToolResult, AdapterError> {
        Err(Box::new(std::io::Error::other("executor unavailable")))
    }
}

#[async_trait::async_trait]
impl PermissionResolver for ScenarioPermissionResolver {
    async fn request(
        &self,
        request: &PermissionRequest,
    ) -> Result<PermissionDecision, AdapterError> {
        Ok(PermissionDecision {
            request_id: request.request_id.clone(),
            tool_call_id: request.tool_call_id.clone(),
            permission: request.permission.clone(),
            approved: self.approved,
            reason: Some(
                if self.approved {
                    "allow_all"
                } else {
                    "deny_all"
                }
                .to_string(),
            ),
            result: Value::Null,
        })
    }
}

fn replay_vectors() -> ReplayVectors {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("spec")
        .join("vectors")
        .join("harness")
        .join("replay_vectors.json");
    let vectors: ReplayVectors = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(vectors.version, 1);
    vectors
}

fn normalize_journal(records: Vec<Value>) -> Vec<String> {
    records
        .iter()
        .map(|record| {
            if record["kind"] == "summary" {
                let summary = &record["summary"];
                return format!(
                    "summary:{}:{}:turns={}:checkpoints={}",
                    summary["sessionId"].as_str().unwrap(),
                    summary["status"].as_str().unwrap(),
                    summary["turns"].as_i64().unwrap(),
                    summary["checkpoints"].as_i64().unwrap()
                );
            }

            let event = &record["event"];
            let event_type = event["type"].as_str().unwrap();
            if record["kind"] == "session" {
                if event_type == "session_end" {
                    return format!(
                        "session:{}:{}:{}:{}",
                        event_type,
                        event["sessionId"].as_str().unwrap(),
                        event["turnId"].as_str().unwrap(),
                        event["payload"]["status"].as_str().unwrap()
                    );
                }
                return format!(
                    "session:{}:{}:{}",
                    event_type,
                    event["sessionId"].as_str().unwrap(),
                    event["turnId"].as_str().unwrap()
                );
            }

            let payload = &event["payload"];
            let iteration = event["iteration"].as_i64().unwrap();
            match event_type {
                "permission_requested" => {
                    format!(
                        "turn:{event_type}:{iteration}:{}",
                        payload["requestId"].as_str().unwrap()
                    )
                }
                "permission_completed" => {
                    format!(
                        "turn:{event_type}:{iteration}:{}",
                        payload["approved"].as_bool().unwrap()
                    )
                }
                "tool_execution_start" => {
                    format!(
                        "turn:{event_type}:{iteration}:{}",
                        payload["toolName"].as_str().unwrap()
                    )
                }
                "tool_execution_complete" | "tool_result" => {
                    let mut value = format!(
                        "turn:{event_type}:{iteration}:{}:{}",
                        payload["toolName"].as_str().unwrap(),
                        payload["success"].as_bool().unwrap()
                    );
                    if let Some(error_kind) = payload["errorKind"].as_str() {
                        value.push(':');
                        value.push_str(error_kind);
                    }
                    value
                }
                "error" => format!(
                    "turn:{event_type}:{iteration}:{}",
                    payload["errorKind"].as_str().unwrap()
                ),
                "turn_end" => format!(
                    "turn:{event_type}:{iteration}:{}",
                    payload["status"].as_str().unwrap()
                ),
                _ => format!("turn:{event_type}:{iteration}"),
            }
        })
        .collect()
}

fn model_for_scenario(
    name: &str,
) -> Arc<dyn Fn(TurnModelRequest) -> Result<TurnModelResponse, AdapterError> + Send + Sync> {
    let name = name.to_string();
    Arc::new(move |request: TurnModelRequest| {
        if name == "no_tool" {
            return Ok(TurnModelResponse {
                output: Some(
                    json!({ "text": format!("hello {}", request.inputs["name"].as_str().unwrap()) }),
                ),
                checkpoint_state: json!({ "stable": true }),
                ..Default::default()
            });
        }
        if request.iteration == 0 {
            return Ok(TurnModelResponse {
                tool_requests: vec![HostToolRequest {
                    request_id: Some("exec-1".to_string()),
                    tool_call_id: Some("call-1".to_string()),
                    tool_name: if name == "tool_failure" {
                        "fail"
                    } else {
                        "add"
                    }
                    .to_string(),
                    arguments: json!({ "a": 2, "b": 3 }),
                    ..Default::default()
                }],
                ..Default::default()
            });
        }
        Ok(TurnModelResponse {
            output: Some(json!({
                "toolResult": request.tool_results[0].result,
                "errorKind": request.tool_results[0].error_kind,
            })),
            ..Default::default()
        })
    })
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
async fn reference_turn_runner_preserves_missing_request_id_allocation_order() {
    let path = trace_path("prompty-turn-generated-permission");
    let sink = CollectingEventSink::new();
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        DenyAllPermissionResolver,
        FunctionHostToolExecutor::default(),
        Arc::new(|request: TurnModelRequest| {
            if request.iteration == 0 {
                return Ok(TurnModelResponse {
                    tool_requests: vec![HostToolRequest {
                        tool_name: "generated".to_string(),
                        ..Default::default()
                    }],
                    ..Default::default()
                });
            }
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

    let permission = sink
        .turn_events()
        .into_iter()
        .find(|event| event.r#type.to_string() == "permission_requested")
        .unwrap();
    assert_eq!(permission.id, "turn-event-7");
    assert_eq!(permission.payload["requestId"], "permission-6");
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
    let messages_updated = sink
        .turn_events()
        .into_iter()
        .find(|event| event.r#type.to_string() == "messages_updated")
        .unwrap();
    assert_eq!(
        messages_updated.payload["toolResults"][0]["errorKind"],
        "permission_denied"
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_propagates_model_callback_errors() {
    let path = trace_path("prompty-turn-model-error");
    let sink = CollectingEventSink::new();
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        AllowAllPermissionResolver,
        FunctionHostToolExecutor::default(),
        Arc::new(|_request: TurnModelRequest| {
            Err(Box::new(std::io::Error::other("model unavailable")) as AdapterError)
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let error = runner
        .run(run_request("session-1", "turn-1"))
        .await
        .unwrap_err();

    assert!(error.to_string().contains("model unavailable"));
    assert!(
        !sink
            .turn_events()
            .iter()
            .any(|event| event.r#type.to_string() == "turn_end")
    );
    assert!(
        !sink
            .session_events()
            .iter()
            .any(|event| event.r#type.to_string() == "session_end")
    );
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_propagates_host_executor_errors() {
    let path = trace_path("prompty-turn-executor-error");
    let runner = ReferenceTurnRunner::new(
        CollectingEventSink::new(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        AllowAllPermissionResolver,
        FailingHostToolExecutor,
        Arc::new(|_request: TurnModelRequest| {
            Ok(TurnModelResponse {
                tool_requests: vec![HostToolRequest {
                    request_id: Some("exec-1".to_string()),
                    tool_name: "unavailable".to_string(),
                    ..Default::default()
                }],
                ..Default::default()
            })
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let error = runner
        .run(run_request("session-1", "turn-1"))
        .await
        .unwrap_err();

    assert!(error.to_string().contains("executor unavailable"));
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_preserves_zero_iteration_behavior() {
    let path = trace_path("prompty-turn-zero");
    let calls = Arc::new(Mutex::new(0usize));
    let callback_calls = calls.clone();
    let sink = CollectingEventSink::new();
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        InMemoryCheckpointStore::new(),
        AllowAllPermissionResolver,
        FunctionHostToolExecutor::default(),
        Arc::new(move |_request: TurnModelRequest| {
            *callback_calls.lock().unwrap() += 1;
            Ok(TurnModelResponse::default())
        }),
        fixed_clock(),
        fixed_ids(),
    );

    let result = runner
        .run(RunTurnRequest {
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            inputs: json!({}),
            options: Some(TurnOptions {
                max_iterations: Some(0),
                ..Default::default()
            }),
        })
        .await
        .unwrap();

    assert_eq!(result.status, RunTurnStatus::Success);
    assert_eq!(result.iterations, 0);
    assert!(result.checkpoints.is_empty());
    assert_eq!(*calls.lock().unwrap(), 0);
    assert_eq!(
        sink.turn_events()
            .iter()
            .map(|event| event.r#type.to_string())
            .collect::<Vec<_>>(),
        vec!["turn_start", "turn_end"]
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

#[tokio::test]
async fn reference_turn_runner_preserves_stateful_clock_consumption() {
    let path = trace_path("prompty-turn-clock");
    let tick = Arc::new(Mutex::new(0usize));
    let clock_tick = tick.clone();
    let sink = CollectingEventSink::new();
    let checkpoint_store = InMemoryCheckpointStore::new();
    let runner = ReferenceTurnRunner::new(
        sink.clone(),
        JsonlEventJournalWriter::new(&path),
        checkpoint_store.clone(),
        AllowAllPermissionResolver,
        FunctionHostToolExecutor::default(),
        Arc::new(|_request: TurnModelRequest| {
            Ok(TurnModelResponse {
                output: Some(json!("done")),
                ..Default::default()
            })
        }),
        Arc::new(move || {
            let mut tick = clock_tick.lock().unwrap();
            *tick += 1;
            format!("tick-{tick}")
        }),
        fixed_ids(),
    );

    runner
        .run(run_request("session-1", "turn-1"))
        .await
        .unwrap();

    assert_eq!(
        sink.turn_events()
            .iter()
            .map(|event| event.timestamp.as_str())
            .collect::<Vec<_>>(),
        vec!["tick-2", "tick-3", "tick-4", "tick-7"]
    );
    assert_eq!(
        sink.session_events()
            .iter()
            .map(|event| event.timestamp.as_str())
            .collect::<Vec<_>>(),
        vec!["tick-1", "tick-6", "tick-8"]
    );
    let checkpoint = checkpoint_store
        .load(&"session-1".to_string(), &"turn-1-checkpoint-0".to_string())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(checkpoint.created_at.as_deref(), Some("tick-5"));
    assert_eq!(*tick.lock().unwrap(), 8);
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn reference_turn_runner_matches_shared_golden_replay_vectors() {
    let vectors = replay_vectors();
    for scenario in vectors.scenarios {
        let path = trace_path(&format!("prompty-replay-{}", scenario.name));
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
            ScenarioPermissionResolver {
                approved: scenario.name != "permission_denied",
            },
            FunctionHostToolExecutor::new(handlers),
            model_for_scenario(&scenario.name),
            Arc::new({
                let clock = vectors.clock.clone();
                move || clock.clone()
            }),
            fixed_ids(),
        );
        runner
            .run(RunTurnRequest {
                session_id: vectors.session_id.clone(),
                turn_id: vectors.turn_id.clone(),
                inputs: scenario.inputs.unwrap_or_else(|| json!({})),
                options: Some(TurnOptions {
                    max_iterations: scenario.max_iterations,
                    ..Default::default()
                }),
            })
            .await
            .unwrap();

        let journal_records = records(&path);
        assert_eq!(
            normalize_journal(journal_records.clone()),
            scenario.expected,
            "{}",
            scenario.name
        );
        if scenario.name == "max_iterations" {
            let error = journal_records
                .iter()
                .find(|record| record["event"]["type"] == "error")
                .unwrap();
            assert_eq!(
                error["event"]["payload"]["message"],
                "Maximum turn iterations reached"
            );
            let turn_end = journal_records
                .iter()
                .find(|record| record["event"]["type"] == "turn_end")
                .unwrap();
            assert_eq!(
                turn_end["event"]["payload"]["response"],
                json!({ "message": "Maximum turn iterations reached" })
            );
        }
        let session_end = journal_records
            .iter()
            .find(|record| record["event"]["type"] == "session_end")
            .unwrap();
        assert_eq!(
            session_end["event"]["payload"].as_object().unwrap().len(),
            3
        );
        let _ = fs::remove_file(path);
    }
}
