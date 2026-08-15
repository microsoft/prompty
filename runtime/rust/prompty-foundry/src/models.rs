//! Foundry/Azure OpenAI model discovery.
//!
//! Foundry project connections list deployments because deployments are the
//! invokable identifiers users put in `model.id`. Azure OpenAI key connections
//! can still list the lower-level model catalog.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::{ModelInfo, ModelLister};
use serde_json::Value;

use crate::auth::{connection_api_key, connection_bearer_token};

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Foundry implementation of the Typra-generated model discovery protocol.
#[derive(Debug, Clone, Copy, Default)]
pub struct FoundryModelLister;

const DEFAULT_API_VERSION: &str = "2025-04-01-preview";

/// List deployments/models for Foundry/Azure connections.
pub async fn list_models_async(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    let kind = connection
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match kind {
        "foundry" => list_foundry_deployments(connection).await,
        "key" => list_azure_model_catalog(connection).await,
        other => Err(InvokerError::Execute(
            format!(
                "Connection kind '{other}' is not supported for Foundry model listing. \
                 Use 'foundry' for project deployments or 'key' for Azure OpenAI model catalogs."
            )
            .into(),
        )),
    }
}

#[async_trait::async_trait]
impl ModelLister for FoundryModelLister {
    async fn list_models(
        &self,
        connection: &Value,
    ) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
        list_models_async(connection)
            .await
            .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)
    }
}

/// Blocking wrapper around [`list_models_async`].
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

async fn list_foundry_deployments(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    let endpoint = connection
        .get("endpoint")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            InvokerError::Execute(
                "Foundry connection requires a non-empty endpoint to list deployments."
                    .to_string()
                    .into(),
            )
        })?;
    let token = resolve_foundry_token(connection).await?;
    let url = format!(
        "{}/deployments?api-version=v1",
        endpoint.trim_end_matches('/')
    );
    let response = HTTP_CLIENT
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(InvokerError::Execute(
            format!("Failed to list Foundry deployments (HTTP {status}): {body}").into(),
        ));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;
    Ok(body
        .get("value")
        .and_then(|v| v.as_array())
        .map(|items| items.iter().map(parse_deployment_object).collect())
        .unwrap_or_default())
}

async fn list_azure_model_catalog(connection: &Value) -> Result<Vec<ModelInfo>, InvokerError> {
    let endpoint = connection
        .get("endpoint")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            std::env::var("AZURE_OPENAI_ENDPOINT")
                .ok()
                .filter(|s| !s.is_empty())
        })
        .ok_or_else(|| {
            InvokerError::Execute(
                "Azure endpoint is required to list model catalog entries."
                    .to_string()
                    .into(),
            )
        })?;
    let api_key = connection_api_key(connection)
        .or_else(|| std::env::var("AZURE_OPENAI_API_KEY").ok())
        .ok_or_else(|| {
            InvokerError::Execute(
                "Azure API key is required to list model catalog entries."
                    .to_string()
                    .into(),
            )
        })?;
    let api_version = connection
        .get("apiVersion")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_API_VERSION);
    let url = format!(
        "{}/openai/models?api-version={}",
        endpoint.trim_end_matches('/'),
        api_version
    );
    let response = HTTP_CLIENT
        .get(&url)
        .header("api-key", api_key)
        .send()
        .await
        .map_err(|e| InvokerError::Execute(format!("HTTP request failed: {e}").into()))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(InvokerError::Execute(
            format!("Azure model catalog error (HTTP {status}): {body}").into(),
        ));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|e| InvokerError::Execute(format!("Failed to parse response: {e}").into()))?;
    Ok(body
        .get("data")
        .and_then(|v| v.as_array())
        .map(|items| items.iter().map(parse_catalog_model_object).collect())
        .unwrap_or_default())
}

/// Map one raw Foundry data-plane deployment object into the provider-neutral
/// [`ModelInfo`] contract. Handles both the flat `/deployments?api-version=v1`
/// shape and the nested ARM management-plane shape.
///
/// Exercised by the generated `vectors.json` (mapModel operation) so every runtime
/// converges on the same canonical mapping.
pub fn deployment_to_model_info(raw: &Value) -> ModelInfo {
    parse_deployment_object(raw)
}

/// Map one raw Azure OpenAI model-catalog entry into the provider-neutral
/// [`ModelInfo`] contract.
///
/// Exercised by the generated `vectors.json` (mapModel operation).
pub fn catalog_model_to_model_info(raw: &Value) -> ModelInfo {
    parse_catalog_model_object(raw)
}

fn parse_catalog_model_object(obj: &Value) -> ModelInfo {
    let mut info = ModelInfo {
        id: obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        display_name: None,
        owned_by: obj
            .get("owned_by")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        context_window: obj
            .get("maxContextLength")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32),
        input_modalities: None,
        output_modalities: None,
        additional_properties: obj.clone(),
    };

    prompty::discovery::enrich("foundry", &mut info);
    info
}

fn parse_deployment_object(obj: &Value) -> ModelInfo {
    let properties = obj.get("properties").unwrap_or(&Value::Null);
    let model = properties.get("model").unwrap_or(&Value::Null);
    // Foundry's data-plane `/deployments?api-version=v1` returns a flat shape
    // (`modelName`, `modelPublisher`, top-level `capabilities`), while the ARM
    // management-plane shape nests these under `properties.model`. Support both.
    let capabilities = properties
        .get("capabilities")
        .or_else(|| model.get("capabilities"))
        .or_else(|| obj.get("capabilities"))
        .unwrap_or(&Value::Null);

    let mut info = ModelInfo {
        id: obj
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        display_name: obj
            .get("modelName")
            .and_then(|v| v.as_str())
            .or_else(|| model.get("name").and_then(|v| v.as_str()))
            .map(ToString::to_string),
        owned_by: obj
            .get("modelPublisher")
            .and_then(|v| v.as_str())
            .or_else(|| model.get("publisher").and_then(|v| v.as_str()))
            .map(ToString::to_string)
            .or_else(|| Some("azure".to_string())),
        context_window: get_i32(
            capabilities,
            &["maxContextLength", "contextWindow", "context_length"],
        )
        .or_else(|| get_i32(model, &["maxContextLength"]))
        .or_else(|| get_i32(obj, &["maxContextLength"])),
        input_modalities: get_string_vec(
            capabilities,
            &[
                "inputModalities",
                "input_modalities",
                "supportedInputModalities",
            ],
        ),
        output_modalities: get_string_vec(
            capabilities,
            &[
                "outputModalities",
                "output_modalities",
                "supportedOutputModalities",
            ],
        ),
        additional_properties: obj.clone(),
    };

    prompty::discovery::enrich("foundry", &mut info);
    info
}

fn get_i32(obj: &Value, keys: &[&str]) -> Option<i32> {
    keys.iter().find_map(|key| {
        obj.get(*key).and_then(|value| {
            value
                .as_i64()
                .map(|v| v as i32)
                .or_else(|| value.as_str().and_then(|s| s.parse::<i32>().ok()))
        })
    })
}

fn get_string_vec(obj: &Value, keys: &[&str]) -> Option<Vec<String>> {
    keys.iter().find_map(|key| {
        obj.get(*key).and_then(|value| {
            value
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(ToString::to_string))
                        .collect()
                })
                .or_else(|| {
                    value.as_str().map(|s| {
                        s.split(',')
                            .map(str::trim)
                            .filter(|v| !v.is_empty())
                            .map(ToString::to_string)
                            .collect()
                    })
                })
        })
    })
}

/// Resolve the bearer token used for Foundry project deployment listing.
///
/// Prefers a caller-supplied token on the connection (`apiKey`/`api_key`/
/// `bearerToken`/`bearer_token`) so hosts that already hold an interactive
/// Entra token (e.g. browser OAuth/PKCE) can list deployments without the
/// ambient `DefaultAzureCredential`. Falls back to [`get_ai_token`] when no
/// caller token is present.
async fn resolve_foundry_token(connection: &Value) -> Result<String, InvokerError> {
    match connection_bearer_token(connection) {
        Some(token) => Ok(token),
        None => get_ai_token().await,
    }
}

#[cfg(feature = "entra_id")]
async fn get_ai_token() -> Result<String, InvokerError> {
    use azure_core::credentials::TokenCredential;
    use azure_identity::DefaultAzureCredential;

    let credential = DefaultAzureCredential::new().map_err(|e| {
        InvokerError::Execute(format!("Failed to create DefaultAzureCredential: {e}").into())
    })?;
    let token = credential
        .get_token(&["https://ai.azure.com/.default"])
        .await
        .map_err(|e| {
            InvokerError::Execute(format!("Failed to acquire Entra ID token: {e}").into())
        })?;
    Ok(token.token.secret().to_string())
}

#[cfg(not(feature = "entra_id"))]
async fn get_ai_token() -> Result<String, InvokerError> {
    Err(InvokerError::Execute(
        "Foundry deployment listing requires Entra ID auth. Enable the 'entra_id' feature."
            .to_string()
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_lister_implements_generated_protocol() {
        fn assert_model_lister<T: ModelLister>() {}
        assert_model_lister::<FoundryModelLister>();
    }

    #[test]
    fn parse_deployment_maps_capabilities_and_raw_payload() {
        let deployment = json!({
            "name": "chat-prod",
            "properties": {
                "model": { "name": "gpt-4o", "publisher": "Microsoft" },
                "capabilities": {
                    "maxContextLength": 128000,
                    "inputModalities": ["text", "image"],
                    "outputModalities": "text, json"
                }
            }
        });

        let info = parse_deployment_object(&deployment);

        assert_eq!(info.id, "chat-prod");
        assert_eq!(info.display_name.as_deref(), Some("gpt-4o"));
        assert_eq!(info.owned_by.as_deref(), Some("Microsoft"));
        assert_eq!(info.context_window, Some(128_000));
        assert_eq!(
            info.input_modalities,
            Some(vec!["text".to_string(), "image".to_string()])
        );
        assert_eq!(
            info.output_modalities,
            Some(vec!["text".to_string(), "json".to_string()])
        );
        assert_eq!(info.additional_properties["name"], "chat-prod");
    }

    #[test]
    fn parse_deployment_maps_flat_data_plane_shape() {
        // Shape returned by `{project}/deployments?api-version=v1`.
        let deployment = json!({
            "name": "gpt-5.2",
            "type": "ModelDeployment",
            "modelName": "gpt-5.2",
            "modelVersion": "2025-12-11",
            "modelPublisher": "OpenAI",
            "capabilities": { "chat_completion": "true" },
            "sku": { "name": "GlobalStandard", "capacity": 1000 }
        });

        let info = parse_deployment_object(&deployment);

        assert_eq!(info.id, "gpt-5.2");
        assert_eq!(info.display_name.as_deref(), Some("gpt-5.2"));
        assert_eq!(info.owned_by.as_deref(), Some("OpenAI"));
        assert_eq!(info.context_window, None);
        assert_eq!(info.additional_properties["modelPublisher"], "OpenAI");
    }

    #[tokio::test]
    async fn resolve_foundry_token_prefers_caller_supplied_token() {
        let token = resolve_foundry_token(&json!({ "apiKey": "caller-bearer" }))
            .await
            .expect("caller token should resolve without ambient credentials");
        assert_eq!(token, "caller-bearer");

        let token = resolve_foundry_token(&json!({ "api_key": "  snake-bearer  " }))
            .await
            .expect("snake_case api_key should resolve and trim");
        assert_eq!(token, "snake-bearer");
    }

    #[cfg(not(feature = "entra_id"))]
    #[tokio::test]
    async fn resolve_foundry_token_falls_back_when_no_caller_token() {
        let error = resolve_foundry_token(&json!({ "apiKey": "   " }))
            .await
            .expect_err("blank caller token should fall through to ambient credentials");
        assert!(error.to_string().contains("Entra ID"));
    }
}
