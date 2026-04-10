//! Tool registry and dispatch — 3-layer tool resolution.
//!
//! Matches TypeScript `core/tool-dispatch.ts`. Provides:
//! - **Name registry**: register a specific tool handler by name
//! - **Kind handlers**: register a handler for a tool kind (function, mcp, etc.)
//! - **`dispatch_tool()`**: 3-layer resolution: user tools → name registry → kind handler
//!
//! The built-in `function` kind handler calls user-provided tool functions
//! from `TurnOptions.tools` or the name registry.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{OnceLock, RwLock};

use crate::model::Prompty;
use crate::types::ToolCall;

// ---------------------------------------------------------------------------
// ToolHandler trait — for kind-based dispatch
// ---------------------------------------------------------------------------

/// A handler that can execute tools of a particular kind.
///
/// Matches TypeScript's `ToolHandler` interface.
#[async_trait::async_trait]
pub trait ToolHandlerTrait: Send + Sync {
    /// Execute a tool call, returning the result as a string.
    ///
    /// # Arguments
    /// - `tool_def`: The tool definition from `agent.tools` (as JSON value)
    /// - `args`: The parsed arguments from the LLM
    /// - `agent`: The current Prompty agent
    /// - `parent_inputs`: The original inputs to the pipeline (for binding resolution)
    async fn execute_tool(
        &self,
        tool_def: &serde_json::Value,
        args: serde_json::Value,
        agent: &Prompty,
        parent_inputs: Option<&serde_json::Value>,
    ) -> Result<String, ToolHandlerError>;
}

/// Error type for tool handler failures.
#[derive(Debug, thiserror::Error)]
pub enum ToolHandlerError {
    #[error("{0}")]
    Execution(String),
    #[error("Tool not found: {0}")]
    NotFound(String),
}

// ---------------------------------------------------------------------------
// Callable tool function types
// ---------------------------------------------------------------------------

/// A callable tool function: takes JSON arguments, returns a string.
pub type ToolCallable = Box<
    dyn Fn(
            serde_json::Value,
        ) -> Pin<Box<dyn Future<Output = Result<String, Box<dyn std::error::Error + Send + Sync>>> + Send>>
        + Send
        + Sync,
>;

// ---------------------------------------------------------------------------
// Global registries
// ---------------------------------------------------------------------------

static TOOL_NAME_REGISTRY: OnceLock<RwLock<HashMap<String, ToolCallable>>> = OnceLock::new();
static TOOL_KIND_HANDLERS: OnceLock<RwLock<HashMap<String, Box<dyn ToolHandlerTrait>>>> =
    OnceLock::new();

fn name_registry() -> &'static RwLock<HashMap<String, ToolCallable>> {
    TOOL_NAME_REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

fn kind_handlers() -> &'static RwLock<HashMap<String, Box<dyn ToolHandlerTrait>>> {
    TOOL_KIND_HANDLERS.get_or_init(|| RwLock::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Name registry (per-tool callable)
// ---------------------------------------------------------------------------

/// Register a callable tool function by name.
///
/// This takes priority over kind handlers in `dispatch_tool()`.
pub fn register_tool<F, Fut>(name: impl Into<String>, handler: F)
where
    F: Fn(serde_json::Value) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<String, Box<dyn std::error::Error + Send + Sync>>> + Send + 'static,
{
    let name = name.into();
    let boxed: ToolCallable = Box::new(move |args| Box::pin(handler(args)));
    name_registry()
        .write()
        .expect("tool name registry lock poisoned")
        .insert(name, boxed);
}

/// Get whether a tool is registered by name.
pub fn has_tool(name: &str) -> bool {
    name_registry()
        .read()
        .expect("tool name registry lock poisoned")
        .contains_key(name)
}

/// Clear all registered tool callables.
pub fn clear_tools() {
    if let Some(m) = TOOL_NAME_REGISTRY.get() {
        m.write()
            .expect("tool name registry lock poisoned")
            .clear();
    }
}

// ---------------------------------------------------------------------------
// Kind handler registry
// ---------------------------------------------------------------------------

/// Register a handler for a tool kind (e.g. "function", "mcp", "openapi", "*").
pub fn register_tool_handler(kind: impl Into<String>, handler: impl ToolHandlerTrait + 'static) {
    kind_handlers()
        .write()
        .expect("tool kind handlers lock poisoned")
        .insert(kind.into(), Box::new(handler));
}

/// Get whether a kind handler is registered.
pub fn has_tool_handler(kind: &str) -> bool {
    kind_handlers()
        .read()
        .expect("tool kind handlers lock poisoned")
        .contains_key(kind)
}

/// Clear all registered kind handlers.
pub fn clear_tool_handlers() {
    if let Some(m) = TOOL_KIND_HANDLERS.get() {
        m.write()
            .expect("tool kind handlers lock poisoned")
            .clear();
    }
}

// ---------------------------------------------------------------------------
// dispatch_tool — 3-layer resolution
// ---------------------------------------------------------------------------

/// Dispatch a tool call using 3-layer resolution.
///
/// Resolution order (matches TypeScript):
/// 1. `user_tools` — the `TurnOptions.tools` map (runtime-provided handlers)
/// 2. Global name registry — tools registered via `register_tool()`
/// 3. Kind handler — handlers registered via `register_tool_handler()` for the
///    tool's `kind` from `agent.tools`, with fallback to `"*"` wildcard
///
/// Returns an error message string (never throws) — the LLM can recover.
pub async fn dispatch_tool(
    tool_call: &ToolCall,
    user_tools: &HashMap<String, crate::pipeline::ToolHandler>,
    agent: &Prompty,
    parent_inputs: Option<&serde_json::Value>,
) -> String {
    let args_result: Result<serde_json::Value, _> = serde_json::from_str(&tool_call.arguments);
    let args = match args_result {
        Ok(a) => a,
        Err(e) => return format!("Error: Invalid tool arguments JSON: {e}"),
    };

    // Layer 1: user_tools (from TurnOptions)
    if let Some(handler) = user_tools.get(&tool_call.name) {
        return match execute_user_handler(handler, args).await {
            Ok(r) => r,
            Err(e) => format!("Error: {e}"),
        };
    }

    // Layer 2: global name registry
    {
        let map = name_registry().read().expect("tool name registry lock poisoned");
        if let Some(callable) = map.get(&tool_call.name) {
            return match callable(args.clone()).await {
                Ok(r) => r,
                Err(e) => format!("Error: {e}"),
            };
        }
    }

    // Layer 3: kind handler — look up tool definition in agent.tools
    let tool_def = find_tool_def(agent, &tool_call.name);
    if let Some(def) = &tool_def {
        let kind = def
            .get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("function");

        // Try specific kind handler, then fallback to "*" wildcard
        let handlers = kind_handlers()
            .read()
            .expect("tool kind handlers lock poisoned");
        if let Some(handler) = handlers.get(kind).or_else(|| handlers.get("*")) {
            return match handler
                .execute_tool(def, args, agent, parent_inputs)
                .await
            {
                Ok(r) => r,
                Err(e) => format!("Error: {e}"),
            };
        }
    }

    // No handler found — return error string (non-fatal)
    format!("Error: No handler registered for tool '{}'", tool_call.name)
}

/// Find a tool definition in `agent.tools` by name.
fn find_tool_def(agent: &Prompty, name: &str) -> Option<serde_json::Value> {
    let tools = agent.tools.as_array()?;
    for tool in tools {
        let tool_name = tool.get("name").and_then(|n| n.as_str());
        if tool_name == Some(name) {
            return Some(tool.clone());
        }
    }
    None
}

/// Execute a user-provided tool handler (from TurnOptions.tools).
async fn execute_user_handler(
    handler: &crate::pipeline::ToolHandler,
    args: serde_json::Value,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    match handler {
        crate::pipeline::ToolHandler::Sync(f) => f(args),
        crate::pipeline::ToolHandler::Async(f) => f(args).await,
    }
}

// ---------------------------------------------------------------------------
// Built-in function handler
// ---------------------------------------------------------------------------

/// Built-in handler for `kind: "function"` tools.
///
/// Looks up the tool by name in the name registry, then calls it.
pub struct FunctionToolHandler;

#[async_trait::async_trait]
impl ToolHandlerTrait for FunctionToolHandler {
    async fn execute_tool(
        &self,
        _tool_def: &serde_json::Value,
        _args: serde_json::Value,
        _agent: &Prompty,
        _parent_inputs: Option<&serde_json::Value>,
    ) -> Result<String, ToolHandlerError> {
        // Function tools delegate to user-provided callables — if the tool
        // wasn't found in layers 1-2, it won't be here either.
        Err(ToolHandlerError::NotFound(
            "Function tool must be provided via register_tool() or TurnOptions.tools".into(),
        ))
    }
}

/// Register the built-in tool kind handlers.
///
/// Called by `register_defaults()` in pipeline.rs.
pub fn register_builtin_handlers() {
    register_tool_handler("function", FunctionToolHandler);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::ToolHandler as PipelineToolHandler;

    fn make_tool_call(name: &str, args: &str) -> ToolCall {
        ToolCall {
            id: "call_1".into(),
            name: name.into(),
            arguments: args.into(),
        }
    }

    fn default_agent() -> Prompty {
        Prompty::default()
    }

    #[tokio::test]
    async fn test_dispatch_user_tools_first() {
        clear_tools();
        clear_tool_handlers();
        let mut user_tools = HashMap::new();
        user_tools.insert(
            "get_weather".into(),
            PipelineToolHandler::Sync(Box::new(|_args| Ok("72°F".to_string()))),
        );

        let tc = make_tool_call("get_weather", r#"{"city":"NY"}"#);
        let result = dispatch_tool(&tc, &user_tools, &default_agent(), None).await;
        assert_eq!(result, "72°F");
    }

    #[tokio::test]
    async fn test_dispatch_name_registry_second() {
        clear_tools();
        clear_tool_handlers();
        register_tool("global_tool", |_args| async {
            Ok("global result".to_string())
        });

        let user_tools = HashMap::new();
        let tc = make_tool_call("global_tool", "{}");
        let result = dispatch_tool(&tc, &user_tools, &default_agent(), None).await;
        assert_eq!(result, "global result");
    }

    #[tokio::test]
    async fn test_dispatch_missing_tool() {
        clear_tools();
        clear_tool_handlers();
        let user_tools = HashMap::new();
        let tc = make_tool_call("nonexistent", "{}");
        let result = dispatch_tool(&tc, &user_tools, &default_agent(), None).await;
        assert!(result.starts_with("Error:"));
        assert!(result.contains("nonexistent"));
    }

    #[tokio::test]
    async fn test_dispatch_invalid_json_args() {
        clear_tools();
        let user_tools = HashMap::new();
        let tc = make_tool_call("test", "not json");
        let result = dispatch_tool(&tc, &user_tools, &default_agent(), None).await;
        assert!(result.starts_with("Error:"));
        assert!(result.contains("Invalid tool arguments JSON"));
    }

    #[tokio::test]
    async fn test_dispatch_user_tool_error() {
        clear_tools();
        let mut user_tools = HashMap::new();
        user_tools.insert(
            "fail_tool".into(),
            PipelineToolHandler::Sync(Box::new(|_args| {
                Err("tool exploded".into())
            })),
        );

        let tc = make_tool_call("fail_tool", "{}");
        let result = dispatch_tool(&tc, &user_tools, &default_agent(), None).await;
        assert!(result.starts_with("Error:"));
        assert!(result.contains("tool exploded"));
    }

    #[test]
    fn test_register_and_check_tool() {
        clear_tools();
        assert!(!has_tool("my_tool"));
        register_tool("my_tool", |_| async { Ok("ok".into()) });
        assert!(has_tool("my_tool"));
    }

    #[test]
    fn test_register_and_check_handler() {
        clear_tool_handlers();
        assert!(!has_tool_handler("custom_kind"));
        register_tool_handler("custom_kind", FunctionToolHandler);
        assert!(has_tool_handler("custom_kind"));
    }

    #[test]
    fn test_clear_tools() {
        register_tool("temp", |_| async { Ok("ok".into()) });
        assert!(has_tool("temp"));
        clear_tools();
        assert!(!has_tool("temp"));
    }

    #[test]
    fn test_clear_tool_handlers() {
        register_tool_handler("temp_kind", FunctionToolHandler);
        assert!(has_tool_handler("temp_kind"));
        clear_tool_handlers();
        assert!(!has_tool_handler("temp_kind"));
    }

    #[test]
    fn test_register_builtin_handlers() {
        clear_tool_handlers();
        register_builtin_handlers();
        assert!(has_tool_handler("function"));
    }
}
