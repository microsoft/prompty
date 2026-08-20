use std::collections::HashMap;

use prompty::model::context::{LoadContext, SaveContext};
use prompty::model::ModelInfo;
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

pub struct Adapter {
    pub invoke: fn(&Value, &Context) -> Result<Value, AdapterError>,
    pub normalize: Option<fn(&Value, &Context) -> Value>,
}

#[derive(Debug, Clone)]
pub struct AdapterError {
    pub message: String,
    pub payload: Option<Value>,
}

impl AdapterError {
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
            Adapter {
                invoke: enrich_adapter,
                normalize: None,
            },
        ),
        (
            "DiscoveryConformance.mapModel".to_string(),
            Adapter {
                invoke: map_model_adapter,
                normalize: None,
            },
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

fn enrich_adapter(input: &Value, ctx: &Context) -> Result<Value, AdapterError> {
    let provider = ctx.provider.as_deref().unwrap_or("");
    let base = ModelInfo::try_load_from_value(input, &LoadContext::default())
        .map_err(|err| AdapterError::new(err.to_string()))?;
    Ok(prompty::discovery::enrich(base, provider).to_value(&SaveContext::default()))
}

fn map_model_adapter(input: &Value, ctx: &Context) -> Result<Value, AdapterError> {
    let provider = ctx.provider.as_deref().unwrap_or("");
    Ok(prompty::discovery::map_model(input, provider).to_value(&SaveContext::default()))
}
