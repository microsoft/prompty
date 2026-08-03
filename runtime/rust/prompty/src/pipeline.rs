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
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{Value, json};

use crate::engine::{DurabilityPort, PermissionPort, PostCommitPort, TurnEngineRequest};
use crate::interfaces::InvokerError;
use crate::model::Prompty;
use crate::parsers::parse_chat;
use crate::registry;
use crate::renderers::prepare_render_inputs;
use crate::structured::{create_structured_result, to_structured_value, unwrap_structured};
use crate::tracing::{Tracer, sanitize_value};
#[cfg(test)]
use crate::types::ToolCall;
use crate::types::{
    ContentPart, ContentPartKind, Message, PromptyStream, Role, consume_stream_chunks,
};

mod live_turn;

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
                "apiType": agent.model.api_type.as_ref().map(|t| t.as_str()).unwrap_or("chat"),
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

    for prop in props {
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
        let processed = process(agent, response).await?;
        Ok(unwrap_structured(&processed))
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
    /// The turn has started.
    TurnStart {
        agent: Option<String>,
        max_iterations: usize,
    },
    /// The turn has ended.
    TurnEnd {
        status: String,
        iterations: usize,
        response: serde_json::Value,
    },
    /// An LLM request is starting.
    LlmStart {
        provider: String,
        model_id: Option<String>,
        message_count: usize,
        iteration: usize,
    },
    /// An LLM request completed.
    LlmComplete { iteration: usize },
    /// A transient operation will be retried.
    Retry {
        operation: String,
        attempt: usize,
        max_attempts: usize,
        reason: String,
    },
    /// A streaming token from the LLM.
    Token(String),
    /// A thinking/reasoning token from the LLM.
    Thinking(String),
    /// A tool call is about to be dispatched.
    ToolCallStart { name: String, arguments: String },
    /// A tool call has completed with a result.
    ToolResult { name: String, result: String },
    /// A tool dispatch has completed with normalized success metadata.
    ToolCallComplete {
        name: String,
        success: bool,
        result: String,
        error_kind: Option<String>,
    },
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
// Compaction
// ---------------------------------------------------------------------------

/// Type alias for compaction functions.
///
/// Receives dropped messages and returns a summary string (or an error).
pub type CompactionFn = Arc<
    dyn Fn(
            &[Message],
        ) -> Pin<
            Box<
                dyn Future<Output = Result<String, Box<dyn std::error::Error + Send + Sync>>>
                    + Send,
            >,
        > + Send
        + Sync,
>;

/// Context compaction strategy for replacing low-signal summaries.
///
/// When messages are trimmed by `trim_to_context_window`, the default summary
/// is a simple concatenation of truncated message texts. With compaction, the
/// summary can be replaced by an LLM-powered (Prompty file) or function-based
/// higher-quality summary.
pub enum Compaction {
    /// Path to a `.prompty` file that summarizes dropped messages.
    Prompty(PathBuf),
    /// Custom async function that receives dropped messages and returns a summary.
    Function(CompactionFn),
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
    /// Compatibility flag retained for the public API.
    ///
    /// Setting this to `true` returns [`InvokerError::Validation`] and emits an
    /// error turn lifecycle. The canonical engine executes tool effects
    /// sequentially so durable result ordering is deterministic.
    pub parallel_tool_calls: bool,
    /// Optional validator for the final processed output.
    ///
    /// The canonical turn engine invokes this after output guardrail rewrites and
    /// structured-result unwrapping, immediately before its durable success commit.
    /// A rejection commits an `output_validation_failed` turn lifecycle and returns
    /// [`InvokerError::Validation`].
    #[allow(clippy::type_complexity)]
    pub validator: Option<Box<dyn Fn(&serde_json::Value) -> Result<(), String> + Send + Sync>>,
    /// Maximum model attempts for each LLM invocation with exponential backoff (§9.10, default: 3).
    ///
    /// This applies to simple public turns and tool-calling turns alike. Values below
    /// one are normalized to one attempt.
    pub max_llm_retries: usize,
    /// Context compaction strategy. When set and messages are trimmed, replaces
    /// the default `summarize_dropped()` summary with a higher-quality one.
    pub compaction: Option<Compaction>,
    /// Optional durable event/checkpoint sink for the canonical turn engine.
    ///
    /// When supplied, the sink is called before live events are projected to
    /// the callback. Hosts can resume with [`turn_with_engine_request`] and a
    /// request created from [`TurnEngineRequest::resume_from`].
    pub durability: Option<Arc<dyn DurabilityPort>>,
    /// Optional host authorization port for tool requests.
    ///
    /// When omitted, live turns retain their existing behavior: tool guardrails
    /// authorize requests when configured and all requests are otherwise allowed.
    /// When supplied, this port owns the authorization decision.
    pub permission: Option<Arc<dyn PermissionPort>>,
    /// Optional non-fatal effect invoked after a successful turn is committed.
    ///
    /// The hook receives the committed [`crate::engine::TurnCommit`] and the
    /// turn cancellation token. Hook failures are recorded by the canonical
    /// engine but never revoke an already committed successful turn.
    pub post_commit: Option<Arc<dyn PostCommitPort>>,
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
            max_llm_retries: 3,
            compaction: None,
            durability: None,
            permission: None,
            post_commit: None,
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

    #[cfg(test)]
    fn emit(&self, event: AgentEvent) {
        if let Some(ref cb) = self.on_event {
            // Per spec §13.1: event callbacks MUST NOT block the loop.
            // If a callback panics, log and continue.
            if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cb(event))) {
                eprintln!("[prompty] Event callback panicked: {e:?}");
            }
        }
    }

    #[cfg(test)]
    fn is_cancelled(&self) -> bool {
        self.cancelled
            .as_ref()
            .map(|c| c.load(std::sync::atomic::Ordering::Relaxed))
            .unwrap_or(false)
    }

    /// Create a builder starting from defaults.
    pub fn builder() -> TurnOptionsBuilder {
        TurnOptionsBuilder {
            opts: TurnOptions::default(),
        }
    }
}

/// Builder for [`TurnOptions`] with fluent API.
///
/// ```rust
/// use prompty::TurnOptions;
///
/// let opts = TurnOptions::builder()
///     .max_iterations(5)
///     .context_budget(50_000)
///     .build();
/// assert_eq!(opts.max_iterations, 5);
/// ```
pub struct TurnOptionsBuilder {
    opts: TurnOptions,
}

impl TurnOptionsBuilder {
    pub fn max_iterations(mut self, n: usize) -> Self {
        self.opts.max_iterations = n;
        self
    }

    pub fn raw(mut self, raw: bool) -> Self {
        self.opts.raw = raw;
        self
    }

    pub fn tools(mut self, tools: HashMap<String, ToolHandler>) -> Self {
        self.opts.tools = tools;
        self
    }

    pub fn tool(mut self, name: impl Into<String>, handler: ToolHandler) -> Self {
        self.opts.tools.insert(name.into(), handler);
        self
    }

    pub fn on_event(mut self, cb: EventCallback) -> Self {
        self.opts.on_event = Some(cb);
        self
    }

    pub fn cancelled(mut self, token: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Self {
        self.opts.cancelled = Some(token);
        self
    }

    pub fn context_budget(mut self, budget: usize) -> Self {
        self.opts.context_budget = Some(budget);
        self
    }

    pub fn guardrails(mut self, g: crate::guardrails::Guardrails) -> Self {
        self.opts.guardrails = Some(g);
        self
    }

    pub fn steering(mut self, s: crate::steering::Steering) -> Self {
        self.opts.steering = Some(s);
        self
    }

    pub fn parallel_tool_calls(mut self, parallel: bool) -> Self {
        self.opts.parallel_tool_calls = parallel;
        self
    }

    #[allow(clippy::type_complexity)]
    pub fn validator(
        mut self,
        v: Box<dyn Fn(&serde_json::Value) -> Result<(), String> + Send + Sync>,
    ) -> Self {
        self.opts.validator = Some(v);
        self
    }

    pub fn max_llm_retries(mut self, n: usize) -> Self {
        self.opts.max_llm_retries = n;
        self
    }

    pub fn compaction(mut self, c: Compaction) -> Self {
        self.opts.compaction = Some(c);
        self
    }

    /// Persist canonical engine events and checkpoints through the supplied sink.
    pub fn durability(mut self, durability: Arc<dyn DurabilityPort>) -> Self {
        self.opts.durability = Some(durability);
        self
    }

    /// Use a host-owned authorization port for tool requests.
    ///
    /// This replaces the default tool-guardrail/allow-all authorization path.
    pub fn permission(mut self, permission: Arc<dyn PermissionPort>) -> Self {
        self.opts.permission = Some(permission);
        self
    }

    /// Run a host-owned non-fatal hook after a successful turn commit.
    pub fn post_commit(mut self, post_commit: Arc<dyn PostCommitPort>) -> Self {
        self.opts.post_commit = Some(post_commit);
        self
    }

    /// Consume the builder and return the configured [`TurnOptions`].
    pub fn build(self) -> TurnOptions {
        self.opts
    }
}

// ---------------------------------------------------------------------------
// turn — conversational round-trip with optional tool calling
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Compaction helpers
// ---------------------------------------------------------------------------

/// Replace the synthetic summary message in `messages` with a compacted summary.
///
/// Scans for the first `User` message whose text starts with `[Context summary:`
/// and replaces it.
fn replace_summary_message(messages: &mut [Message], summary: &str) {
    for msg in messages.iter_mut() {
        if msg.role == Role::User && msg.text_content().starts_with("[Context summary:") {
            *msg = Message::with_text(Role::User, format!("[Context summary: {summary}]"));
            return;
        }
    }
}

/// Run the compaction strategy on dropped messages, replacing the default summary
/// in `messages` on success. On failure the existing summary is preserved.
pub async fn apply_compaction(
    compaction: &Compaction,
    dropped: &[Message],
    messages: &mut [Message],
    span: &crate::tracing::SpanEmitter,
) {
    span.emit("compaction_start", &json!({"dropped_count": dropped.len()}));

    let result = match compaction {
        Compaction::Prompty(path) => {
            let text = crate::context::format_dropped_messages(dropped);
            let mut inputs = serde_json::Map::new();
            inputs.insert("messages".into(), serde_json::Value::String(text));
            match crate::invoke_from_path(path, Some(&serde_json::Value::Object(inputs))).await {
                Ok(val) => Ok(val.as_str().unwrap_or("").to_string()),
                Err(e) => Err(format!("{e}")),
            }
        }
        Compaction::Function(f) => match f(dropped).await {
            Ok(s) => Ok(s),
            Err(e) => Err(format!("{e}")),
        },
    };

    match result {
        Ok(summary) if !summary.trim().is_empty() => {
            replace_summary_message(messages, &summary);
            span.emit(
                "compaction_complete",
                &json!({"summary_length": summary.len()}),
            );
        }
        Ok(_) => {
            span.emit("compaction_failed", &json!({"reason": "empty result"}));
        }
        Err(reason) => {
            span.emit("compaction_failed", &json!({"reason": reason}));
        }
    }
}

/// One conversational round-trip: prepare → [agent loop with tool calls] → process.
///
/// All live execution delegates to the canonical [`crate::engine::TurnEngine`].
///
/// Extensions (matching TypeScript):
/// - **Context trimming**: If `context_budget` is set, messages are trimmed before each LLM call
/// - **Guardrails**: Input/output/tool guardrails checked at appropriate points
/// - **Steering**: Messages injected between iterations
/// - **Ordered tools**: Tool effects are durably committed in request order
/// - **Cancellation**: Checked at each iteration boundary
pub async fn turn(
    agent: &Prompty,
    inputs: Option<&serde_json::Value>,
    options: Option<TurnOptions>,
) -> Result<serde_json::Value, InvokerError> {
    live_turn::turn(agent, inputs, options).await
}

/// Run a live turn using a caller-owned canonical engine request.
///
/// This is the durable/resumable counterpart to [`turn`]. Supply a request
/// created with [`TurnEngineRequest::new`] for a named turn or
/// [`TurnEngineRequest::resume_from`] after restoring a durable checkpoint.
/// Configure durable events, host tool authorization, and post-commit effects
/// through [`TurnOptions`]. Supplied ports are passed unchanged to the
/// canonical engine, preserving its durable event ordering and non-fatal
/// post-commit semantics.
pub async fn turn_with_engine_request(
    agent: &Prompty,
    request: TurnEngineRequest,
    options: Option<TurnOptions>,
) -> Result<serde_json::Value, InvokerError> {
    live_turn::turn_with_engine_request(agent, request, options).await
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
/// Extract ToolCalls from a processed response value.
///
/// Works with both OpenAI-style and Anthropic-style processed results:
/// both return `Value::Array([{id, name, arguments}])` for tool calls.
#[cfg(test)]
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
            if let ContentPartKind::TextPart {
                value: ref text_value,
            } = part.kind
            {
                for (nonce, name) in &nonce_to_name {
                    if text_value.contains(*nonce) {
                        let idx = text_value.find(*nonce).unwrap();
                        let before = text_value[..idx].trim();
                        let after = text_value[idx + nonce.len()..].trim();

                        if !before.is_empty() {
                            result.push(Message::with_text(msg.role, before));
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
                            result.push(Message::with_text(msg.role, after));
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
        parts: vec![ContentPart::text(content)],
        ..Default::default()
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
    use std::sync::Mutex;

    use crate::engine::{
        ContextPortability, DelegatedStateReference, EngineCheckpoint, EngineEvent, PortError,
    };
    use crate::model::context::LoadContext;
    use crate::model::{
        InvocationContextPortability, InvocationContextState, ModelInvocationRequest,
        ModelInvocationResponse, ModelToolRequest, Prompty,
    };
    use async_trait::async_trait;
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

    #[derive(Default)]
    struct RecordingDurability {
        events: Mutex<Vec<EngineEvent>>,
        checkpoints: Mutex<Vec<EngineCheckpoint>>,
    }

    #[async_trait]
    impl DurabilityPort for RecordingDurability {
        async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
            self.events.lock().unwrap().push(event.clone());
            Ok(())
        }

        async fn append_with_checkpoint(
            &self,
            events: &[EngineEvent],
            checkpoint: &EngineCheckpoint,
        ) -> Result<(), PortError> {
            self.events.lock().unwrap().extend_from_slice(events);
            self.checkpoints.lock().unwrap().push(checkpoint.clone());
            Ok(())
        }
    }

    struct FailOnceDurability {
        recording: RecordingDurability,
        failed: AtomicBool,
    }

    impl Default for FailOnceDurability {
        fn default() -> Self {
            Self {
                recording: RecordingDurability::default(),
                failed: AtomicBool::new(false),
            }
        }
    }

    #[async_trait]
    impl DurabilityPort for FailOnceDurability {
        async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
            self.recording.append(event).await
        }

        async fn append_with_checkpoint(
            &self,
            events: &[EngineEvent],
            checkpoint: &EngineCheckpoint,
        ) -> Result<(), PortError> {
            self.recording
                .append_with_checkpoint(events, checkpoint)
                .await?;
            if !self.failed.swap(true, Ordering::SeqCst) {
                return Err(PortError::new("injected durability failure"));
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct FailOnSecondCheckpointDurability {
        recording: RecordingDurability,
        checkpoint_count: AtomicUsize,
    }

    #[async_trait]
    impl DurabilityPort for FailOnSecondCheckpointDurability {
        async fn append(&self, event: &EngineEvent) -> Result<(), PortError> {
            self.recording.append(event).await
        }

        async fn append_with_checkpoint(
            &self,
            events: &[EngineEvent],
            checkpoint: &EngineCheckpoint,
        ) -> Result<(), PortError> {
            self.recording
                .append_with_checkpoint(events, checkpoint)
                .await?;
            if self.checkpoint_count.fetch_add(1, Ordering::SeqCst) == 1 {
                return Err(PortError::new("injected model response durability failure"));
            }
            Ok(())
        }
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
        let msgs = vec![Message::with_text(Role::System, "Hello")];
        let nonces = HashMap::new();
        let inputs = serde_json::json!({});
        let result = expand_threads(&msgs, &nonces, &inputs);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_expand_threads_with_conversation() {
        let nonce = "__PROMPTY_THREAD_abcd1234_conversation__";
        let msgs = vec![
            Message::with_text(Role::System, "You are helpful."),
            Message::with_text(Role::User, &format!("Before\n{nonce}\nAfter")),
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
        assert_eq!(opts.max_llm_retries, 3);
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
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

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

    struct ContextAwareExecutor {
        received_state_ids: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for ContextAwareExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            Err(InvokerError::Execute(
                "live turns must call execute_with_context".into(),
            ))
        }

        async fn execute_with_context(
            &self,
            _agent: &Prompty,
            request: &ModelInvocationRequest,
            _cancellation: &crate::engine::CancellationToken,
        ) -> Result<serde_json::Value, InvokerError> {
            self.received_state_ids.lock().unwrap().push(
                request
                    .context
                    .context_state
                    .delegated_state
                    .first()
                    .map(|state| state.id.clone())
                    .unwrap_or_default(),
            );
            Ok(json!({ "contextAware": true }))
        }
    }

    struct ContextAwareProcessor {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Processor for ContextAwareProcessor {
        async fn process(
            &self,
            _agent: &Prompty,
            _response: serde_json::Value,
        ) -> Result<serde_json::Value, InvokerError> {
            Err(InvokerError::Process(
                "live turns must call process_with_context".into(),
            ))
        }

        async fn process_with_context(
            &self,
            _agent: &Prompty,
            _response: serde_json::Value,
            _request: &ModelInvocationRequest,
        ) -> Result<ModelInvocationResponse, InvokerError> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            let next_context_state = Some(InvocationContextState {
                portability: InvocationContextPortability::Delegated,
                delegated_state: vec![crate::model::DelegatedStateReference {
                    provider: "context-test".to_string(),
                    kind: "continuation".to_string(),
                    id: if call == 0 {
                        "provider-state-1".to_string()
                    } else {
                        "provider-state-2".to_string()
                    },
                    metadata: Value::Null,
                }],
            });
            Ok(ModelInvocationResponse {
                output: (call != 0).then(|| json!("resumed")),
                usage: None,
                assistant_messages: Vec::new(),
                tool_requests: (call == 0)
                    .then(|| {
                        vec![ModelToolRequest {
                            id: "context-tool".to_string(),
                            name: "acknowledge".to_string(),
                            arguments: Some(json!({})),
                            metadata: Value::Null,
                        }]
                    })
                    .unwrap_or_default(),
                next_context_state,
                metadata: Value::Null,
            })
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

    fn capture_events() -> (Arc<std::sync::Mutex<Vec<AgentEvent>>>, EventCallback) {
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let on_event: EventCallback = Box::new(move |event| {
            events_clone.lock().unwrap().push(event);
        });
        (events, on_event)
    }

    fn assert_turn_lifecycle(events: &[AgentEvent], expected_status: &str) {
        let start_indices: Vec<_> = events
            .iter()
            .enumerate()
            .filter_map(|(index, event)| {
                matches!(event, AgentEvent::TurnStart { .. }).then_some(index)
            })
            .collect();
        let end_indices: Vec<_> = events
            .iter()
            .enumerate()
            .filter_map(|(index, event)| {
                matches!(event, AgentEvent::TurnEnd { .. }).then_some(index)
            })
            .collect();

        assert_eq!(
            start_indices.len(),
            1,
            "expected exactly one TurnStart, got {events:?}"
        );
        assert_eq!(
            end_indices.len(),
            1,
            "expected exactly one TurnEnd, got {events:?}"
        );
        assert!(
            start_indices[0] < end_indices[0],
            "TurnStart should precede TurnEnd, got {events:?}"
        );

        match &events[end_indices[0]] {
            AgentEvent::TurnEnd { status, .. } => assert_eq!(status, expected_status),
            other => panic!("expected TurnEnd, got {other:?}"),
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_without_tools_invokes_directly() {
        ensure_defaults();
        let engine_runs =
            super::live_turn::LIVE_ENGINE_RUNS.load(std::sync::atomic::Ordering::SeqCst);
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
        assert_eq!(result, "The weather in Seattle is 72°F.");
        assert!(
            super::live_turn::LIVE_ENGINE_RUNS.load(std::sync::atomic::Ordering::SeqCst)
                > engine_runs,
            "pipeline::turn must route through the canonical TurnEngine live bundle"
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_with_engine_request_persists_canonical_checkpoint() {
        ensure_defaults();
        let key = "turn_durable_request";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)),
            },
        );
        registry::register_processor(key, MockProcessor);
        let agent = make_simple_agent(key);
        let durability = Arc::new(RecordingDurability::default());
        let mut request = TurnEngineRequest::new("durable-session", "durable-turn", Vec::new());
        request.inputs = json!({});

        let result = turn_with_engine_request(
            &agent,
            request,
            Some(
                TurnOptions::builder()
                    .durability(durability.clone())
                    .build(),
            ),
        )
        .await
        .unwrap();

        assert_eq!(result, "The weather in Seattle is 72°F.");
        assert!(
            !durability.events.lock().unwrap().is_empty(),
            "live turns must write canonical events through the caller durability port"
        );
        let checkpoints = durability.checkpoints.lock().unwrap();
        assert!(
            checkpoints.len() >= 2,
            "the live request should persist both the model and terminal checkpoints"
        );
        assert!(checkpoints.iter().all(|checkpoint| {
            checkpoint.session_id == "durable-session" && checkpoint.turn_id == "durable-turn"
        }));
        assert!(
            checkpoints
                .iter()
                .any(|checkpoint| checkpoint.final_output_ready)
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_with_engine_request_resumes_after_durability_failure() {
        ensure_defaults();
        let key = "turn_durable_resume";
        let calls = Arc::new(AtomicUsize::new(1));
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: calls.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);
        let agent = make_simple_agent(key);
        let durability = Arc::new(FailOnceDurability::default());
        let mut request = TurnEngineRequest::new("resume-session", "resume-turn", Vec::new());
        request.inputs = json!({});

        let failure = turn_with_engine_request(
            &agent,
            request,
            Some(
                TurnOptions::builder()
                    .durability(durability.clone())
                    .build(),
            ),
        )
        .await
        .expect_err("injected persistence failure must stop the live turn");
        assert!(failure.to_string().contains("injected durability failure"));

        let checkpoint = durability
            .recording
            .checkpoints
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("the failing durability sink must retain the checkpoint");
        let resume =
            TurnEngineRequest::resume_from(&checkpoint, 10, checkpoint.last_sequence as u64);
        let result = turn_with_engine_request(
            &agent,
            resume,
            Some(TurnOptions::builder().durability(durability).build()),
        )
        .await
        .unwrap();

        assert_eq!(result, "The weather in Seattle is 72°F.");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "resume must commit the retained model response without another provider invocation"
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_context_aware_provider_state_reaches_checkpoint_and_resume() {
        ensure_defaults();
        let key = "turn_context_state_resume";
        let received_state_ids = Arc::new(Mutex::new(Vec::new()));
        let processor_calls = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            ContextAwareExecutor {
                received_state_ids: received_state_ids.clone(),
            },
        );
        registry::register_processor(
            key,
            ContextAwareProcessor {
                calls: processor_calls.clone(),
            },
        );
        let agent = make_simple_agent(key);
        let durability = Arc::new(FailOnSecondCheckpointDurability::default());
        let mut request = TurnEngineRequest::new("context-session", "context-turn", Vec::new());
        request.inputs = json!({});
        request.portability = ContextPortability::Delegated;
        request.delegated_state = vec![DelegatedStateReference {
            provider: "context-test".to_string(),
            kind: "continuation".to_string(),
            id: "incoming-state".to_string(),
            metadata: Value::Null,
        }];

        let mut first_tools = HashMap::new();
        first_tools.insert(
            "acknowledge".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("acknowledged".to_string()))),
        );
        let failure = turn_with_engine_request(
            &agent,
            request,
            Some(
                TurnOptions::builder()
                    .tools(first_tools)
                    .durability(durability.clone())
                    .build(),
            ),
        )
        .await
        .expect_err("the injected durability failure must leave a resumable checkpoint");
        assert!(
            failure
                .to_string()
                .contains("injected model response durability failure")
        );

        let checkpoint = durability
            .recording
            .checkpoints
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("model response checkpoint must be retained");
        assert_eq!(
            checkpoint.context_state.portability,
            ContextPortability::Delegated
        );
        assert_eq!(
            checkpoint.context_state.delegated_state[0].id, "provider-state-1",
            "checkpoint: {checkpoint:?}"
        );
        assert_eq!(
            received_state_ids.lock().unwrap().as_slice(),
            ["incoming-state"]
        );

        let resume =
            TurnEngineRequest::resume_from(&checkpoint, 10, checkpoint.last_sequence as u64);
        let mut resumed_tools = HashMap::new();
        resumed_tools.insert(
            "acknowledge".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("acknowledged".to_string()))),
        );
        let result = turn_with_engine_request(
            &agent,
            resume,
            Some(
                TurnOptions::builder()
                    .tools(resumed_tools)
                    .durability(durability)
                    .build(),
            ),
        )
        .await
        .unwrap();

        assert_eq!(result, "resumed");
        assert_eq!(
            received_state_ids.lock().unwrap().as_slice(),
            ["incoming-state", "provider-state-1"]
        );
        assert_eq!(processor_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_rejects_parallel_tool_calls_with_error_lifecycle() {
        ensure_defaults();
        let key = "turn_parallel_rejected";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)),
            },
        );
        registry::register_processor(key, MockProcessor);
        let agent = make_simple_agent(key);
        let (events, callback) = capture_events();

        let error = turn(
            &agent,
            None,
            Some(TurnOptions {
                parallel_tool_calls: true,
                on_event: Some(callback),
                ..Default::default()
            }),
        )
        .await
        .unwrap_err();

        assert!(matches!(error, InvokerError::Validation(_)));
        assert!(error.to_string().contains("parallel_tool_calls=true"));
        let events = events.lock().unwrap();
        assert!(matches!(events[0], AgentEvent::TurnStart { .. }));
        assert!(matches!(events[1], AgentEvent::Error(_)));
        assert!(matches!(
            events[2],
            AgentEvent::TurnEnd {
                ref status,
                iterations: 0,
                ..
            } if status == "error"
        ));
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
        // Should see lifecycle events plus ToolCallStart → ToolResult → Done.
        assert!(
            captured.len() >= 3,
            "Expected at least 3 events, got {:?}",
            captured
        );
        let tool_start_index = captured
            .iter()
            .position(|event| event.contains("ToolCallStart"))
            .expect("expected ToolCallStart event");
        let tool_result_index = captured
            .iter()
            .position(|event| event.contains("ToolResult"))
            .expect("expected ToolResult event");
        assert!(tool_start_index < tool_result_index);
        let done_index = captured
            .iter()
            .position(|event| event.contains("Done"))
            .expect("expected Done event");
        let turn_end_index = captured
            .iter()
            .position(|event| event.contains("TurnEnd"))
            .expect("expected TurnEnd event");
        assert!(done_index < turn_end_index);
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_lifecycle_success_simple_path() {
        ensure_defaults();
        let key = "turn_lifecycle_simple_success";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let (events, on_event) = capture_events();
        let opts = TurnOptions {
            on_event: Some(on_event),
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await.unwrap();
        assert_eq!(result, "The weather in Seattle is 72°F.");
        assert_turn_lifecycle(&events.lock().unwrap(), "success");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_lifecycle_success_tool_loop() {
        ensure_defaults();
        let key = "turn_lifecycle_tool_success";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(0)),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "get_weather".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("72°F and sunny".to_string()))),
        );
        let (events, on_event) = capture_events();
        let opts = TurnOptions {
            tools,
            on_event: Some(on_event),
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await.unwrap();
        assert_eq!(result, "The weather in Seattle is 72°F.");
        assert_turn_lifecycle(&events.lock().unwrap(), "success");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_lifecycle_input_guardrail_error() {
        ensure_defaults();
        let key = "turn_lifecycle_guardrail_error";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let (events, on_event) = capture_events();
        let guardrails = crate::guardrails::Guardrails {
            input: Some(Box::new(|_, _| {
                Box::pin(async { crate::guardrails::GuardrailResult::deny("blocked") })
            })),
            ..Default::default()
        };
        let opts = TurnOptions {
            on_event: Some(on_event),
            guardrails: Some(guardrails),
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await;
        assert!(result.is_err());
        assert_turn_lifecycle(&events.lock().unwrap(), "error");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_lifecycle_retry_exhausted_error() {
        ensure_defaults();
        let key = "turn_lifecycle_retry_error";
        registry::register_executor(key, AlwaysFailExecutor);
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "dummy".to_string(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".to_string()))),
        );
        let (events, on_event) = capture_events();
        let opts = TurnOptions {
            tools,
            on_event: Some(on_event),
            max_llm_retries: 1,
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await;
        assert!(result.is_err());
        assert_turn_lifecycle(&events.lock().unwrap(), "error");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_lifecycle_cancelled_simple_path() {
        ensure_defaults();
        let key = "turn_lifecycle_simple_cancelled";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let (events, on_event) = capture_events();
        let opts = TurnOptions {
            on_event: Some(on_event),
            cancelled: Some(Arc::new(AtomicBool::new(true))),
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await;
        assert!(result.is_err());
        assert_turn_lifecycle(&events.lock().unwrap(), "cancelled");
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_lifecycle_cancelled_during_tool_dispatch() {
        ensure_defaults();
        let key = "turn_lifecycle_tool_cancelled";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(0)),
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_in_tool = cancel.clone();
        let mut tools = HashMap::new();
        tools.insert(
            "get_weather".to_string(),
            ToolHandler::Sync(Box::new(move |_| {
                cancel_in_tool.store(true, Ordering::Relaxed);
                Ok("72°F and sunny".to_string())
            })),
        );
        let (events, on_event) = capture_events();
        let opts = TurnOptions {
            tools,
            on_event: Some(on_event),
            cancelled: Some(cancel),
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await;
        assert!(result.is_err());
        assert_turn_lifecycle(&events.lock().unwrap(), "cancelled");
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
        let messages = vec![Message::with_text(Role::User, "Hello")];
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

    // -----------------------------------------------------------------------
    // LLM retry tests (§9.10)
    // -----------------------------------------------------------------------

    /// Mock executor that fails the first N calls, then succeeds.
    struct FailThenSucceedExecutor {
        call_count: Arc<AtomicUsize>,
        fail_until: usize,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for FailThenSucceedExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            let n = self.call_count.fetch_add(1, Ordering::SeqCst);
            if n < self.fail_until {
                Err(InvokerError::Execute("transient failure".into()))
            } else {
                Ok(serde_json::json!({
                    "choices": [{"message": {"content": "success after retry"}}]
                }))
            }
        }
    }

    /// Mock executor that always fails.
    struct AlwaysFailExecutor;

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for AlwaysFailExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<serde_json::Value, InvokerError> {
            Err(InvokerError::Execute("persistent failure".into()))
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_llm_retry_success_on_second_attempt() {
        ensure_defaults();
        let key = "retry_test_success";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            FailThenSucceedExecutor {
                call_count: call_count.clone(),
                fail_until: 1,
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "dummy".into(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".into()))),
        );

        let opts = TurnOptions {
            tools,
            max_llm_retries: 3,
            ..Default::default()
        };

        let result = turn(&agent, None, Some(opts)).await.unwrap();
        assert_eq!(
            call_count.load(Ordering::SeqCst),
            2,
            "Should have failed once and succeeded once"
        );
        assert_eq!(result, "success after retry");
    }

    #[tokio::test]
    #[serial]
    async fn test_llm_retry_exhausted_carries_messages() {
        ensure_defaults();
        let key = "retry_test_exhaust";
        registry::register_executor(key, AlwaysFailExecutor);
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let mut tools = HashMap::new();
        tools.insert(
            "dummy".into(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".into()))),
        );

        let opts = TurnOptions {
            tools,
            max_llm_retries: 2,
            ..Default::default()
        };

        let err = turn(&agent, None, Some(opts)).await.unwrap_err();
        let err_str = format!("{}", err);
        assert!(
            err_str.contains("retries") || err_str.contains("failed"),
            "Error should mention retry exhaustion: {}",
            err_str
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_llm_retry_emits_status_events() {
        ensure_defaults();
        let key = "retry_test_events";
        let call_count = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            FailThenSucceedExecutor {
                call_count: call_count.clone(),
                fail_until: 1,
            },
        );
        registry::register_processor(key, MockProcessor);

        let agent = make_simple_agent(key);
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let mut tools = HashMap::new();
        tools.insert(
            "dummy".into(),
            ToolHandler::Sync(Box::new(|_| Ok("ok".into()))),
        );

        let opts = TurnOptions {
            tools,
            max_llm_retries: 3,
            on_event: Some(Box::new(move |event| {
                events_clone.lock().unwrap().push(format!("{:?}", event));
            })),
            ..Default::default()
        };

        let _ = turn(&agent, None, Some(opts)).await.unwrap();
        let captured = events.lock().unwrap();
        assert!(
            captured
                .iter()
                .any(|e| e.contains("Status") && e.contains("retrying")),
            "Expected retry status event, got: {:?}",
            *captured
        );
    }

    // -----------------------------------------------------------------------
    // TurnOptionsBuilder tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_builder_defaults() {
        let opts = TurnOptions::builder().build();
        assert_eq!(opts.max_iterations, 10);
        assert_eq!(opts.max_llm_retries, 3);
        assert!(!opts.raw);
        assert!(!opts.parallel_tool_calls);
        assert!(opts.context_budget.is_none());
        assert!(opts.compaction.is_none());
        assert!(opts.on_event.is_none());
        assert!(opts.cancelled.is_none());
        assert!(opts.guardrails.is_none());
        assert!(opts.steering.is_none());
        assert!(opts.validator.is_none());
        assert!(opts.tools.is_empty());
    }

    #[test]
    fn test_builder_chaining() {
        let opts = TurnOptions::builder()
            .max_iterations(5)
            .context_budget(50_000)
            .max_llm_retries(5)
            .parallel_tool_calls(true)
            .raw(true)
            .build();
        assert_eq!(opts.max_iterations, 5);
        assert_eq!(opts.context_budget, Some(50_000));
        assert_eq!(opts.max_llm_retries, 5);
        assert!(opts.parallel_tool_calls);
        assert!(opts.raw);
    }

    #[test]
    fn test_builder_tool_method() {
        let handler = ToolHandler::Sync(Box::new(|_args| Ok("result".to_string())));
        let opts = TurnOptions::builder().tool("my_tool", handler).build();
        assert!(opts.tools.contains_key("my_tool"));
        assert_eq!(opts.tools.len(), 1);
    }

    #[test]
    fn test_builder_multiple_tools() {
        let h1 = ToolHandler::Sync(Box::new(|_| Ok("a".to_string())));
        let h2 = ToolHandler::Sync(Box::new(|_| Ok("b".to_string())));
        let opts = TurnOptions::builder()
            .tool("tool_a", h1)
            .tool("tool_b", h2)
            .build();
        assert_eq!(opts.tools.len(), 2);
        assert!(opts.tools.contains_key("tool_a"));
        assert!(opts.tools.contains_key("tool_b"));
    }

    #[test]
    fn test_builder_compaction() {
        let opts = TurnOptions::builder()
            .compaction(Compaction::Prompty("summarize.prompty".into()))
            .build();
        assert!(opts.compaction.is_some());
    }

    #[test]
    fn test_builder_cancelled_token() {
        let token = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let opts = TurnOptions::builder().cancelled(token.clone()).build();
        assert!(!opts.is_cancelled());
        token.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(opts.is_cancelled());
    }

    struct StreamingExecutor;

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for StreamingExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<Value, InvokerError> {
            Err(InvokerError::Execute("unexpected fallback".into()))
        }

        async fn execute_stream(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError>
        {
            Ok(Box::pin(futures::stream::iter(vec![
                json!({"kind": "thinking", "value": "plan"}),
                json!({"kind": "text", "value": "hello "}),
                json!({"kind": "text", "value": "world"}),
            ])))
        }
    }

    struct StreamingProcessor;

    #[async_trait::async_trait]
    impl crate::interfaces::Processor for StreamingProcessor {
        async fn process(&self, _agent: &Prompty, response: Value) -> Result<Value, InvokerError> {
            Ok(response)
        }

        fn process_stream(
            &self,
            inner: std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>,
        ) -> Result<
            std::pin::Pin<Box<dyn futures::Stream<Item = crate::types::StreamChunk> + Send>>,
            InvokerError,
        > {
            use futures::StreamExt;
            Ok(Box::pin(inner.map(|value| {
                if value["kind"] == "thinking" {
                    crate::types::StreamChunk::Thinking(
                        value["value"].as_str().unwrap().to_string(),
                    )
                } else {
                    crate::types::StreamChunk::Text(value["value"].as_str().unwrap().to_string())
                }
            })))
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_streaming_projects_side_channel_events_before_done() {
        ensure_defaults();
        let key = "turn_live_streaming";
        registry::register_executor(key, StreamingExecutor);
        registry::register_processor(key, StreamingProcessor);
        let agent = Prompty::load_from_value(
            &json!({
                "name": "streaming",
                "kind": "prompt",
                "model": {
                    "id": "stream-model",
                    "provider": key,
                    "options": {"additionalProperties": {"stream": true}}
                },
                "instructions": "user:\nhello"
            }),
            &LoadContext::default(),
        );
        let captured = Arc::new(Mutex::new(Vec::new()));
        let events = captured.clone();

        let result = turn(
            &agent,
            None,
            Some(TurnOptions {
                on_event: Some(Box::new(move |event| events.lock().unwrap().push(event))),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

        assert_eq!(result, "hello world");
        let events = captured.lock().unwrap();
        let thinking = events
            .iter()
            .position(|event| matches!(event, AgentEvent::Thinking(value) if value == "plan"))
            .unwrap();
        let first_token = events
            .iter()
            .position(|event| matches!(event, AgentEvent::Token(value) if value == "hello "))
            .unwrap();
        let done = events
            .iter()
            .position(|event| matches!(event, AgentEvent::Done { .. }))
            .unwrap();
        let turn_end = events
            .iter()
            .position(|event| matches!(event, AgentEvent::TurnEnd { .. }))
            .unwrap();
        assert!(thinking < done);
        assert!(first_token < done);
        assert!(done < turn_end);
    }

    struct CapturingExecutor {
        messages: Arc<Mutex<Vec<Vec<Message>>>>,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for CapturingExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            messages: &[Message],
        ) -> Result<Value, InvokerError> {
            self.messages.lock().unwrap().push(messages.to_vec());
            Ok(json!({
                "choices": [{
                    "message": {"content": "captured"}
                }]
            }))
        }
    }

    struct CustomFormattingExecutor {
        calls: AtomicUsize,
        messages: Arc<Mutex<Vec<Vec<Message>>>>,
        format_calls: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for CustomFormattingExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            messages: &[Message],
        ) -> Result<Value, InvokerError> {
            self.messages.lock().unwrap().push(messages.to_vec());
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                Ok(json!({
                    "choices": [{
                        "message": {
                            "tool_calls": [{
                                "id": "custom-call",
                                "type": "function",
                                "function": {"name": "custom", "arguments": "{}"}
                            }]
                        }
                    }]
                }))
            } else {
                Ok(json!({
                    "choices": [{
                        "message": {"content": "formatted"}
                    }]
                }))
            }
        }

        fn format_tool_messages(
            &self,
            _raw_response: &Value,
            _tool_calls: &[ToolCall],
            tool_results: &[String],
            _text_content: Option<&str>,
        ) -> Vec<Message> {
            self.format_calls.fetch_add(1, Ordering::SeqCst);
            vec![Message::with_text(
                Role::User,
                format!("custom-format:{}", tool_results.join(",")),
            )]
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_uses_registered_executor_conversation_formatting() {
        ensure_defaults();
        let key = "turn_live_custom_formatter";
        let messages = Arc::new(Mutex::new(Vec::new()));
        let format_calls = Arc::new(AtomicUsize::new(0));
        registry::register_executor(
            key,
            CustomFormattingExecutor {
                calls: AtomicUsize::new(0),
                messages: messages.clone(),
                format_calls: format_calls.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);
        let agent = make_simple_agent(key);

        let result = turn(
            &agent,
            None,
            Some(TurnOptions {
                raw: true,
                tools: HashMap::from([(
                    "custom".to_string(),
                    ToolHandler::Sync(Box::new(|_| Ok("tool-output".to_string()))),
                )]),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

        assert_eq!(result, "formatted");
        assert_eq!(format_calls.load(Ordering::SeqCst), 1);
        assert!(
            messages.lock().unwrap()[1]
                .iter()
                .any(|message| message.text_content() == "custom-format:tool-output")
        );
    }

    struct RawExecutor;

    #[async_trait::async_trait]
    impl crate::interfaces::Executor for RawExecutor {
        async fn execute(
            &self,
            _agent: &Prompty,
            _messages: &[Message],
        ) -> Result<Value, InvokerError> {
            Ok(json!({"raw": true}))
        }
    }

    struct FailingProcessor;

    #[async_trait::async_trait]
    impl crate::interfaces::Processor for FailingProcessor {
        async fn process(&self, _agent: &Prompty, _response: Value) -> Result<Value, InvokerError> {
            Err(InvokerError::Process(
                "raw responses must bypass processing".into(),
            ))
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_raw_simple_response_bypasses_processor() {
        ensure_defaults();
        let key = "turn_live_raw";
        registry::register_executor(key, RawExecutor);
        registry::register_processor(key, FailingProcessor);
        let agent = make_simple_agent(key);

        let result = turn(
            &agent,
            None,
            Some(TurnOptions {
                raw: true,
                guardrails: Some(crate::guardrails::Guardrails {
                    output: Some(Box::new(|_, _| {
                        Box::pin(async {
                            crate::guardrails::GuardrailResult::deny(
                                "raw response must bypass output guardrails",
                            )
                        })
                    })),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

        assert_eq!(result, json!({"raw": true}));
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_policy_rewrites_persist_into_model_and_done_messages() {
        ensure_defaults();
        let key = "turn_live_policy_persistence";
        let model_messages = Arc::new(Mutex::new(Vec::new()));
        registry::register_executor(
            key,
            CapturingExecutor {
                messages: model_messages.clone(),
            },
        );
        registry::register_processor(key, MockProcessor);
        let agent = Prompty::load_from_value(
            &json!({
                "name": "policy",
                "kind": "prompt",
                "model": {"id": "capture", "provider": key},
                "instructions": format!(
                    "system:\nKeep system\n\nuser:\n{}\n\nassistant:\n{}\n\nuser:\nlatest",
                    "a".repeat(300),
                    "b".repeat(300)
                )
            }),
            &LoadContext::default(),
        );
        let steering = crate::steering::Steering::new();
        steering.send("persist this steering");
        let captured = Arc::new(Mutex::new(Vec::new()));
        let events = captured.clone();

        turn(
            &agent,
            None,
            Some(TurnOptions {
                context_budget: Some(250),
                steering: Some(steering),
                on_event: Some(Box::new(move |event| events.lock().unwrap().push(event))),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

        let sent = model_messages.lock().unwrap()[0].clone();
        assert!(
            sent.iter()
                .any(|message| message.text_content().starts_with("[Context summary:"))
        );
        assert!(
            sent.iter()
                .any(|message| message.text_content() == "persist this steering")
        );
        let done_messages = captured
            .lock()
            .unwrap()
            .iter()
            .find_map(|event| match event {
                AgentEvent::Done { messages, .. } => Some(messages.clone()),
                _ => None,
            })
            .unwrap();
        assert_eq!(&done_messages[..sent.len()], sent.as_slice());
        assert_eq!(
            done_messages.last().map(Message::text_content).as_deref(),
            Some("captured")
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_turn_output_guardrail_rewrite_is_committed() {
        ensure_defaults();
        let key = "turn_live_output_rewrite";
        registry::register_executor(
            key,
            ToolCallThenDoneExecutor {
                call_count: Arc::new(AtomicUsize::new(1)),
            },
        );
        registry::register_processor(key, MockProcessor);
        let agent = make_simple_agent(key);
        let guardrails = crate::guardrails::Guardrails {
            output: Some(Box::new(|_, _| {
                Box::pin(async {
                    crate::guardrails::GuardrailResult::rewrite(json!("safe rewrite"))
                })
            })),
            ..Default::default()
        };

        let result = turn(
            &agent,
            None,
            Some(TurnOptions {
                guardrails: Some(guardrails),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

        assert_eq!(result, "safe rewrite");
    }
}
