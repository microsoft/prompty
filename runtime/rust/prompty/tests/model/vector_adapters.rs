use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Mutex;

use prompty::model::ModelInfo;
use prompty::model::context::{LoadContext, SaveContext};
use prompty::model::Agent;
use prompty::pipeline::expand_threads;
use prompty::parsers::parse_chat;
use prompty::{load, validate_inputs, Message};
use regex::Regex;
use serde_json::Value;

/// Serializes env-var mutation across parallel `#[tokio::test]` load vectors.
/// The load contract resolves `${env:...}` against the process environment, so
/// each env-dependent vector must set/restore vars without interleaving.
static ENV_LOCK: Mutex<()> = Mutex::new(());

pub struct Context {
    pub contract: String,
    pub operation: String,
    pub vector: Value,
    pub provider: Option<String>,
    pub target_api: Option<String>,
    pub doubles: HashMap<String, Value>,
    pub base_dir: String,
}

/// A synchronous adapter body: resolves without touching the runtime.
pub type SyncInvoke = fn(&Value, &Context) -> Result<Value, VectorError>;

/// An asynchronous adapter body: a boxed, type-erased `'static` future the
/// harness awaits exactly once on its current-thread tokio runtime.
pub type AsyncInvoke =
    Box<dyn Fn(&Value, &Context) -> Pin<Box<dyn Future<Output = Result<Value, VectorError>>>>>;

/// Typra 0.13 classifies each `@vector` as sync-only or async-capable and drives
/// the adapter through this enum. `@sync` operations must register `Invoke::Sync`.
pub enum Invoke {
    Sync(SyncInvoke),
    Async(AsyncInvoke),
}

pub struct Adapter {
    pub invoke: Invoke,
    pub normalize: Option<fn(&Value, &Context) -> Value>,
}

impl Adapter {
    /// Register a synchronous adapter — a bare `fn`, no boxing, no bridge.
    pub fn sync(invoke: SyncInvoke) -> Self {
        Self {
            invoke: Invoke::Sync(invoke),
            normalize: None,
        }
    }

    /// Register an asynchronous adapter. The constructor is generic over the
    /// returned future and boxes it internally, so the call site is a bare
    /// `async move { .. }` — no `Box::pin`, no `std::future::ready`. `Fut:
    /// 'static` forces the body to own its inputs (clone the `&Value`, build an
    /// owned `Agent`) so the future never borrows the adapter arguments across
    /// an await; borrowing them is a compile error, which is the intended guard.
    #[allow(dead_code)]
    pub fn asynchronous<F, Fut>(invoke: F) -> Self
    where
        F: Fn(&Value, &Context) -> Fut + 'static,
        Fut: Future<Output = Result<Value, VectorError>> + 'static,
    {
        Self {
            invoke: Invoke::Async(Box::new(move |input, ctx| Box::pin(invoke(input, ctx)))),
            normalize: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct VectorError {
    pub message: String,
    pub payload: Option<Value>,
}

impl VectorError {
    #[allow(dead_code)]
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            payload: None,
        }
    }
}

pub fn adapters() -> HashMap<String, Adapter> {
    HashMap::from([
        (
            "DiscoveryConformance.enrich".to_string(),
            Adapter::sync(enrich_adapter),
        ),
        (
            "DiscoveryConformance.mapModel".to_string(),
            Adapter::sync(map_model_adapter),
        ),
        (
            "LoadConformance.load".to_string(),
            Adapter {
                invoke: Invoke::Sync(load_adapter),
                normalize: Some(load_normalize),
            },
        ),
        (
            "Renderer.render".to_string(),
            Adapter {
                invoke: Invoke::Async(Box::new(|input, ctx| {
                    let input = input.clone();
                    let expected = ctx.vector.get("expected").cloned().unwrap_or(Value::Null);
                    Box::pin(render_impl(input, expected))
                })),
                normalize: None,
            },
        ),
        (
            "Parser.parse".to_string(),
            Adapter {
                invoke: Invoke::Sync(parse_adapter),
                normalize: None,
            },
        ),
    ])
}

pub fn waivers() -> HashMap<String, String> {
    HashMap::from([
        (
            "WireConformance.toRequest".to_string(),
            "No concrete provider request-builder exists in the Rust runtime yet. The generated `WireConformance` trait (src/model/wire_conformance.rs) and the Anthropic wire structs (src/model/wire/) are present, but there is no OpenAI/Anthropic executor that maps a canonical agent + messages into a provider request body (no `_build_chat_args`/`_message_to_wire` equivalent). Wiring this would require reimplementing that provider logic inside the adapter, which is disallowed. Honest gap: the Rust runtime does not implement the provider wire layer.".to_string(),
        ),
        (
            "Processor.process".to_string(),
            "No concrete provider response-processor exists in the Rust runtime yet. The `Processor` trait and pipeline `process()` dispatch are present, but `register_defaults()` registers only renderers, the parser, and tool handlers — no OpenAI/Anthropic processor is registered to extract content/tool_calls/usage from a raw provider response. Honest gap: the Rust runtime does not implement the provider response-processing layer.".to_string(),
        ),
        (
            "TurnConformance.replay".to_string(),
            "Depends on the provider wire + process layer (unimplemented in the Rust runtime), so the replay journal cannot be reproduced. Honest gap, consistent with WireConformance.toRequest and Processor.process.".to_string(),
        ),
        (
            "TurnConformance.run".to_string(),
            "The run vectors assert an agent-loop accounting/observability contract (iteration counting = LLM-call count, total_messages including the final assistant message, exact event schemas) not yet matched by the runtime. Same honest gap as the Python reference.".to_string(),
        ),
        (
            "TurnConformance.runTurn".to_string(),
            "Requires the not-yet-implemented snapshot/portability turn engine. Same gap as the Python reference.".to_string(),
        ),
    ])
}

pub fn doubles() -> HashMap<String, Value> {
    HashMap::new()
}

fn enrich_adapter(input: &Value, ctx: &Context) -> Result<Value, VectorError> {
    let provider = ctx.provider.as_deref().unwrap_or("");
    let base = ModelInfo::try_load_from_value(input, &LoadContext::default())
        .map_err(|err| VectorError::new(err.to_string()))?;
    Ok(prompty::discovery::enrich(base, provider).to_value(&SaveContext::default()))
}

fn map_model_adapter(input: &Value, ctx: &Context) -> Result<Value, VectorError> {
    let provider = ctx.provider.as_deref().unwrap_or("");
    Ok(prompty::discovery::map_model(input, provider).to_value(&SaveContext::default()))
}

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

/// Project `observed` onto the shape of `expected` (subset semantics): only keys
/// present in `expected` are retained, and a key missing from `observed` is
/// coerced to `null` so `expected: { model: null }` matches an omitted field.
/// Wrong values still fail; list-length mismatches are surfaced, not truncated.
fn project(observed: &Value, expected: &Value) -> Value {
    match (observed, expected) {
        (Value::Object(obs), Value::Object(exp)) => {
            let mut out = serde_json::Map::new();
            for (k, ev) in exp {
                let ov = obs.get(k).unwrap_or(&Value::Null);
                out.insert(k.clone(), project(ov, ev));
            }
            Value::Object(out)
        }
        (Value::Array(obs), Value::Array(exp)) => {
            if obs.len() != exp.len() {
                return observed.clone();
            }
            Value::Array(
                obs.iter()
                    .zip(exp.iter())
                    .map(|(o, e)| project(o, e))
                    .collect(),
            )
        }
        _ => observed.clone(),
    }
}

fn project_normalize(observed: &Value, ctx: &Context) -> Value {
    let expected = ctx.vector.get("expected").cloned().unwrap_or(Value::Null);
    project(observed, &expected)
}

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------

/// Locate `spec/fixtures` by walking up from the conformance base dir.
fn spec_fixtures(ctx: &Context) -> PathBuf {
    let mut dir = PathBuf::from(&ctx.base_dir);
    loop {
        let candidate = dir.join("spec").join("fixtures");
        if candidate.is_dir() {
            return candidate;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => return PathBuf::from("spec/fixtures"),
        }
    }
}

/// Bridge `Agent::to_value` (array collection format, no shorthand) to the
/// canonical cross-runtime load shape: inject the implicit `kind: "prompt"` and
/// strip the trailing newline the loader preserves on `instructions`.
fn agent_to_canonical(agent: &Agent) -> Value {
    let ctx = SaveContext {
        collection_format: "array".to_string(),
        use_shorthand: false,
        ..SaveContext::default()
    };
    let mut value = agent.to_value(&ctx);
    if let Value::Object(ref mut map) = value {
        map.insert("kind".to_string(), Value::String("prompt".to_string()));
        if let Some(Value::String(instr)) = map.get("instructions") {
            let trimmed = instr.trim_end_matches('\n').to_string();
            map.insert("instructions".to_string(), Value::String(trimmed));
        }
        // Under `array` collection format, tool `bindings` serialize as an
        // ordered `[{name, ...}]` list, but the canonical cross-runtime shape
        // keeps them as a name-keyed object. De-arrayify each tool's bindings.
        if let Some(Value::Array(tools)) = map.get_mut("tools") {
            for tool in tools.iter_mut() {
                if let Value::Object(tmap) = tool {
                    if let Some(Value::Array(bindings)) = tmap.get("bindings") {
                        let mut obj = serde_json::Map::new();
                        for b in bindings {
                            if let Value::Object(bm) = b {
                                if let Some(Value::String(n)) = bm.get("name") {
                                    let mut rest = bm.clone();
                                    rest.remove("name");
                                    obj.insert(n.clone(), Value::Object(rest));
                                }
                            }
                        }
                        tmap.insert("bindings".to_string(), Value::Object(obj));
                    }
                }
            }
        }
    }
    value
}

/// Canonicalize `float32`-declared numeric fields (`temperature`, `topP`,
/// sampling penalties). The generated `to_value` widens `f32` to `f64` via
/// `val as f64`, so `0.7f32` serializes as `0.6999999880…`. Re-round every
/// non-integer number through the `f32` shortest-decimal representation so the
/// observed value reflects its declared `float32` precision. Real value
/// differences (e.g. `0.8` vs `0.7`) still fail; only representation noise is
/// collapsed. (An upstream Typra emitter fix — serializing `float32` via the
/// `f32` shortest repr rather than `as f64` — would remove the need for this.)
fn canon_floats(v: &Value) -> Value {
    match v {
        Value::Number(n) => {
            if n.as_i64().is_none() && n.as_u64().is_none() {
                if let Some(f) = n.as_f64() {
                    if let Ok(parsed) = format!("{}", f as f32).parse::<f64>() {
                        if let Some(num) = serde_json::Number::from_f64(parsed) {
                            return Value::Number(num);
                        }
                    }
                }
            }
            v.clone()
        }
        Value::Array(a) => Value::Array(a.iter().map(canon_floats).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, val)| (k.clone(), canon_floats(val))).collect())
        }
        _ => v.clone(),
    }
}

fn load_normalize(observed: &Value, ctx: &Context) -> Value {
    let expected = ctx.vector.get("expected").cloned().unwrap_or(Value::Null);
    project(&canon_floats(observed), &expected)
}

/// Serialize an inline `frontmatter` dict into `.prompty` source text. An
/// `instructions` key (if present) becomes the markdown body.
fn frontmatter_to_prompty(frontmatter: &Value) -> String {
    let mut fm = frontmatter.clone();
    let body = if let Value::Object(ref mut map) = fm {
        match map.remove("instructions") {
            Some(Value::String(s)) => s,
            _ => String::new(),
        }
    } else {
        String::new()
    };
    let yaml = serde_yaml::to_string(&fm).unwrap_or_default();
    format!("---\n{yaml}---\n{body}")
}

/// Create a unique temp directory for a load vector's on-disk `.prompty` tree.
fn make_temp_dir() -> PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("prompty_vec_{}_{}_{}", std::process::id(), nanos, n));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Write the vector's `files` map (sibling reference files) into `root`.
fn write_files(root: &std::path::Path, files: &Value) {
    if let Value::Object(map) = files {
        for (rel, content) in map {
            let target = root.join(rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let text = match content {
                Value::String(s) => s.clone(),
                other => serde_json::to_string(other).unwrap_or_default(),
            };
            std::fs::write(&target, text).ok();
        }
    }
}

/// Map a load/validation error to the canonical `{ error, error_field? }` shape,
/// matching the fuzzy error semantics of the Python reference adapter.
fn err_map(msg: &str, expected: &Value) -> Value {
    let low = msg.to_lowercase();
    let exp_err = expected.get("error").and_then(|v| v.as_str());
    let field = expected.get("error_field");
    let mut matched = false;
    if let Some(exp) = exp_err {
        let el = exp.to_lowercase();
        if exp == msg || msg.contains(exp) {
            matched = true;
        } else if exp == "invalid frontmatter" && (low.contains("yaml") || low.contains("mapping") || low.contains("frontmatter") || low.contains("flow")) {
            matched = true;
        } else if exp == "FileNotFoundError" && (low.contains("not found") || low.contains("no such file") || low.contains("cannot find") || low.contains("os error 2") || low.contains("filenotfound")) {
            matched = true;
        } else if exp == "Invalid template format" && low.contains("template") {
            matched = true;
        } else if exp == "Missing required input" && low.contains("required") {
            matched = true;
        } else if el.contains("outside allowed roots") && low.contains("outside allowed roots") {
            matched = true;
        }
    }
    if !matched {
        return serde_json::json!({ "error": msg });
    }
    let mut out = serde_json::Map::new();
    out.insert("error".to_string(), Value::String(exp_err.unwrap_or(msg).to_string()));
    if let Some(f) = field {
        if let Some(fs) = f.as_str() {
            if msg.contains(fs) {
                out.insert("error_field".to_string(), f.clone());
            }
        }
    }
    Value::Object(out)
}

/// Build an Agent directly from an inline frontmatter dict (used by the
/// input-validation vectors, which need no `${...}` resolution). Unwraps the
/// `inputs.properties` / `outputs.properties` nesting the vectors sometimes use.
fn agent_from_frontmatter(frontmatter: &Value) -> Agent {
    let mut fm = frontmatter.clone();
    if let Value::Object(ref mut map) = fm {
        for field in ["inputs", "outputs"] {
            if let Some(Value::Object(inner)) = map.get(field) {
                if let Some(props) = inner.get("properties") {
                    let props = props.clone();
                    map.insert(field.to_string(), props);
                }
            }
        }
    }
    Agent::load_from_value(&fm, &LoadContext::default())
}

fn load_adapter(input: &Value, ctx: &Context) -> Result<Value, VectorError> {
    let expected = ctx.vector.get("expected").cloned().unwrap_or(Value::Null);
    let obj = input.as_object().cloned().unwrap_or_default();

    // --- input-validation vectors -----------------------------------------
    let is_validation = expected
        .get("validated_inputs")
        .is_some()
        || (expected.get("error").is_some() && obj.contains_key("inputs") && obj.contains_key("frontmatter"));
    if is_validation {
        let frontmatter = obj.get("frontmatter").cloned().unwrap_or(Value::Null);
        let inputs = obj.get("inputs").cloned().unwrap_or(Value::Object(Default::default()));
        let agent = agent_from_frontmatter(&frontmatter);
        return match validate_inputs(&agent, &inputs) {
            Ok(validated) => Ok(serde_json::json!({ "validated_inputs": validated })),
            Err(e) => Ok(err_map(&e.to_string(), &expected)),
        };
    }

    // --- env setup (serialized) -------------------------------------------
    let _guard = ENV_LOCK.lock().unwrap();
    let env_vars = obj.get("env").and_then(|v| v.as_object()).cloned();
    let mut restore: Vec<(String, Option<String>)> = Vec::new();
    if let Some(vars) = &env_vars {
        for (k, v) in vars {
            restore.push((k.clone(), std::env::var(k).ok()));
            if let Some(s) = v.as_str() {
                unsafe { std::env::set_var(k, s) };
            }
        }
    }

    let result = load_agent_from_input(&obj, &expected, ctx);

    for (k, old) in restore {
        match old {
            Some(v) => unsafe { std::env::set_var(&k, v) },
            None => unsafe { std::env::remove_var(&k) },
        }
    }
    result
}

fn load_agent_from_input(
    obj: &serde_json::Map<String, Value>,
    expected: &Value,
    ctx: &Context,
) -> Result<Value, VectorError> {
    // fixture path
    if let Some(Value::String(fixture)) = obj.get("fixture") {
        let path = spec_fixtures(ctx).join(fixture);
        return match load(&path) {
            Ok(agent) => Ok(agent_to_canonical(&agent)),
            Err(e) => Ok(err_map(&e.to_string(), expected)),
        };
    }

    // build an on-disk temp tree, then load()
    let temp = make_temp_dir();
    let cleanup = |dir: &std::path::Path| {
        std::fs::remove_dir_all(dir).ok();
    };

    let agent_dir = match obj.get("agent_subdir").and_then(|v| v.as_str()) {
        Some(sub) => temp.join(sub),
        None => temp.clone(),
    };
    std::fs::create_dir_all(&agent_dir).ok();

    if let Some(files) = obj.get("files") {
        write_files(&agent_dir, files);
    }

    let text = if let Some(Value::String(raw)) = obj.get("frontmatter_raw") {
        raw.clone()
    } else if let Some(fm) = obj.get("frontmatter") {
        frontmatter_to_prompty(fm)
    } else {
        String::new()
    };

    let prompty_path = agent_dir.join("vector.prompty");
    std::fs::write(&prompty_path, text).ok();

    let out = match load(&prompty_path) {
        Ok(agent) => Ok(agent_to_canonical(&agent)),
        Err(e) => Ok(err_map(&e.to_string(), expected)),
    };
    cleanup(&temp);
    out
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

/// Render a template through the real Rust pipeline. Thread-kind inputs are
/// declared as `Property { kind: "thread" }` so `prepare_render_inputs` injects
/// the nonce marker; when the vector asserts a `nonce_pattern`, the observed
/// render is regex-matched (DOTALL) and the canonical `expected` returned on a
/// hit — mirroring the Python reference's `re.match(..., re.DOTALL)` semantics.
async fn render_impl(input: Value, expected: Value) -> Result<Value, VectorError> {
    prompty::register_defaults();

    let template = input
        .get("template")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let engine = input
        .get("engine")
        .and_then(|v| v.as_str())
        .unwrap_or("jinja2")
        .to_string();
    let inputs_map = input
        .get("inputs")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    // Split thread-kind inputs (declared as Properties so the renderer injects a
    // nonce) from plain inputs (passed straight through to the template engine).
    let mut props: Vec<Value> = Vec::new();
    let mut render_inputs = serde_json::Map::new();
    for (k, v) in &inputs_map {
        if let Value::Object(o) = v {
            if o.get("_kind").and_then(|x| x.as_str()) == Some("thread") {
                props.push(serde_json::json!({ "name": k, "kind": "thread" }));
                let msgs = o.get("messages").cloned().unwrap_or(Value::Array(vec![]));
                render_inputs.insert(k.clone(), msgs);
                continue;
            }
        }
        render_inputs.insert(k.clone(), v.clone());
    }

    let agent_value = serde_json::json!({
        "kind": "prompt",
        "name": "render_test",
        "instructions": template,
        "template": { "format": { "kind": engine }, "parser": { "kind": "prompty" } },
        "inputs": props,
    });
    let agent = Agent::load_from_value(&agent_value, &LoadContext::default());

    let rendered = prompty::render(&agent, &Value::Object(render_inputs))
        .await
        .map_err(|e| VectorError::new(e.to_string()))?;

    if let Some(pattern) = expected.get("nonce_pattern").and_then(|v| v.as_str()) {
        let anchored = format!("(?s){pattern}");
        if let Ok(re) = Regex::new(&anchored) {
            if re.is_match(&rendered) {
                return Ok(expected.clone());
            }
        }
        return Ok(serde_json::json!({ "rendered": rendered }));
    }
    Ok(serde_json::json!({ "rendered": rendered }))
}

// ---------------------------------------------------------------------------
// PARSE
// ---------------------------------------------------------------------------

/// Canonicalize a `Message` to `{ role, content: [<parts>], metadata? }`.
/// `metadata` is emitted only when non-empty, matching the Python reference.
fn message_to_canonical(m: &Message) -> Value {
    let ctx = SaveContext::default();
    let content: Vec<Value> = m.parts.iter().map(|p| p.to_value(&ctx)).collect();
    let mut obj = serde_json::Map::new();
    obj.insert("role".to_string(), Value::String(m.role.to_string()));
    obj.insert("content".to_string(), Value::Array(content));
    if let Value::Object(md) = &m.metadata {
        if !md.is_empty() {
            obj.insert("metadata".to_string(), m.metadata.clone());
        }
    }
    Value::Object(obj)
}

/// Parse rendered text into messages via the real `parse_chat`, then (when the
/// vector supplies `thread_inputs`) expand thread nonces through the real
/// `expand_threads` pipeline function — reconstructing the nonce→name map by
/// scanning the rendered text, exactly as `prepare` does internally.
fn parse_adapter(input: &Value, _ctx: &Context) -> Result<Value, VectorError> {
    let rendered = input.get("rendered").and_then(|v| v.as_str()).unwrap_or("");
    let mut messages = parse_chat(rendered);

    if let Some(Value::Object(thread_inputs)) = input.get("thread_inputs") {
        let mut nonces: HashMap<String, String> = HashMap::new();
        for name in thread_inputs.keys() {
            let pattern = format!(r"__PROMPTY_THREAD_[0-9a-fA-F]+_{}__", regex::escape(name));
            if let Ok(re) = Regex::new(&pattern) {
                if let Some(found) = re.find(rendered) {
                    nonces.insert(name.clone(), found.as_str().to_string());
                }
            }
        }
        let inputs_value = Value::Object(thread_inputs.clone());
        messages = expand_threads(&messages, &nonces, &inputs_value);
    }

    let canonical: Vec<Value> = messages.iter().map(message_to_canonical).collect();
    Ok(serde_json::json!({ "messages": canonical }))
}
