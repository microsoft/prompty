//! Mustache renderer using the `ribboncurls` crate.
//!
//! Registered under key `"mustache"`. Uses `ribboncurls::render()` which
//! takes a template string and JSON data string.

use async_trait::async_trait;

use crate::interfaces::{InvokerError, Renderer};
use crate::model::Prompty;

use super::common::prepare_render_inputs;

/// Mustache renderer powered by `ribboncurls` (Mustache v1.4.2 spec compliant).
pub struct MustacheRenderer;

#[async_trait]
impl Renderer for MustacheRenderer {
    async fn render(
        &self,
        agent: &Prompty,
        template: &str,
        inputs: &serde_json::Value,
    ) -> Result<String, InvokerError> {
        let (modified_inputs, _nonces) = prepare_render_inputs(agent, inputs);

        render_mustache(template, &modified_inputs)
    }
}

/// Render a Mustache template string with the given context values.
fn render_mustache(template: &str, context: &serde_json::Value) -> Result<String, InvokerError> {
    let data_str = serde_json::to_string(context)
        .map_err(|e| InvokerError::Render(Box::new(e)))?;

    ribboncurls::render(template, &data_str, None)
        .map_err(|e| InvokerError::Render(e.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_substitution() {
        let result = render_mustache("Hello {{name}}!", &serde_json::json!({"name": "World"}));
        assert_eq!(result.unwrap(), "Hello World!");
    }

    #[test]
    fn test_multiple_variables() {
        let result = render_mustache(
            "{{name}} is {{age}}",
            &serde_json::json!({"name": "Jane", "age": 30}),
        );
        assert_eq!(result.unwrap(), "Jane is 30");
    }

    #[test]
    fn test_missing_variable() {
        let result = render_mustache("Hello {{name}}!", &serde_json::json!({}));
        assert_eq!(result.unwrap(), "Hello !");
    }

    #[test]
    fn test_section() {
        let result = render_mustache(
            "{{#items}}{{.}} {{/items}}",
            &serde_json::json!({"items": ["a", "b", "c"]}),
        );
        assert_eq!(result.unwrap(), "a b c ");
    }

    #[test]
    fn test_inverted_section() {
        let result = render_mustache(
            "{{^items}}No items{{/items}}",
            &serde_json::json!({"items": []}),
        );
        assert_eq!(result.unwrap(), "No items");
    }

    #[test]
    fn test_nested_object() {
        let result = render_mustache(
            "{{person.name}} is {{person.age}}",
            &serde_json::json!({"person": {"name": "Alice", "age": 25}}),
        );
        assert_eq!(result.unwrap(), "Alice is 25");
    }

    #[tokio::test]
    async fn test_renderer_trait() {
        let renderer = MustacheRenderer;
        let agent = Prompty::default();
        let result = renderer
            .render(&agent, "Hello {{name}}!", &serde_json::json!({"name": "Rust"}))
            .await;
        assert_eq!(result.unwrap(), "Hello Rust!");
    }
}
