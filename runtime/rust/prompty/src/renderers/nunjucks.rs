//! Nunjucks/Jinja2 renderer using the `minijinja` crate.
//!
//! Registered under keys `"nunjucks"` and `"jinja2"` — both are aliases for
//! the same implementation since MiniJinja is Jinja2-compatible.

use async_trait::async_trait;

use crate::interfaces::{InvokerError, Renderer};
use crate::model::Prompty;

use super::common::prepare_render_inputs;

/// Jinja2/Nunjucks-compatible renderer powered by MiniJinja.
pub struct NunjucksRenderer;

#[async_trait]
impl Renderer for NunjucksRenderer {
    async fn render(
        &self,
        agent: &Prompty,
        template: &str,
        inputs: &serde_json::Value,
    ) -> Result<String, InvokerError> {
        let (modified_inputs, _nonces) = prepare_render_inputs(agent, inputs);

        render_template(template, &modified_inputs)
    }
}

/// Render a Jinja2 template string with the given context values.
fn render_template(template: &str, context: &serde_json::Value) -> Result<String, InvokerError> {
    let mut env = minijinja::Environment::new();
    env.set_undefined_behavior(minijinja::UndefinedBehavior::Lenient);

    env.add_template("prompt", template)
        .map_err(|e| InvokerError::Render(Box::new(e)))?;

    let tmpl = env
        .get_template("prompt")
        .map_err(|e| InvokerError::Render(Box::new(e)))?;

    tmpl.render(context)
        .map_err(|e| InvokerError::Render(Box::new(e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_substitution() {
        let result = render_template("Hello {{ name }}!", &serde_json::json!({"name": "World"}));
        assert_eq!(result.unwrap(), "Hello World!");
    }

    #[test]
    fn test_multiple_variables() {
        let result = render_template(
            "{{ name }} {{ surname }} is {{ age }}",
            &serde_json::json!({"name": "Jane", "surname": "Doe", "age": 30}),
        );
        assert_eq!(result.unwrap(), "Jane Doe is 30");
    }

    #[test]
    fn test_conditional_true() {
        let result = render_template(
            "{% if vip %}Welcome VIP!{% else %}Hello!{% endif %}",
            &serde_json::json!({"vip": true}),
        );
        assert_eq!(result.unwrap(), "Welcome VIP!");
    }

    #[test]
    fn test_conditional_false() {
        let result = render_template(
            "{% if vip %}Welcome VIP!{% else %}Hello!{% endif %}",
            &serde_json::json!({"vip": false}),
        );
        assert_eq!(result.unwrap(), "Hello!");
    }

    #[test]
    fn test_for_loop() {
        let result = render_template(
            "Items: {% for item in items %}{{ item }} {% endfor %}",
            &serde_json::json!({"items": ["a", "b", "c"]}),
        );
        assert_eq!(result.unwrap(), "Items: a b c ");
    }

    #[test]
    fn test_nested_object() {
        let result = render_template(
            "{{ user.name }} ({{ user.email }})",
            &serde_json::json!({"user": {"name": "Jane", "email": "jane@test.com"}}),
        );
        assert_eq!(result.unwrap(), "Jane (jane@test.com)");
    }

    #[test]
    fn test_missing_variable_renders_empty() {
        let result = render_template("Hello {{ name }}!", &serde_json::json!({}));
        assert_eq!(result.unwrap(), "Hello !");
    }

    #[test]
    fn test_html_not_escaped() {
        let result = render_template("{{ content }}", &serde_json::json!({"content": "<b>bold</b>"}));
        assert_eq!(result.unwrap(), "<b>bold</b>");
    }

    #[test]
    fn test_filter_upper() {
        let result = render_template("{{ name | upper }}", &serde_json::json!({"name": "hello"}));
        assert_eq!(result.unwrap(), "HELLO");
    }

    #[test]
    fn test_filter_lower() {
        let result = render_template("{{ name | lower }}", &serde_json::json!({"name": "HELLO"}));
        assert_eq!(result.unwrap(), "hello");
    }

    #[test]
    fn test_filter_trim() {
        let result = render_template("{{ name | trim }}", &serde_json::json!({"name": "  hello  "}));
        assert_eq!(result.unwrap(), "hello");
    }

    #[test]
    fn test_filter_join() {
        let result = render_template(
            "{{ items | join(\", \") }}",
            &serde_json::json!({"items": ["a", "b", "c"]}),
        );
        assert_eq!(result.unwrap(), "a, b, c");
    }

    #[test]
    fn test_filter_length() {
        let result = render_template("{{ name | length }}", &serde_json::json!({"name": "hello"}));
        assert_eq!(result.unwrap(), "5");
    }

    #[test]
    fn test_jinja2_comment() {
        let result = render_template("Hello {# this is a comment #}World", &serde_json::json!({}));
        assert_eq!(result.unwrap(), "Hello World");
    }

    #[test]
    fn test_whitespace_preserved() {
        let template = "  hello  \n  world  ";
        let result = render_template(template, &serde_json::json!({}));
        assert_eq!(result.unwrap(), "  hello  \n  world  ");
    }

    #[test]
    fn test_role_markers_preserved() {
        let template = "system:\nYou are helpful.\n\nuser:\n{{ question }}";
        let result = render_template(template, &serde_json::json!({"question": "Hi"}));
        assert_eq!(result.unwrap(), "system:\nYou are helpful.\n\nuser:\nHi");
    }

    #[test]
    fn test_default_filter() {
        let result = render_template(
            "{{ name | default(\"stranger\") }}",
            &serde_json::json!({}),
        );
        assert_eq!(result.unwrap(), "stranger");
    }
}
