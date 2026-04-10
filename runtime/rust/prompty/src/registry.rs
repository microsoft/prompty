//! Thread-safe invoker registry — register and look up pipeline stage
//! implementations by key.
//!
//! Matches the registry pattern from the TypeScript, Python, and C# runtimes.
//! Uses `HashMap<String, Box<dyn Trait>>` behind a `RwLock`.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use crate::interfaces::{Executor, InvokerError, Parser, Processor, Renderer};

// ---------------------------------------------------------------------------
// Global singletons
// ---------------------------------------------------------------------------

static RENDERERS: OnceLock<RwLock<HashMap<String, Box<dyn Renderer>>>> = OnceLock::new();
static PARSERS: OnceLock<RwLock<HashMap<String, Box<dyn Parser>>>> = OnceLock::new();
static EXECUTORS: OnceLock<RwLock<HashMap<String, Box<dyn Executor>>>> = OnceLock::new();
static PROCESSORS: OnceLock<RwLock<HashMap<String, Box<dyn Processor>>>> = OnceLock::new();

fn renderers() -> &'static RwLock<HashMap<String, Box<dyn Renderer>>> {
    RENDERERS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn parsers() -> &'static RwLock<HashMap<String, Box<dyn Parser>>> {
    PARSERS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn executors() -> &'static RwLock<HashMap<String, Box<dyn Executor>>> {
    EXECUTORS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn processors() -> &'static RwLock<HashMap<String, Box<dyn Processor>>> {
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
        .insert(key.into(), Box::new(renderer));
}

/// Register a parser under the given key (e.g. `"prompty"`).
pub fn register_parser(key: impl Into<String>, parser: impl Parser + 'static) {
    parsers()
        .write()
        .expect("parsers lock poisoned")
        .insert(key.into(), Box::new(parser));
}

/// Register an executor under the given key (e.g. `"openai"`, `"azure"`).
pub fn register_executor(key: impl Into<String>, executor: impl Executor + 'static) {
    executors()
        .write()
        .expect("executors lock poisoned")
        .insert(key.into(), Box::new(executor));
}

/// Register a processor under the given key (e.g. `"openai"`, `"azure"`).
pub fn register_processor(key: impl Into<String>, processor: impl Processor + 'static) {
    processors()
        .write()
        .expect("processors lock poisoned")
        .insert(key.into(), Box::new(processor));
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

/// Clear all registrations. Mainly useful for testing.
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
    let map = renderers();
    let guard = map.read().expect("renderers lock poisoned");
    let renderer = guard.get(key).ok_or_else(|| InvokerError::NotFound {
        group: "renderer".into(),
        key: key.into(),
    })?;
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
    let map = parsers();
    let guard = map.read().expect("parsers lock poisoned");
    let parser = guard.get(key).ok_or_else(|| InvokerError::NotFound {
        group: "parser".into(),
        key: key.into(),
    })?;
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
    let map = executors();
    let guard = map.read().expect("executors lock poisoned");
    let executor = guard.get(key).ok_or_else(|| InvokerError::NotFound {
        group: "executor".into(),
        key: key.into(),
    })?;
    executor.execute(agent, messages).await
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
    let map = processors();
    let guard = map.read().expect("processors lock poisoned");
    let processor = guard.get(key).ok_or_else(|| InvokerError::NotFound {
        group: "processor".into(),
        key: key.into(),
    })?;
    processor.process(agent, response).await
}

/// Get tool messages from a registered executor's `format_tool_messages`.
pub fn invoke_format_tool_messages(
    key: &str,
    raw_response: &serde_json::Value,
    tool_calls: &[crate::types::ToolCall],
    tool_results: &[String],
    text_content: Option<&str>,
) -> Result<Vec<crate::types::Message>, InvokerError> {
    let map = executors();
    let guard = map.read().expect("executors lock poisoned");
    let executor = guard.get(key).ok_or_else(|| InvokerError::NotFound {
        group: "executor".into(),
        key: key.into(),
    })?;
    Ok(executor.format_tool_messages(raw_response, tool_calls, tool_results, text_content))
}

/// Get the pre-render hook from a registered parser (if it provides one).
pub fn invoke_pre_render(key: &str, template: &str) -> Result<Option<(String, serde_json::Value)>, InvokerError> {
    let map = parsers();
    let guard = map.read().expect("parsers lock poisoned");
    let parser = guard.get(key).ok_or_else(|| InvokerError::NotFound {
        group: "parser".into(),
        key: key.into(),
    })?;
    Ok(parser.pre_render(template))
}

#[cfg(test)]
mod tests {
    use super::*;

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
            Ok(vec![crate::types::Message::text(
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
    fn test_register_and_get_renderer() {
        clear_cache();
        register_renderer("test", DummyRenderer);
        assert!(has_renderer("test"));
        assert!(!has_renderer("missing"));
    }

    #[test]
    fn test_register_and_get_parser() {
        clear_cache();
        register_parser("test", DummyParser);
        assert!(has_parser("test"));
        assert!(!has_parser("missing"));
    }

    #[test]
    fn test_register_and_get_executor() {
        clear_cache();
        register_executor("test", DummyExecutor);
        assert!(has_executor("test"));
        assert!(!has_executor("missing"));
    }

    #[test]
    fn test_register_and_get_processor() {
        clear_cache();
        register_processor("test", DummyProcessor);
        assert!(has_processor("test"));
        assert!(!has_processor("missing"));
    }

    #[test]
    fn test_clear_cache() {
        register_renderer("clear_test", DummyRenderer);
        assert!(has_renderer("clear_test"));
        clear_cache();
        assert!(!has_renderer("clear_test"));
    }

    #[tokio::test]
    async fn test_invoke_renderer() {
        clear_cache();
        register_renderer("inv_test", DummyRenderer);
        let agent = crate::model::Prompty::default();
        let result = invoke_renderer("inv_test", &agent, "hello", &serde_json::json!({})).await;
        assert_eq!(result.unwrap(), "HELLO");
    }

    #[tokio::test]
    async fn test_invoke_missing_renderer_error() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_renderer("nope", &agent, "hi", &serde_json::json!({}))
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "no renderer registered for key 'nope'");
    }

    #[tokio::test]
    async fn test_invoke_parser() {
        clear_cache();
        register_parser("test_parser", DummyParser);
        let agent = crate::model::Prompty::default();
        let msgs = invoke_parser("test_parser", &agent, "hello", None).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].text_content(), "parsed");
    }

    #[tokio::test]
    async fn test_invoke_parser_missing() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_parser("nope", &agent, "hello", None).await.unwrap_err();
        assert!(err.to_string().contains("parser"));
        assert!(err.to_string().contains("nope"));
    }

    #[tokio::test]
    async fn test_invoke_executor() {
        clear_cache();
        register_executor("test_exec", DummyExecutor);
        let agent = crate::model::Prompty::default();
        let result = invoke_executor("test_exec", &agent, &[]).await.unwrap();
        assert_eq!(result["result"], "ok");
    }

    #[tokio::test]
    async fn test_invoke_executor_missing() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_executor("nope", &agent, &[]).await.unwrap_err();
        assert!(err.to_string().contains("executor"));
        assert!(err.to_string().contains("nope"));
    }

    #[tokio::test]
    async fn test_invoke_processor() {
        clear_cache();
        register_processor("test_proc", DummyProcessor);
        let agent = crate::model::Prompty::default();
        let result = invoke_processor("test_proc", &agent, serde_json::json!({"x": 1})).await.unwrap();
        assert_eq!(result["x"], 1);
    }

    #[tokio::test]
    async fn test_invoke_processor_missing() {
        clear_cache();
        let agent = crate::model::Prompty::default();
        let err = invoke_processor("nope", &agent, serde_json::json!({})).await.unwrap_err();
        assert!(err.to_string().contains("processor"));
        assert!(err.to_string().contains("nope"));
    }

    #[test]
    fn test_invoke_format_tool_messages_default() {
        clear_cache();
        register_executor("test_ftm", DummyExecutor);
        let tool_calls = vec![
            crate::types::ToolCall {
                id: "call_1".into(),
                name: "get_weather".into(),
                arguments: r#"{"city":"NY"}"#.into(),
            },
        ];
        let results = vec!["72°F sunny".to_string()];
        let msgs = invoke_format_tool_messages("test_ftm", &serde_json::json!({}), &tool_calls, &results, None).unwrap();
        // Default impl: assistant message with tool_calls + tool result message
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, crate::types::Role::Assistant);
        assert!(msgs[0].metadata.contains_key("tool_calls"));
        assert_eq!(msgs[1].role, crate::types::Role::Tool);
        assert_eq!(msgs[1].text_content(), "72°F sunny");
    }

    #[test]
    fn test_invoke_format_tool_messages_missing_executor() {
        clear_cache();
        let err = invoke_format_tool_messages("nope", &serde_json::json!({}), &[], &[], None).unwrap_err();
        assert!(err.to_string().contains("executor"));
    }

    #[test]
    fn test_invoke_pre_render() {
        clear_cache();
        register_parser("test_pre", DummyParser);
        // DummyParser returns None for pre_render (default impl)
        let result = invoke_pre_render("test_pre", "template").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_invoke_pre_render_missing_parser() {
        clear_cache();
        let err = invoke_pre_render("nope", "template").unwrap_err();
        assert!(err.to_string().contains("parser"));
    }
}
