//! Shared connection credential resolution for Foundry provider operations.

use serde_json::Value;

const API_KEY_FIELDS: &[&str] = &["apiKey", "api_key"];
const BEARER_TOKEN_FIELDS: &[&str] = &["bearerToken", "bearer_token", "apiKey", "api_key"];

fn first_non_empty(connection: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        connection
            .get(*field)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

/// Resolve an API key for Azure OpenAI key-authenticated operations.
pub(crate) fn connection_api_key(connection: &Value) -> Option<String> {
    first_non_empty(connection, API_KEY_FIELDS)
}

/// Resolve a caller-supplied bearer token for Foundry operations.
///
/// Explicit bearer-token fields are preferred. API-key field aliases remain
/// accepted for compatibility with generated connection shapes and existing
/// hosts that carry an OAuth token in `apiKey`.
pub(crate) fn connection_bearer_token(connection: &Value) -> Option<String> {
    first_non_empty(connection, BEARER_TOKEN_FIELDS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn api_key_accepts_generated_and_legacy_names() {
        assert_eq!(
            connection_api_key(&json!({"apiKey": " generated "})).as_deref(),
            Some("generated")
        );
        assert_eq!(
            connection_api_key(&json!({"api_key": " legacy "})).as_deref(),
            Some("legacy")
        );
    }

    #[test]
    fn bearer_token_prefers_explicit_token_fields() {
        let connection = json!({
            "apiKey": "compatibility",
            "bearerToken": "explicit"
        });
        assert_eq!(
            connection_bearer_token(&connection).as_deref(),
            Some("explicit")
        );
    }

    #[test]
    fn credentials_ignore_blank_values() {
        let connection = json!({"bearerToken": " ", "apiKey": ""});
        assert!(connection_bearer_token(&connection).is_none());
        assert!(connection_api_key(&connection).is_none());
    }
}
