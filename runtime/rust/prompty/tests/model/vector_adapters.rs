use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use prompty::model::ModelInfo;
use prompty::model::context::{LoadContext, SaveContext};
use serde_json::Value;

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
    ])
}

pub fn waivers() -> HashMap<String, String> {
    HashMap::from([
        (
            "LoadConformance.load".to_string(),
            "Not yet wired (deferred). The Rust loader is synchronous and wireable; scheduled for a follow-up increment.".to_string(),
        ),
        (
            "Renderer.render".to_string(),
            "Not yet wired (deferred). The Rust pipeline API is async, but is bridgeable to the synchronous conformance harness via futures::executor::block_on; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.".to_string(),
        ),
        (
            "Parser.parse".to_string(),
            "Not yet wired (deferred). The Rust pipeline API is async, but is bridgeable to the synchronous conformance harness via futures::executor::block_on; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.".to_string(),
        ),
        (
            "WireConformance.toRequest".to_string(),
            "Not yet wired (deferred). The Rust pipeline API is async, but is bridgeable to the synchronous conformance harness via futures::executor::block_on; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.".to_string(),
        ),
        (
            "Processor.process".to_string(),
            "Not yet wired (deferred). The Rust pipeline API is async, but is bridgeable to the synchronous conformance harness via futures::executor::block_on; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.".to_string(),
        ),
        (
            "TurnConformance.replay".to_string(),
            "Not yet wired (deferred). The async turn runner is bridgeable via block_on; scheduled for a follow-up increment.".to_string(),
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
