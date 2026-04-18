//! Model discovery for OpenAI — calls `GET /v1/models` and enriches results
//! with known context-window and modality data.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::ModelInfo;
use serde_json::Value;

/// Shared HTTP client — reuses the same pool as the executor.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Known model metadata for enrichment when the API doesn't provide these fields.
struct KnownModel {
    prefix: &'static str,
    context_window: Option<i32>,
    input_modalities: &'static [&'static str],
    output_modalities: &'static [&'static str],
}

static KNOWN_MODELS: &[KnownModel] = &[
    KnownModel {
        prefix: "gpt-4o-mini",
        context_window: Some(128_000),
        input_modalities: &["text", "image"],
        output_modalities: &["text"],
    },
    KnownModel {
        prefix: "gpt-4o",
        context_window: Some(128_000),
        input_modalities: &["text", "image"],
        output_modalities: &["text"],
    },
    KnownModel {
        prefix: "gpt-4-turbo",
        context_window: Some(128_000),
        input_modalities: &["text", "image"],
        output_modalities: &["text"],
    },
    KnownModel {
        prefix: "gpt-4",
        context_window: Some(8_192),
        input_modalities: &["text"],
        output_modalities: &["text"],
    },
    KnownModel {
        prefix: "gpt-3.5-turbo",
        context_window: Some(16_385),
        input_modalities: &["text"],
        output_modalities: &["text"],
    },
    KnownModel {
        prefix: "text-embedding-3-small",
        context_window: Some(8_191),
        input_modalities: &["text"],
        output_modalities: &[],
    },
    KnownModel {
        prefix: "text-embedding-3-large",
        context_window: Some(8_191),
        input_modalities: &["text"],
        output_modalities: &[],
    },
    KnownModel {
        prefix: "dall-e-3",
        context_window: None,
        input_modalities: &["text"],
        output_modalities: &["image"],
    },
];

/// Look up a known model entry by prefix match (longest prefix first since
/// the table is ordered from most-specific to least-specific).
fn find_known(id: &str) -> Option<&'static KnownModel> {
    KNOWN_MODELS.iter().find(|km| id.starts_with(km.prefix))
}

/// Build the models endpoint URL from a connection JSON value.
fn build_models_url(connection: &Value) -> String {
    let endpoint = connection
        .get("endpoint")
        .and_then(|e| e.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            std::env::var("OPENAI_BASE_URL")
                .ok()
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "https://api.openai.com".to_string());

    let base = endpoint.trim_end_matches('/');

    let path = "/v1/models";
    let adjusted = if base.ends_with("/v1") || base.ends_with("/v1/") {
        path.strip_prefix("/v1").unwrap_or(path)
    } else {
        path
    };

    format!("{base}{adjusted}")
}

/// Extract the API key from the connection or fall back to `OPENAI_API_KEY`.
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

    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(key);
        }
    }

    Err(InvokerError::Execute(
        "No API key found. Set OPENAI_API_KEY or configure connection.apiKey"
            .to_string()
            .into(),
    ))
}

/// Convert one API model object into a `ModelInfo`, enriching from `KNOWN_MODELS`.
fn parse_model_object(obj: &Value) -> ModelInfo {
    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let owned_by = obj
        .get("owned_by")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let known = find_known(&id);

    ModelInfo {
        id,
        display_name: None,
        owned_by,
        context_window: known.and_then(|k| k.context_window),
        input_modalities: known.map(|k| {
            k.input_modalities
                .iter()
                .map(|s| (*s).to_string())
                .collect()
        }),
        output_modalities: known.map(|k| {
            k.output_modalities
                .iter()
                .map(|s| (*s).to_string())
                .collect()
        }),
        additional_properties: serde_json::Value::Null,
    }
}

/// List models available from the OpenAI API (async).
///
/// Calls `GET /v1/models` and enriches the response with known model metadata
/// (context window, modalities) from a built-in lookup table.
pub async fn list_models_async(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    let url = build_models_url(connection);
    let api_key = get_api_key(connection)?;

    let client = &*HTTP_CLIENT;
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
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
            format!("OpenAI list models error (HTTP {status}): {body_text}").into(),
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;

    let models = body
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| arr.iter().map(parse_model_object).collect())
        .unwrap_or_default();

    Ok(models)
}

/// List models available from the OpenAI API (blocking).
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
        .and_then(|_| {
            // We're inside a runtime but can't block_on from async context.
            // Use futures::executor for the sync wrapper.
            futures::executor::block_on(list_models_async(connection))
        })
        .or_else(|_| {
            // No runtime — create a temporary one.
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
        // Clear env to test default
        let _prev = std::env::var("OPENAI_BASE_URL").ok();
        // Safety: test-only env manipulation
        unsafe { std::env::remove_var("OPENAI_BASE_URL") };
        let url = build_models_url(&conn);
        assert_eq!(url, "https://api.openai.com/v1/models");
    }

    #[test]
    fn test_build_models_url_custom_endpoint() {
        let conn = serde_json::json!({
            "endpoint": "https://custom.openai.com/"
        });
        let url = build_models_url(&conn);
        assert_eq!(url, "https://custom.openai.com/v1/models");
    }

    #[test]
    fn test_build_models_url_with_v1_suffix() {
        let conn = serde_json::json!({
            "endpoint": "https://proxy.example.com/openai/v1"
        });
        let url = build_models_url(&conn);
        assert_eq!(url, "https://proxy.example.com/openai/v1/models");
    }

    #[test]
    fn test_get_api_key_from_connection() {
        let conn = serde_json::json!({
            "apiKey": "sk-from-conn"
        });
        let key = get_api_key(&conn).unwrap();
        assert_eq!(key, "sk-from-conn");
    }

    #[test]
    fn test_get_api_key_missing() {
        // Safety: test-only env manipulation
        unsafe { std::env::remove_var("OPENAI_API_KEY") };
        let conn = serde_json::json!({});
        let result = get_api_key(&conn);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_known_gpt4o() {
        let km = find_known("gpt-4o").unwrap();
        assert_eq!(km.context_window, Some(128_000));
        assert_eq!(km.input_modalities, &["text", "image"]);
    }

    #[test]
    fn test_find_known_gpt4o_mini() {
        // "gpt-4o-mini" should match the gpt-4o-mini entry (before gpt-4o)
        let km = find_known("gpt-4o-mini-2024-07-18").unwrap();
        assert_eq!(km.context_window, Some(128_000));
        assert_eq!(km.prefix, "gpt-4o-mini");
    }

    #[test]
    fn test_find_known_gpt4() {
        let km = find_known("gpt-4-0613").unwrap();
        assert_eq!(km.context_window, Some(8_192));
        assert_eq!(km.input_modalities, &["text"]);
    }

    #[test]
    fn test_find_known_dalle3() {
        let km = find_known("dall-e-3").unwrap();
        assert!(km.context_window.is_none());
        assert_eq!(km.output_modalities, &["image"]);
    }

    #[test]
    fn test_find_known_unknown_model() {
        assert!(find_known("some-custom-model").is_none());
    }

    #[test]
    fn test_parse_model_object_known() {
        let obj = serde_json::json!({
            "id": "gpt-4o",
            "owned_by": "openai",
            "object": "model"
        });
        let info = parse_model_object(&obj);
        assert_eq!(info.id, "gpt-4o");
        assert_eq!(info.owned_by.as_deref(), Some("openai"));
        assert_eq!(info.context_window, Some(128_000));
        assert_eq!(
            info.input_modalities.as_deref(),
            Some(vec!["text".to_string(), "image".to_string()].as_slice())
        );
    }

    #[test]
    fn test_parse_model_object_unknown() {
        let obj = serde_json::json!({
            "id": "ft:custom:user-123",
            "owned_by": "user-123"
        });
        let info = parse_model_object(&obj);
        assert_eq!(info.id, "ft:custom:user-123");
        assert!(info.context_window.is_none());
        assert!(info.input_modalities.is_none());
    }

    #[test]
    fn test_parse_model_object_embedding() {
        let obj = serde_json::json!({
            "id": "text-embedding-3-small",
            "owned_by": "openai"
        });
        let info = parse_model_object(&obj);
        assert_eq!(info.context_window, Some(8_191));
        assert_eq!(
            info.output_modalities.as_deref(),
            Some(Vec::<String>::new().as_slice())
        );
    }
}
