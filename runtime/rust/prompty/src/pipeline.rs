//! Pipeline orchestration — `prepare`, `run`, `invoke`, `turn`.
//!
//! These are the 5 public functions that compose the four pipeline stages
//! (renderer → parser → executor → processor). Matches the TypeScript
//! implementation at `@prompty/core/pipeline.ts`.
//!
//! Each step is independently traced. Users can bring their own
//! tracer backends (console, file, OpenTelemetry) via `Tracer::add`.

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use serde_json::{Value, json};

use crate::interfaces::InvokerError;
use crate::model::Prompty;
use crate::parsers::parse_chat;
use crate::registry;
use crate::renderers::prepare_render_inputs;
use crate::structured::{create_structured_result, to_structured_value, unwrap_structured};
use crate::tracing::{Tracer, sanitize_value};
use crate::types::{
    ContentPart, Message, PromptyStream, Role, StreamChunk, TextPart, ToolCall,
    consume_stream_chunks,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FORMAT: &str = "nunjucks";
const DEFAULT_PARSER: &str = "prompty";
const DEFAULT_PROVIDER: &str = "openai";

// ---------------------------------------------------------------------------
// Structured output helpers
// ---------------------------------------------------------------------------

/// Wrap a processor result in StructuredResult transport if the agent has outputs
/// and the result is a JSON object or array (i.e., structured data).
/// This preserves raw JSON for `cast()` while keeping processors clean.
fn wrap_structured_if_needed(agent: &Prompty, result: Value) -> Value {
    let has_outputs = agent.as_outputs().map(|o| !o.is_empty()).unwrap_or(false);
    if has_outputs && (result.is_object() || result.is_array()) {
        // The raw_json is the serialized form of the parsed result
        let raw_json = result.to_string();
        let sr = create_structured_result(result, raw_json);
        to_structured_value(&sr)
    } else {
        result
    }
}

// ---------------------------------------------------------------------------
// Config resolution helpers
// ---------------------------------------------------------------------------

fn resolve_format_kind(agent: &Prompty) -> String {
    agent
        .template
        .as_ref()
        .and_then(|t| {
            if t.format.kind.is_empty() {
                None
            } else {
                Some(t.format.kind.clone())
            }
        })
        .unwrap_or_else(|| DEFAULT_FORMAT.to_string())
}

fn resolve_parser_kind(agent: &Prompty) -> String {
    agent
        .template
        .as_ref()
        .and_then(|t| {
            if t.parser.kind.is_empty() {
                None
            } else {
                Some(t.parser.kind.clone())
            }
        })
        .unwrap_or_else(|| DEFAULT_PARSER.to_string())
}

fn resolve_provider(agent: &Prompty) -> String {
    agent
        .model
        .provider
        .as_deref()
        .filter(|p| !p.is_empty())
        .unwrap_or(DEFAULT_PROVIDER)
        .to_string()
}

/// Check if the agent's model options request streaming.
fn is_streaming(agent: &Prompty) -> bool {
    agent
        .model
        .options
        .as_ref()
        .and_then(|opts| {
            opts.additional_properties
                .get("stream")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Trace serialization helpers
// ---------------------------------------------------------------------------

/// Serialize agent summary for trace output.
fn serialize_agent(agent: &Prompty) -> Value {
    let metadata = agent
        .as_metadata_dict()
        .map(|m| Value::Object(m.clone()))
        .unwrap_or(Value::Null);

    let inputs: Vec<Value> = agent
        .as_inputs()
        .map(|props| {
            props
                .iter()
                .map(|p| {
                    json!({
                        "name": p.name,
                        "kind": p.kind_str(),
                        "description": p.description,
                        "required": p.required.unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let outputs: Vec<Value> = agent
        .as_outputs()
        .map(|props| {
            props
                .iter()
                .map(|p| {
                    json!({
                        "name": p.name,
                        "kind": p.kind_str(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let tools: Vec<Value> = agent
        .as_tools()
        .map(|tools| {
            tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "kind": t.kind_str(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    sanitize_value(
        "agent",
        &json!({
            "name": agent.name,
            "description": agent.description,
            "metadata": metadata,
            "model": {
                "id": agent.model.id,
                "apiType": agent.model.api_type.as_deref().unwrap_or("chat"),
                "provider": agent.model.provider.as_deref().unwrap_or(""),
            },
            "inputs": inputs,
            "outputs": outputs,
            "tools": tools,
            "template": {
                "format": resolve_format_kind(agent),
                "parser": resolve_parser_kind(agent),
            },
        }),
    )
}

/// Serialize messages for trace output.
fn serialize_messages(messages: &[Message]) -> Value {
    Value::Array(
        messages
            .iter()
            .map(|m| {
                json!({
                    "role": m.role.to_string(),
                    "content": m.text_content(),
                })
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// validate_inputs
// ---------------------------------------------------------------------------

/// Validate and fill defaults for agent inputs.
///
/// - Fills `default` values for missing optional inputs
/// - Raises `InvokerError::Validation` for missing required inputs
pub fn validate_inputs(
    agent: &Prompty,
    inputs: &serde_json::Value,
) -> Result<serde_json::Value, InvokerError> {
    let mut result = inputs.clone();

    let props = match agent.as_inputs() {
        Some(p) => p,
        None => return Ok(result),
    };

    let obj = result
        .as_object_mut()
        .ok_or_else(|| InvokerError::Validation("inputs must be a JSON object".into()))?;

    for prop in &props {
        if prop.name.is_empty() {
            continue;
        }
        if !obj.contains_key(&prop.name) {
            if let Some(ref default_val) = prop.default {
                obj.insert(prop.name.clone(), default_val.clone());
            } else if prop.required.unwrap_or(false) {
                return Err(InvokerError::Validation(format!(
                    "Missing required input: \"{}\"",
                    prop.name
                )));
            }
        }
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// render (internal)
// ---------------------------------------------------------------------------

/// Render the agent's template with the given inputs using the registered renderer.
///
/// Validates inputs (fills defaults, checks required) and injects nonce markers
/// for rich-kind inputs (thread, image, file, audio) before rendering.
pub async fn render(agent: &Prompty, inputs: &serde_json::Value) -> Result<String, InvokerError> {
    let (rendered, _nonces) = render_with_nonces(agent, inputs).await?;
    Ok(rendered)
}

/// Internal: render + return nonces for thread expansion in prepare().
async fn render_with_nonces(
    agent: &Prompty,
    inputs: &serde_json::Value,
) -> Result<(String, HashMap<String, String>), InvokerError> {
    let validated = validate_inputs(agent, inputs)?;
    let (nonce_inputs, nonces) = prepare_render_inputs(agent, &validated);
    let format_kind = resolve_format_kind(agent);
    let template = agent.instructions.as_deref().unwrap_or("");

    let span = Tracer::start("Renderer");
    span.emit(
        "signature",
        &json!(format!("prompty.renderers.{format_kind}.render")),
    );
    span.emit("inputs", &json!({ "data": &nonce_inputs }));

    match registry::invoke_renderer(&format_kind, agent, template, &nonce_inputs).await {
        Ok(result) => {
            span.emit("result", &json!(result));
            span.end();
            Ok((result, nonces))
        }
        Err(e) => {
            span.emit("error", &json!(e.to_string()));
            span.end();
            Err(e)
        }
    }
}

/// Parse rendered text into messages using the registered parser.
pub async fn parse(
    agent: &Prompty,
    rendered: &str,
    context: Option<&serde_json::Value>,
) -> Result<Vec<Message>, InvokerError> {
    let parser_kind = resolve_parser_kind(agent);

    let span = Tracer::start("Parser");
    span.emit(
        "signature",
        &json!(format!("prompty.parsers.{parser_kind}.parse")),
    );
    span.emit("inputs", &json!(rendered));

    let result = if parser_kind == "prompty" {
        Ok(parse_chat(rendered))
    } else {
        registry::invoke_parser(&parser_kind, agent, rendered, context).await
    };

    match result {
        Ok(messages) => {
            span.emit("result", &serialize_messages(&messages));
            span.end();
            Ok(messages)
        }
        Err(e) => {
            span.emit("error", &json!(e.to_string()));
            span.end();
            Err(e)
        }
    }
}

/// Process a raw LLM response using the registered processor.
pub async fn process(
    agent: &Prompty,
    response: serde_json::Value,
) -> Result<serde_json::Value, InvokerError> {
    let provider = resolve_provider(agent);

    let span = Tracer::start("Processor");
    span.emit(
        "signature",
        &json!(format!("prompty.processors.{provider}.process")),
    );
    span.emit("inputs", &json!("raw response"));

    match registry::invoke_processor(&provider, agent, response).await {
        Ok(result) => {
            // Wrap in StructuredResult if agent has outputs and result is parsed JSON object/array
            let result = wrap_structured_if_needed(agent, result);
            span.emit("result", &result);
            span.end();
            Ok(result)
        }
        Err(e) => {
            span.emit("error", &json!(e.to_string()));
            span.end();
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// prepare — render + parse + expand threads
// ---------------------------------------------------------------------------

/// Check if the agent has strict mode enabled (default: true per spec).
fn is_strict_mode(agent: &Prompty) -> bool {
    agent
        .template
        .as_ref()
        .and_then(|t| t.format.strict)
        .unwrap_or(true)
}

/// Render template + parse into messages + expand thread markers.
///
/// This is the first half of the pipeline: template → messages.
/// When strict mode is enabled (default), uses nonce-based injection defense.
pub async fn prepare(
    agent: &Prompty,
    inputs: Option<&serde_json::Value>,
) -> Result<Vec<Message>, InvokerError> {
    let span = Tracer::start("prepare");
    span.emit("signature", &json!("prompty.prepare"));
    span.emit("description", &json!("Render and parse into messages"));

    let empty = serde_json::json!({});
    let raw_inputs = inputs.unwrap_or(&empty);
    let validated = validate_inputs(agent, raw_inputs)?;
    span.emit("inputs", &json!(validated));

    let parser_kind = resolve_parser_kind(agent);
    let strict = is_strict_mode(agent);

    if strict {
        // Try to get pre_render context from the parser
        let pre_render_result =
            registry::invoke_pre_render(&parser_kind, agent.instructions.as_deref().unwrap_or(""));

        if let Ok(Some((sanitized_template, context))) = pre_render_result {
            // Create a temporary agent with sanitized instructions for rendering
            let mut temp_agent = agent.clone();
            temp_agent.instructions = Some(sanitized_template);

            let (rendered, nonces) = render_with_nonces(&temp_agent, &validated).await?;

            // Parse with nonce context for validation
            let messages = parse(agent, &rendered, Some(&context)).await?;

            let expanded = expand_threads(&messages, &nonces, &validated);

            span.emit("result", &serialize_messages(&expanded));
            span.end();
            return Ok(expanded);
        }
    }

    // Non-strict path (or parser has no pre_render)
    let (rendered, nonces) = render_with_nonces(agent, &validated).await?;
    let messages = parse(agent, &rendered, None).await?;

    let expanded = expand_threads(&messages, &nonces, &validated);

    span.emit("result", &serialize_messages(&expanded));
    span.end();
    Ok(expanded)
}

// ---------------------------------------------------------------------------
// run — executor + process
// ---------------------------------------------------------------------------

/// Execute messages against the LLM and process the response.
///
/// Takes pre-prepared messages (from `prepare`).
/// When `model.options.stream` is `true`, uses streaming execution and
/// returns the accumulated text content.
pub async fn run(agent: &Prompty, messages: &[Message]) -> Result<serde_json::Value, InvokerError> {
    let provider = resolve_provider(agent);

    let span = Tracer::start("run");
    span.emit("signature", &json!("prompty.run"));
    span.emit("description", &json!("Execute and process"));
    span.emit("inputs", &serialize_messages(messages));

    let streaming = is_streaming(agent);
    let result = if streaming {
        match registry::invoke_executor_stream(&provider, agent, messages).await {
            Ok(sse_stream) => {
                let prompty_stream = PromptyStream::from_stream("PromptyStream", sse_stream);
                let chunk_stream =
                    registry::invoke_processor_stream(&provider, Box::pin(prompty_stream))?;
                let (_, text) = consume_stream_chunks(chunk_stream, None).await;
                json!(text)
            }
            Err(_) => {
                // Fallback to non-streaming
                let response = registry::invoke_executor(&provider, agent, messages).await?;
                let result = process(agent, response).await?;
                unwrap_structured(&result)
            }
        }
    } else {
        let response = match registry::invoke_executor(&provider, agent, messages).await {
            Ok(r) => r,
            Err(e) => {
                span.emit("error", &json!(e.to_string()));
                span.end();
                return Err(e);
            }
        };
        let result = process(agent, response).await?;
        unwrap_structured(&result)
    };

    span.emit("result", &result);
    span.end();
    Ok(result)
}

// ---------------------------------------------------------------------------
// invoke — one-shot: load + prepare + execute + process
// ---------------------------------------------------------------------------

/// One-shot pipeline: load → prepare → execute → process.
///
/// Accepts either a file path (string) or a pre-loaded `Prompty` agent.
pub async fn invoke(
    agent: &Prompty,
    inputs: Option<&serde_json::Value>,
) -> Result<serde_json::Value, InvokerError> {
    let span = Tracer::start("invoke");
    span.emit("signature", &json!("prompty.invoke"));
    span.emit(
        "description",
        &json!(agent.description.as_deref().unwrap_or("")),
    );
    let empty = serde_json::json!({});
    span.emit(
        "inputs",
        &json!({
            "prompt": serialize_agent(agent),
            "inputs": inputs.unwrap_or(&empty),
        }),
    );

    let result: Result<serde_json::Value, InvokerError> = async {
        let messages = prepare(agent, inputs).await?;
        let provider = resolve_provider(agent);
        let response = registry::invoke_executor(&provider, agent, &messages).await?;
        process(agent, response).await
    }
    .await;

    match &result {
        Ok(v) => {
            span.emit("result", v);
            span.end();
        }
        Err(e) => {
            span.emit("error", &json!(e.to_string()));
            span.end();
        }
    }
    result
}

/// One-shot pipeline from a file path.
pub async fn invoke_from_path(
    path: impl AsRef<Path>,
    inputs: Option<&serde_json::Value>,
) -> Result<serde_json::Value, InvokerError> {
    let agent = crate::load(&path).map_err(|e| InvokerError::Validation(e.to_string()))?;

    let span = Tracer::start("load");
    span.emit("signature", &json!("prompty.load"));
    span.emit(
        "description",
        &json!(agent.description.as_deref().unwrap_or("")),
    );
    span.emit(
        "inputs",
        &json!({ "prompty_file": path.as_ref().display().to_string() }),
    );
    span.emit("result", &serialize_agent(&agent));
    span.end();

    invoke(&agent, inputs).await
}

// ---------------------------------------------------------------------------
// turn — conversational round-trip with optional tool calling
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent events
// ---------------------------------------------------------------------------

/// Events emitted during the agent loop in `turn()`.
#[derive(Debug, Clone)]
pub enum AgentEvent {
    /// A streaming token from the LLM.
    Token(String),
    /// A thinking/reasoning token from the LLM.
    Thinking(String),
    /// A tool call is about to be dispatched.
    ToolCallStart { name: String, arguments: String },
    /// A tool call has completed with a result.
    ToolResult { name: String, result: String },
    /// Status update from the agent loop.
    Status(String),
    /// The message list was updated (e.g., tool results appended).
    MessagesUpdated { messages: Vec<Message> },
    /// The agent loop has completed.
    Done {
        response: serde_json::Value,
        messages: Vec<Message>,
    },
    /// An error occurred.
    Error(String),
    /// The operation was cancelled.
    Cancelled,
}

/// Callback type for agent events.
pub type EventCallback = Box<dyn Fn(AgentEvent) + Send + Sync>;

// ---------------------------------------------------------------------------
// Tool function types
// ---------------------------------------------------------------------------

/// A synchronous tool function: takes JSON arguments, returns a string result.
pub type ToolFn = Box<
    dyn Fn(serde_json::Value) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
        + Send
        + Sync,
>;

/// An async tool function: takes JSON arguments, returns a string result.
pub type AsyncToolFn = Box<
    dyn Fn(
            serde_json::Value,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<String, Box<dyn std::error::Error + Send + Sync>>>
                    + Send,
            >,
        > + Send
        + Sync,
>;

/// A tool handler — either sync or async.
pub enum ToolHandler {
    Sync(ToolFn),
    Async(AsyncToolFn),
}

// ---------------------------------------------------------------------------
// TurnOptions
// ---------------------------------------------------------------------------

/// Options for a conversation turn.
pub struct TurnOptions {
    /// Maximum iterations for the agent tool-calling loop (default: 10).
    pub max_iterations: usize,
    /// If true, return the raw executor response without processing.
    pub raw: bool,
    /// Tool function handlers keyed by tool name.
    pub tools: HashMap<String, ToolHandler>,
    /// Event callback for monitoring agent loop progress.
    pub on_event: Option<EventCallback>,
    /// Cancellation token — set to true to cancel the loop.
    pub cancelled: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    /// Context window budget in characters. If set, messages are trimmed before each LLM call.
    pub context_budget: Option<usize>,
    /// Guardrails for input/output/tool checks.
    pub guardrails: Option<crate::guardrails::Guardrails>,
    /// Steering message queue for injecting messages between iterations.
    pub steering: Option<crate::steering::Steering>,
    /// If true, dispatch tool calls in parallel (via tokio::join!).
    pub parallel_tool_calls: bool,
    /// Optional validator for structured output (called via cast after processing).
    #[allow(clippy::type_complexity)]
    pub validator: Option<Box<dyn Fn(&serde_json::Value) -> Result<(), String> + Send + Sync>>,
}

impl Default for TurnOptions {
    fn default() -> Self {
        Self {
            max_iterations: 10,
            raw: false,
            tools: HashMap::new(),
            on_event: None,
            cancelled: None,
            context_budget: None,
            guardrails: None,
            steering: None,
            parallel_tool_calls: false,
            validator: None,
        }
    }
}

impl TurnOptions {
    /// Create TurnOptions with tool handlers.
    pub fn with_tools(tools: HashMap<String, ToolHandler>) -> Self {
        Self {
            tools,
            ..Default::default()
        }
    }

    fn emit(&self, event: AgentEvent) {
        if let Some(ref cb) = self.on_event {
            // Per spec §13.1: event callbacks MUST NOT block the loop.
            // If a callback panics, log and continue.
            if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cb(event))) {
                eprintln!("[prompty] Event callback panicked: {e:?}");
            }
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled
            .as_ref()
            .map(|c| c.load(std::sync::atomic::Ordering::Relaxed))
            .unwrap_or(false)
    }
}

// ---------------------------------------------------------------------------
// turn — conversational round-trip with optional tool calling
// ---------------------------------------------------------------------------

/// One conversational round-trip: prepare → [agent loop with tool calls] → process.
///
/// Without tools, this is equivalent to `invoke` (simple mode). With tools,
/// it loops: execute → check for tool_calls → dispatch tools → re-execute
/// until the model returns a final response or `max_iterations` is reached.
///
/// Extensions (matching TypeScript):
/// - **Context trimming**: If `context_budget` is set, messages are trimmed before each LLM call
/// - **Guardrails**: Input/output/tool guardrails checked at appropriate points
/// - **Steering**: Messages injected between iterations
/// - **Parallel tools**: If `parallel_tool_calls` is true, tool calls run concurrently
/// - **Cancellation**: Checked at each iteration boundary
pub async fn turn(
    agent: &Prompty,
    inputs: Option<&serde_json::Value>,
    options: Option<TurnOptions>,
) -> Result<serde_json::Value, InvokerError> {
    let mut opts = options.unwrap_or_default();

    // If no tools registered (neither user tools nor global registry), fast-path to invoke
    if opts.tools.is_empty() && !has_any_tools(agent) {
        // Simple mode: steering → trim → input guardrail → execute → output guardrail → process
        let span = Tracer::start("turn");
        span.emit("signature", &json!("prompty.turn"));
        span.emit("description", &json!("Simple turn (no tools)"));
        let empty = serde_json::json!({});
        span.emit("inputs", inputs.unwrap_or(&empty));

        let mut messages = prepare(agent, inputs).await?;
        let provider = resolve_provider(agent);

        // Drain steering
        if let Some(ref mut steering) = opts.steering {
            messages.extend(steering.drain());
        }

        // Context trimming
        if let Some(budget) = opts.context_budget {
            let (dropped, trimmed) = crate::context::trim_to_context_window(&messages, budget);
            if dropped > 0 {
                span.emit("context_trimmed", &json!(dropped));
            }
            messages = trimmed;
        }

        // Input guardrail
        if let Some(ref guardrails) = opts.guardrails {
            let gr = guardrails.check_input(&messages, agent).await;
            if !gr.allowed {
                let reason = gr.reason.unwrap_or_else(|| "Input denied".into());
                span.emit("error", &json!(format!("Input guardrail: {reason}")));
                span.end();
                return Err(InvokerError::Execute(
                    format!("Input guardrail denied: {reason}").into(),
                ));
            }
        }

        // Execute (streaming-aware)
        let streaming = is_streaming(agent);
        let processed = if streaming {
            match registry::invoke_executor_stream(&provider, agent, &messages).await {
                Ok(sse_stream) => {
                    let prompty_stream = PromptyStream::from_stream("PromptyStream", sse_stream);
                    let chunk_stream =
                        registry::invoke_processor_stream(&provider, Box::pin(prompty_stream))?;

                    use futures::StreamExt;
                    let mut text_parts = Vec::new();
                    futures::pin_mut!(chunk_stream);
                    while let Some(chunk) = chunk_stream.next().await {
                        match chunk {
                            StreamChunk::Text(t) => {
                                opts.emit(AgentEvent::Token(t.clone()));
                                text_parts.push(t);
                            }
                            StreamChunk::Thinking(t) => {
                                opts.emit(AgentEvent::Thinking(t));
                            }
                            StreamChunk::Error(e) => {
                                span.emit("error", &json!(e));
                                span.end();
                                return Err(InvokerError::Execute(e.into()));
                            }
                            _ => {}
                        }
                    }
                    json!(text_parts.join(""))
                }
                Err(_) => {
                    // Fallback to non-streaming
                    let raw_response =
                        registry::invoke_executor(&provider, agent, &messages).await?;
                    if opts.raw {
                        span.emit("result", &json!("(raw)"));
                        span.end();
                        return Ok(raw_response);
                    }

                    process(agent, raw_response).await?
                }
            }
        } else {
            let raw_response = registry::invoke_executor(&provider, agent, &messages).await?;

            if opts.raw {
                span.emit("result", &json!("(raw)"));
                span.end();
                return Ok(raw_response);
            }

            process(agent, raw_response).await?
        };

        // Output guardrail
        if let Some(ref guardrails) = opts.guardrails {
            let gr = guardrails.check_output(&processed, agent).await;
            if !gr.allowed {
                let reason = gr.reason.unwrap_or_else(|| "Output denied".into());
                span.emit("error", &json!(format!("Output guardrail: {reason}")));
                span.end();
                return Err(InvokerError::Execute(
                    format!("Output guardrail denied: {reason}").into(),
                ));
            }
            if let Some(rewrite) = gr.rewrite {
                span.emit("result", &rewrite);
                span.end();
                return Ok(rewrite);
            }
        }

        span.emit("result", &processed);
        span.end();
        return Ok(processed);
    }

    // Agent mode — tool-calling loop
    let span = Tracer::start("turn");
    span.emit("signature", &json!("prompty.turn"));
    span.emit("description", &json!("Agent turn (tool-calling loop)"));
    let empty = serde_json::json!({});
    span.emit("inputs", inputs.unwrap_or(&empty));

    // Check cancellation at start
    if opts.is_cancelled() {
        opts.emit(AgentEvent::Cancelled);
        span.emit("error", &json!("Operation cancelled"));
        span.end();
        return Err(InvokerError::Cancelled("Operation cancelled".to_string()));
    }

    // Prepare messages
    let mut messages = prepare(agent, inputs).await?;
    let provider = resolve_provider(agent);

    for iteration in 0..opts.max_iterations {
        // Check cancellation before each LLM call
        if opts.is_cancelled() {
            opts.emit(AgentEvent::Cancelled);
            span.emit("error", &json!("Operation cancelled"));
            span.end();
            return Err(InvokerError::Cancelled("Operation cancelled".to_string()));
        }

        let iter_span = Tracer::start(&format!("turn.iteration.{iteration}"));
        iter_span.emit("iteration", &json!(iteration));

        // Drain steering messages
        if let Some(ref steering) = opts.steering {
            let steering_msgs = steering.drain();
            if !steering_msgs.is_empty() {
                let count = steering_msgs.len();
                iter_span.emit("steering_messages", &json!(count));
                messages.extend(steering_msgs);
                opts.emit(AgentEvent::Status(format!(
                    "Injected {count} steering message(s)"
                )));
                opts.emit(AgentEvent::MessagesUpdated {
                    messages: messages.clone(),
                });
            }
        }

        // Context trimming
        if let Some(budget) = opts.context_budget {
            let (dropped, trimmed) = crate::context::trim_to_context_window(&messages, budget);
            if dropped > 0 {
                iter_span.emit("context_trimmed", &json!(dropped));
                messages = trimmed;
                opts.emit(AgentEvent::MessagesUpdated {
                    messages: messages.clone(),
                });
            } else {
                messages = trimmed;
            }
        }

        // Input guardrail
        if let Some(ref guardrails) = opts.guardrails {
            let gr = guardrails.check_input(&messages, agent).await;
            if !gr.allowed {
                let reason = gr.reason.unwrap_or_else(|| "Input denied".into());
                iter_span.end();
                span.emit("error", &json!(format!("Input guardrail: {reason}")));
                span.end();
                return Err(InvokerError::Execute(
                    format!("Input guardrail denied: {reason}").into(),
                ));
            }
        }

        // Execute LLM — streaming or non-streaming
        let streaming = is_streaming(agent);
        let (tool_calls, processed, raw_response) = if streaming {
            // Streaming path: execute_stream → PromptyStream → process_stream → consume
            match registry::invoke_executor_stream(&provider, agent, &messages).await {
                Ok(sse_stream) => {
                    let prompty_stream = PromptyStream::from_stream("PromptyStream", sse_stream);
                    let chunk_stream =
                        registry::invoke_processor_stream(&provider, Box::pin(prompty_stream))?;

                    let (tool_calls_vec, text) = {
                        use futures::StreamExt;
                        let mut tool_calls_vec = Vec::new();
                        let mut text_parts = Vec::new();
                        let mut stream_error = None;
                        futures::pin_mut!(chunk_stream);
                        while let Some(chunk) = chunk_stream.next().await {
                            match chunk {
                                StreamChunk::Text(t) => {
                                    opts.emit(AgentEvent::Token(t.clone()));
                                    text_parts.push(t);
                                }
                                StreamChunk::Thinking(t) => {
                                    opts.emit(AgentEvent::Thinking(t));
                                }
                                StreamChunk::Tool(tc) => {
                                    tool_calls_vec.push(tc);
                                }
                                StreamChunk::Error(e) => {
                                    stream_error = Some(e);
                                    break;
                                }
                            }
                        }
                        if let Some(err) = stream_error {
                            iter_span.end();
                            span.emit("error", &json!(err));
                            span.end();
                            return Err(InvokerError::Execute(err.into()));
                        }
                        (tool_calls_vec, text_parts.join(""))
                    };

                    let processed = json!(text);
                    (tool_calls_vec, processed, json!(null))
                }
                Err(_) => {
                    // Fallback to non-streaming if executor doesn't support it
                    let raw_response =
                        registry::invoke_executor(&provider, agent, &messages).await?;
                    let processed = process(agent, raw_response.clone()).await?;
                    let tool_calls = extract_tool_calls_from_processed(&processed);
                    (tool_calls, processed, raw_response)
                }
            }
        } else {
            // Non-streaming path
            let raw_response = registry::invoke_executor(&provider, agent, &messages).await?;
            let processed = process(agent, raw_response.clone()).await?;
            let tool_calls = extract_tool_calls_from_processed(&processed);
            (tool_calls, processed, raw_response)
        };

        if tool_calls.is_empty() {
            // No tool calls — final response

            // Output guardrail
            if let Some(ref guardrails) = opts.guardrails {
                let gr = guardrails.check_output(&processed, agent).await;
                if !gr.allowed {
                    let reason = gr.reason.unwrap_or_else(|| "Output denied".into());
                    iter_span.end();
                    span.emit("error", &json!(format!("Output guardrail: {reason}")));
                    span.end();
                    return Err(InvokerError::Execute(
                        format!("Output guardrail denied: {reason}").into(),
                    ));
                }
                if let Some(rewrite) = gr.rewrite {
                    iter_span.emit("result", &rewrite);
                    iter_span.end();
                    opts.emit(AgentEvent::Done {
                        response: rewrite.clone(),
                        messages: messages.clone(),
                    });
                    span.emit("result", &rewrite);
                    span.emit("iterations", &json!(iteration + 1));
                    span.end();
                    return Ok(rewrite);
                }
            }

            iter_span.emit("result", &processed);
            iter_span.end();
            let final_result = unwrap_structured(&processed);
            opts.emit(AgentEvent::Done {
                response: final_result.clone(),
                messages: messages.clone(),
            });
            span.emit("result", &final_result);
            span.emit("iterations", &json!(iteration + 1));
            span.end();
            return Ok(final_result);
        }

        // Dispatch tool calls (parallel or sequential)
        let tool_span = Tracer::start("turn.toolCalls");
        tool_span.emit("signature", &json!("prompty.turn.toolCalls"));
        tool_span.emit(
            "inputs",
            &json!(
                tool_calls
                    .iter()
                    .map(|tc| {
                        json!({ "name": tc.name, "id": tc.id, "arguments": tc.arguments })
                    })
                    .collect::<Vec<_>>()
            ),
        );

        let tool_results = if opts.parallel_tool_calls {
            dispatch_tools_parallel(&tool_calls, &opts, agent, inputs).await
        } else {
            dispatch_tools_sequential(&tool_calls, &opts, agent, inputs).await?
        };

        tool_span.emit("result", &json!(tool_results));
        tool_span.end();

        // Extract text content for formatToolMessages (some providers need it)
        let text_content = extract_text_from_processed(&processed);

        // Format tool results into messages using provider-specific formatting
        let tool_messages = registry::invoke_format_tool_messages(
            &provider,
            &raw_response,
            &tool_calls,
            &tool_results,
            text_content.as_deref(),
        )?;

        messages.extend(tool_messages);
        opts.emit(AgentEvent::MessagesUpdated {
            messages: messages.clone(),
        });

        iter_span.emit(
            "tool_calls",
            &json!(
                tool_calls
                    .iter()
                    .map(|tc| { json!({ "name": tc.name, "id": tc.id }) })
                    .collect::<Vec<_>>()
            ),
        );
        iter_span.end();

        // If this was the last iteration, error out like TypeScript does
        if iteration == opts.max_iterations - 1 {
            let msg = format!(
                "Agent loop exceeded max iterations ({})",
                opts.max_iterations
            );
            opts.emit(AgentEvent::Error(msg.clone()));
            span.emit("error", &json!(msg));
            span.end();
            return Err(InvokerError::Execute(msg.into()));
        }
    }

    // Loop exhausted without returning — only reachable if max_iterations == 0
    let msg = format!(
        "Agent loop exceeded max iterations ({})",
        opts.max_iterations
    );
    opts.emit(AgentEvent::Error(msg.clone()));
    span.emit("error", &json!(msg));
    span.end();
    Err(InvokerError::Execute(msg.into()))
}

/// Convenience wrapper: load a `.prompty` file and run `turn()` on it.
///
/// Mirrors the TypeScript API where `turn()` accepts either a loaded agent or a path string.
pub async fn turn_from_path(
    path: impl AsRef<std::path::Path>,
    inputs: Option<&serde_json::Value>,
    options: Option<TurnOptions>,
) -> Result<serde_json::Value, InvokerError> {
    let agent = crate::loader::load_async(path)
        .await
        .map_err(|e| InvokerError::Load(e.to_string()))?;
    turn(&agent, inputs, options).await
}
fn has_any_tools(agent: &Prompty) -> bool {
    if let Some(arr) = agent.tools.as_array() {
        if !arr.is_empty() {
            return true;
        }
    }
    false
}

/// Dispatch tool calls sequentially, checking cancellation and tool guardrails.
async fn dispatch_tools_sequential(
    tool_calls: &[ToolCall],
    opts: &TurnOptions,
    agent: &Prompty,
    parent_inputs: Option<&serde_json::Value>,
) -> Result<Vec<String>, InvokerError> {
    let mut tool_results = Vec::new();
    for tc in tool_calls {
        // Check cancellation before each tool call
        if opts.is_cancelled() {
            opts.emit(AgentEvent::Cancelled);
            return Err(InvokerError::Cancelled("Operation cancelled".to_string()));
        }

        // Tool guardrail
        if let Some(ref guardrails) = opts.guardrails {
            let args: serde_json::Value = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
            let gr = guardrails.check_tool(&tc.name, &args, agent).await;
            if !gr.allowed {
                let reason = gr.reason.unwrap_or_else(|| "Tool denied".into());
                opts.emit(AgentEvent::ToolResult {
                    name: tc.name.clone(),
                    result: format!("Error: Tool guardrail denied: {reason}"),
                });
                tool_results.push(format!("Error: Tool guardrail denied: {reason}"));
                continue;
            }
        }

        opts.emit(AgentEvent::ToolCallStart {
            name: tc.name.clone(),
            arguments: tc.arguments.clone(),
        });

        let result =
            crate::tool_dispatch::dispatch_tool(tc, &opts.tools, agent, parent_inputs).await;

        opts.emit(AgentEvent::ToolResult {
            name: tc.name.clone(),
            result: result.clone(),
        });
        tool_results.push(result);
    }
    Ok(tool_results)
}

/// Dispatch tool calls in parallel using tokio::join_all.
async fn dispatch_tools_parallel(
    tool_calls: &[ToolCall],
    opts: &TurnOptions,
    agent: &Prompty,
    parent_inputs: Option<&serde_json::Value>,
) -> Vec<String> {
    // Emit start events synchronously before dispatching
    for tc in tool_calls {
        opts.emit(AgentEvent::ToolCallStart {
            name: tc.name.clone(),
            arguments: tc.arguments.clone(),
        });
    }

    // Dispatch all in parallel
    let futures: Vec<_> = tool_calls
        .iter()
        .map(|tc| {
            let tools = &opts.tools;
            async move {
                // Tool guardrail (check in parallel)
                if let Some(ref guardrails) = opts.guardrails {
                    let args: serde_json::Value =
                        serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
                    let gr = guardrails.check_tool(&tc.name, &args, agent).await;
                    if !gr.allowed {
                        let reason = gr.reason.unwrap_or_else(|| "Tool denied".into());
                        return format!("Error: Tool guardrail denied: {reason}");
                    }
                }
                crate::tool_dispatch::dispatch_tool(tc, tools, agent, parent_inputs).await
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    // Emit result events
    for (tc, result) in tool_calls.iter().zip(results.iter()) {
        opts.emit(AgentEvent::ToolResult {
            name: tc.name.clone(),
            result: result.clone(),
        });
    }

    results
}

/// Extract ToolCalls from a processed response value.
///
/// Works with both OpenAI-style and Anthropic-style processed results:
/// both return `Value::Array([{id, name, arguments}])` for tool calls.
fn extract_tool_calls_from_processed(processed: &serde_json::Value) -> Vec<ToolCall> {
    let arr = match processed.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };

    arr.iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_str()?.to_string();
            let name = v.get("name")?.as_str()?.to_string();
            let arguments = v.get("arguments")?.as_str()?.to_string();
            Some(ToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect()
}

/// Extract text content from a processed response (if it's a string, not tool calls).
fn extract_text_from_processed(processed: &serde_json::Value) -> Option<String> {
    processed.as_str().map(String::from)
}

// ---------------------------------------------------------------------------
// Thread expansion
// ---------------------------------------------------------------------------

/// Expand thread nonce markers in messages with actual conversation history.
fn expand_threads(
    messages: &[Message],
    nonces: &HashMap<String, String>,
    inputs: &serde_json::Value,
) -> Vec<Message> {
    if nonces.is_empty() {
        return messages.to_vec();
    }

    // Build nonce → input name lookup
    let nonce_to_name: HashMap<&str, &str> = nonces
        .iter()
        .map(|(name, nonce)| (nonce.as_str(), name.as_str()))
        .collect();

    let mut result: Vec<Message> = Vec::new();

    for msg in messages {
        let mut expanded = false;

        for part in &msg.parts {
            if let ContentPart::Text(text_part) = part {
                for (nonce, name) in &nonce_to_name {
                    if text_part.value.contains(*nonce) {
                        let idx = text_part.value.find(*nonce).unwrap();
                        let before = text_part.value[..idx].trim();
                        let after = text_part.value[idx + nonce.len()..].trim();

                        if !before.is_empty() {
                            result.push(Message::text(msg.role, before));
                        }

                        // Insert thread messages from inputs
                        if let Some(thread_msgs) = inputs.get(*name) {
                            if let Some(arr) = thread_msgs.as_array() {
                                for tm in arr {
                                    if let Some(m) = dict_to_message(tm) {
                                        result.push(m);
                                    }
                                }
                            }
                        }

                        if !after.is_empty() {
                            result.push(Message::text(msg.role, after));
                        }

                        expanded = true;
                        break;
                    }
                }
            }
            if expanded {
                break;
            }
        }

        if !expanded {
            result.push(msg.clone());
        }
    }

    result
}

/// Convert a JSON dict `{role, content}` to a `Message`.
fn dict_to_message(value: &serde_json::Value) -> Option<Message> {
    let obj = value.as_object()?;
    let role_str = obj.get("role")?.as_str()?;
    let role = Role::from_str_opt(role_str)?;
    let content = obj.get("content").and_then(|v| v.as_str()).unwrap_or("");
    Some(Message {
        role,
        parts: vec![ContentPart::Text(TextPart {
            value: content.to_string(),
        })],
        metadata: serde_json::Map::new(),
    })
}

// ---------------------------------------------------------------------------
// Default registrations
// ---------------------------------------------------------------------------

/// Register the built-in renderers, parsers, and tool handlers.
///
/// Call this once at startup (or it's called automatically by the pipeline).
pub fn register_defaults() {
    use crate::parsers::PromptyChatParser;
    use crate::renderers::{MustacheRenderer, NunjucksRenderer};
    use crate::tool_dispatch::register_builtin_handlers;

    registry::register_renderer("nunjucks", NunjucksRenderer);
    registry::register_renderer("jinja2", NunjucksRenderer);
    registry::register_renderer("mustache", MustacheRenderer);
    registry::register_parser("prompty", PromptyChatParser);
    register_builtin_handlers();
}

/// Ensure defaults are registered (idempotent). Only used in tests.
#[cfg(test)]
pub(crate) fn ensure_defaults() {
    if !registry::has_renderer("nunjucks") {
        register_defaults();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Prompty;
    use crate::model::context::LoadContext;
    use serial_test::serial;

    fn make_agent_with_inputs() -> Prompty {
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "test",
            "model": "gpt-4",
            "inputs": [
                {"name": "firstName", "kind": "string", "default": "Jane"},
                {"name": "lastName", "kind": "string", "required": true},
                {"name": "question", "kind": "string"}
            ],
            "instructions": "system:\nHello {{ firstName }} {{ lastName }}\n\nuser:\n{{ question }}"
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[test]
    fn test_validate_inputs_fills_defaults() {
        let agent = make_agent_with_inputs();
        let inputs = serde_json::json!({"lastName": "Doe", "question": "Hi"});
        let result = validate_inputs(&agent, &inputs).unwrap();
        assert_eq!(result["firstName"], "Jane");
        assert_eq!(result["lastName"], "Doe");
    }

    #[test]
    fn test_validate_inputs_missing_required() {
        let agent = make_agent_with_inputs();
        let inputs = serde_json::json!({"question": "Hi"});
        let err = validate_inputs(&agent, &inputs).unwrap_err();
        assert!(err.to_string().contains("lastName"));
    }

    #[test]
    fn test_validate_inputs_no_schema() {
        let agent = Prompty::default();
        let inputs = serde_json::json!({"anything": "goes"});
        let result = validate_inputs(&agent, &inputs).unwrap();
        assert_eq!(result["anything"], "goes");
    }

    #[tokio::test]
    #[serial]
    async fn test_prepare_renders_and_parses() {
        ensure_defaults();
        let agent = make_agent_with_inputs();
        let inputs = serde_json::json!({"lastName": "Doe", "question": "What is life?"});
        let messages = prepare(&agent, Some(&inputs)).await.unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, Role::System);
        assert!(messages[0].text_content().contains("Jane Doe"));
        assert_eq!(messages[1].role, Role::User);
        assert_eq!(messages[1].text_content(), "What is life?");
    }

    #[tokio::test]
    #[serial]
    async fn test_prepare_with_defaults() {
        ensure_defaults();
        let agent = make_agent_with_inputs();
        // question is provided (no default), firstName uses default "Jane"
        let inputs = serde_json::json!({"lastName": "Smith", "question": "test"});
        let messages = prepare(&agent, Some(&inputs)).await.unwrap();
        assert!(messages[0].text_content().contains("Jane Smith"));
    }

    #[test]
    fn test_expand_threads_no_nonces() {
        let msgs = vec![Message::text(Role::System, "Hello")];
        let nonces = HashMap::new();
        let inputs = serde_json::json!({});
        let result = expand_threads(&msgs, &nonces, &inputs);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_expand_threads_with_conversation() {
        let nonce = "__PROMPTY_THREAD_abcd1234_conversation__";
        let msgs = vec![
            Message::text(Role::System, "You are helpful."),
            Message::text(Role::User, &format!("Before\n{nonce}\nAfter")),
        ];
        let mut nonces = HashMap::new();
        nonces.insert("conversation".to_string(), nonce.to_string());
        let inputs = serde_json::json!({
            "conversation": [
                {"role": "user", "content": "Previous Q"},
                {"role": "assistant", "content": "Previous A"}
            ]
        });
        let result = expand_threads(&msgs, &nonces, &inputs);
        // system + before + prev_user + prev_assistant + after
        assert_eq!(result.len(), 5);
        assert_eq!(result[0].role, Role::System);
        assert_eq!(result[1].text_content(), "Before");
        assert_eq!(result[2].role, Role::User);
        assert_eq!(result[2].text_content(), "Previous Q");
        assert_eq!(result[3].role, Role::Assistant);
        assert_eq!(result[3].text_content(), "Previous A");
        assert_eq!(result[4].text_content(), "After");
    }

    #[test]
    fn test_dict_to_message() {
        let val = serde_json::json!({"role": "user", "content": "Hello"});
        let msg = dict_to_message(&val).unwrap();
        assert_eq!(msg.role, Role::User);
        assert_eq!(msg.text_content(), "Hello");
    }

    #[test]
    fn test_dict_to_message_invalid() {
        assert!(dict_to_message(&serde_json::json!(42)).is_none());
        assert!(dict_to_message(&serde_json::json!({"role": "unknown"})).is_none());
    }

    #[test]
    fn test_resolve_defaults() {
        let agent = Prompty::default();
        assert_eq!(resolve_format_kind(&agent), "nunjucks");
        assert_eq!(resolve_parser_kind(&agent), "prompty");
        assert_eq!(resolve_provider(&agent), "openai");
    }

    // -----------------------------------------------------------------------
    // Agent loop / turn() helper tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_tool_calls_from_processed_array() {
        let processed = serde_json::json!([
            {"id": "call_1", "name": "get_weather", "arguments": "{\"city\":\"Paris\"}"},
            {"id": "call_2", "name": "get_time", "arguments": "{\"tz\":\"UTC\"}"}
        ]);
        let calls = extract_tool_calls_from_processed(&processed);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "get_weather");
        assert_eq!(calls[1].name, "get_time");
    }

    #[test]
    fn test_extract_tool_calls_from_processed_string() {
        let processed = serde_json::json!("Hello, how can I help?");
        let calls = extract_tool_calls_from_processed(&processed);
        assert!(calls.is_empty());
    }

    #[test]
    fn test_extract_tool_calls_from_processed_empty_array() {
        let processed = serde_json::json!([]);
        let calls = extract_tool_calls_from_processed(&processed);
        assert!(calls.is_empty());
    }

    #[test]
    fn test_extract_text_from_processed_string() {
        let processed = serde_json::json!("Hello!");
        assert_eq!(
            extract_text_from_processed(&processed),
            Some("Hello!".to_string())
        );
    }

    #[test]
    fn test_extract_text_from_processed_non_string() {
        let processed = serde_json::json!([{"id": "1", "name": "tool"}]);
        assert_eq!(extract_text_from_processed(&processed), None);
    }

    #[tokio::test]
    async fn test_dispatch_tool_sync() {
        let mut tools = HashMap::new();
        tools.insert(
            "greet".to_string(),
            ToolHandler::Sync(Box::new(|args| {
                let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("World");
                Ok(format!("Hello, {name}!"))
            })),
        );

        let tc = ToolCall {
            id: "call_1".to_string(),
            name: "greet".to_string(),
            arguments: r#"{"name":"Rust"}"#.to_string(),
        };

        let agent = Prompty::default();
        let result = crate::tool_dispatch::dispatch_tool(&tc, &tools, &agent, None).await;
        assert_eq!(result, "Hello, Rust!");
    }

    #[tokio::test]
    async fn test_dispatch_tool_async() {
        let mut tools = HashMap::new();
        tools.insert(
            "greet".to_string(),
            ToolHandler::Async(Box::new(|args| {
                Box::pin(async move {
                    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("World");
                    Ok(format!("Hello, {name}!"))
                })
            })),
        );

        let tc = ToolCall {
            id: "call_1".to_string(),
            name: "greet".to_string(),
            arguments: r#"{"name":"Async"}"#.to_string(),
        };

        let agent = Prompty::default();
        let result = crate::tool_dispatch::dispatch_tool(&tc, &tools, &agent, None).await;
        assert_eq!(result, "Hello, Async!");
    }

    #[tokio::test]
    async fn test_dispatch_tool_missing() {
        let tools = HashMap::new();
        let tc = ToolCall {
            id: "call_1".to_string(),
            name: "nonexistent".to_string(),
            arguments: "{}".to_string(),
        };

        let agent = Prompty::default();
        // Missing tool returns error string (non-fatal), matching TypeScript behavior
        let result = crate::tool_dispatch::dispatch_tool(&tc, &tools, &agent, None).await;
        assert!(result.contains("nonexistent"));
        assert!(result.contains("Error"));
    }

    #[test]
    fn test_turn_options_default() {
        let opts = TurnOptions::default();
        assert_eq!(opts.max_iterations, 10);
        assert!(!opts.raw);
        assert!(opts.tools.is_empty());
        assert!(!opts.is_cancelled());
    }

    #[test]
    fn test_turn_options_cancellation() {
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let opts = TurnOptions {
            cancelled: Some(cancel.clone()),
            ..Default::default()
        };
        assert!(!opts.is_cancelled());
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(opts.is_cancelled());
    }

    #[test]
    fn test_event_callback() {
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let opts = TurnOptions {
            on_event: Some(Box::new(move |event| {
                events_clone.lock().unwrap().push(format!("{:?}", event));
            })),
            ..Default::default()
        };

        opts.emit(AgentEvent::ToolCallStart {
            name: "test".into(),
            arguments: "{}".into(),
        });
        opts.emit(AgentEvent::Done {
            response: json!("test"),
            messages: vec![],
        });

        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 2);
        assert!(captured[0].contains("ToolCallStart"));
        assert!(captured[1].contains("Done"));
    }

    // -----------------------------------------------------------------------
    // Full turn() agent loop integration tests
    // -----------------------------------------------------------------------
    //
    // These tests register mock executors/processors in the global registry
    // and exercise the full turn() function.

    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Mock executor that returns tool calls on first call, then a final response.
    struct ToolCallThenDoneExecutor {
        call_count: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for ToolCallThenDoneExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            let n = self.call_count.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                // First call: return tool call in OpenAI format
                Ok(serde_json::json!({
                    "choices": [{
                        "message": {
                            "tool_calls": [{
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": "{\"city\":\"Seattle\"}"
                                }
                            }]
                        }
                    }]
                }))
            } else {
                // Subsequent calls: return final text response
                Ok(serde_json::json!({
                    "choices": [{
                        "message": {
                            "content": "The weather in Seattle is 72°F."
                        }
                    }]
                }))
            }
        }
    }

    /// Mock executor that always returns tool calls (for max_iterations test).
    struct AlwaysToolCallExecutor;

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for AlwaysToolCallExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            Ok(serde_json::json!({
                "choices": [{
                    "message": {
                        "tool_calls": [{
                            "id": "call_loop",
                            "type": "function",
                            "function": {
                                "name": "ticker",
                                "arguments": "{}"
                            }
                        }]
                    }
                }]
            }))
        }
    }

    /// Mock executor that returns multi-tool calls.
    struct MultiToolExecutor {
        call_count: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for MultiToolExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            let n = self.call_count.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                Ok(serde_json::json!({
                    "choices": [{
                        "message": {
                            "tool_calls": [
                                {"id": "c1", "type": "function", "function": {"name": "add", "arguments": "{\"a\":1,\"b\":2}"}},
                                {"id": "c2", "type": "function", "function": {"name": "multiply", "arguments": "{\"a\":3,\"b\":4}"}}
                            ]
                        }
                    }]
                }))
            } else {
                Ok(serde_json::json!({"choices": [{"message": {"content": "3 and 12"}}]}))
            }
        }
    }

    /// Passthrough processor — just processes as OpenAI format.
    struct MockProcessor;

    #[async_trait::async_trait]
    impl crate::interfaces::Processor for MockProcessor {
        async fn process(
            &self,
            agent: &Prompty,
            response: serde_json::Value,
        ) -> Result<serde_json::Value, InvokerError> {
            // Inline minimal OpenAI processing logic
            if let Some(choices) = response.get("choices").and_then(|c| c.as_array()) {
                if let Some(first) = choices.first() {
                    if let Some(message) = first.get("message") {
                        // Tool calls
                        if let Some(tcs) = message.get("tool_calls").and_then(|t| t.as_array()) {
                            if !tcs.is_empty() {
                                let calls: Vec<serde_json::Value> = tcs.iter().map(|tc| {
                                    let func = tc.get("function").unwrap_or(tc);
                                    serde_json::json!({
                                        "id": tc.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                                        "name": func.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                                        "arguments": func.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}"),
                                    })
                                }).collect();
                                return Ok(serde_json::Value::Array(calls));
                            }
                        }
                        // Text content
                        if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
                            // Structured output
                            if let Some(outputs) = agent.as_outputs() {
                                if !outputs.is_empty() {
                                    let parsed: serde_json::Value = serde_json::from_str(content)
                                        .unwrap_or(serde_json::Value::String(content.to_string()));
                                    return Ok(parsed);
                                }
                            }
                            return Ok(serde_json::Value::String(content.to_string()));
                        }
                    }
                }
            }
            Ok(response)
        }
    }

    fn make_simple_agent(provider: &str) -> Prompty {
        let data = serde_json::json!({
            "kind": "prompt",
            "name": "test-agent",
            "model": {
                "id": "gpt-4",
                "provider": provider
            },
            "instructions": "system:\nYou are helpful.\n\nuser:\nHello"
        });
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_without_tools_invokes_directly() {
        ensure_defaults();
        let key = "turn_test_no_tools";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)), // start at 1 → returns text response
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let result = turn(&agent, None, None).await.unwrap();
        // Without tools, turn() fast-paths to invoke() — should get text content
        assert_eq!(result, "The weather in Seattle is 72°F.");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_with_tools_single_iteration() {
        ensure_defaults();
        let key = "turn_test_single";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: call_count.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "get_weather".to_string(),
            ToolHandler::Sync(Box::new(|_args| Ok("72°F and sunny".to_string()))),
        );

        let opts = TurnOptions::with_tools(tools);
        let result = turn(&agent, None, Some(opts)).await.unwrap();

        // First call → tool_calls → dispatch → second call → text response
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
        assert_eq!(result, "The weather in Seattle is 72°F.");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_with_multiple_tools() {
        ensure_defaults();
        let key = "turn_test_multi";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            MultiToolExecutor {
                call_count: call_count.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "add".to_string(),
            ToolHandler::Sync(Box::new(|args| {
                let a = args.get("a").and_then(|v| v.as_i64()).unwrap_or(0);
                let b = args.get("b").and_then(|v| v.as_i64()).unwrap_or(0);
                Ok(format!("{}", a + b))
            })),
        );
        tools.insert(
            "multiply".to_string(),
            ToolHandler::Sync(Box::new(|args| {
                let a = args.get("a").and_then(|v| v.as_i64()).unwrap_or(0);
                let b = args.get("b").and_then(|v| v.as_i64()).unwrap_or(0);
                Ok(format!("{}", a * b))
            })),
        );

        let opts = TurnOptions::with_tools(tools);
        let result = turn(&agent, None, Some(opts)).await.unwrap();

        assert_eq!(call_count.load(Ordering::SeqCst), 2);
        assert_eq!(result, "3 and 12");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_max_iterations() {
        ensure_defaults();
        let key = "turn_test_max_iter";
        registry::register_executor(key, AlwaysToolCallExecutor);
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "ticker".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("tick".to_string()))),
        );

        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let opts = TurnOptions {
            max_iterations: 3,
            tools,
            on_event: Some(Box::new(move |event| {
                events_clone.lock().unwrap().push(format!("{:?}", event));
            })),
            ..Default::default()
        };

        // Should complete after max_iterations + 1 final call
        let _result = turn(&agent, None, Some(opts)).await;

        // Check that we got an error event about max iterations
        let captured = events.lock().unwrap();
        let has_max_iter_warning = captured.iter().any(|e| e.contains("max iterations"));
        assert!(
            has_max_iter_warning,
            "Should warn about max iterations: {:?}",
            captured
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_cancellation_before_start() {
        ensure_defaults();
        let key = "turn_test_cancel_before";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(0)),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(true)); // already cancelled
        let mut tools = HashMap::new();
        tools.insert(
            "test".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".to_string()))),
        );

        let opts = TurnOptions {
            tools,
            cancelled: Some(cancel),
            ..Default::default()
        };

        let err = turn(&agent, None, Some(opts)).await.unwrap_err();
        assert!(err.to_string().contains("cancelled"));
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_cancellation_mid_loop() {
        ensure_defaults();
        let key = "turn_test_cancel_mid";
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let cancel_clone = cancel.clone();

        // Use AlwaysToolCallExecutor — will loop until cancelled
        registry::register_executor(key, AlwaysToolCallExecutor);
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        let call_count = Arc::new(AtomicUsize::new(0));
        let count_clone = call_count.clone();
        let cancel_in_tool = cancel_clone.clone();

        tools.insert(
            "ticker".to_string(),
            ToolHandler::Sync(Box::new(move |_| {
                let n = count_clone.fetch_add(1, Ordering::SeqCst);
                if n >= 1 {
                    // Cancel after second tool dispatch
                    cancel_in_tool.store(true, Ordering::Relaxed);
                }
                Ok("tick".to_string())
            })),
        );

        let opts = TurnOptions {
            tools,
            cancelled: Some(cancel),
            max_iterations: 10,
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await;
        // Should be cancelled
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
        // Should have run at least 2 tool calls before cancelling
        assert!(call_count.load(Ordering::SeqCst) >= 2);
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_events_sequence() {
        ensure_defaults();
        let key = "turn_test_events";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: call_count.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let mut tools = HashMap::new();
        tools.insert(
            "get_weather".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("sunny".to_string()))),
        );

        let opts = TurnOptions {
            tools,
            on_event: Some(Box::new(move |event| {
                events_clone.lock().unwrap().push(format!("{:?}", event));
            })),
            ..Default::default()
        };

        let _result = turn(&agent, None, Some(opts)).await.unwrap();

        let captured = events.lock().unwrap();
        // Should see: ToolCallStart → ToolResult → Done
        assert!(
            captured.len() >= 3,
            "Expected at least 3 events, got {:?}",
            captured
        );
        assert!(captured[0].contains("ToolCallStart"));
        assert!(captured[1].contains("ToolResult"));
        assert!(captured.last().unwrap().contains("Done"));
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_tool_error_propagates() {
        ensure_defaults();
        let key = "turn_test_tool_err";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: call_count.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "get_weather".to_string(),
            ToolHandler::Sync(Box::new(|_| Err("API rate limited".into()))),
        );

        let opts = TurnOptions::with_tools(tools);
        // Tool errors are non-fatal (matching TypeScript) — error string sent to LLM,
        // and the model returns a normal response on the second call
        let result = turn(&agent, None, Some(opts)).await.unwrap();
        assert!(result.is_string());
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_missing_tool_handler_error() {
        ensure_defaults();
        let key = "turn_test_missing_tool";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: call_count.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        // Register tools map that does NOT include "get_weather"
        let mut tools = HashMap::new();
        tools.insert(
            "other_tool".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".to_string()))),
        );

        let opts = TurnOptions::with_tools(tools);
        // Missing tool is non-fatal (matching TypeScript) — error string sent to LLM
        let result = turn(&agent, None, Some(opts)).await.unwrap();
        assert!(result.is_string());
    }

    #[tokio::test]
    async fn test_dispatch_tool_invalid_json_arguments() {
        let mut tools = HashMap::new();
        tools.insert(
            "test".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".to_string()))),
        );

        let tc = ToolCall {
            id: "call_1".to_string(),
            name: "test".to_string(),
            arguments: "not valid json".to_string(),
        };

        let agent = Prompty::default();
        let result = crate::tool_dispatch::dispatch_tool(&tc, &tools, &agent, None).await;
        assert!(result.contains("Error"));
        assert!(result.contains("Invalid tool arguments"));
    }

    // -----------------------------------------------------------------------
    // run() and invoke() tests with registered executor/processor
    // -----------------------------------------------------------------------

    #[tokio::test]
    #[serial]
    async fn test_run_with_mock_executor() {
        ensure_defaults();
        let key = "run_test";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)), // skip to final response
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let messages = vec![Message::text(Role::User, "Hello")];
        let result = run(&agent, &messages).await.unwrap();
        assert_eq!(result, "The weather in Seattle is 72°F.");
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_with_mock_executor() {
        ensure_defaults();
        let key = "invoke_test";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)), // skip to final response
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let result = invoke(&agent, None).await.unwrap();
        assert_eq!(result, "The weather in Seattle is 72°F.");
    }
}
