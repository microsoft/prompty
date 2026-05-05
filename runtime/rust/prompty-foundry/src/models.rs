//! Foundry/Azure OpenAI model discovery.
//!
//! Foundry project connections list deployments because deployments are the
//! invokable identifiers users put in `model.id`. Azure OpenAI key connections
//! can still list the lower-level model catalog.

use std::sync::LazyLock;

use prompty::interfaces::InvokerError;
use prompty::model::ModelInfo;
use serde_json::Value;

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

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
    let token = get_ai_token().await?;
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
    let api_key = connection
        .get("apiKey")
        .or(connection.get("api_key"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
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

fn parse_catalog_model_object(obj: &Value) -> ModelInfo {
    ModelInfo {
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
    }
}

fn parse_deployment_object(obj: &Value) -> ModelInfo {
    let properties = obj.get("properties").unwrap_or(&Value::Null);
    let model = properties.get("model").unwrap_or(&Value::Null);
    let capabilities = properties
        .get("capabilities")
        .or_else(|| model.get("capabilities"))
        .unwrap_or(&Value::Null);

    ModelInfo {
        id: obj
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        display_name: model
            .get("name")
            .and_then(|v| v.as_str())
            .map(ToString::to_string),
        owned_by: model
            .get("publisher")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .or_else(|| Some("azure".to_string())),
        context_window: get_i32(
            capabilities,
            &["maxContextLength", "contextWindow", "context_length"],
        )
        .or_else(|| get_i32(model, &["maxContextLength"])),
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
    }
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
}
