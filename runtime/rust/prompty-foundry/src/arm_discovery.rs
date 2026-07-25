//! Azure Resource Manager (ARM) discovery for Foundry/Azure OpenAI resources.
//!
//! Provides the read-only resource-enumeration protocol behind a Foundry
//! resource picker: list subscriptions, list AI resources (Cognitive Services
//! accounts), and list Foundry projects for a resource. These calls hit the
//! Azure management plane (`management.azure.com`) with an already-minted
//! management-plane bearer token (see [`crate::oauth::AZURE_MANAGEMENT_SCOPE`]).
//!
//! This module owns only the ARM protocol. The interactive picker/wizard
//! (selection state, ordering, UI, persistence) is a host concern.
//!
//! # Wire format
//!
//! The three public result structs cross a host IPC boundary and are consumed
//! directly by front-end code that expects snake_case fields. They therefore
//! use plain serde derives (no `rename_all`) and serialize as snake_case. They
//! are host-facing result DTOs mapped from ARM responses, not part of the
//! cross-runtime Prompty model, so they intentionally do not follow the
//! generated model's camelCase convention.

use std::sync::LazyLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Base URL for the Azure Resource Manager control plane.
const ARM_BASE: &str = "https://management.azure.com";

/// API version for the subscriptions list endpoint.
const SUBSCRIPTIONS_API_VERSION: &str = "2022-12-01";
/// API version for the Cognitive Services accounts list endpoint.
const ACCOUNTS_API_VERSION: &str = "2023-05-01";
/// API version for the Cognitive Services projects (new Foundry) endpoint.
const COG_PROJECTS_API_VERSION: &str = "2025-04-01-preview";
/// API version for the Machine Learning workspaces (classic hub) endpoint.
const ML_WORKSPACES_API_VERSION: &str = "2024-10-01";

/// Preferred key in `properties.endpoints` for the inference endpoint.
const ENDPOINT_PREFERENCE_KEY: &str = "OpenAI Language Model Instance API";

/// Per-request timeout for ARM calls.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// An Azure subscription the signed-in identity can access.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub subscription_id: String,
    pub display_name: String,
    pub state: String,
}

/// A Cognitive Services account usable for Azure OpenAI / Foundry inference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResource {
    pub name: String,
    /// `"AIServices"` or `"OpenAI"`.
    pub kind: String,
    pub endpoint: String,
    pub location: String,
    pub resource_group: String,
    /// `Some` for `AIServices` (new Foundry), `None` for `OpenAI`.
    #[serde(default)]
    pub foundry_url: Option<String>,
}

/// A Foundry project hosted under an [`AiResource`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoundryProject {
    pub name: String,
    pub display_name: String,
    pub endpoint: String,
}

/// List enabled subscriptions for the token's identity.
///
/// Pages through `nextLink` and filters to `state == "Enabled"`.
pub async fn list_subscriptions(token: &str) -> Result<Vec<Subscription>, String> {
    let url = format!("{ARM_BASE}/subscriptions?api-version={SUBSCRIPTIONS_API_VERSION}");
    let items = fetch_all(token, url).await?;
    Ok(items.iter().filter_map(parse_subscription).collect())
}

/// List Cognitive Services accounts (Azure OpenAI / AI Services) in a subscription.
///
/// Pages through `nextLink`, keeps only `AIServices`/`OpenAI` kinds with a
/// non-empty inference endpoint, and derives `resource_group` from the ARM id
/// and `foundry_url` for `AIServices` accounts.
pub async fn list_ai_resources(
    token: &str,
    subscription_id: &str,
) -> Result<Vec<AiResource>, String> {
    let url = format!(
        "{ARM_BASE}/subscriptions/{subscription_id}/providers/Microsoft.CognitiveServices/accounts?api-version={ACCOUNTS_API_VERSION}"
    );
    let items = fetch_all(token, url).await?;
    Ok(items.iter().filter_map(parse_ai_resource).collect())
}

/// List Foundry projects for a Cognitive Services account.
///
/// Two-strategy merge:
/// * S1 (new Foundry): the account's `projects` sub-resource.
/// * S2 (classic hub, only if S1 yields nothing): ML workspaces filtered to
///   `kind == "Project"`.
///
/// Each strategy soft-fails to empty (a fetch error contributes nothing rather
/// than failing the call), so both endpoints failing returns `Ok(vec![])`.
/// The picker treats an empty list as "none found", not an error.
pub async fn list_foundry_projects(
    token: &str,
    subscription_id: &str,
    resource_group: &str,
    resource_name: &str,
) -> Result<Vec<FoundryProject>, String> {
    // S1: new-Foundry projects sub-resource.
    let s1_url = format!(
        "{ARM_BASE}/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.CognitiveServices/accounts/{resource_name}/projects?api-version={COG_PROJECTS_API_VERSION}"
    );
    let mut projects: Vec<FoundryProject> = Vec::new();
    if let Ok(items) = fetch_all(token, s1_url).await {
        projects.extend(items.iter().map(|v| parse_s1_project(v, resource_name)));
    }

    // S2: classic hub fallback, only when S1 found nothing.
    if projects.is_empty() {
        let s2_url = format!(
            "{ARM_BASE}/subscriptions/{subscription_id}/providers/Microsoft.MachineLearningServices/workspaces?api-version={ML_WORKSPACES_API_VERSION}"
        );
        if let Ok(items) = fetch_all(token, s2_url).await {
            projects.extend(
                items
                    .iter()
                    .filter_map(|v| parse_s2_workspace(v, resource_name)),
            );
        }
    }

    Ok(projects)
}

/// Page through an ARM list endpoint, accumulating every `value` entry.
///
/// Follows absolute `nextLink` URLs until absent/empty. Returns an error on the
/// first non-success HTTP status.
async fn fetch_all(token: &str, first_url: String) -> Result<Vec<Value>, String> {
    let mut items: Vec<Value> = Vec::new();
    let mut next: Option<String> = Some(first_url);

    while let Some(url) = next.take() {
        if url.is_empty() {
            break;
        }
        let response = HTTP_CLIENT
            .get(&url)
            .bearer_auth(token)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("ARM request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("ARM API error ({status}): {body}"));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse ARM response: {e}"))?;

        if let Some(arr) = body.get("value").and_then(|v| v.as_array()) {
            items.extend(arr.iter().cloned());
        }

        next = body
            .get("nextLink")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);
    }

    Ok(items)
}

fn parse_subscription(v: &Value) -> Option<Subscription> {
    let state = string_at(v, "state");
    if state != "Enabled" {
        return None;
    }
    Some(Subscription {
        subscription_id: string_at(v, "subscriptionId"),
        display_name: string_at(v, "displayName"),
        state,
    })
}

fn parse_ai_resource(v: &Value) -> Option<AiResource> {
    let kind = string_at(v, "kind");
    if kind != "AIServices" && kind != "OpenAI" {
        return None;
    }

    let properties = v.get("properties").unwrap_or(&Value::Null);
    let endpoint = properties
        .get("endpoints")
        .and_then(|e| e.get(ENDPOINT_PREFERENCE_KEY))
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            properties
                .get("endpoint")
                .and_then(|s| s.as_str())
                .filter(|s| !s.is_empty())
        })
        .map(ToString::to_string)?;

    let name = string_at(v, "name");
    let foundry_url = if kind == "AIServices" {
        Some(format!("https://{name}.services.ai.azure.com"))
    } else {
        None
    };

    Some(AiResource {
        resource_group: extract_resource_group(&string_at(v, "id")),
        location: string_at(v, "location"),
        endpoint,
        foundry_url,
        kind,
        name,
    })
}

fn parse_s1_project(v: &Value, resource_name: &str) -> FoundryProject {
    // ARM returns the project as "parent/child"; keep the child segment.
    let full = v.get("name").and_then(|s| s.as_str()).unwrap_or_default();
    let short_name = full.rsplit('/').next().unwrap_or(full).to_string();
    let display_name = v
        .get("properties")
        .and_then(|p| p.get("displayName"))
        .and_then(|s| s.as_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| short_name.clone());
    let endpoint =
        format!("https://{resource_name}.services.ai.azure.com/api/projects/{short_name}");
    FoundryProject {
        name: short_name,
        display_name,
        endpoint,
    }
}

fn parse_s2_workspace(v: &Value, resource_name: &str) -> Option<FoundryProject> {
    if string_at(v, "kind") != "Project" {
        return None;
    }
    let name = string_at(v, "name");
    let display_name = v
        .get("properties")
        .and_then(|p| p.get("friendlyName"))
        .and_then(|s| s.as_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| name.clone());
    let endpoint = format!("https://{resource_name}.services.ai.azure.com/api/projects/{name}");
    Some(FoundryProject {
        name,
        display_name,
        endpoint,
    })
}

/// Extract the resource-group segment from an ARM resource id, case-insensitively.
fn extract_resource_group(id: &str) -> String {
    let segments: Vec<&str> = id.split('/').collect();
    segments
        .iter()
        .position(|s| s.eq_ignore_ascii_case("resourceGroups"))
        .and_then(|i| segments.get(i + 1))
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn string_at(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|s| s.as_str())
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_subscription_keeps_enabled() {
        let v = json!({
            "subscriptionId": "sub-1",
            "displayName": "Prod",
            "state": "Enabled"
        });
        let sub = parse_subscription(&v).expect("enabled subscription");
        assert_eq!(sub.subscription_id, "sub-1");
        assert_eq!(sub.display_name, "Prod");
        assert_eq!(sub.state, "Enabled");
    }

    #[test]
    fn parse_subscription_drops_disabled() {
        let v = json!({ "subscriptionId": "sub-2", "displayName": "Old", "state": "Disabled" });
        assert!(parse_subscription(&v).is_none());
    }

    #[test]
    fn parse_ai_resource_prefers_named_endpoint() {
        let v = json!({
            "name": "myaccount",
            "kind": "AIServices",
            "location": "eastus",
            "id": "/subscriptions/s/resourceGroups/my-rg/providers/Microsoft.CognitiveServices/accounts/myaccount",
            "properties": {
                "endpoint": "https://fallback.example.com",
                "endpoints": {
                    "OpenAI Language Model Instance API": "https://preferred.example.com"
                }
            }
        });
        let res = parse_ai_resource(&v).expect("valid resource");
        assert_eq!(res.endpoint, "https://preferred.example.com");
        assert_eq!(res.resource_group, "my-rg");
        assert_eq!(
            res.foundry_url.as_deref(),
            Some("https://myaccount.services.ai.azure.com")
        );
    }

    #[test]
    fn parse_ai_resource_falls_back_to_plain_endpoint() {
        let v = json!({
            "name": "openaionly",
            "kind": "OpenAI",
            "location": "westus",
            "id": "/subscriptions/s/resourcegroups/lower-rg/providers/Microsoft.CognitiveServices/accounts/openaionly",
            "properties": { "endpoint": "https://plain.example.com" }
        });
        let res = parse_ai_resource(&v).expect("valid resource");
        assert_eq!(res.endpoint, "https://plain.example.com");
        // resource group extraction is case-insensitive on the id segment.
        assert_eq!(res.resource_group, "lower-rg");
        // OpenAI kind gets no foundry_url.
        assert_eq!(res.foundry_url, None);
    }

    #[test]
    fn parse_ai_resource_drops_wrong_kind() {
        let v = json!({ "name": "x", "kind": "ComputerVision", "properties": { "endpoint": "https://x" } });
        assert!(parse_ai_resource(&v).is_none());
    }

    #[test]
    fn parse_ai_resource_drops_empty_endpoint() {
        let v = json!({ "name": "x", "kind": "OpenAI", "properties": { "endpoint": "" } });
        assert!(parse_ai_resource(&v).is_none());
    }

    #[test]
    fn parse_s1_project_uses_child_segment_and_display_name() {
        let v = json!({
            "name": "myaccount/proj-a",
            "properties": { "displayName": "Project A" }
        });
        let p = parse_s1_project(&v, "myaccount");
        assert_eq!(p.name, "proj-a");
        assert_eq!(p.display_name, "Project A");
        assert_eq!(
            p.endpoint,
            "https://myaccount.services.ai.azure.com/api/projects/proj-a"
        );
    }

    #[test]
    fn parse_s1_project_defaults_display_to_short_name() {
        let v = json!({ "name": "acct/proj-b" });
        let p = parse_s1_project(&v, "acct");
        assert_eq!(p.name, "proj-b");
        assert_eq!(p.display_name, "proj-b");
    }

    #[test]
    fn parse_s2_workspace_keeps_projects_only() {
        let hub = json!({ "name": "hub-1", "kind": "Hub", "properties": {} });
        assert!(parse_s2_workspace(&hub, "acct").is_none());

        let proj = json!({
            "name": "ws-proj",
            "kind": "Project",
            "properties": { "friendlyName": "Friendly WS" }
        });
        let p = parse_s2_workspace(&proj, "acct").expect("project workspace");
        assert_eq!(p.name, "ws-proj");
        assert_eq!(p.display_name, "Friendly WS");
        assert_eq!(
            p.endpoint,
            "https://acct.services.ai.azure.com/api/projects/ws-proj"
        );
    }

    #[test]
    fn extract_resource_group_handles_casing_and_missing() {
        assert_eq!(
            extract_resource_group("/subscriptions/s/resourceGroups/rg-1/providers/x"),
            "rg-1"
        );
        assert_eq!(
            extract_resource_group("/subscriptions/s/RESOURCEGROUPS/rg-2/providers/x"),
            "rg-2"
        );
        assert_eq!(extract_resource_group("/subscriptions/s/providers/x"), "");
    }

    #[test]
    fn structs_serialize_snake_case() {
        let res = AiResource {
            name: "a".into(),
            kind: "AIServices".into(),
            endpoint: "https://e".into(),
            location: "eastus".into(),
            resource_group: "rg".into(),
            foundry_url: Some("https://f".into()),
        };
        let json = serde_json::to_string(&res).unwrap();
        assert!(json.contains("\"resource_group\""));
        assert!(json.contains("\"foundry_url\""));
        assert!(!json.contains("resourceGroup"));
        assert!(!json.contains("foundryUrl"));

        let sub = Subscription {
            subscription_id: "s".into(),
            display_name: "d".into(),
            state: "Enabled".into(),
        };
        let sub_json = serde_json::to_string(&sub).unwrap();
        assert!(sub_json.contains("\"subscription_id\""));
        assert!(sub_json.contains("\"display_name\""));
        assert!(!sub_json.contains("subscriptionId"));
    }

    #[test]
    fn ai_resource_foundry_url_defaults_when_absent() {
        // Missing foundry_url deserializes to None via serde(default).
        let v = json!({
            "name": "a",
            "kind": "OpenAI",
            "endpoint": "https://e",
            "location": "eastus",
            "resource_group": "rg"
        });
        let res: AiResource = serde_json::from_value(v).unwrap();
        assert_eq!(res.foundry_url, None);
    }
}
