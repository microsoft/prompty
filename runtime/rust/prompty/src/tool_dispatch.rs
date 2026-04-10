//! Tool registry and dispatch — 3-layer tool resolution.
//!
//! Matches TypeScript `core/tool-dispatch.ts`. Provides:
//! - **Name registry**: register a specific tool handler by name
//! - **Kind handlers**: register a handler for a tool kind (function, mcp, etc.)
//! - **`dispatch_tool()`**: 3-layer resolution: user tools → name registry → kind handler
//! - **`resolve_bindings()`**: inject parent inputs into tool args via tool.bindings
//!
//! The built-in `function` kind handler calls user-provided tool functions
//! from `TurnOptions.tools` or the name registry.

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, RwLock};

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
static TOOL_KIND_HANDLERS: OnceLock<RwLock<HashMap<String, Arc<dyn ToolHandlerTrait>>>> =
    OnceLock::new();

fn name_registry() -> &'static RwLock<HashMap<String, ToolCallable>> {
    TOOL_NAME_REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

fn kind_handlers() -> &'static RwLock<HashMap<String, Arc<dyn ToolHandlerTrait>>> {
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
        .insert(kind.into(), Arc::new(handler));
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
// Binding resolution
// ---------------------------------------------------------------------------

/// Resolve tool bindings: inject values from `parent_inputs` into tool arguments.
///
/// For each binding on the matched tool definition, looks up `binding.input` in
/// `parent_inputs` and sets `args[binding.name]` to that value. Returns the
/// merged args object.
///
/// Matches TypeScript `resolveBindings()`.
pub fn resolve_bindings(
    agent: &Prompty,
    tool_name: &str,
    mut args: serde_json::Value,
    parent_inputs: &serde_json::Value,
) -> serde_json::Value {
    let Some(parent_obj) = parent_inputs.as_object() else {
        return args;
    };

    let Some(tool_def) = find_tool_def(agent, tool_name) else {
        return args;
    };

    let Some(bindings) = tool_def.get("bindings").and_then(|b| b.as_array()) else {
        return args;
    };

    if bindings.is_empty() {
        return args;
    }

    let args_obj = match args.as_object_mut() {
        Some(obj) => obj,
        None => return args,
    };

    for binding in bindings {
        let Some(target_name) = binding.get("name").and_then(|n| n.as_str()) else {
            continue;
        };
        let Some(source_input) = binding.get("input").and_then(|i| i.as_str()) else {
            continue;
        };
        if let Some(value) = parent_obj.get(source_input) {
            args_obj.insert(target_name.to_string(), value.clone());
        }
    }

    args
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
/// Before dispatching, resolves tool bindings from `parent_inputs` into args.
///
/// Returns an error message string (never throws) — the LLM can recover.
pub async fn dispatch_tool(
    tool_call: &ToolCall,
    user_tools: &HashMap<String, crate::pipeline::ToolHandler>,
    agent: &Prompty,
    parent_inputs: Option<&serde_json::Value>,
) -> String {
    let args_result: Result<serde_json::Value, _> = serde_json::from_str(&tool_call.arguments);
    let mut args = match args_result {
        Ok(a) => a,
        Err(e) => return format!("Error: Invalid tool arguments JSON: {e}"),
    };

    // Resolve bindings: inject parent_inputs into args per tool.bindings
    if let Some(inputs) = parent_inputs {
        if args.is_object() {
            args = resolve_bindings(agent, &tool_call.name, args, inputs);
        }
    }

    // Layer 1: user_tools (from TurnOptions)
    if let Some(handler) = user_tools.get(&tool_call.name) {
        return match execute_user_handler(handler, args).await {
            Ok(r) => r,
            Err(e) => format!("Error: {e}"),
        };
    }

    // Layer 2: global name registry
    {
        let fut = {
            let map = name_registry().read().expect("tool name registry lock poisoned");
            map.get(&tool_call.name).map(|callable| callable(args.clone()))
        };
        if let Some(fut) = fut {
            return match fut.await {
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
        // Clone the Arc before dropping the read guard to avoid holding it across .await
        let handler = {
            let handlers = kind_handlers()
                .read()
                .expect("tool kind handlers lock poisoned");
            handlers.get(kind).cloned().or_else(|| handlers.get("*").cloned())
        };
        if let Some(handler) = handler {
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
// Built-in kind handlers
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

/// Handler for `kind: "prompty"` tools — loads a child `.prompty` file
/// relative to the parent agent and executes it.
///
/// - `mode === "single"` (default): `prepare()` → `run()` (via `invoke()`)
/// - `mode === "agentic"`: `turn()`
pub struct PromptyToolHandler;

#[async_trait::async_trait]
impl ToolHandlerTrait for PromptyToolHandler {
    async fn execute_tool(
        &self,
        tool_def: &serde_json::Value,
        args: serde_json::Value,
        agent: &Prompty,
        _parent_inputs: Option<&serde_json::Value>,
    ) -> Result<String, ToolHandlerError> {
        let tool_name = tool_def
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("<unknown>");

        // Get parent source path from metadata
        let parent_path = agent
            .metadata
            .get("__source_path")
            .and_then(|p| p.as_str())
            .ok_or_else(|| {
                ToolHandlerError::Execution(format!(
                    "cannot resolve PromptyTool '{tool_name}': parent has no __source_path"
                ))
            })?;

        // Get the child path from tool_def.path
        let child_relative = tool_def
            .get("path")
            .and_then(|p| p.as_str())
            .ok_or_else(|| {
                ToolHandlerError::Execution(format!(
                    "PromptyTool '{tool_name}' is missing 'path' field"
                ))
            })?;

        let parent_dir = Path::new(parent_path)
            .parent()
            .unwrap_or(Path::new("."));
        let child_path = parent_dir.join(child_relative);

        // Circular reference detection
        let stack: Vec<String> = agent
            .metadata
            .get("__prompty_tool_stack")
            .and_then(|s| serde_json::from_value(s.clone()).ok())
            .unwrap_or_default();

        let normalized_child = child_path
            .canonicalize()
            .unwrap_or_else(|_| child_path.clone());
        let normalized_parent = Path::new(parent_path)
            .canonicalize()
            .unwrap_or_else(|_| Path::new(parent_path).to_path_buf());

        let mut visited = std::collections::HashSet::new();
        visited.insert(normalized_parent.to_string_lossy().to_string());
        for p in &stack {
            let np = Path::new(p)
                .canonicalize()
                .unwrap_or_else(|_| Path::new(p).to_path_buf());
            visited.insert(np.to_string_lossy().to_string());
        }

        if visited.contains(&*normalized_child.to_string_lossy()) {
            let chain_parts: Vec<&str> = stack
                .iter()
                .map(|s| s.as_str())
                .chain(std::iter::once(parent_path))
                .chain(std::iter::once(child_relative))
                .collect();
            return Err(ToolHandlerError::Execution(format!(
                "circular reference detected: {}",
                chain_parts.join(" → ")
            )));
        }

        // Load the child .prompty file
        let mut child = crate::loader::load(&child_path).map_err(|e| {
            ToolHandlerError::Execution(format!(
                "failed to load PromptyTool '{tool_name}': {e}"
            ))
        })?;

        // Propagate visited-path stack
        if let Some(meta) = child.metadata.as_object_mut() {
            let mut new_stack = stack;
            new_stack.push(parent_path.to_string());
            meta.insert(
                "__prompty_tool_stack".to_string(),
                serde_json::to_value(new_stack).unwrap_or_default(),
            );
        }

        let mode = tool_def
            .get("mode")
            .and_then(|m| m.as_str())
            .unwrap_or("single");

        let result = if mode == "agentic" {
            crate::pipeline::turn(&child, Some(&args), None)
                .await
                .map_err(|e| ToolHandlerError::Execution(e.to_string()))?
        } else {
            crate::pipeline::invoke(&child, Some(&args))
                .await
                .map_err(|e| ToolHandlerError::Execution(e.to_string()))?
        };

        Ok(if let Some(s) = result.as_str() {
            s.to_string()
        } else {
            serde_json::to_string(&result).unwrap_or_default()
        })
    }
}

/// Placeholder handler for `kind: "mcp"` tools.
/// MCP tool dispatch is not yet implemented.
pub struct McpToolHandler;

#[async_trait::async_trait]
impl ToolHandlerTrait for McpToolHandler {
    async fn execute_tool(
        &self,
        _tool_def: &serde_json::Value,
        _args: serde_json::Value,
        _agent: &Prompty,
        _parent_inputs: Option<&serde_json::Value>,
    ) -> Result<String, ToolHandlerError> {
        Err(ToolHandlerError::Execution(
            "MCP tool dispatch is not yet implemented".into(),
        ))
    }
}

/// Placeholder handler for `kind: "openapi"` tools.
/// OpenAPI tool dispatch is not yet implemented.
pub struct OpenApiToolHandler;

#[async_trait::async_trait]
impl ToolHandlerTrait for OpenApiToolHandler {
    async fn execute_tool(
        &self,
        _tool_def: &serde_json::Value,
        _args: serde_json::Value,
        _agent: &Prompty,
        _parent_inputs: Option<&serde_json::Value>,
    ) -> Result<String, ToolHandlerError> {
        Err(ToolHandlerError::Execution(
            "OpenAPI tool dispatch is not yet implemented".into(),
        ))
    }
}

/// Wildcard handler for unknown tool kinds.
/// Custom tool dispatch is not yet implemented.
pub struct CustomToolHandler;

#[async_trait::async_trait]
impl ToolHandlerTrait for CustomToolHandler {
    async fn execute_tool(
        &self,
        tool_def: &serde_json::Value,
        _args: serde_json::Value,
        _agent: &Prompty,
        _parent_inputs: Option<&serde_json::Value>,
    ) -> Result<String, ToolHandlerError> {
        let kind = tool_def
            .get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("unknown");
        Err(ToolHandlerError::Execution(format!(
            "Custom tool dispatch for kind '{kind}' is not yet implemented"
        )))
    }
}

/// Register the built-in tool kind handlers.
///
/// Called by `register_defaults()` in pipeline.rs.
pub fn register_builtin_handlers() {
    register_tool_handler("function", FunctionToolHandler);
    register_tool_handler("prompty", PromptyToolHandler);
    register_tool_handler("mcp", McpToolHandler);
    register_tool_handler("openapi", OpenApiToolHandler);
    register_tool_handler("*", CustomToolHandler);
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

    fn agent_with_tools(tools: serde_json::Value) -> Prompty {
        let mut agent = Prompty::default();
        agent.tools = tools;
        agent
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
        assert!(has_tool_handler("prompty"));
        assert!(has_tool_handler("mcp"));
        assert!(has_tool_handler("openapi"));
        assert!(has_tool_handler("*"));
    }

    // --- resolve_bindings tests ---

    #[test]
    fn test_resolve_bindings_injects_values() {
        let agent = agent_with_tools(serde_json::json!([{
            "name": "get_weather",
            "kind": "function",
            "bindings": [
                { "name": "unit", "input": "temperatureUnit" }
            ]
        }]));

        let args = serde_json::json!({ "city": "Paris" });
        let parent_inputs = serde_json::json!({ "temperatureUnit": "celsius" });

        let result = resolve_bindings(&agent, "get_weather", args, &parent_inputs);
        assert_eq!(result["city"], "Paris");
        assert_eq!(result["unit"], "celsius");
    }

    #[test]
    fn test_resolve_bindings_no_bindings_passthrough() {
        let agent = agent_with_tools(serde_json::json!([{
            "name": "get_weather",
            "kind": "function"
        }]));

        let args = serde_json::json!({ "city": "Paris" });
        let parent_inputs = serde_json::json!({ "temperatureUnit": "celsius" });

        let result = resolve_bindings(&agent, "get_weather", args.clone(), &parent_inputs);
        assert_eq!(result, args);
    }

    #[test]
    fn test_resolve_bindings_missing_input_skipped() {
        let agent = agent_with_tools(serde_json::json!([{
            "name": "get_weather",
            "kind": "function",
            "bindings": [
                { "name": "unit", "input": "missingKey" }
            ]
        }]));

        let args = serde_json::json!({ "city": "Paris" });
        let parent_inputs = serde_json::json!({ "temperatureUnit": "celsius" });

        let result = resolve_bindings(&agent, "get_weather", args.clone(), &parent_inputs);
        assert_eq!(result, args); // no "unit" added since "missingKey" not in parent_inputs
    }

    #[test]
    fn test_resolve_bindings_multiple() {
        let agent = agent_with_tools(serde_json::json!([{
            "name": "get_weather",
            "kind": "function",
            "bindings": [
                { "name": "unit", "input": "temperatureUnit" },
                { "name": "city", "input": "defaultCity" }
            ]
        }]));

        let args = serde_json::json!({});
        let parent_inputs = serde_json::json!({
            "temperatureUnit": "fahrenheit",
            "defaultCity": "London"
        });

        let result = resolve_bindings(&agent, "get_weather", args, &parent_inputs);
        assert_eq!(result["unit"], "fahrenheit");
        assert_eq!(result["city"], "London");
    }

    #[test]
    fn test_resolve_bindings_no_tool_def() {
        let agent = default_agent();
        let args = serde_json::json!({ "city": "Paris" });
        let parent_inputs = serde_json::json!({ "temperatureUnit": "celsius" });

        let result = resolve_bindings(&agent, "nonexistent", args.clone(), &parent_inputs);
        assert_eq!(result, args);
    }

    // --- Kind handler tests ---

    #[tokio::test]
    async fn test_mcp_handler_not_implemented() {
        let handler = McpToolHandler;
        let result = handler
            .execute_tool(
                &serde_json::json!({"kind": "mcp", "name": "test"}),
                serde_json::json!({}),
                &default_agent(),
                None,
            )
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("MCP"));
    }

    #[tokio::test]
    async fn test_openapi_handler_not_implemented() {
        let handler = OpenApiToolHandler;
        let result = handler
            .execute_tool(
                &serde_json::json!({"kind": "openapi", "name": "test"}),
                serde_json::json!({}),
                &default_agent(),
                None,
            )
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("OpenAPI"));
    }

    #[tokio::test]
    async fn test_custom_handler_not_implemented() {
        let handler = CustomToolHandler;
        let result = handler
            .execute_tool(
                &serde_json::json!({"kind": "my_custom", "name": "test"}),
                serde_json::json!({}),
                &default_agent(),
                None,
            )
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("my_custom"));
    }

    #[tokio::test]
    async fn test_dispatch_bindings_integrated() {
        clear_tools();
        clear_tool_handlers();

        // Register a tool that returns its args as JSON
        register_tool("get_weather", |args| async move {
            Ok(serde_json::to_string(&args).unwrap())
        });

        let agent = agent_with_tools(serde_json::json!([{
            "name": "get_weather",
            "kind": "function",
            "bindings": [
                { "name": "unit", "input": "temperatureUnit" }
            ]
        }]));

        let tc = make_tool_call("get_weather", r#"{"city":"Paris"}"#);
        let parent_inputs = serde_json::json!({ "temperatureUnit": "celsius" });
        let result = dispatch_tool(&tc, &HashMap::new(), &agent, Some(&parent_inputs)).await;

        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["city"], "Paris");
        assert_eq!(parsed["unit"], "celsius");
    }
}
