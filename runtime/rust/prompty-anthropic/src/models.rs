//! Model discovery for Anthropic — calls `GET /v1/models` and maps the
//! response to `ModelInfo`. Anthropic returns `context_length` and modality
//! information directly, so no enrichment table is needed.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::ModelInfo;
use serde_json::Value;

/// Shared HTTP client — reuses the same pool as the executor.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// The Anthropic API version header value (matches executor.rs / wire.rs).
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Build the models endpoint URL from a connection JSON value.
fn build_models_url(connection: &Value) -> String {
    let endpoint = connection
        .get("endpoint")
        .and_then(|e| e.as_str())
        .unwrap_or("https://api.anthropic.com");

    let base = endpoint.trim_end_matches('/');
    format!("{base}/v1/models")
}

/// Extract the API key from the connection or fall back to `ANTHROPIC_API_KEY`.
fn get_api_key(connection: &Value) -> Result<String, InvokerError> {
    if let Some(key) = connection
        .get("apiKey")
        .or(connection.get("api_key"))
        .and_then(|k| k.as_str())
    {
        if !key.is_empty() {
            return Ok(key.to_string());
        }
    }

    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(InvokerError::Execute(
        "No API key found. Set ANTHROPIC_API_KEY or configure connection.apiKey"
            .to_string()
            .into(),
    ))
}

/// Convert one Anthropic model object into a `ModelInfo`.
///
/// Anthropic's list models response includes `context_length` and modality
/// information, so we map them directly without a lookup table.
fn parse_model_object(obj: &Value) -> ModelInfo {
    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let display_name = obj
        .get("display_name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let owned_by = Some("anthropic".to_string());

    // Anthropic returns `context_length` as an integer (not `context_window`)
    // See: https://docs.anthropic.com/en/api/models-list
    let context_window = obj
        .get("context_length")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);

    // Anthropic returns input/output modalities as arrays of strings when available
    let input_modalities = obj
        .get("input_modalities")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        });

    let output_modalities = obj
        .get("output_modalities")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        });

    ModelInfo {
        id,
        display_name,
        owned_by,
        context_window,
        input_modalities,
        output_modalities,
        additional_properties: serde_json::Value::Null,
    }
}

/// List models available from the Anthropic API (async).
///
/// Calls `GET /v1/models` with pagination and aggregates all results.
pub async fn list_models_async(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    let base_url = build_models_url(connection);
    let api_key = get_api_key(connection)?;
    let client = &*HTTP_CLIENT;

    let mut all_models = Vec::new();
    let mut after_id: Option<String> = None;

    loop {
        let mut url = base_url.clone();
        // Anthropic uses cursor-based pagination with `after_id` and `limit`
        let mut params = vec![("limit", "100".to_string())];
        if let Some(ref cursor) = after_id {
            params.push(("after_id", cursor.clone()));
        }

        url = reqwest::Url::parse_with_params(&url, &params)
            .map_err(|e| InvokerError::Execute(format!("Failed to build URL: {e}").into()))?
            .to_string();

        let response = client
            .get(&url)
            .header("x-api-key", &api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .send()
            .await
            .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body_text = response
                .text()
                .await
                .unwrap_or_else(|_| "unable to read body".to_string());
            return Err(InvokerError::Execute(
                format!("Anthropic list models error (HTTP {status}): {body_text}").into(),
            ));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;

        if let Some(arr) = body.get("data").and_then(|d| d.as_array()) {
            for obj in arr {
                all_models.push(parse_model_object(obj));
            }
        }

        // Check if there are more pages
        let has_more = body
            .get("has_more")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if !has_more {
            break;
        }

        // Get the last model ID for pagination cursor
        after_id = body
            .get("last_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        if after_id.is_none() {
            break;
        }
    }

    Ok(all_models)
}

/// List models available from the Anthropic API (blocking).
///
/// Wraps [`list_models_async`] using a one-shot tokio runtime.
pub fn list_models(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    tokio::runtime::Handle::try_current()
        .map_err(|_| {
            InvokerError::Execute(
                "list_models requires a tokio runtime; use list_models_async instead"
                    .to_string()
                    .into(),
            )
        })
        .and_then(|_| futures::executor::block_on(list_models_async(connection)))
        .or_else(|_| {
            let rt = tokio::runtime::Runtime::new().map_err(|e| {
                InvokerError::Execute(format!("Failed to create tokio runtime: {e}").into())
            })?;
            rt.block_on(list_models_async(connection))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_models_url_default() {
        let conn = serde_json::json!({});
        let url = build_models_url(&conn);
        assert_eq!(url, "https://api.anthropic.com/v1/models");
    }

    #[test]
    fn test_build_models_url_custom_endpoint() {
        let conn = serde_json::json!({
            "endpoint": "https://custom.anthropic.com/"
        });
        let url = build_models_url(&conn);
        assert_eq!(url, "https://custom.anthropic.com/v1/models");
    }

    #[test]
    fn test_get_api_key_from_connection() {
        let conn = serde_json::json!({
            "apiKey": "sk-ant-test"
        });
        let key = get_api_key(&conn).unwrap();
        assert_eq!(key, "sk-ant-test");
    }

    #[test]
    fn test_get_api_key_missing() {
        // Safety: test-only env manipulation
        unsafe { std::env::remove_var("ANTHROPIC_API_KEY") };
        let conn = serde_json::json!({});
        let result = get_api_key(&conn);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_model_with_all_fields() {
        let obj = serde_json::json!({
            "id": "claude-sonnet-4-20250514",
            "display_name": "Claude Sonnet 4",
            "context_length": 200000,
            "input_modalities": ["text", "image"],
            "output_modalities": ["text"],
            "type": "model"
        });
        let info = parse_model_object(&obj);
        assert_eq!(info.id, "claude-sonnet-4-20250514");
        assert_eq!(info.display_name.as_deref(), Some("Claude Sonnet 4"));
        assert_eq!(info.owned_by.as_deref(), Some("anthropic"));
        assert_eq!(info.context_window, Some(200_000));
        assert_eq!(
            info.input_modalities.as_deref(),
            Some(vec!["text".to_string(), "image".to_string()].as_slice())
        );
        assert_eq!(
            info.output_modalities.as_deref(),
            Some(vec!["text".to_string()].as_slice())
        );
    }

    #[test]
    fn test_parse_model_minimal() {
        let obj = serde_json::json!({
            "id": "claude-3-haiku-20240307",
            "type": "model"
        });
        let info = parse_model_object(&obj);
        assert_eq!(info.id, "claude-3-haiku-20240307");
        assert_eq!(info.owned_by.as_deref(), Some("anthropic"));
        assert!(info.context_window.is_none());
        assert!(info.input_modalities.is_none());
    }

    #[test]
    fn test_parse_model_empty() {
        let obj = serde_json::json!({});
        let info = parse_model_object(&obj);
        assert_eq!(info.id, "");
        assert!(info.display_name.is_none());
    }
}
