//! Foundry/Azure OpenAI executor — sends requests to Azure OpenAI endpoints.
//!
//! Reuses OpenAI wire format helpers from `prompty-openai`, but constructs
//! Azure-specific URLs and uses Azure authentication (API key with `api-key`
//! header, or Foundry connection for Entra ID).

use async_trait::async_trait;
use serde_json::Value;

use prompty::interfaces::{Executor, InvokerError};
use prompty::model::Prompty;
use prompty::types::Message;

use prompty_openai::wire;

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

        let (url, auth_header) = build_azure_request(agent, api_type)?;

        let client = reqwest::Client::new();
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
}

// ---------------------------------------------------------------------------
// URL construction and auth
// ---------------------------------------------------------------------------

/// Returns `(url, (header_name, header_value))` for the Azure OpenAI request.
fn build_azure_request(
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

    let auth_header = get_auth_header(agent)?;

    Ok((url, auth_header))
}

/// Extract the endpoint URL from the agent's connection configuration.
fn get_endpoint(agent: &Prompty) -> Result<String, InvokerError> {
    let conn = &agent.model.connection;
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
/// - Foundry (Entra ID): Not yet implemented, falls back to API key from env
fn get_auth_header(agent: &Prompty) -> Result<(&'static str, String), InvokerError> {
    let conn = &agent.model.connection;

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

    // Foundry connection — TODO: Implement Entra ID / DefaultAzureCredential token
    // For now, fall through to env var

    // Fall back to environment variable
    if let Ok(key) = std::env::var("AZURE_OPENAI_API_KEY") {
        if !key.is_empty() {
            return Ok(("api-key", key));
        }
    }

    Err(InvokerError::Execute(
        "No Azure API key found. Set AZURE_OPENAI_API_KEY or configure model.connection.apiKey"
            .to_string()
            .into(),
    ))
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

    #[test]
    fn test_build_url_api_key_connection() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let (url, _) = build_azure_request(&agent, "chat").unwrap();
        assert!(url.starts_with("https://myresource.openai.azure.com/openai/deployments/gpt-4/chat/completions"));
        assert!(url.contains("api-version="));
    }

    #[test]
    fn test_build_url_foundry_connection() {
        // Foundry connections typically use Entra ID, but for testing we
        // supply an API key via env var since Entra ID isn't implemented yet
        std::env::set_var("AZURE_OPENAI_API_KEY", "test-foundry-key");
        let agent = make_agent(json!({
            "id": "gpt-4o",
            "connection": {
                "kind": "foundry",
                "endpoint": "https://myresource.services.ai.azure.com/api/projects/my-project",
                "name": "my-conn"
            }
        }));
        let (url, _) = build_azure_request(&agent, "chat").unwrap();
        // Foundry endpoint should strip the project path
        assert!(url.starts_with("https://myresource.services.ai.azure.com/openai/deployments/gpt-4o/chat/completions"));
        std::env::remove_var("AZURE_OPENAI_API_KEY");
    }

    #[test]
    fn test_build_url_embedding() {
        let agent = make_agent(json!({
            "id": "text-embedding-3-small",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let (url, _) = build_azure_request(&agent, "embedding").unwrap();
        assert!(url.contains("/embeddings?"));
    }

    #[test]
    fn test_build_url_image() {
        let agent = make_agent(json!({
            "id": "dall-e-3",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "test-key"
            }
        }));
        let (url, _) = build_azure_request(&agent, "image").unwrap();
        assert!(url.contains("/images/generations?"));
    }

    #[test]
    fn test_auth_header_api_key() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "my-azure-key"
            }
        }));
        let (name, value) = get_auth_header(&agent).unwrap();
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

    #[test]
    fn test_unsupported_api_type() {
        let agent = make_agent(json!({
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "https://myresource.openai.azure.com",
                "apiKey": "key"
            }
        }));
        let result = build_azure_request(&agent, "unknown");
        assert!(result.is_err());
    }
}
