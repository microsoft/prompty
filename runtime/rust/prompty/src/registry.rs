//! Thread-safe invoker registry — register and look up pipeline stage
//! implementations by key.
//!
//! Matches the registry pattern from the TypeScript, Python, and C# runtimes.
//! Uses `HashMap<String, Arc<dyn Trait>>` behind a `RwLock`. Arc allows cloning
//! the trait object so the lock guard is dropped before any `.await` point.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

use crate::interfaces::{Executor, InvokerError, Parser, Processor, Renderer};

// ---------------------------------------------------------------------------
// Global singletons
// ---------------------------------------------------------------------------

static RENDERERS: OnceLock<RwLock<HashMap<String, Arc<dyn Renderer>>>> = OnceLock::new();
static PARSERS: OnceLock<RwLock<HashMap<String, Arc<dyn Parser>>>> = OnceLock::new();
static EXECUTORS: OnceLock<RwLock<HashMap<String, Arc<dyn Executor>>>> = OnceLock::new();
static PROCESSORS: OnceLock<RwLock<HashMap<String, Arc<dyn Processor>>>> = OnceLock::new();

fn renderers() -> &'static RwLock<HashMap<String, Arc<dyn Renderer>>> {
    RENDERERS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn parsers() -> &'static RwLock<HashMap<String, Arc<dyn Parser>>> {
    PARSERS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn executors() -> &'static RwLock<HashMap<String, Arc<dyn Executor>>> {
    EXECUTORS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn processors() -> &'static RwLock<HashMap<String, Arc<dyn Processor>>> {
    PROCESSORS.get_or_init(|| RwLock::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/// Register a renderer under the given key (e.g. `"nunjucks"`, `"mustache"`).
pub fn register_renderer(key: impl Into<String>, renderer: impl Renderer + 'static) {
    renderers()
        .write()
        .expect("renderers lock poisoned")
        .insert(key.into(), Arc::new(renderer));
}

/// Register a parser under the given key (e.g. `"prompty"`).
pub fn register_parser(key: impl Into<String>, parser: impl Parser + 'static) {
    parsers()
        .write()
        .expect("parsers lock poisoned")
        .insert(key.into(), Arc::new(parser));
}

/// Register an executor under the given key (e.g. `"openai"`, `"azure"`).
pub fn register_executor(key: impl Into<String>, executor: impl Executor + 'static) {
    executors()
        .write()
        .expect("executors lock poisoned")
        .insert(key.into(), Arc::new(executor));
}

/// Register a processor under the given key (e.g. `"openai"`, `"azure"`).
pub fn register_processor(key: impl Into<String>, processor: impl Processor + 'static) {
    processors()
        .write()
        .expect("processors lock poisoned")
        .insert(key.into(), Arc::new(processor));
}

// ---------------------------------------------------------------------------
// Lookup — check existence (internal use; invoke_* is the public API)
// ---------------------------------------------------------------------------

/// Check if a renderer is registered for `key`.
pub fn has_renderer(key: &str) -> bool {
    renderers()
        .read()
        .expect("renderers lock poisoned")
        .contains_key(key)
}

/// Check if a parser is registered for `key`.
pub fn has_parser(key: &str) -> bool {
    parsers()
        .read()
        .expect("parsers lock poisoned")
        .contains_key(key)
}

/// Check if an executor is registered for `key`.
pub fn has_executor(key: &str) -> bool {
    executors()
        .read()
        .expect("executors lock poisoned")
        .contains_key(key)
}

/// Check if a processor is registered for `key`.
pub fn has_processor(key: &str) -> bool {
    processors()
        .read()
        .expect("processors lock poisoned")
        .contains_key(key)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/// Clear all registrations (invokers, connections, tool registries).
/// Mainly useful for testing.
pub fn clear_cache() {
    if let Some(m) = RENDERERS.get() {
        m.write().expect("renderers lock poisoned").clear();
    }
    if let Some(m) = PARSERS.get() {
        m.write().expect("parsers lock poisoned").clear();
    }
    if let Some(m) = EXECUTORS.get() {
        m.write().expect("executors lock poisoned").clear();
    }
    if let Some(m) = PROCESSORS.get() {
        m.write().expect("processors lock poisoned").clear();
    }
    crate::connections::clear_connections();
    crate::tool_dispatch::clear_tools();
    crate::tool_dispatch::clear_tool_handlers();
}

// ---------------------------------------------------------------------------
// Invocation helpers — execute a registered invoker by key
// ---------------------------------------------------------------------------

/// Render using the registered renderer for the given key.
///
/// # Errors
///
/// Returns `InvokerError::NotFound` if no renderer is registered for `key`.
pub async fn invoke_renderer(
    key: &str,
    agent: &crate::model::Prompty,
    template: &str,
    inputs: &serde_json::Value,
) -> Result<String, InvokerError> {
    let renderer = {
        let guard = renderers().read().expect("renderers lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "renderer".into(),
            key: key.into(),
        })?)
    };
    renderer.render(agent, template, inputs).await
}

/// Parse using the registered parser for the given key.
///
/// # Errors
///
/// Returns `InvokerError::NotFound` if no parser is registered for `key`.
pub async fn invoke_parser(
    key: &str,
    agent: &crate::model::Prompty,
    rendered: &str,
    context: Option<&serde_json::Value>,
) -> Result<Vec<crate::types::Message>, InvokerError> {
    let parser = {
        let guard = parsers().read().expect("parsers lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "parser".into(),
            key: key.into(),
        })?)
    };
    parser.parse(agent, rendered, context).await
}

/// Execute using the registered executor for the given key.
///
/// # Errors
///
/// Returns `InvokerError::NotFound` if no executor is registered for `key`.
pub async fn invoke_executor(
    key: &str,
    agent: &crate::model::Prompty,
    messages: &[crate::types::Message],
) -> Result<serde_json::Value, InvokerError> {
    let executor = {
        let guard = executors().read().expect("executors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "executor".into(),
            key: key.into(),
        })?)
    };
    executor.execute(agent, messages).await
}

/// Execute using the registered executor and generated invocation context.
///
/// Legacy executors are supported by the trait's default implementation.
pub async fn invoke_executor_with_context(
    key: &str,
    agent: &crate::model::Prompty,
    request: &crate::model::ModelInvocationRequest,
    cancellation: &crate::engine::CancellationToken,
) -> Result<serde_json::Value, InvokerError> {
    let executor = {
        let guard = executors().read().expect("executors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "executor".into(),
            key: key.into(),
        })?)
    };
    executor
        .execute_with_context(agent, request, cancellation)
        .await
}

/// Execute using the registered executor in streaming mode.
///
/// Returns a `Stream<Item = Value>` of raw SSE chunks from the provider.
///
/// # Errors
///
/// Returns `InvokerError::NotFound` if no executor is registered for `key`.
/// Returns `InvokerError::Execute` if the executor does not support streaming.
pub async fn invoke_executor_stream(
    key: &str,
    agent: &crate::model::Prompty,
    messages: &[crate::types::Message],
) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>, InvokerError>
{
    let executor = {
        let guard = executors().read().expect("executors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "executor".into(),
            key: key.into(),
        })?)
    };
    executor.execute_stream(agent, messages).await
}

/// Execute a streaming request using the registered executor and generated context.
///
/// Legacy executors are supported by the trait's default implementation.
pub async fn invoke_executor_stream_with_context(
    key: &str,
    agent: &crate::model::Prompty,
    request: &crate::model::ModelInvocationRequest,
    cancellation: &crate::engine::CancellationToken,
) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>, InvokerError>
{
    let executor = {
        let guard = executors().read().expect("executors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "executor".into(),
            key: key.into(),
        })?)
    };
    executor
        .execute_stream_with_context(agent, request, cancellation)
        .await
}

/// Process using the registered processor for the given key.
///
/// # Errors
///
/// Returns `InvokerError::NotFound` if no processor is registered for `key`.
pub async fn invoke_processor(
    key: &str,
    agent: &crate::model::Prompty,
    response: serde_json::Value,
) -> Result<serde_json::Value, InvokerError> {
    let processor = {
        let guard = processors().read().expect("processors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "processor".into(),
            key: key.into(),
        })?)
    };
    processor.process(agent, response).await
}

/// Process a raw response into the generated live-invocation contract.
///
/// Legacy processors receive a portable state mapping from the trait default.
pub async fn invoke_processor_with_context(
    key: &str,
    agent: &crate::model::Prompty,
    response: serde_json::Value,
    request: &crate::model::ModelInvocationRequest,
) -> Result<crate::model::ModelInvocationResponse, InvokerError> {
    let processor = {
        let guard = processors().read().expect("processors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "processor".into(),
            key: key.into(),
        })?)
    };
    processor
        .process_with_context(agent, response, request)
        .await
}

/// Map a raw response while preserving the legacy raw execution boundary.
pub async fn invoke_processor_raw_with_context(
    key: &str,
    agent: &crate::model::Prompty,
    response: serde_json::Value,
    request: &crate::model::ModelInvocationRequest,
) -> Result<crate::model::ModelInvocationResponse, InvokerError> {
    let processor = {
        let guard = processors().read().expect("processors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "processor".into(),
            key: key.into(),
        })?)
    };
    processor
        .process_raw_with_context(agent, response, request)
        .await
}

/// Process a streaming response using the registered processor.
///
/// Returns a `Stream<Item = StreamChunk>` of processed chunks.
///
/// # Errors
///
/// Returns `InvokerError::NotFound` if no processor is registered for `key`.
/// Returns `InvokerError::Process` if the processor does not support streaming.
pub fn invoke_processor_stream(
    key: &str,
    inner: std::pin::Pin<Box<dyn futures::Stream<Item = serde_json::Value> + Send>>,
) -> Result<
    std::pin::Pin<Box<dyn futures::Stream<Item = crate::types::StreamChunk> + Send>>,
    InvokerError,
> {
    let processor = {
        let guard = processors().read().expect("processors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "processor".into(),
            key: key.into(),
        })?)
    };
    processor.process_stream(inner)
}

/// Get tool messages from a registered executor's `format_tool_messages`.
pub fn invoke_format_tool_messages(
    key: &str,
    raw_response: &serde_json::Value,
    tool_calls: &[crate::types::ToolCall],
    tool_results: &[String],
    text_content: Option<&str>,
) -> Result<Vec<crate::types::Message>, InvokerError> {
    let executor = {
        let guard = executors().read().expect("executors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "executor".into(),
            key: key.into(),
        })?)
    };
    Ok(executor.format_tool_messages(raw_response, tool_calls, tool_results, text_content))
}

/// Format a streamed tool exchange using the registered executor.
pub fn invoke_format_stream_tool_messages(
    key: &str,
    raw_chunks: &[serde_json::Value],
    tool_calls: &[crate::types::ToolCall],
    tool_results: &[String],
    text_content: Option<&str>,
) -> Result<Vec<crate::types::Message>, InvokerError> {
    let executor = {
        let guard = executors().read().expect("executors lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "executor".into(),
            key: key.into(),
        })?)
    };
    Ok(executor.format_stream_tool_messages(raw_chunks, tool_calls, tool_results, text_content))
}

/// Get the pre-render hook from a registered parser (if it provides one).
pub fn invoke_pre_render(
    key: &str,
    template: &str,
) -> Result<Option<(String, serde_json::Value)>, InvokerError> {
    let parser = {
        let guard = parsers().read().expect("parsers lock poisoned");
        Arc::clone(guard.get(key).ok_or_else(|| InvokerError::NotFound {
            group: "parser".into(),
            key: key.into(),
        })?)
    };
    Ok(parser.pre_render(template))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    struct DummyRenderer;
    #[async_trait::async_trait]
    impl Renderer for DummyRenderer {
        async fn render(
            &self,
            _agent: &crate::model::Prompty,
            template: &str,
            _inputs: &serde_json::Value,
        ) -> Result<String, InvokerError> {
            Ok(template.to_uppercase())
        }
    }

    struct DummyParser;
    #[async_trait::async_trait]
    impl Parser for DummyParser {
        async fn parse(
            &self,
            _agent: &crate::model::Prompty,
            _rendered: &str,
            _context: Option<&serde_json::Value>,
        ) -> Result<Vec<crate::types::Message>, InvokerError> {
            Ok(vec![crate::types::Message::with_text(
                crate::types::Role::System,
                "parsed",
            )])
        }
    }

    struct DummyExecutor;
    #[async_trait::async_trait]
    impl Executor for DummyExecutor {
        async fn execute(
            &self,
            _agent: &crate::model::Prompty,
            _messages: &[crate::types::Message],
        ) -> Result<serde_json::Value, InvokerError> {
            Ok(serde_json::json!({"result": "ok"}))
        }
    }

    struct DummyProcessor;
    #[async_trait::async_trait]
    impl Processor for DummyProcessor {
        async fn process(
            &self,
            _agent: &crate::model::Prompty,
            response: serde_json::Value,
        ) -> Result<serde_json::Value, InvokerError> {
            Ok(response)
        }
    }

    #[test]
    #[serial]
    fn test_register_and_get_renderer() {
        clear_cache();
        register_renderer("test", DummyRenderer);
        assert!(has_renderer("test"));
        assert!(!has_renderer("missing"));
    }

    #[test]
    #[serial]
    fn test_register_and_get_parser() {
        clear_cache();
        register_parser("test", DummyParser);
        assert!(has_parser("test"));
        assert!(!has_parser("missing"));
    }

    #[test]
    #[serial]
    fn test_register_and_get_executor() {
        clear_cache();
        register_executor("test", DummyExecutor);
        assert!(has_executor("test"));
        assert!(!has_executor("missing"));
    }

    #[test]
    #[serial]
    fn test_register_and_get_processor() {
        clear_cache();
        register_processor("test", DummyProcessor);
        assert!(has_processor("test"));
        assert!(!has_processor("missing"));
    }

    #[test]
    #[serial]
    fn test_clear_cache() {
        register_renderer("clear_test", DummyRenderer);
        assert!(has_renderer("clear_test"));
        clear_cache();
        assert!(!has_renderer("clear_test"));
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_renderer() {
        clear_cache();
        register_renderer("inv_test", DummyRenderer);
        let agent = crate::model::Prompty::default();
        let result = invoke_renderer("inv_test", &agent, "hello", &serde_json::json!({})).await;
        assert_eq!(result.unwrap(), "HELLO");
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_missing_renderer_error() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_renderer("nope", &agent, "hi", &serde_json::json!({}))
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "no renderer registered for key 'nope'");
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_parser() {
        clear_cache();
        register_parser("test_parser", DummyParser);
        let agent = crate::model::Prompty::default();
        let msgs = invoke_parser("test_parser", &agent, "hello", None)
            .await
            .unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].text_content(), "parsed");
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_parser_missing() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_parser("nope", &agent, "hello", None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("parser"));
        assert!(err.to_string().contains("nope"));
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_executor() {
        clear_cache();
        register_executor("test_exec", DummyExecutor);
        let agent = crate::model::Prompty::default();
        let result = invoke_executor("test_exec", &agent, &[]).await.unwrap();
        assert_eq!(result["result"], "ok");
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_executor_missing() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_executor("nope", &agent, &[]).await.unwrap_err();
        assert!(err.to_string().contains("executor"));
        assert!(err.to_string().contains("nope"));
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_processor() {
        clear_cache();
        register_processor("test_proc", DummyProcessor);
        let agent = crate::model::Prompty::default();
        let result = invoke_processor("test_proc", &agent, serde_json::json!({"x": 1}))
            .await
            .unwrap();
        assert_eq!(result["x"], 1);
    }

    #[tokio::test]
    #[serial]
    async fn test_invoke_processor_missing() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_processor("nope", &agent, serde_json::json!({}))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("processor"));
        assert!(err.to_string().contains("nope"));
    }

    #[test]
    #[serial]
    fn test_invoke_format_tool_messages_default() {
        clear_cache();
        register_executor("test_ftm", DummyExecutor);
        let tool_calls = vec![crate::types::ToolCall {
            id: "call_1".into(),
            name: "get_weather".into(),
            arguments: r#"{"city":"NY"}"#.into(),
        }];
        let results = vec!["72°F sunny".to_string()];
        let msgs = invoke_format_tool_messages(
            "test_ftm",
            &serde_json::json!({}),
            &tool_calls,
            &results,
            None,
        )
        .unwrap();
        // Default impl: assistant message with tool_calls + tool result message
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, crate::types::Role::Assistant);
        assert!(msgs[0].metadata.get("tool_calls").is_some());
        assert_eq!(msgs[1].role, crate::types::Role::Tool);
        assert_eq!(msgs[1].text_content(), "72°F sunny");
    }

    #[test]
    #[serial]
    fn test_invoke_format_tool_messages_missing_executor() {
        clear_cache();
        let err = invoke_format_tool_messages("nope", &serde_json::json!({}), &[], &[], None)
            .unwrap_err();
        assert!(err.to_string().contains("executor"));
    }

    #[test]
    #[serial]
    fn test_invoke_pre_render() {
        clear_cache();
        register_parser("test_pre", DummyParser);
        // DummyParser returns None for pre_render (default impl)
        let result = invoke_pre_render("test_pre", "template").unwrap();
        assert!(result.is_none());
    }

    #[test]
    #[serial]
    fn test_invoke_pre_render_missing_parser() {
        clear_cache();
        let err = invoke_pre_render("nope", "template").unwrap_err();
        assert!(err.to_string().contains("parser"));
    }
}
