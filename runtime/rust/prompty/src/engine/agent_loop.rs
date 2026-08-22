//! Provider-agnostic agent loop -- the canonical `TurnConformance.run` engine.
//!
//! This module owns the *observable* agent-loop contract that the cross-runtime
//! `@vector` suite (`schema/model/conformance/vectors/agent.tsp`, stage `agent`)
//! asserts. It mirrors the Python reference engine (`core/agent_loop.py`) exactly
//! and is deliberately provider-agnostic: the loop is driven by two abstract
//! callbacks --
//!
//! * `invoke_model(conversation) -> ModelResponse` -- one LLM call, and
//! * `dispatch_tool(call) -> String` -- one tool execution --
//!
//! so the same engine backs every provider (OpenAI, Azure, Anthropic, ...).
//! Providers supply only the wire translation that turns their raw response into
//! a [`ModelResponse`]; they never re-implement the loop, its accounting, or its
//! event vocabulary.
//!
//! Observable contract (verified against all 28 `run` vectors):
//! * `iterations` counts **LLM calls** (not tool rounds).
//! * `total_messages` = `conversation.len() + (if any tool round ran { 1 } else { 0 })`.
//! * `messages_updated.message_count` = `conversation.len() + 1` at the point the
//!   event fires (same convention).
//! * Events are emitted in a fixed order: `status` (loop start) -> `tool_call_start`
//!   -> `tool_result` -> `messages_updated` -> optional steering
//!   `status`/`messages_updated` -> `done`; `cancelled` replaces the tail when a
//!   cancellation fires.
//! * Canonical message shapes:
//!   - assistant-with-tool-calls: `{"role": "assistant", "content": "",
//!     "metadata": {"tool_calls": [...]}}` (content is the empty string).
//!   - tool result: `{"role": "tool", "content": <str>,
//!     "metadata": {"tool_call_id": <id>}}` (content stored as a string).
//!   - assistant final / system / user: `{"role": <role>, "content": <str>}`.
//!
//! Errors are returned as fields on [`AgentLoopResult`] (`error`, `error_type`,
//! `error_reason`) rather than raised, so the accumulated conversation and events
//! remain observable on the failure path.

use serde_json::{Value, json};

/// Default maximum number of LLM iterations before the loop aborts.
pub const DEFAULT_MAX_ITERATIONS: usize = 10;

/// Prefix used by the fallback compaction summary message.
pub const SUMMARY_PREFIX: &str = "[Summary of earlier conversation] ";

// Canonical error markers. The vectors assert the *class name* for cancellation
// and guardrail denials.
const CANCELLED_ERROR: &str = "CancelledError";
const GUARDRAIL_ERROR: &str = "GuardrailError";

/// A single tool invocation requested by the model.
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// Raw JSON string exactly as the model emitted it.
    pub arguments: String,
}

/// A normalized single-turn model response.
///
/// `raw_tool_calls` carries the provider's exact tool-call array so the assistant
/// message's `metadata.tool_calls` round-trips byte-for-byte; when omitted the
/// engine reconstructs it from [`ToolCall`] fields.
#[derive(Debug, Clone, Default)]
pub struct ModelResponse {
    pub content: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub raw_tool_calls: Option<Vec<Value>>,
}

/// Outcome of a guardrail check.
#[derive(Debug, Clone)]
pub struct GuardrailDecision {
    pub allowed: bool,
    pub reason: Option<String>,
}

impl GuardrailDecision {
    pub fn allow() -> Self {
        Self {
            allowed: true,
            reason: None,
        }
    }

    pub fn deny(reason: Option<String>) -> Self {
        Self {
            allowed: false,
            reason,
        }
    }
}

/// A steering message scheduled for injection before a given iteration.
#[derive(Debug, Clone)]
pub struct SteeringMessage {
    pub inject_before_iteration: i64,
    pub role: String,
    pub text: String,
}

/// The observable result of an agent-loop run.
#[derive(Debug, Clone, Default)]
pub struct AgentLoopResult {
    pub result: Option<String>,
    pub iterations: usize,
    pub conversation: Vec<Value>,
    pub events: Vec<Value>,
    pub tool_rounds: usize,
    pub tools_executed: usize,
    pub tool_execution_order: Vec<String>,
    pub denied_tools: Vec<String>,
    pub trimmed_messages: Option<Vec<Value>>,
    pub error: Option<String>,
    pub error_type: Option<String>,
    pub error_reason: Option<String>,
}

impl AgentLoopResult {
    /// Conversation length plus the conformance `+1` when tools ran.
    pub fn total_messages(&self) -> usize {
        self.conversation.len() + usize::from(self.tool_rounds > 0)
    }
}

type BoolCb<'a> = Box<dyn FnMut(&str) -> bool + 'a>;
type InputGuardrail<'a> = Box<dyn FnMut(&[Value]) -> GuardrailDecision + 'a>;
type OutputGuardrail<'a> = Box<dyn FnMut(&ModelResponse) -> GuardrailDecision + 'a>;
type ToolGuardrail<'a> = Box<dyn FnMut(&str, &Value) -> GuardrailDecision + 'a>;
type Summarize<'a> = Box<dyn FnMut(&[Value]) -> String + 'a>;

/// Optional inputs mirroring the `run` vector flags.
#[derive(Default)]
pub struct AgentLoopOptions<'a> {
    pub is_tool_registered: Option<BoolCb<'a>>,
    pub max_iterations: Option<usize>,
    pub input_guardrail: Option<InputGuardrail<'a>>,
    pub output_guardrail: Option<OutputGuardrail<'a>>,
    pub tool_guardrail: Option<ToolGuardrail<'a>>,
    pub steering: Vec<SteeringMessage>,
    pub cancel_at: Option<String>,
    pub context_budget: Option<i64>,
    pub summarize: Option<Summarize<'a>>,
}

fn assistant_tool_calls_message(response: &ModelResponse) -> Value {
    let tool_calls: Vec<Value> = match &response.raw_tool_calls {
        Some(raw) => raw.clone(),
        None => response
            .tool_calls
            .iter()
            .map(|tc| {
                json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": tc.arguments},
                })
            })
            .collect(),
    };
    json!({"role": "assistant", "content": "", "metadata": {"tool_calls": tool_calls}})
}

fn tool_message(call_id: &str, content: &str) -> Value {
    json!({"role": "tool", "content": content, "metadata": {"tool_call_id": call_id}})
}

fn char_count(messages: &[Value]) -> i64 {
    messages
        .iter()
        .filter_map(|m| m.get("content").and_then(Value::as_str))
        .map(|content| content.chars().count() as i64)
        .sum()
}

fn parse_args(arguments: &str) -> Value {
    if arguments.is_empty() {
        return json!({});
    }
    match serde_json::from_str::<Value>(arguments) {
        Ok(value) if value.is_object() => value,
        _ => json!({}),
    }
}

fn default_summary(dropped_users: &[Value]) -> String {
    let topics: Vec<String> = dropped_users
        .iter()
        .filter_map(|m| m.get("content").and_then(Value::as_str))
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .collect();
    format!("{SUMMARY_PREFIX}User asked about {}", topics.join("; "))
}

fn maybe_trim(
    conversation: &[Value],
    context_budget: Option<i64>,
    summarize: &mut Option<Summarize<'_>>,
) -> Option<Vec<Value>> {
    let budget = context_budget?;
    if char_count(conversation) <= budget {
        return None;
    }

    let systems: Vec<Value> = conversation
        .iter()
        .filter(|m| m.get("role").and_then(Value::as_str) == Some("system"))
        .cloned()
        .collect();
    let users: Vec<&Value> = conversation
        .iter()
        .filter(|m| m.get("role").and_then(Value::as_str) == Some("user"))
        .collect();
    let (dropped_users, last_user) = match users.split_last() {
        Some((last, rest)) => (
            rest.iter().map(|m| (*m).clone()).collect::<Vec<Value>>(),
            Some((*last).clone()),
        ),
        None => (Vec::new(), None),
    };

    let summary_text = match summarize {
        Some(callback) => callback(&dropped_users),
        None => default_summary(&dropped_users),
    };

    let mut trimmed = systems;
    trimmed.push(json!({"role": "system", "content": summary_text}));
    if let Some(last) = last_user {
        trimmed.push(
            json!({"role": "user", "content": last.get("content").cloned().unwrap_or(Value::Null)}),
        );
    }
    Some(trimmed)
}

/// Run the canonical agent loop and return its observable result.
///
/// `cancel_at` accepts the scripted positions `"before_iteration"` (before
/// iteration 1), `"before_iteration_<n>"` (before iteration *n*), and
/// `"after_tool_<i>"` (after the *i*-th tool of a round). The loop is
/// deterministic: given the same callbacks and flags it always produces the same
/// events and accounting.
pub fn run_agent_loop<IM, DT>(
    messages: Vec<Value>,
    mut invoke_model: IM,
    mut dispatch_tool: DT,
    mut options: AgentLoopOptions<'_>,
) -> AgentLoopResult
where
    IM: FnMut(&[Value]) -> ModelResponse,
    DT: FnMut(&ToolCall) -> String,
{
    let max_iterations = options.max_iterations.unwrap_or(DEFAULT_MAX_ITERATIONS);
    let mut result = AgentLoopResult::default();
    let mut conversation: Vec<Value> = messages;

    let emit = |result: &mut AgentLoopResult, event_type: &str, data: Value| {
        result
            .events
            .push(json!({"type": event_type, "data": data}));
    };

    emit(
        &mut result,
        "status",
        json!({"message": "Starting agent loop"}),
    );

    if let Some(trimmed) = maybe_trim(
        &conversation,
        options.context_budget,
        &mut options.summarize,
    ) {
        conversation = trimmed.clone();
        result.trimmed_messages = Some(trimmed);
    }

    let mut steering_pending = options.steering;

    loop {
        let iteration_number = (result.iterations + 1) as i64;

        // Cancellation at the top of the iteration.
        if options.cancel_at.as_deref() == Some("before_iteration") && iteration_number == 1 {
            emit(
                &mut result,
                "cancelled",
                json!({"reason": "Cancellation requested before first iteration"}),
            );
            result.error = Some(CANCELLED_ERROR.to_string());
            result.conversation = conversation;
            return result;
        }
        if options.cancel_at.as_deref() == Some(&format!("before_iteration_{iteration_number}")) {
            emit(
                &mut result,
                "cancelled",
                json!({"reason": format!("Cancellation requested before iteration {iteration_number}")}),
            );
            result.error = Some(CANCELLED_ERROR.to_string());
            result.conversation = conversation;
            return result;
        }

        // Steering: atomically drain everything scheduled for this iteration.
        let to_inject: Vec<SteeringMessage> = steering_pending
            .iter()
            .filter(|s| s.inject_before_iteration == iteration_number)
            .cloned()
            .collect();
        if !to_inject.is_empty() {
            steering_pending.retain(|s| s.inject_before_iteration != iteration_number);
            emit(
                &mut result,
                "status",
                json!({"message": "Injecting steering message"}),
            );
            for steer in &to_inject {
                conversation.push(json!({"role": steer.role, "content": steer.text}));
            }
            emit(
                &mut result,
                "messages_updated",
                json!({"message_count": conversation.len() + 1}),
            );
        }

        // Input guardrail runs before the LLM call.
        if let Some(guardrail) = options.input_guardrail.as_mut() {
            let decision = guardrail(&conversation);
            if !decision.allowed {
                result.error = Some(GUARDRAIL_ERROR.to_string());
                result.error_reason = decision.reason;
                result.conversation = conversation;
                return result;
            }
        }

        let response = invoke_model(&conversation);
        result.iterations += 1;

        // Output guardrail runs on the model response.
        if let Some(guardrail) = options.output_guardrail.as_mut() {
            let decision = guardrail(&response);
            if !decision.allowed {
                result.error = Some(GUARDRAIL_ERROR.to_string());
                result.error_reason = decision.reason;
                result.conversation = conversation;
                return result;
            }
        }

        if !response.tool_calls.is_empty() {
            conversation.push(assistant_tool_calls_message(&response));
            result.tool_rounds += 1;
            let mut cancelled = false;

            for (idx, call) in response.tool_calls.iter().enumerate() {
                emit(
                    &mut result,
                    "tool_call_start",
                    json!({"name": call.name, "arguments": call.arguments}),
                );

                if let Some(guardrail) = options.tool_guardrail.as_mut() {
                    let decision = guardrail(&call.name, &parse_args(&call.arguments));
                    if !decision.allowed {
                        result.denied_tools.push(call.name.clone());
                        let denial = format!(
                            "Tool denied by guardrail: {}",
                            decision.reason.clone().unwrap_or_default()
                        );
                        conversation.push(tool_message(&call.id, &denial));
                        continue;
                    }
                }

                let registered = match options.is_tool_registered.as_mut() {
                    Some(check) => check(&call.name),
                    None => true,
                };
                if !registered {
                    result.error = Some(format!("Tool not registered: {}", call.name));
                    result.error_type = Some("ValueError".to_string());
                    result.conversation = conversation;
                    return result;
                }

                let output = dispatch_tool(call);
                result.tools_executed += 1;
                result.tool_execution_order.push(call.name.clone());
                emit(
                    &mut result,
                    "tool_result",
                    json!({"name": call.name, "result": output}),
                );
                conversation.push(tool_message(&call.id, &output));

                if options.cancel_at.as_deref() == Some(&format!("after_tool_{idx}")) {
                    emit(
                        &mut result,
                        "cancelled",
                        json!({"reason": "Cancellation requested after tool execution"}),
                    );
                    result.error = Some(CANCELLED_ERROR.to_string());
                    cancelled = true;
                    break;
                }
            }

            if cancelled {
                result.conversation = conversation;
                return result;
            }

            emit(
                &mut result,
                "messages_updated",
                json!({"message_count": conversation.len() + 1}),
            );

            if result.iterations > max_iterations {
                result.error = Some(format!("Agent loop exceeded {max_iterations} iterations"));
                result.conversation = conversation;
                return result;
            }

            continue;
        }

        // No tool calls -- the model produced a final answer.
        result.result = response.content.clone();
        conversation.push(json!({
            "role": "assistant",
            "content": response.content.clone().map_or(Value::Null, Value::String),
        }));
        emit(
            &mut result,
            "done",
            json!({"response": response.content.clone().map_or(Value::Null, Value::String)}),
        );
        result.conversation = conversation;
        return result;
    }
}
