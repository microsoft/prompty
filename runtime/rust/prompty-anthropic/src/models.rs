//! Model discovery for Anthropic.
//!
//! Loads each `GET /v1/models` page through Typra-generated wire models,
//! then converts each entry to the provider-neutral [`ModelInfo`] shape.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::{
    AnthropicModelInfo, AnthropicModelsResponse, LoadContext, ModelInfo, ModelLister, SaveContext,
};
use serde_json::Value;

/// Shared HTTP client for model discovery requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Anthropic implementation of the Typra-generated model discovery protocol.
#[derive(Debug, Clone, Copy, Default)]
pub struct AnthropicModelLister;

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

fn validate_connection_kind(connection: &Value) -> Result<(), InvokerError> {
    let kind = connection.get("kind").and_then(Value::as_str).unwrap_or("");
    if kind == "key" {
        return Ok(());
    }
    Err(InvokerError::Execute(
        format!(
            "Connection kind '{kind}' is not supported for Anthropic model listing. Use 'key'."
        )
        .into(),
    ))
}

/// Convert one typed Anthropic model into a provider-neutral `ModelInfo`.
fn to_model_info(model: AnthropicModelInfo) -> ModelInfo {
    let additional_properties = model.to_value(&SaveContext::default());

    ModelInfo {
        id: model.id,
        display_name: model.display_name,
        owned_by: Some("anthropic".to_string()),
        context_window: model.context_length,
        input_modalities: model.input_modalities,
        output_modalities: model.output_modalities,
        additional_properties,
    }
}

/// List models available from the Anthropic API (async).
///
/// Calls `GET /v1/models` with pagination and aggregates all results.
pub async fn list_models_async(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    validate_connection_kind(connection)?;
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

        let response = AnthropicModelsResponse::load_from_value(&body, &LoadContext::default());
        all_models.extend(response.data.into_iter().map(to_model_info));

        if !response.has_more.unwrap_or(false) {
            break;
        }

        after_id = response.last_id;
        if after_id.is_none() {
            break;
        }
    }

    Ok(all_models)
}

#[async_trait::async_trait]
impl ModelLister for AnthropicModelLister {
    async fn list_models(
        &self,
        connection: &Value,
    ) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
        list_models_async(connection)
            .await
            .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)
    }
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
    #[serial]
    fn test_get_api_key_missing() {
        let _env = RemovedEnv::new("ANTHROPIC_API_KEY");
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
        assert_model_lister::<AnthropicModelLister>();
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
        let model = AnthropicModelInfo::load_from_value(&obj, &LoadContext::default());
        let info = to_model_info(model);
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
        assert_eq!(info.additional_properties["type"], "model");
    }

    #[test]
    fn test_parse_model_minimal() {
        let obj = serde_json::json!({
            "id": "claude-3-haiku-20240307",
            "type": "model"
        });
        let model = AnthropicModelInfo::load_from_value(&obj, &LoadContext::default());
        let info = to_model_info(model);
        assert_eq!(info.id, "claude-3-haiku-20240307");
        assert_eq!(info.owned_by.as_deref(), Some("anthropic"));
        assert!(info.context_window.is_none());
        assert!(info.input_modalities.is_none());
    }

    #[test]
    fn test_parse_model_empty() {
        let obj = serde_json::json!({});
        let model = AnthropicModelInfo::load_from_value(&obj, &LoadContext::default());
        let info = to_model_info(model);
        assert_eq!(info.id, "");
        assert!(info.display_name.is_none());
    }

    #[tokio::test]
    async fn test_list_models_sends_anthropic_headers_and_loads_typed_response() {
        let body = r#"{"data":[{"id":"claude-sonnet-4-20250514","display_name":"Claude Sonnet 4","created_at":"2025-05-14T00:00:00Z","type":"model"}],"first_id":"claude-sonnet-4-20250514","has_more":false,"last_id":"claude-sonnet-4-20250514"}"#;
        let (endpoint, request) = spawn_model_server(body).await;
        let models = list_models_async(&serde_json::json!({
            "kind": "key",
            "endpoint": endpoint,
            "apiKey": "test-anthropic-key"
        }))
        .await
        .unwrap();

        let request = request.await.unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /v1/models?limit=100 "));
        assert!(request.contains("x-api-key: test-anthropic-key"));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].display_name.as_deref(), Some("Claude Sonnet 4"));
        assert_eq!(
            models[0].additional_properties["created_at"],
            "2025-05-14T00:00:00Z"
        );
    }
}
