//! Model discovery for OpenAI.
//!
//! Loads the `GET /v1/models` response through Typra-generated wire models,
//! then converts each entry to the provider-neutral [`ModelInfo`] shape.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::{
    LoadContext, ModelInfo, ModelLister, OpenAIModelInfo, OpenAIModelsResponse, SaveContext,
};
use serde_json::Value;

/// Shared HTTP client for model discovery requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// OpenAI implementation of the Typra-generated model discovery protocol.
#[derive(Debug, Clone, Copy, Default)]
pub struct OpenAIModelLister;

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

fn validate_connection_kind(connection: &Value) -> Result<(), InvokerError> {
    let kind = connection.get("kind").and_then(Value::as_str).unwrap_or("");
    if kind == "key" {
        return Ok(());
    }
    Err(InvokerError::Execute(
        format!("Connection kind '{kind}' is not supported for OpenAI model listing. Use 'key'.")
            .into(),
    ))
}

/// Convert one typed OpenAI model into a provider-neutral `ModelInfo`.
fn to_model_info(model: OpenAIModelInfo) -> ModelInfo {
    let known = find_known(&model.id);
    let additional_properties = model.to_value(&SaveContext::default());

    ModelInfo {
        id: model.id,
        display_name: None,
        owned_by: model.owned_by,
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
        additional_properties,
    }
}

/// List models available from the OpenAI API (async).
///
/// Calls `GET /v1/models` and enriches the response with known model metadata
/// (context window, modalities) from a built-in lookup table.
pub async fn list_models_async(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    validate_connection_kind(connection)?;
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

    let response = OpenAIModelsResponse::load_from_value(&body, &LoadContext::default());
    Ok(response.data.into_iter().map(to_model_info).collect())
}

#[async_trait::async_trait]
impl ModelLister for OpenAIModelLister {
    async fn list_models(
        &self,
        connection: &Value,
    ) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
        list_models_async(connection)
            .await
            .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)
    }
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
    use serial_test::serial;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    struct RemovedEnv {
        name: &'static str,
        previous: Option<String>,
    }

    impl RemovedEnv {
        fn new(name: &'static str) -> Self {
            let previous = std::env::var(name).ok();
            // SAFETY: Tests that mutate provider environment variables are serialized.
            unsafe { std::env::remove_var(name) };
            Self { name, previous }
        }
    }

    impl Drop for RemovedEnv {
        fn drop(&mut self) {
            if let Some(value) = &self.previous {
                // SAFETY: Tests that mutate provider environment variables are serialized.
                unsafe { std::env::set_var(self.name, value) };
            }
        }
    }

    async fn spawn_model_server(body: &'static str) -> (String, oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (request_tx, request_rx) = oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let size = stream.read(&mut request).await.unwrap();
            request.truncate(size);
            request_tx
                .send(String::from_utf8(request).unwrap())
                .unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        (format!("http://{address}"), request_rx)
    }

    #[test]
    #[serial]
    fn test_build_models_url_default() {
        let conn = serde_json::json!({});
        let _env = RemovedEnv::new("OPENAI_BASE_URL");
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
    #[serial]
    fn test_get_api_key_missing() {
        let _env = RemovedEnv::new("OPENAI_API_KEY");
        let conn = serde_json::json!({});
        let result = get_api_key(&conn);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_connection_kind() {
        assert!(validate_connection_kind(&serde_json::json!({"kind": "key"})).is_ok());
        let error =
            validate_connection_kind(&serde_json::json!({"kind": "reference"})).unwrap_err();
        assert!(error.to_string().contains("not supported"));
    }

    #[test]
    fn test_model_lister_implements_generated_protocol() {
        fn assert_model_lister<T: ModelLister>() {}
        assert_model_lister::<OpenAIModelLister>();
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
        let model = OpenAIModelInfo::load_from_value(&obj, &LoadContext::default());
        let info = to_model_info(model);
        assert_eq!(info.id, "gpt-4o");
        assert_eq!(info.owned_by.as_deref(), Some("openai"));
        assert_eq!(info.context_window, Some(128_000));
        assert_eq!(
            info.input_modalities.as_deref(),
            Some(vec!["text".to_string(), "image".to_string()].as_slice())
        );
        assert_eq!(info.additional_properties["object"], "model");
    }

    #[test]
    fn test_parse_model_object_unknown() {
        let obj = serde_json::json!({
            "id": "ft:custom:user-123",
            "owned_by": "user-123"
        });
        let model = OpenAIModelInfo::load_from_value(&obj, &LoadContext::default());
        let info = to_model_info(model);
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
        let model = OpenAIModelInfo::load_from_value(&obj, &LoadContext::default());
        let info = to_model_info(model);
        assert_eq!(info.context_window, Some(8_191));
        assert_eq!(
            info.output_modalities.as_deref(),
            Some(Vec::<String>::new().as_slice())
        );
    }

    #[tokio::test]
    async fn test_list_models_sends_bearer_auth_and_loads_typed_response() {
        let body = r#"{"object":"list","data":[{"id":"gpt-4o","object":"model","created":1715367049,"owned_by":"openai"}]}"#;
        let (endpoint, request) = spawn_model_server(body).await;
        let models = list_models_async(&serde_json::json!({
            "kind": "key",
            "endpoint": endpoint,
            "apiKey": "test-openai-key"
        }))
        .await
        .unwrap();

        let request = request.await.unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /v1/models "));
        assert!(request.contains("authorization: bearer test-openai-key"));
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-4o");
        assert_eq!(models[0].additional_properties["created"], 1_715_367_049);
    }
}
