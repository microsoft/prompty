//! Interactive Azure OAuth 2.0 sign-in flows for prompty-foundry.
//!
//! Provides the browser/device user sign-in flows used to acquire Azure/Entra
//! user tokens for Foundry and Azure OpenAI:
//!
//! - device authorization grant (RFC 8628),
//! - authorization-code grant with PKCE (RFC 7636 / RFC 6749),
//! - refresh-token grant.
//!
//! These complement the non-interactive auth already in [`crate::executor`]
//! (`api-key` header, `AZURE_INFERENCE_CREDENTIAL` bearer, and
//! `DefaultAzureCredential`/Entra ID via `get_entra_token`). `DefaultAzureCredential`
//! does not perform interactive browser sign-in, which is what this module adds.
//!
//! # Boundary (mirrors the `MemoryPort` data-vs-behavior split)
//!
//! This module owns ONLY the provider protocol: PKCE generation, authorize-URL
//! construction, the device-code request/poll state machine, code exchange, and
//! refresh. The HOST owns the interactive surface — opening the OS browser,
//! binding the loopback redirect listener, serving the post-redirect HTML,
//! tracking pending-auth state, and persisting tokens.
//!
//! Notably, unlike the legacy implementation this module does NOT bind a
//! `TcpListener` or keep any global pending-listener state. The host binds the
//! loopback listener, derives `redirect_uri`, calls [`build_auth_code_url`], and
//! later feeds the received `code` back into [`exchange_code_for_token`].
//!
//! # Scope
//!
//! Endpoints, scopes, and the default client id are Azure-concrete on purpose:
//! interactive OAuth has a single provider (Azure) today. If a second provider
//! ever needs interactive OAuth, promote the endpoints/scopes/client-id into an
//! `OAuthConfig` value and extract this module into a shared, provider-neutral
//! crate. Until then it stays Azure-specific and lives beside `get_entra_token`.

use std::time::{Duration, Instant};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use prompty::model::context::LoadContext;
pub use prompty::model::{
    AuthorizationCodeFlow as AuthCodeFlowInit, DeviceAuthorization as DeviceCodeResponse,
    OAuthToken as TokenResponse,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Default public client id used for interactive sign-in (the Azure CLI public client).
pub const DEFAULT_CLIENT_ID: &str = "1950a258-227b-4e31-a9cf-717495945fc2";

/// Default scope for Azure OpenAI / Foundry access.
///
/// Includes `offline_access` so the token response carries a refresh token.
pub const AZURE_OPENAI_SCOPE: &str = "https://ai.azure.com/.default offline_access";

/// Default scope for Azure Resource Manager access.
pub const AZURE_MANAGEMENT_SCOPE: &str = "https://management.azure.com/.default offline_access";

/// Tenant used when the caller supplies an empty tenant id.
const DEFAULT_TENANT: &str = "organizations";

/// RFC 8628 mandates a poll interval of at least 5 seconds.
const MIN_POLL_INTERVAL_SECS: u64 = 5;

/// Length of the generated PKCE code verifier (RFC 7636 allows 43..=128).
const PKCE_VERIFIER_LEN: usize = 64;

fn tenant_or_default(tenant: &str) -> &str {
    if tenant.is_empty() {
        DEFAULT_TENANT
    } else {
        tenant
    }
}

fn client_id_or_default(client_id: Option<&str>) -> &str {
    client_id.unwrap_or(DEFAULT_CLIENT_ID)
}

fn scope_or_default(scope: Option<&str>) -> &str {
    scope.unwrap_or(AZURE_OPENAI_SCOPE)
}

fn devicecode_url(tenant: &str) -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/devicecode",
        tenant_or_default(tenant)
    )
}

fn token_url(tenant: &str) -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant_or_default(tenant)
    )
}

fn authorize_url_base(tenant: &str) -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
        tenant_or_default(tenant)
    )
}

/// OAuth 2.0 error response (RFC 6749 §5.2), used by the device-code poll loop.
#[derive(Debug, Deserialize)]
struct TokenErrorResponse {
    error: String,
    #[serde(default)]
    #[allow(dead_code)]
    error_description: Option<String>,
}

/// Generate a PKCE `(code_verifier, code_challenge)` pair using the S256 method
/// (RFC 7636).
fn generate_pkce() -> (String, String) {
    const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::rng();
    let verifier: String = (0..PKCE_VERIFIER_LEN)
        .map(|_| UNRESERVED[rng.random_range(0..UNRESERVED.len())] as char)
        .collect();
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

fn foundry_wire_context() -> LoadContext {
    LoadContext {
        pre_process: Some(Box::new(|value| {
            let Value::Object(mut object) = value else {
                return value;
            };
            for (wire, canonical) in [
                ("access_token", "accessToken"),
                ("token_type", "tokenType"),
                ("expires_in", "expiresIn"),
                ("refresh_token", "refreshToken"),
                ("device_code", "deviceCode"),
                ("user_code", "userCode"),
                ("verification_uri", "verificationUri"),
            ] {
                if let Some(value) = object.remove(wire) {
                    object.insert(canonical.to_string(), value);
                }
            }
            Value::Object(object)
        })),
        post_process: None,
    }
}

fn invalid_response(field: &str, expected: &str) -> serde_json::Error {
    serde_json::Error::io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("missing or invalid field '{field}'; expected {expected}"),
    ))
}

fn require_string(value: &Value, field: &str) -> Result<(), serde_json::Error> {
    match value.get(field).and_then(Value::as_str) {
        Some(value) if !value.is_empty() => Ok(()),
        _ => Err(invalid_response(field, "a non-empty string")),
    }
}

fn require_nonnegative_i64(value: &Value, field: &str) -> Result<(), serde_json::Error> {
    match value.get(field).and_then(Value::as_i64) {
        Some(value) if value >= 0 => Ok(()),
        _ => Err(invalid_response(field, "a non-negative integer")),
    }
}

fn parse_token_response(text: &str) -> Result<TokenResponse, serde_json::Error> {
    let value: Value = serde_json::from_str(text)?;
    require_string(&value, "access_token")?;
    require_string(&value, "token_type")?;
    require_nonnegative_i64(&value, "expires_in")?;
    Ok(TokenResponse::load_from_value(
        &value,
        &foundry_wire_context(),
    ))
}

fn parse_device_code_response(text: &str) -> Result<DeviceCodeResponse, serde_json::Error> {
    let value: Value = serde_json::from_str(text)?;
    require_string(&value, "device_code")?;
    require_string(&value, "user_code")?;
    require_string(&value, "verification_uri")?;
    require_nonnegative_i64(&value, "expires_in")?;
    require_nonnegative_i64(&value, "interval")?;
    Ok(DeviceCodeResponse::load_from_value(
        &value,
        &foundry_wire_context(),
    ))
}

/// Build the authorization URL for an authorization-code + PKCE flow.
///
/// This performs no I/O: it generates a PKCE verifier/challenge and constructs
/// the provider authorize URL. The host is responsible for binding the loopback
/// redirect listener (and thus choosing `redirect_uri`), opening the browser,
/// and awaiting the redirected authorization code.
pub fn build_auth_code_url(
    tenant_id: &str,
    client_id: Option<&str>,
    scope: Option<&str>,
    redirect_uri: &str,
) -> AuthCodeFlowInit {
    let (verifier, challenge) = generate_pkce();
    let mut url =
        reqwest::Url::parse(&authorize_url_base(tenant_id)).expect("authorize base url is valid");
    url.query_pairs_mut()
        .append_pair("client_id", client_id_or_default(client_id))
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_mode", "query")
        .append_pair("scope", scope_or_default(scope))
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    AuthCodeFlowInit {
        auth_url: url.to_string(),
        code_verifier: verifier,
    }
}

/// Request a device authorization code (RFC 8628 §3.1).
pub async fn request_device_code(
    tenant_id: &str,
    client_id: Option<&str>,
    scope: Option<&str>,
) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id_or_default(client_id)),
        ("scope", scope_or_default(scope)),
    ];
    let resp = client
        .post(devicecode_url(tenant_id))
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("device code request failed: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("failed to read device code response: {e}"))?;
    if !status.is_success() {
        return Err(format!("device code request failed ({status}): {text}"));
    }
    parse_device_code_response(&text)
        .map_err(|e| format!("failed to parse device code response: {e}"))
}

/// Poll the token endpoint until the user authorizes the device or the flow
/// times out (RFC 8628 §3.4–3.5).
///
/// The `interval_secs` floor is 5 seconds; a `slow_down` error increases it by
/// 5 seconds per RFC 8628. `scope` is intentionally not sent on the poll.
pub async fn poll_for_token(
    tenant_id: &str,
    device_code: &str,
    interval_secs: u64,
    timeout_secs: u64,
    client_id: Option<&str>,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let mut interval = interval_secs.max(MIN_POLL_INTERVAL_SECS);
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let client_id = client_id_or_default(client_id);

    loop {
        if Instant::now() >= deadline {
            return Err("device code authorization timed out".to_string());
        }
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let params = [
            ("client_id", client_id),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
        ];
        let resp = client
            .post(token_url(tenant_id))
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("token poll request failed: {e}"))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("failed to read token poll response: {e}"))?;

        if status.is_success() {
            return parse_token_response(&text)
                .map_err(|e| format!("failed to parse token response: {e}"));
        }

        let err: TokenErrorResponse = serde_json::from_str(&text)
            .map_err(|e| format!("failed to parse token error response ({status}): {e}"))?;
        match err.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                interval += 5;
                continue;
            }
            "expired_token" => {
                return Err("device code expired before authorization".to_string());
            }
            other => return Err(format!("device code authorization failed: {other}")),
        }
    }
}

/// Exchange an authorization code for a token (RFC 6749 §4.1.3 with PKCE).
pub async fn exchange_code_for_token(
    tenant_id: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
    client_id: Option<&str>,
    scope: Option<&str>,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id_or_default(client_id)),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", code_verifier),
        ("scope", scope_or_default(scope)),
    ];
    post_token(&client, tenant_id, &params).await
}

/// Exchange a refresh token for a new access token (RFC 6749 §6).
pub async fn refresh_token(
    tenant_id: &str,
    refresh_token: &str,
    client_id: Option<&str>,
    scope: Option<&str>,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id_or_default(client_id)),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", scope_or_default(scope)),
    ];
    post_token(&client, tenant_id, &params).await
}

/// POST a form to the token endpoint and parse a [`TokenResponse`].
async fn post_token(
    client: &reqwest::Client,
    tenant_id: &str,
    params: &[(&str, &str)],
) -> Result<TokenResponse, String> {
    let resp = client
        .post(token_url(tenant_id))
        .form(params)
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("failed to read token response: {e}"))?;
    if !status.is_success() {
        return Err(format!("token request failed ({status}): {text}"));
    }
    parse_token_response(&text).map_err(|e| format!("failed to parse token response: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_verifier_is_correct_length_and_charset() {
        let (verifier, _challenge) = generate_pkce();
        assert_eq!(verifier.len(), PKCE_VERIFIER_LEN);
        assert!(
            verifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~')),
            "verifier must be RFC 7636 unreserved chars: {verifier}"
        );
    }

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let (verifier, challenge) = generate_pkce();
        // SHA-256 -> 32 bytes -> base64url-no-pad -> 43 chars, no padding.
        assert_eq!(challenge.len(), 43);
        assert!(!challenge.contains('='));
        assert!(!challenge.contains('+'));
        assert!(!challenge.contains('/'));
        // Recomputing the challenge from the verifier must match.
        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, expected);
    }

    #[test]
    fn pkce_pairs_are_unique() {
        let (v1, c1) = generate_pkce();
        let (v2, c2) = generate_pkce();
        assert_ne!(v1, v2);
        assert_ne!(c1, c2);
    }

    #[test]
    fn build_auth_code_url_contains_expected_params() {
        let init = build_auth_code_url("my-tenant", None, None, "http://127.0.0.1:5000");
        let url = reqwest::Url::parse(&init.auth_url).unwrap();
        assert_eq!(url.host_str(), Some("login.microsoftonline.com"));
        assert!(url.path().starts_with("/my-tenant/oauth2/v2.0/authorize"));

        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            pairs.get("client_id").map(String::as_str),
            Some(DEFAULT_CLIENT_ID)
        );
        assert_eq!(pairs.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            pairs.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:5000")
        );
        assert_eq!(
            pairs.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            pairs.get("scope").map(String::as_str),
            Some(AZURE_OPENAI_SCOPE)
        );
        // The challenge in the URL must correspond to the returned verifier.
        let expected_challenge =
            URL_SAFE_NO_PAD.encode(Sha256::digest(init.code_verifier.as_bytes()));
        assert_eq!(
            pairs.get("code_challenge").map(String::as_str),
            Some(expected_challenge.as_str())
        );
    }

    #[test]
    fn build_auth_code_url_uses_custom_client_and_scope() {
        let init = build_auth_code_url(
            "",
            Some("custom-client"),
            Some("custom-scope"),
            "http://127.0.0.1:1",
        );
        let url = reqwest::Url::parse(&init.auth_url).unwrap();
        // Empty tenant falls back to the "organizations" tenant.
        assert!(
            url.path()
                .starts_with("/organizations/oauth2/v2.0/authorize")
        );
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(
            pairs.get("client_id").map(String::as_str),
            Some("custom-client")
        );
        assert_eq!(pairs.get("scope").map(String::as_str), Some("custom-scope"));
    }

    #[test]
    fn url_helpers_apply_tenant_default() {
        assert_eq!(
            devicecode_url(""),
            "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode"
        );
        assert_eq!(
            token_url("contoso"),
            "https://login.microsoftonline.com/contoso/oauth2/v2.0/token"
        );
    }

    #[test]
    fn token_response_deserializes_with_optional_fields_absent() {
        let json = r#"{"access_token":"abc","token_type":"Bearer","expires_in":3600}"#;
        let tok = parse_token_response(json).unwrap();
        assert_eq!(tok.access_token, "abc");
        assert_eq!(tok.token_type, "Bearer");
        assert_eq!(tok.expires_in, 3600);
        assert!(tok.refresh_token.is_none());
        assert!(tok.scope.is_none());
    }

    #[test]
    fn parse_token_response_rejects_missing_required_fields() {
        let error = parse_token_response(r#"{"token_type":"Bearer","expires_in":3600}"#)
            .expect_err("missing access_token must fail");
        assert!(error.to_string().contains("access_token"));
    }

    #[test]
    fn parse_device_code_response_rejects_invalid_required_fields() {
        let error = parse_device_code_response(
            r#"{
                "device_code": "device",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://example.test",
                "expires_in": 900,
                "interval": -1
            }"#,
        )
        .expect_err("negative interval must fail");
        assert!(error.to_string().contains("interval"));
    }

    #[test]
    fn token_response_deserializes_with_refresh_and_scope() {
        let json = r#"{"access_token":"abc","token_type":"Bearer","expires_in":3600,"refresh_token":"r","scope":"s"}"#;
        let tok = parse_token_response(json).unwrap();
        assert_eq!(tok.refresh_token.as_deref(), Some("r"));
        assert_eq!(tok.scope.as_deref(), Some("s"));
    }

    #[test]
    fn device_code_response_deserializes() {
        let json = r#"{"device_code":"dc","user_code":"UC","verification_uri":"https://aka.ms/devicelogin","expires_in":900,"interval":5,"message":"go here"}"#;
        let dc = parse_device_code_response(json).unwrap();
        assert_eq!(dc.device_code, "dc");
        assert_eq!(dc.user_code, "UC");
        assert_eq!(dc.interval, 5);
        assert_eq!(dc.message, "go here");
    }

    #[test]
    fn device_code_response_message_defaults_when_absent() {
        let json = r#"{"device_code":"dc","user_code":"UC","verification_uri":"u","expires_in":900,"interval":5}"#;
        let dc = parse_device_code_response(json).unwrap();
        assert_eq!(dc.message, "");
    }

    #[test]
    fn token_error_response_parses() {
        let json = r#"{"error":"authorization_pending","error_description":"user has not yet authorized"}"#;
        let err: TokenErrorResponse = serde_json::from_str(json).unwrap();
        assert_eq!(err.error, "authorization_pending");
    }
}
