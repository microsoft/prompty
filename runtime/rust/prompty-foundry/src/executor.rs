//! Foundry/Azure OpenAI executor — sends requests to Azure OpenAI endpoints.
//!
//! Reuses OpenAI wire format helpers from `prompty-openai`, but constructs
//! Azure-specific URLs and uses Azure authentication (API key with `api-key`
//! header, or Foundry connection for Entra ID).

use async_trait::async_trait;
use serde_json::Value;
use std::sync::LazyLock;

use prompty::interfaces::{Executor, InvokerError};
use prompty::model::Prompty;
use prompty::types::Message;

use prompty_openai::wire;

/// Shared HTTP client — reuses connection pool across requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Default Azure OpenAI API version.
const DEFAULT_API_VERSION: &str = "2025-04-01-preview";

/// Foundry/Azure OpenAI executor implementing the `Executor` trait.
///
/// Supports two connection kinds:
/// - `ApiKey`: Uses the `api-key` header for authentication
/// - `Foundry`: Uses the Foundry endpoint (Entra ID auth, when available)
///
/// Falls back to API key auth when no explicit connection is configured.
pub struct FoundryExecutor;

#[async_trait]
impl Executor for FoundryExecutor {
    async fn execute(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<Value, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");

        let body = match api_type {
            "chat" | "agent" => wire::build_chat_args(agent, messages),
            "embedding" => wire::build_embedding_args(agent, messages),
            "image" => wire::build_image_args(agent, messages),
            other => {
                return Err(InvokerError::Execute(
                    format!("Unsupported apiType: {other}").into(),
                ));
            }
        };

        let (url, auth_header) = build_azure_request(agent, api_type).await?;

        let client = &*HTTP_CLIENT;
        let response = client
            .post(&url)
            .header(auth_header.0, auth_header.1)
            .header("Content-Type", "application/json")
            .json(&body)
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
                format!("Azure OpenAI API error (HTTP {status}): {body_text}").into(),
            ));
        }

        let result: Value = response
            .json()
            .await
            .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;

        Ok(result)
    }

    fn format_tool_messages(
        &self,
        _raw_response: &Value,
        tool_calls: &[prompty::types::ToolCall],
        tool_results: &[String],
        _text_content: Option<&str>,
    ) -> Vec<Message> {
        wire::format_tool_messages(tool_calls, tool_results)
    }

    async fn execute_stream(
        &self,
        agent: &Prompty,
        messages: &[Message],
    ) -> Result<std::pin::Pin<Box<dyn futures::Stream<Item = Value> + Send>>, InvokerError> {
        let api_type = agent.model.api_type.as_deref().unwrap_or("chat");
        if api_type != "chat" && api_type != "agent" {
            return Err(InvokerError::Execute(
                format!("Foundry streaming only supports apiType 'chat', got: {api_type}").into(),
            ));
        }

        let mut body = wire::build_chat_args(agent, messages);
        // Force stream: true
        if let Some(obj) = body.as_object_mut() {
            obj.insert("stream".into(), Value::Bool(true));
        }

        let (url, auth_header) = build_azure_request(agent, api_type).await?;

        let client = &*HTTP_CLIENT;
        let response = client
            .post(&url)
            .header(auth_header.0, auth_header.1)
            .header("Content-Type", "application/json")
            .json(&body)
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
                format!("Azure OpenAI API error (HTTP {status}): {body_text}").into(),
            ));
        }

        // Reuse OpenAI SSE parser — Azure uses the same SSE format
        let byte_stream = response.bytes_stream();
        Ok(Box::pin(FoundrySseParser::new(byte_stream)))
    }
}

// ---------------------------------------------------------------------------
// URL construction and auth
// ---------------------------------------------------------------------------

/// Resolve the effective connection — if `kind == "reference"`, look up the
/// named connection from the registry. Otherwise return the connection as-is.
fn resolve_connection(agent: &Prompty) -> Result<std::borrow::Cow<'_, serde_json::Value>, InvokerError> {
    let conn = &agent.model.connection;
    let kind = conn.get("kind").and_then(|k| k.as_str()).unwrap_or("");

    if kind == "reference" {
        let name = conn
            .get("name")
            .and_then(|n| n.as_str())
            .ok_or_else(|| {
                InvokerError::Execute(
                    "Reference connection missing 'name' field".to_string().into(),
                )
            })?;

        let resolved = prompty::connections::with_connection::<serde_json::Value, _>(name, |c| c.clone())
            .map_err(|e| InvokerError::Execute(e.into()))?;

        Ok(std::borrow::Cow::Owned(resolved))
    } else {
        Ok(std::borrow::Cow::Borrowed(conn))
    }
}

/// Returns `(url, (header_name, header_value))` for the Azure OpenAI request.
async fn build_azure_request(
    agent: &Prompty,
    api_type: &str,
) -> Result<(String, (&'static str, String)), InvokerError> {
    let endpoint = get_endpoint(agent)?;
    let deployment = get_deployment(agent)?;

    let path = match api_type {
        "chat" | "agent" => "chat/completions",
        "embedding" => "embeddings",
        "image" => "images/generations",
        other => {
            return Err(InvokerError::Execute(
                format!("Unsupported apiType for Azure: {other}").into(),
            ));
        }
    };

    let api_version = get_api_version(agent);
    let url = format!(
        "{}/openai/deployments/{}/{}?api-version={}",
        endpoint.trim_end_matches('/'),
        deployment,
        path,
        api_version,
    );

    let auth_header = get_auth_header(agent).await?;

    Ok((url, auth_header))
}

/// Extract the endpoint URL from the agent's connection configuration.
fn get_endpoint(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = resolve_connection(agent)?;
    let kind = conn.get("kind").and_then(|v| v.as_str()).unwrap_or("");

    // Check typed endpoint field
    if let Some(ep) = conn.get("endpoint").and_then(|v| v.as_str()) {
        if !ep.is_empty() {
            return match kind {
                "foundry" => Ok(strip_project_path(ep)),
                _ => Ok(ep.to_string()),
            };
        }
    }

    // Fall back to environment variable
    if let Ok(ep) = std::env::var("AZURE_OPENAI_ENDPOINT") {
        if !ep.is_empty() {
            return Ok(ep);
        }
    }

    Err(InvokerError::Execute(
        "No Azure OpenAI endpoint found. Set AZURE_OPENAI_ENDPOINT or configure model.connection.endpoint"
            .to_string()
            .into(),
    ))
}

/// Strip Foundry project path to get the resource endpoint.
///
/// Foundry endpoints look like `https://resource.services.ai.azure.com/api/projects/project-name`
/// but the OpenAI API needs just `https://resource.services.ai.azure.com`.
fn strip_project_path(endpoint: &str) -> String {
    if let Some(idx) = endpoint.find("/api/projects") {
        endpoint[..idx].to_string()
    } else {
        endpoint.to_string()
    }
}

/// Extract the deployment name from the agent's model configuration.
fn get_deployment(agent: &Prompty) -> Result<String, InvokerError> {
    // model.id is the deployment name for Azure
    if !agent.model.id.is_empty() {
        return Ok(agent.model.id.clone());
    }

    // Fall back to environment variable
    if let Ok(deployment) = std::env::var("AZURE_OPENAI_DEPLOYMENT") {
        if !deployment.is_empty() {
            return Ok(deployment);
        }
    }

    Err(InvokerError::Execute(
        "No deployment name found. Set model.id or AZURE_OPENAI_DEPLOYMENT".to_string().into(),
    ))
}

/// Get the API version, defaulting to the latest preview.
fn get_api_version(agent: &Prompty) -> String {
    // Check model options for custom api version
    if let Some(opts) = &agent.model.options {
        if let Some(version) = opts.additional_properties.get("apiVersion").and_then(|v| v.as_str()) {
            return version.to_string();
        }
    }

    DEFAULT_API_VERSION.to_string()
}

/// Get the authentication header for the request.
///
/// Returns `(header_name, header_value)`:
/// - API key auth: `("api-key", key)` — Azure uses `api-key` header, not `Authorization: Bearer`
/// - Foundry (Entra ID): `("Authorization", "Bearer <token>")` — requires `entra_id` feature
async fn get_auth_header(agent: &Prompty) -> Result<(&'static str, String), InvokerError> {
    let conn = resolve_connection(agent)?;
    let kind = conn.get("kind").and_then(|k| k.as_str()).unwrap_or("");

    // Try connection-level API key
    if let Some(key) = conn
        .get("apiKey")
        .or(conn.get("api_key"))
        .and_then(|k| k.as_str())
    {
        if !key.is_empty() {
            return Ok(("api-key", key.to_string()));
        }
    }

    // Fall back to environment variable (works for both key and foundry connections)
    if let Ok(key) = std::env::var("AZURE_OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(("api-key", key));
        }
    }

    // Foundry connection without API key — use Entra ID / DefaultAzureCredential
    if kind == "foundry" {
        return get_entra_token().await;
    }

    Err(InvokerError::Execute(
        "No Azure API key found. Set AZURE_OPENAI_API_KEY or configure model.connection.apiKey"
            .to_string()
            .into(),
    ))
}

/// Azure Cognitive Services scope for Entra ID tokens.
#[cfg(feature = "entra_id")]
const AZURE_COGNITIVE_SCOPE: &str = "https://cognitiveservices.azure.com/.default";

/// Get a bearer token via DefaultAzureCredential (requires `entra_id` feature).
#[cfg(feature = "entra_id")]
async fn get_entra_token() -> Result<(&'static str, String), InvokerError> {
    use azure_identity::DefaultAzureCredential;
    use azure_core::credentials::TokenCredential;

    let credential = DefaultAzureCredential::new()
        .map_err(|e| InvokerError::Execute(format!("Failed to create DefaultAzureCredential: {e}").into()))?;
    let token = credential
        .get_token(&[AZURE_COGNITIVE_SCOPE])
        .await
        .map_err(|e| InvokerError::Execute(format!("Failed to acquire Entra ID token: {e}").into()))?;
    Ok(("Authorization", format!("Bearer {}", token.token.secret())))
}

/// Stub when the `entra_id` feature is not enabled.
#[cfg(not(feature = "entra_id"))]
async fn get_entra_token() -> Result<(&'static str, String), InvokerError> {
    Err(InvokerError::Execute(
        "Foundry connection requires Entra ID auth. Enable the 'entra_id' feature on prompty-foundry, \
         or provide an API key in model.connection.apiKey"
            .to_string()
            .into(),
    ))
}

// ---------------------------------------------------------------------------
// SSE stream parser — same OpenAI SSE format, copied for crate boundaries
// ---------------------------------------------------------------------------

use std::collections::VecDeque;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use futures::Stream;

/// SSE parser for Azure OpenAI (same format as OpenAI).
struct FoundrySseParser {
    inner: Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>,
    buffer: String,
    pending: VecDeque<Value>,
    done: bool,
}

impl FoundrySseParser {
    fn new(inner: impl Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static) -> Self {
        Self {
            inner: Box::pin(inner),
            buffer: String::new(),
            pending: VecDeque::new(),
            done: false,
        }
    }

    fn parse_buffer(&mut self) {
        while let Some(pos) = self.buffer.find("\n\n") {
            let event = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 2..].to_string();

            for line in event.lines() {
                if let Some(data) = line.strip_prefix("data: ").or_else(|| line.strip_prefix("data:")) {
                    let data = data.trim();
                    if data == "[DONE]" {
                        self.done = true;
                        return;
                    }
                    match serde_json::from_str::<Value>(data) {
                        Ok(parsed) => self.pending.push_back(parsed),
                        Err(e) => {
                            self.pending.push_back(serde_json::json!({
                                "error": {
                                    "type": "sse_parse_error",
                                    "message": format!("Failed to parse SSE data: {e}"),
                                    "raw": data,
                                }
                            }));
                        }
                    }
                }
            }
        }
    }
}

impl Stream for FoundrySseParser {
    type Item = Value;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            if let Some(item) = self.pending.pop_front() {
                return Poll::Ready(Some(item));
            }
            if self.done {
                return Poll::Ready(None);
            }

            match self.inner.as_mut().poll_next(cx) {
                Poll::Ready(Some(Ok(bytes))) => {
                    match std::str::from_utf8(&bytes) {
                        Ok(text) => self.buffer.push_str(text),
                        Err(e) => {
                            self.pending.push_back(serde_json::json!({
                                "error": {
                                    "type": "sse_decode_error",
                                    "message": format!("Invalid UTF-8 in SSE stream: {e}"),
                                }
                            }));
                        }
                    }
                    self.parse_buffer();
                }
                Poll::Ready(Some(Err(e))) => {
                    self.pending.push_back(serde_json::json!({
                        "error": {
                            "type": "sse_transport_error",
                            "message": format!("SSE stream error: {e}"),
                        }
                    }));
                    self.done = true;
                    if let Some(item) = self.pending.pop_front() {
                        return Poll::Ready(Some(item));
                    }
                    return Poll::Ready(None);
                }
                Poll::Ready(None) => {
                    self.done = true;
                    return Poll::Ready(None);
                }
                Poll::Pending => {
                    return Poll::Pending;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prompty::model::context::LoadContext;
    use serde_json::json;

    fn make_agent(model_json: Value) -> Prompty {
        let mut data = json!({
            "name": "test",
            "kind": "prompt",
            "model": model_json,
        });
        data["instructions"] = json!("test");
        Prompty::load_from_value(&data, &LoadContext::default())
    }

    #[tokio::test]
    async fn test_build_url_api_key_connection() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let (url, _) = build_azure_request(&agent, "chat").await.unwrap();
        assert!(url.starts_with("https://myresource.openai.azure.com/openai/deployments/gpt-4/chat/completions"));
        assert!(url.contains("api-version="));
    }

    #[tokio::test]
    async fn test_build_url_foundry_connection() {
        // Foundry connections typically use Entra ID, but for testing we
        // supply an API key via env var since Entra ID may not be enabled
        // SAFETY: tests run single-threaded (--test-threads=1) so env var mutation is safe
        unsafe { std::env::set_var("AZURE_OPENAI_API_KEY", "test-foundry-key") };
        let agent = make_agent(json!({
            "id": "gpt-4o",
            "connection": {
                "kind": "foundry",
                "endpoint": "https://myresource.services.ai.azure.com/api/projects/my-project",
                "name": "my-conn"
            }
        }));
        let (url, _) = build_azure_request(&agent, "chat").await.unwrap();
        // Foundry endpoint should strip the project path
        assert!(url.starts_with("https://myresource.services.ai.azure.com/openai/deployments/gpt-4o/chat/completions"));
        unsafe { std::env::remove_var("AZURE_OPENAI_API_KEY") };
    }

    #[tokio::test]
    async fn test_build_url_embedding() {
        let agent = make_agent(json!({
            "id": "text-embedding-3-small",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let (url, _) = build_azure_request(&agent, "embedding").await.unwrap();
        assert!(url.contains("/embeddings?"));
    }

    #[tokio::test]
    async fn test_build_url_image() {
        let agent = make_agent(json!({
            "id": "dall-e-3",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let (url, _) = build_azure_request(&agent, "image").await.unwrap();
        assert!(url.contains("/images/generations?"));
    }

    #[tokio::test]
    async fn test_auth_header_api_key() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "my-azure-key"
            }
        }));
        let (name, value) = get_auth_header(&agent).await.unwrap();
        assert_eq!(name, "api-key");
        assert_eq!(value, "my-azure-key");
    }

    #[test]
    fn test_strip_project_path() {
        assert_eq!(
            strip_project_path("https://myresource.services.ai.azure.com/api/projects/my-project"),
            "https://myresource.services.ai.azure.com"
        );
        assert_eq!(
            strip_project_path("https://myresource.openai.azure.com"),
            "https://myresource.openai.azure.com"
        );
    }

    #[test]
    fn test_deployment_from_model_id() {
        let agent = make_agent(json!({
            "id": "my-deployment-name",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "key"
            }
        }));
        let deployment = get_deployment(&agent).unwrap();
        assert_eq!(deployment, "my-deployment-name");
    }

    #[test]
    fn test_api_version_default() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "key"
            }
        }));
        let version = get_api_version(&agent);
        assert_eq!(version, DEFAULT_API_VERSION);
    }

    #[tokio::test]
    async fn test_unsupported_api_type() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "key"
            }
        }));
        let result = build_azure_request(&agent, "unknown").await;
        assert!(result.is_err());
    }

    // --- Reference connection resolution tests ---

    #[test]
    fn test_resolve_connection_passthrough() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let conn = resolve_connection(&agent).unwrap();
        assert_eq!(conn.get("kind").unwrap().as_str().unwrap(), "key");
        assert_eq!(conn.get("apiKey").unwrap().as_str().unwrap(), "test-key");
    }

    #[test]
    fn test_resolve_connection_reference_missing_name() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": { "kind": "reference" }
        }));
        let result = resolve_connection(&agent);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("name"));
    }

    #[test]
    fn test_resolve_connection_reference_success() {
        prompty::connections::clear_connections();
        prompty::connections::register_connection(
            "azure-prod",
            json!({
                "kind": "key",
                "endpoint": "https://prod.openai.azure.com",
                "apiKey": "prod-key"
            }),
        );

        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": { "kind": "reference", "name": "azure-prod" }
        }));

        let conn = resolve_connection(&agent).unwrap();
        assert_eq!(conn.get("endpoint").unwrap().as_str().unwrap(), "https://prod.openai.azure.com");
        assert_eq!(conn.get("apiKey").unwrap().as_str().unwrap(), "prod-key");

        prompty::connections::clear_connections();
    }

    #[tokio::test]
    async fn test_reference_connection_flows_to_auth_header() {
        prompty::connections::clear_connections();
        prompty::connections::register_connection(
            "azure-resolved",
            json!({
                "kind": "key",
                "endpoint": "https://resolved.openai.azure.com",
                "apiKey": "resolved-key"
            }),
        );

        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": { "kind": "reference", "name": "azure-resolved" }
        }));

        let (header_name, header_value) = get_auth_header(&agent).await.unwrap();
        assert_eq!(header_name, "api-key");
        assert_eq!(header_value, "resolved-key");

        prompty::connections::clear_connections();
    }

    // --- Entra ID stub test ---

    #[tokio::test]
    async fn test_auth_header_foundry_no_key_no_entra() {
        prompty::connections::clear_connections();
        // Remove env var to ensure no fallback
        // SAFETY: tests run single-threaded
        unsafe { std::env::remove_var("AZURE_OPENAI_API_KEY") };

        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "foundry",
                "endpoint": "https://resource.services.ai.azure.com/api/projects/proj"
            }
        }));

        let result = get_auth_header(&agent).await;
        // Without entra_id feature: should error (can't get token)
        // With entra_id feature: would attempt DefaultAzureCredential (would also fail in CI)
        assert!(result.is_err());
    }
}
