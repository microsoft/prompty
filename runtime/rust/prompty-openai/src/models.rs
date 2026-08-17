//! Model discovery for OpenAI.
//!
//! Maps the provider response into the Typra-generated, provider-neutral
//! [`ModelInfo`] contract.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::{ModelInfo, ModelLister};
use serde_json::Value;

/// Shared HTTP client for model discovery requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// OpenAI implementation of the Typra-generated model discovery protocol.
#[derive(Debug, Clone, Copy, Default)]
pub struct OpenAIModelLister;

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

/// Convert one OpenAI model payload into the generated provider-neutral contract.
///
/// OpenAI's `/v1/models` returns only `id`/`owned_by`, so capability fields are
/// filled from the shared `spec/data/model_capabilities.json` dataset via
/// [`prompty::discovery::enrich`]. That primitive applies the cross-runtime
/// fill-only-missing rule: any field OpenAI *did* supply is preserved.
fn to_model_info(model: &Value) -> ModelInfo {
    let id = model
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut info = ModelInfo {
        id,
        display_name: None,
        owned_by: model
            .get("owned_by")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        context_window: None,
        input_modalities: None,
        output_modalities: None,
        additional_properties: model.clone(),
    };

    prompty::discovery::enrich("openai", &mut info);
    info
}

/// Map one raw OpenAI `/v1/models` entry into the provider-neutral
/// [`ModelInfo`] contract.
///
/// This is the single source of truth for the OpenAI wire → `ModelInfo`
/// mapping and is exercised by the generated `vectors.json` (mapModel operation) so
/// every runtime converges on the same canonical shape. Enrichment from the
/// built-in known-model table is applied here but is provider-optional per the
/// `ModelInfo` contract, so discovery vectors deliberately use ids outside that
/// table to assert the pure wire mapping.
pub fn model_info_from_wire(raw: &Value) -> ModelInfo {
    to_model_info(raw)
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

    Ok(body
        .get("data")
        .and_then(Value::as_array)
        .map(|models| models.iter().map(to_model_info).collect())
        .unwrap_or_default())
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
    fn test_shared_dataset_lookup_gpt4o() {
        let caps = prompty::discovery::lookup("openai", "gpt-4o").unwrap();
        assert_eq!(caps.context_window, Some(128_000));
        assert_eq!(
            caps.input_modalities.as_deref(),
            Some(["text".to_string(), "image".to_string()].as_slice())
        );
    }

    #[test]
    fn test_shared_dataset_lookup_gpt4o_mini() {
        // "gpt-4o-mini" should match the gpt-4o-mini entry (longest prefix first).
        let caps = prompty::discovery::lookup("openai", "gpt-4o-mini-2024-07-18").unwrap();
        assert_eq!(caps.context_window, Some(128_000));
        assert_eq!(
            caps.output_modalities.as_deref(),
            Some(["text".to_string()].as_slice())
        );
    }

    #[test]
    fn test_shared_dataset_lookup_gpt4() {
        let caps = prompty::discovery::lookup("openai", "gpt-4-0613").unwrap();
        assert_eq!(caps.context_window, Some(8_192));
        assert_eq!(
            caps.input_modalities.as_deref(),
            Some(["text".to_string()].as_slice())
        );
    }

    #[test]
    fn test_shared_dataset_lookup_dalle3() {
        let caps = prompty::discovery::lookup("openai", "dall-e-3").unwrap();
        assert!(caps.context_window.is_none());
        assert_eq!(
            caps.output_modalities.as_deref(),
            Some(["image".to_string()].as_slice())
        );
    }

    #[test]
    fn test_shared_dataset_lookup_unknown_model() {
        assert!(prompty::discovery::lookup("openai", "some-custom-model").is_none());
    }

    #[test]
    fn test_parse_model_object_known() {
        let obj = serde_json::json!({
            "id": "gpt-4o",
            "owned_by": "openai",
            "object": "model"
        });
        let info = to_model_info(&obj);
        assert_eq!(info.id, "gpt-4o");
        assert_eq!(info.owned_by.as_deref(), Some("openai"));
        assert_eq!(info.context_window, Some(128_000));
        assert_eq!(
            info.input_modalities.as_deref(),
            Some(vec!["text".to_string(), "image".to_string()].as_slice())
        );
        assert_eq!(info.additional_properties["object"], "model");
        assert_eq!(info.to_wire("openai")["owned_by"], "openai");
    }

    #[test]
    fn test_parse_model_object_unknown() {
        let obj = serde_json::json!({
            "id": "ft:custom:user-123",
            "owned_by": "user-123"
        });
        let info = to_model_info(&obj);
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
        let info = to_model_info(&obj);
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
