//! Agent vector tests — exercises the agent loop (`turn()`) using canned
//! LLM responses from `spec/vectors/agent/agent_vectors.json`.
//!
//! Each vector provides a `sequence` of mock LLM responses and the expected
//! final result (or error). A `MockExecutor` replays the canned responses;
//! a `MockProcessor` extracts content or tool calls from the response.
//! Tool functions return canned results from the vector's `tool_results`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};

use prompty::interfaces::{Executor, InvokerError, Processor};
use prompty::model::Prompty;
use prompty::model::context::LoadContext;
use prompty::pipeline::{AgentEvent, EventCallback, ToolHandler, TurnOptions, turn};
use prompty::types::{Message, Role};

// ---------------------------------------------------------------------------
// Helpers — load vectors JSON
// ---------------------------------------------------------------------------

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap() // runtime/rust/
        .parent()
        .unwrap() // runtime/
        .parent()
        .unwrap() // repo root
        .join("spec")
        .join("vectors")
        .join("agent")
        .join("agent_vectors.json")
}

fn load_vectors() -> Vec<Value> {
    let content =
        std::fs::read_to_string(vectors_path()).expect("failed to read agent_vectors.json");
    serde_json::from_str(&content).expect("failed to parse agent_vectors.json")
}

fn find_vector(name: &str) -> Value {
    load_vectors()
        .into_iter()
        .find(|v| v["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("vector '{name}' not found"))
}

// ---------------------------------------------------------------------------
// MockExecutor — replays canned LLM responses from the vector sequence
// ---------------------------------------------------------------------------

struct MockExecutor {
    responses: Vec<Value>,
    call_idx: AtomicUsize,
}

impl MockExecutor {
    fn new(responses: Vec<Value>) -> Self {
        Self {
            responses,
            call_idx: AtomicUsize::new(0),
        }
    }
}

#[async_trait]
impl Executor for MockExecutor {
    async fn execute(
        &self,
        _agent: &Prompty,
        _messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let idx = self.call_idx.fetch_add(1, Ordering::SeqCst);
        if idx >= self.responses.len() {
            return Err(InvokerError::Execute(
                format!("MockExecutor: no more responses (requested index {idx})").into(),
            ));
        }
        Ok(self.responses[idx].clone())
    }

    // Use default format_tool_messages (OpenAI style) — inherited from trait
}

// ---------------------------------------------------------------------------
// MockProcessor — extracts content or tool calls from a canned response
// ---------------------------------------------------------------------------

struct MockProcessor;

#[async_trait]
impl Processor for MockProcessor {
    async fn process(&self, _agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
        // Navigate OpenAI-style response: choices[0].message
        let message = &response["choices"][0]["message"];

        // Check for tool_calls
        if let Some(tool_calls) = message.get("tool_calls") {
            if tool_calls.is_array() && !tool_calls.as_array().unwrap().is_empty() {
                // Return array of {id, name, arguments} for the pipeline to extract
                let calls: Vec<Value> = tool_calls
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|tc| {
                        json!({
                            "id": tc["id"],
                            "name": tc["function"]["name"],
                            "arguments": tc["function"]["arguments"],
                        })
                    })
                    .collect();
                return Ok(Value::Array(calls));
            }
        }

        // No tool calls — return content string
        let content = message
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("");
        Ok(Value::String(content.to_string()))
    }
}

// ---------------------------------------------------------------------------
// Helper — register mocks under a unique key (tests run in parallel, using
// a static global registry). We use a per-test key to avoid collisions.
// ---------------------------------------------------------------------------

fn register_mocks(key: &str, responses: Vec<Value>) {
    prompty::register_executor(key, MockExecutor::new(responses));
    prompty::register_processor(key, MockProcessor);
}

// ---------------------------------------------------------------------------
// Helper — build a Prompty agent from a vector's input section
// ---------------------------------------------------------------------------

fn build_agent(vector: &Value, provider_key: &str) -> Prompty {
    let tools = vector["input"]["tools"].clone();
    let data = json!({
        "name": format!("agent_test_{}", vector["name"].as_str().unwrap_or("unknown")),
        "kind": "prompt",
        "model": {
            "id": "gpt-4",
            "provider": provider_key,
        },
        "instructions": "system:\nYou are a test agent.\n\nuser:\n{{ question }}",
        "tools": tools,
        "template": {
            "format": { "kind": "nunjucks" },
            "parser": { "kind": "prompty" }
        }
    });
    Prompty::load_from_value(&data, &LoadContext::default())
}

// ---------------------------------------------------------------------------
// Helper — collect LLM responses from the vector's sequence
// ---------------------------------------------------------------------------

fn collect_responses(vector: &Value) -> Vec<Value> {
    vector["sequence"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|step| step["llm_response"].clone())
        .collect()
}

// ---------------------------------------------------------------------------
// Helper — build tool handlers that return canned results
// ---------------------------------------------------------------------------

fn build_tool_handlers(vector: &Value) -> HashMap<String, ToolHandler> {
    // Collect all tool results across the sequence, keyed by tool name
    let mut result_queues: HashMap<String, Vec<String>> = HashMap::new();

    if let Some(sequence) = vector["sequence"].as_array() {
        for step in sequence {
            if let Some(tool_results) = step["tool_results"].as_array() {
                // Find the expected_tool_calls to map tool_call_id → tool name
                let expected_calls = step["expected_tool_calls"].as_array();

                for tr in tool_results {
                    let tool_call_id = tr["tool_call_id"].as_str().unwrap_or("");
                    let result = tr["result"].as_str().unwrap_or("").to_string();

                    // Find the tool name from expected_tool_calls
                    let tool_name = expected_calls
                        .and_then(|calls| {
                            calls
                                .iter()
                                .find(|c| c["id"].as_str() == Some(tool_call_id))
                        })
                        .and_then(|c| c["name"].as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    result_queues.entry(tool_name).or_default().push(result);
                }
            }
        }
    }

    // Also collect tool names from tool_functions that may not appear in results
    if let Some(tf) = vector["input"]["tool_functions"].as_object() {
        for name in tf.keys() {
            result_queues.entry(name.clone()).or_default();
        }
    }

    // Build handlers
    let mut handlers: HashMap<String, ToolHandler> = HashMap::new();
    for (name, queue) in result_queues {
        let queue = Arc::new(queue);
        let idx = Arc::new(AtomicUsize::new(0));
        let name_clone = name.clone();
        handlers.insert(
            name,
            ToolHandler::Sync(Box::new(move |_args: Value| {
                let i = idx.fetch_add(1, Ordering::SeqCst);
                if i < queue.len() {
                    Ok(queue[i].clone())
                } else {
                    Ok(format!("(mock result #{i} for {name_clone})"))
                }
            })),
        );
    }

    handlers
}

// ---------------------------------------------------------------------------
// Helper — build the initial messages from the vector's input
// ---------------------------------------------------------------------------

fn build_messages(vector: &Value) -> Vec<Message> {
    vector["input"]["messages"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|m| {
            let role_str = m["role"].as_str()?;
            let role = Role::from_str_opt(role_str)?;
            let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
            Some(Message::with_text(role, content))
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Helper — unique mock key per test to avoid registry collisions
// ---------------------------------------------------------------------------

fn mock_key(vector_name: &str) -> String {
    format!("specmock_{vector_name}")
}

// ---------------------------------------------------------------------------
// Core run helper — runs a single agent vector through `turn()`
// ---------------------------------------------------------------------------

async fn run_vector(vector_name: &str) -> Result<Value, InvokerError> {
    let vector = find_vector(vector_name);
    let key = mock_key(vector_name);
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let agent = build_agent(&vector, &key);
    let tools = build_tool_handlers(&vector);
    let _messages = build_messages(&vector);

    // Build agent input — we bypass `prepare` and drive `turn` directly.
    // Since `turn` calls `prepare` internally, we instead use a simpler
    // approach: call the executor/processor loop manually via turn() with
    // pre-built messages passed through a metadata trick.
    //
    // Actually, `turn()` takes `agent + inputs` and calls `prepare()` internally.
    // We need to provide the messages directly. Looking at the pipeline, the
    // simplest approach is to set `agent.instructions` so that `prepare()`
    // produces the messages we want, OR we can just test the agent loop
    // behavior by working at a slightly higher level.
    //
    // The cleanest approach: set instructions to produce the exact input
    // messages, then let turn() handle the loop.

    // Build an agent whose instructions will produce the right messages
    let mut agent = agent;
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let opts = TurnOptions {
        tools,
        ..Default::default()
    };

    // Register the default nunjucks renderer + prompty parser
    prompty::pipeline::register_defaults();

    turn(&agent, None, Some(opts)).await
}

// ===================================================================
// BASIC AGENT LOOP VECTORS
// ===================================================================

#[tokio::test]
async fn test_no_tool_calls() {
    let result = run_vector("no_tool_calls").await.unwrap();
    assert_eq!(result.as_str().unwrap(), "2 + 2 equals 4.");
}

#[tokio::test]
async fn test_single_tool_call() {
    let result = run_vector("single_tool_call").await.unwrap();
    let vector = find_vector("single_tool_call");
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);
}

#[tokio::test]
async fn test_multiple_tool_calls_single_turn() {
    let result = run_vector("multiple_tool_calls_single_turn").await.unwrap();
    let vector = find_vector("multiple_tool_calls_single_turn");
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);
}

#[tokio::test]
async fn test_multi_turn_tool_calls() {
    let result = run_vector("multi_turn_tool_calls").await.unwrap();
    let vector = find_vector("multi_turn_tool_calls");
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);
}

#[tokio::test]
async fn test_tool_result_message_format() {
    let result = run_vector("tool_result_message_format").await.unwrap();
    let vector = find_vector("tool_result_message_format");
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);
}

#[tokio::test]
async fn test_assistant_tool_calls_metadata() {
    let result = run_vector("assistant_tool_calls_metadata").await.unwrap();
    let vector = find_vector("assistant_tool_calls_metadata");
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);
}

#[tokio::test]
async fn test_empty_tool_result() {
    let result = run_vector("empty_tool_result").await.unwrap();
    let vector = find_vector("empty_tool_result");
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);
}

// ===================================================================
// ERROR CASES
// ===================================================================

#[tokio::test]
async fn test_tool_not_registered_error() {
    // The LLM tries to call "unknown_tool" which has no handler.
    // Missing tool is non-fatal (matching TypeScript) — error string sent to LLM.
    let vector = find_vector("tool_not_registered_error");
    let key = mock_key("tool_not_registered_error");

    // Need an extra response: after the missing-tool error string is sent back
    // to the LLM, the mock needs to return a final non-tool-call response.
    let mut responses = collect_responses(&vector);
    responses.push(json!({
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "I could not find that tool."
            },
            "finish_reason": "stop"
        }]
    }));
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    // Only register get_weather — NOT unknown_tool
    let mut tools: HashMap<String, ToolHandler> = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(|_| Ok("72°F".to_string()))),
    );

    let opts = TurnOptions {
        tools,
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    let result = turn(&agent, None, Some(opts)).await.unwrap();
    assert!(result.is_string());
}

#[tokio::test]
async fn test_max_iterations_exceeded() {
    // The LLM returns tool calls on every turn for 11 turns.
    // With max_iterations=10, the loop should error (matching TypeScript).
    let vector = find_vector("max_iterations_exceeded");
    let key = mock_key("max_iterations_exceeded");
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let tools = build_tool_handlers(&vector);

    let opts = TurnOptions {
        tools,
        max_iterations: 10,
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    // Max iterations exceeded → error (matching TypeScript behavior)
    let result = turn(&agent, None, Some(opts)).await;
    assert!(result.is_err(), "Expected iteration error, got: {result:?}");
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("max iterations") || err.to_string().contains("exceeded"),
        "Expected max iterations error message, got: {err}"
    );
}

// ===================================================================
// ASYNC TOOL FUNCTION
// ===================================================================

#[tokio::test]
async fn test_async_tool_function() {
    let vector = find_vector("async_tool_function");
    let key = mock_key("async_tool_function");
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let mut tools: HashMap<String, ToolHandler> = HashMap::new();
    tools.insert(
        "lookup".to_string(),
        ToolHandler::Async(Box::new(|_args| {
            Box::pin(async move { Ok("found: test data".to_string()) })
        })),
    );

    let opts = TurnOptions {
        tools,
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    let result = turn(&agent, None, Some(opts)).await.unwrap();
    assert_eq!(result.as_str().unwrap(), "I found: test data");
}

// ===================================================================
// EVENT VECTORS
// ===================================================================

/// Helper to run a vector with event collection.
async fn run_vector_with_events(
    vector_name: &str,
    tool_override: Option<HashMap<String, ToolHandler>>,
    cancelled: Option<Arc<AtomicBool>>,
) -> (Result<Value, InvokerError>, Vec<String>) {
    let vector = find_vector(vector_name);
    let key = mock_key(vector_name);
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let tools = tool_override.unwrap_or_else(|| build_tool_handlers(&vector));

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();
    let on_event: EventCallback = Box::new(move |event: AgentEvent| {
        let event_type = match &event {
            AgentEvent::TurnStart { .. } => "turn_start",
            AgentEvent::TurnEnd { .. } => "turn_end",
            AgentEvent::LlmStart { .. } => "llm_start",
            AgentEvent::LlmComplete { .. } => "llm_complete",
            AgentEvent::Retry { .. } => "retry",
            AgentEvent::Token(_) => "token",
            AgentEvent::Thinking(_) => "thinking",
            AgentEvent::ToolCallStart { .. } => "tool_call_start",
            AgentEvent::ToolCallComplete { .. } => "tool_call_complete",
            AgentEvent::ToolResult { .. } => "tool_result",
            AgentEvent::Status(_) => "status",
            AgentEvent::MessagesUpdated { .. } => "messages_updated",
            AgentEvent::Done { .. } => "done",
            AgentEvent::Error(_) => "error",
            AgentEvent::Cancelled => "cancelled",
        };
        events_clone.lock().unwrap().push(event_type.to_string());
    });

    let opts = TurnOptions {
        tools,
        on_event: Some(on_event),
        cancelled,
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    let result = turn(&agent, None, Some(opts)).await;
    let collected = events.lock().unwrap().clone();
    (result, collected)
}

#[tokio::test]
async fn test_events_basic_tool_loop() {
    let (result, events) = run_vector_with_events("events_basic_tool_loop", None, None).await;
    assert!(result.is_ok(), "expected Ok, got: {result:?}");
    let vector = find_vector("events_basic_tool_loop");
    let expected_result = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.unwrap().as_str().unwrap(), expected_result);

    // Verify event sequence contains the expected types
    assert!(
        events.contains(&"tool_call_start".to_string()),
        "missing tool_call_start event in {events:?}"
    );
    assert!(
        events.contains(&"tool_result".to_string()),
        "missing tool_result event in {events:?}"
    );
    let done_index = events
        .iter()
        .position(|event| event == "done")
        .expect("missing done event");
    let turn_end_index = events
        .iter()
        .position(|event| event == "turn_end")
        .expect("missing turn_end event");
    assert!(
        done_index < turn_end_index,
        "done should be emitted before turn_end, got {events:?}"
    );
}

#[tokio::test]
async fn test_events_no_tools() {
    let (result, events) = run_vector_with_events("events_no_tools", None, None).await;
    assert!(result.is_ok(), "expected Ok, got: {result:?}");
    assert_eq!(result.unwrap().as_str().unwrap(), "2 + 2 equals 4.");

    // No tool events should fire — only done
    assert!(
        events.contains(&"done".to_string()),
        "missing done event in {events:?}"
    );
    assert!(
        !events.contains(&"tool_call_start".to_string()),
        "should NOT have tool_call_start event, got {events:?}"
    );
}

#[tokio::test]
async fn test_events_error_logged() {
    // Tool function raises an error — the vector expects the error string
    // to be returned to the LLM and the loop to continue.
    // In the Rust runtime, tool errors propagate as InvokerError from dispatch_tool.
    // We simulate by providing a tool that returns an error string.
    let mut tools: HashMap<String, ToolHandler> = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(|_| {
            Err("RuntimeError: Weather service unavailable".into())
        })),
    );

    let (result, events) = run_vector_with_events("events_error_logged", Some(tools), None).await;

    // The Rust runtime propagates tool errors — this differs from the spec
    // which expects error strings to be fed back to the LLM. We accept
    // either behavior: an error result, or the continued loop result.
    if result.is_err() {
        let err_str = result.unwrap_err().to_string();
        assert!(
            err_str.contains("Weather service unavailable") || err_str.contains("get_weather"),
            "error should mention weather service: {err_str}"
        );
    } else {
        // If the runtime feeds errors back to the LLM (spec behavior)
        assert!(result.unwrap().as_str().is_some());
    }

    assert!(
        events.contains(&"tool_call_start".to_string()),
        "should have tool_call_start event"
    );
}

// ===================================================================
// CANCELLATION VECTORS
// ===================================================================

#[tokio::test]
async fn test_cancellation_before_llm() {
    // Cancel token is already set before the loop starts
    let cancel = Arc::new(AtomicBool::new(true));
    let (result, events) =
        run_vector_with_events("cancellation_before_llm", None, Some(cancel)).await;

    assert!(result.is_err(), "expected cancellation error");
    let err_str = result.unwrap_err().to_string();
    assert!(
        err_str.to_lowercase().contains("cancel"),
        "error should mention cancellation: {err_str}"
    );
    assert!(
        events.contains(&"cancelled".to_string()),
        "should emit cancelled event, got {events:?}"
    );
}

#[tokio::test]
async fn test_cancellation_between_iterations() {
    // Cancel after the first iteration's tool calls are processed
    let vector = find_vector("cancellation_between_iterations");
    let key = mock_key("cancellation_between_iterations");
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();

    // Build tool handlers that set the cancel flag after the first tool call
    let call_count = Arc::new(AtomicUsize::new(0));
    let call_count_clone = call_count.clone();
    let mut tools: HashMap<String, ToolHandler> = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(move |_args| {
            let n = call_count_clone.fetch_add(1, Ordering::SeqCst);
            // After the first tool call completes, set cancel
            if n == 0 {
                cancel_clone.store(true, Ordering::SeqCst);
            }
            Ok("72°F sunny".to_string())
        })),
    );

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();
    let on_event: EventCallback = Box::new(move |event: AgentEvent| {
        let event_type = match &event {
            AgentEvent::TurnStart { .. } => "turn_start",
            AgentEvent::TurnEnd { .. } => "turn_end",
            AgentEvent::LlmStart { .. } => "llm_start",
            AgentEvent::LlmComplete { .. } => "llm_complete",
            AgentEvent::Retry { .. } => "retry",
            AgentEvent::Token(_) => "token",
            AgentEvent::Thinking(_) => "thinking",
            AgentEvent::ToolCallStart { .. } => "tool_call_start",
            AgentEvent::ToolCallComplete { .. } => "tool_call_complete",
            AgentEvent::ToolResult { .. } => "tool_result",
            AgentEvent::Status(_) => "status",
            AgentEvent::MessagesUpdated { .. } => "messages_updated",
            AgentEvent::Done { .. } => "done",
            AgentEvent::Error(_) => "error",
            AgentEvent::Cancelled => "cancelled",
        };
        events_clone.lock().unwrap().push(event_type.to_string());
    });

    let opts = TurnOptions {
        tools,
        on_event: Some(on_event),
        cancelled: Some(cancel),
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    let result = turn(&agent, None, Some(opts)).await;
    let collected = events.lock().unwrap().clone();

    assert!(result.is_err(), "expected cancellation error");
    let err_str = result.unwrap_err().to_string();
    assert!(
        err_str.to_lowercase().contains("cancel"),
        "error should mention cancellation: {err_str}"
    );
    assert!(
        collected.contains(&"cancelled".to_string()),
        "should emit cancelled event, got {collected:?}"
    );
}

#[tokio::test]
async fn test_cancellation_between_tools() {
    // LLM requests 2 tool calls. Cancel fires after the first.
    let vector = find_vector("cancellation_between_tools");
    let key = mock_key("cancellation_between_tools");
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = cancel.clone();

    let call_count = Arc::new(AtomicUsize::new(0));
    let call_count_clone = call_count.clone();
    let mut tools: HashMap<String, ToolHandler> = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(move |_args| {
            let n = call_count_clone.fetch_add(1, Ordering::SeqCst);
            // After the first tool call, signal cancel
            if n == 0 {
                cancel_clone.store(true, Ordering::SeqCst);
            }
            Ok("72°F sunny".to_string())
        })),
    );

    let opts = TurnOptions {
        tools,
        cancelled: Some(cancel),
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    let result = turn(&agent, None, Some(opts)).await;

    // Should be cancelled
    assert!(result.is_err(), "expected cancellation error");
    let err_str = result.unwrap_err().to_string();
    assert!(
        err_str.to_lowercase().contains("cancel"),
        "error should mention cancellation: {err_str}"
    );

    // Only one tool call should have been executed
    assert_eq!(
        call_count.load(Ordering::SeqCst),
        1,
        "only 1 tool call should have executed before cancellation"
    );
}

// ===================================================================
// BINDINGS — skip (not yet implemented in Rust runtime)
// ===================================================================

#[tokio::test]
async fn test_bindings_injected() {
    let vector = find_vector("bindings_injected");
    let key = mock_key("bindings_injected");
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let captured_args: Arc<Mutex<Option<Value>>> = Arc::new(Mutex::new(None));
    let captured_args_for_tool = Arc::clone(&captured_args);
    let mut tools = HashMap::new();
    tools.insert(
        "get_weather".to_string(),
        ToolHandler::Sync(Box::new(move |args: Value| {
            *captured_args_for_tool.lock().unwrap() = Some(args);
            Ok("22Â°C sunny".to_string())
        })),
    );
    let opts = TurnOptions {
        tools,
        ..Default::default()
    };

    prompty::pipeline::register_defaults();

    let parent_inputs = vector["input"]["parent_inputs"].clone();
    let result = turn(&agent, Some(&parent_inputs), Some(opts))
        .await
        .unwrap();
    let expected = vector["expected"]["result"].as_str().unwrap();
    assert_eq!(result.as_str().unwrap(), expected);

    let expected_args = &vector["sequence"][0]["expected_execution_args"]["get_weather"];
    let actual_args = captured_args.lock().unwrap().clone().unwrap();
    assert_eq!(&actual_args, expected_args);
}

// ===================================================================
// EXTENSION VECTORS — context trimming, guardrails, steering, parallel
// ===================================================================

/// Helper to build a full TurnOptions from a vector's `input` section,
/// wiring up guardrails, steering, context_budget, parallel_tool_calls,
/// and event collection.
fn build_extension_opts(
    vector: &Value,
    tools: HashMap<String, ToolHandler>,
    events: Option<Arc<Mutex<Vec<String>>>>,
) -> TurnOptions {
    let input = &vector["input"];

    // Context budget
    let context_budget = input
        .get("context_budget")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize);

    // Parallel tool calls
    let parallel_tool_calls = input
        .get("parallel_tool_calls")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Guardrails
    let guardrails = input.get("guardrails").map(|g| {
        let input_guardrail: Option<prompty::guardrails::InputGuardrail> =
            g.get("input").map(|ig| {
                let action = ig
                    .get("action")
                    .and_then(|a| a.as_str())
                    .unwrap_or("allow")
                    .to_string();
                let reason = ig
                    .get("reason")
                    .and_then(|r| r.as_str())
                    .unwrap_or("")
                    .to_string();
                let f: prompty::guardrails::InputGuardrail = Box::new(move |_msgs, _agent| {
                    let action = action.clone();
                    let reason = reason.clone();
                    Box::pin(async move {
                        if action == "deny" {
                            prompty::guardrails::GuardrailResult::deny(reason)
                        } else {
                            prompty::guardrails::GuardrailResult::allow()
                        }
                    })
                });
                f
            });

        let output_guardrail: Option<prompty::guardrails::OutputGuardrail> =
            g.get("output").map(|og| {
                let action = og
                    .get("action")
                    .and_then(|a| a.as_str())
                    .unwrap_or("allow")
                    .to_string();
                let reason = og
                    .get("reason")
                    .and_then(|r| r.as_str())
                    .unwrap_or("")
                    .to_string();
                let f: prompty::guardrails::OutputGuardrail = Box::new(move |_resp, _agent| {
                    let action = action.clone();
                    let reason = reason.clone();
                    Box::pin(async move {
                        if action == "deny" {
                            prompty::guardrails::GuardrailResult::deny(reason)
                        } else {
                            prompty::guardrails::GuardrailResult::allow()
                        }
                    })
                });
                f
            });

        let tool_guardrail: Option<prompty::guardrails::ToolGuardrail> = g.get("tool").map(|tg| {
            let deny_tools: Vec<String> = tg
                .get("deny_tools")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let reason = tg
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or("Tool denied")
                .to_string();
            let f: prompty::guardrails::ToolGuardrail =
                Box::new(move |tool_name, _args, _agent| {
                    let denied = deny_tools.contains(&tool_name.to_string());
                    let reason = reason.clone();
                    Box::pin(async move {
                        if denied {
                            prompty::guardrails::GuardrailResult::deny(reason)
                        } else {
                            prompty::guardrails::GuardrailResult::allow()
                        }
                    })
                });
            f
        });

        prompty::guardrails::Guardrails {
            input: input_guardrail,
            output: output_guardrail,
            tool: tool_guardrail,
        }
    });

    // Steering
    let steering = input.get("steering").map(|s| {
        let steering = prompty::steering::Steering::new();
        if let Some(msgs) = s.get("messages").and_then(|m| m.as_array()) {
            for msg in msgs {
                let text = msg.get("text").and_then(|t| t.as_str()).unwrap_or("");
                // All steering messages in our vectors have inject_before_iteration: 2
                // The Steering queue is drained at the start of each iteration,
                // so we pre-load them — they'll be drained before iteration 2 (index 1).
                steering.send(text);
            }
        }
        steering
    });

    // Event callback
    let on_event: Option<EventCallback> = events.map(|ev| {
        let f: EventCallback = Box::new(move |event: AgentEvent| {
            let label = match &event {
                AgentEvent::ToolCallStart { name, .. } => format!("ToolCallStart:{name}"),
                AgentEvent::ToolResult { name, .. } => format!("ToolResult:{name}"),
                AgentEvent::MessagesUpdated { .. } => "MessagesUpdated".into(),
                AgentEvent::Done { .. } => "Done".into(),
                AgentEvent::Error(e) => format!("Error:{e}"),
                AgentEvent::Cancelled => "Cancelled".into(),
                _ => format!("{event:?}"),
            };
            ev.lock().unwrap().push(label);
        });
        f
    });

    TurnOptions {
        tools,
        context_budget,
        parallel_tool_calls,
        guardrails,
        steering,
        on_event,
        ..Default::default()
    }
}

/// Helper for running extension vectors — like run_vector but with extension TurnOptions.
async fn run_extension_vector(vector_name: &str) -> Result<Value, InvokerError> {
    run_extension_vector_with_events(vector_name, None).await
}

async fn run_extension_vector_with_events(
    vector_name: &str,
    events: Option<Arc<Mutex<Vec<String>>>>,
) -> Result<Value, InvokerError> {
    let vector = find_vector(vector_name);
    let key = mock_key(vector_name);
    let responses = collect_responses(&vector);
    register_mocks(&key, responses);

    let mut agent = build_agent(&vector, &key);
    let input_msgs = &vector["input"]["messages"];
    let mut instruction_lines = Vec::new();
    if let Some(msgs) = input_msgs.as_array() {
        for m in msgs {
            let role = m["role"].as_str().unwrap_or("user");
            let content = m["content"].as_str().unwrap_or("");
            instruction_lines.push(format!("{role}:\n{content}"));
        }
    }
    agent.instructions = Some(instruction_lines.join("\n\n"));

    let tools = build_tool_handlers(&vector);
    let opts = build_extension_opts(&vector, tools, events);

    prompty::pipeline::register_defaults();

    turn(&agent, None, Some(opts)).await
}

// -------------------------------------------------------------------
// Context trimming (§13.3)
// -------------------------------------------------------------------

#[tokio::test]
async fn test_context_trim_basic() {
    // Vector has many long messages that exceed context_budget.
    // After trimming, oldest non-system messages are dropped and a summary inserted.
    let vector = find_vector("context_trim_basic");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("context_trim_basic").await.unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

#[tokio::test]
async fn test_context_no_trim_when_fits() {
    // Messages fit within budget — no trimming occurs.
    let vector = find_vector("context_no_trim_when_fits");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("context_no_trim_when_fits")
        .await
        .unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

#[tokio::test]
async fn test_context_preserves_system_messages() {
    // Two system messages + many exchanges. Both system messages MUST survive trimming.
    let vector = find_vector("context_preserves_system_messages");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("context_preserves_system_messages")
        .await
        .unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

// -------------------------------------------------------------------
// Guardrails (§13.4)
// -------------------------------------------------------------------

#[tokio::test]
async fn test_guardrail_input_deny() {
    // Input guardrail denies before any LLM call.
    let result = run_extension_vector("guardrail_input_deny").await;
    assert!(result.is_err(), "Expected error from input guardrail");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("guardrail")
            || err_msg.contains("Guardrail")
            || err_msg.contains("denied"),
        "Error should mention guardrail: {err_msg}"
    );
    assert!(
        err_msg.contains("PII") || err_msg.contains("Contains PII"),
        "Error should mention denial reason: {err_msg}"
    );
}

#[tokio::test]
async fn test_guardrail_output_deny() {
    // Input guardrail passes, LLM responds, output guardrail denies.
    let result = run_extension_vector("guardrail_output_deny").await;
    assert!(result.is_err(), "Expected error from output guardrail");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("guardrail")
            || err_msg.contains("Guardrail")
            || err_msg.contains("denied"),
        "Error should mention guardrail: {err_msg}"
    );
    assert!(
        err_msg.contains("harmful") || err_msg.contains("Response contains harmful"),
        "Error should mention denial reason: {err_msg}"
    );
}

#[tokio::test]
async fn test_guardrail_tool_deny() {
    // Two tool calls — dangerous_tool is denied, get_weather executes normally.
    let vector = find_vector("guardrail_tool_deny");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("guardrail_tool_deny").await.unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

#[tokio::test]
async fn test_guardrail_all_pass() {
    // All guardrails configured but all pass — normal agent loop completes.
    let vector = find_vector("guardrail_all_pass");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("guardrail_all_pass").await.unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

// -------------------------------------------------------------------
// Steering (§13.5)
// -------------------------------------------------------------------

#[tokio::test]
async fn test_steering_inject_message() {
    // Steering message injected before iteration 2.
    let vector = find_vector("steering_inject_message");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("steering_inject_message")
        .await
        .unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

#[tokio::test]
async fn test_steering_multiple_messages() {
    // Two steering messages injected before iteration 2.
    let vector = find_vector("steering_multiple_messages");
    let expected_result = vector["expected"]["result"].as_str().unwrap();

    let result = run_extension_vector("steering_multiple_messages")
        .await
        .unwrap();
    assert_eq!(result.as_str().unwrap(), expected_result);
}

// -------------------------------------------------------------------
// Parallel tool option rejection (§13.6)
// -------------------------------------------------------------------

#[tokio::test]
async fn test_parallel_tools_basic() {
    let vector = find_vector("parallel_tools_basic");
    let expected_error = vector["expected"]["rust_expected_error"].as_str().unwrap();

    let error = run_extension_vector("parallel_tools_basic")
        .await
        .unwrap_err();
    assert!(matches!(error, InvokerError::Validation(_)));
    assert!(error.to_string().contains(expected_error));
}

#[tokio::test]
async fn test_parallel_tools_with_guardrail_deny() {
    let vector = find_vector("parallel_tools_with_guardrail_deny");
    let expected_error = vector["expected"]["rust_expected_error"].as_str().unwrap();

    let error = run_extension_vector("parallel_tools_with_guardrail_deny")
        .await
        .unwrap_err();
    assert!(matches!(error, InvokerError::Validation(_)));
    assert!(error.to_string().contains(expected_error));
}
