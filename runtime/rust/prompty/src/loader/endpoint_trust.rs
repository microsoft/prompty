//! Endpoint trust — keep ambient credentials on host-approved destinations (spec §2.5.1).
//!
//! A `.prompty` file is untrusted input. When its connection carries no
//! file-supplied credential, executors fall back to ambient credentials
//! (`DeveloperToolsCredential`, `*_API_KEY` env vars). This module decides
//! whether the file-chosen destination may receive them.

use std::net::Ipv6Addr;

use serde_json::Value;

use super::error::LoadError;

/// Env var holding a comma-separated list of additional trusted origins.
pub const TRUSTED_ENDPOINTS_ENV: &str = "PROMPTY_TRUSTED_ENDPOINTS";

/// First-party provider origins that are always trusted.
pub const BUILTIN_TRUSTED_ENDPOINTS: &[&str] = &[
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://*.openai.azure.com",
    "https://*.services.ai.azure.com",
    "https://*.cognitiveservices.azure.com",
    "https://login.microsoftonline.com",
];

const DESTINATION_KEYS: [&str; 2] = ["endpoint", "tokenUrl"];

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    }
}

/// Return `(scheme, host, port)` for an absolute http(s) URL, else `None`.
///
/// Mirrors Python's `urllib.parse.urlsplit` semantics used by the reference
/// implementation; additionally treats a backslash in the authority as
/// unparseable, since WHATWG-style HTTP clients read it as a path separator.
fn origin(url: &str) -> Option<(String, String, u16)> {
    let cleaned: String = url
        .trim()
        .trim_start_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\r' | '\n'))
        .collect();

    let colon = cleaned.find(':')?;
    let scheme = &cleaned[..colon];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }
    let scheme = scheme.to_ascii_lowercase();
    let default = default_port(&scheme)?;

    let rest = cleaned[colon + 1..].strip_prefix("//")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let netloc = &rest[..end];
    if netloc.contains('\\') || netloc.contains('[') != netloc.contains(']') {
        return None;
    }

    let hostinfo = netloc.rsplit_once('@').map_or(netloc, |(_, h)| h);
    let (host, port) = match hostinfo.split_once('[') {
        Some((_, bracketed)) => {
            let (host, after) = bracketed.split_once(']').unwrap_or((bracketed, ""));
            if host.parse::<Ipv6Addr>().is_err() {
                return None;
            }
            (host, after.split_once(':').map_or("", |(_, p)| p))
        }
        None => hostinfo.split_once(':').unwrap_or((hostinfo, "")),
    };
    let host = host.to_lowercase();
    if host.is_empty() {
        return None;
    }
    let port = if port.is_empty() {
        default
    } else {
        if !port.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        port.parse::<u16>().ok()?
    };
    Some((scheme, host, port))
}

fn trusted_entries(trusted_endpoints: &[String]) -> Vec<String> {
    let env = std::env::var(TRUSTED_ENDPOINTS_ENV).unwrap_or_default();
    BUILTIN_TRUSTED_ENDPOINTS
        .iter()
        .map(|s| s.to_string())
        .chain(trusted_endpoints.iter().cloned())
        .chain(env.split(',').map(str::to_string))
        .map(|e| e.trim().to_string())
        .filter(|e| !e.is_empty())
        .collect()
}

/// Return `true` if `url`'s origin matches a built-in, host, or env trusted origin.
pub fn is_trusted_endpoint(url: &str, trusted_endpoints: &[String]) -> bool {
    let entries = trusted_entries(trusted_endpoints);
    if entries.iter().any(|e| e == "*") {
        return true;
    }
    let Some((scheme, host, port)) = origin(url) else {
        return false;
    };
    entries.iter().any(|entry| {
        let Some((a_scheme, pattern, a_port)) = origin(entry) else {
            return false;
        };
        if a_scheme != scheme || a_port != port {
            return false;
        }
        match pattern.strip_prefix('*') {
            Some(suffix) if suffix.starts_with('.') => host.ends_with(suffix),
            _ => pattern == host,
        }
    })
}

fn is_reference(value: &str) -> bool {
    value.starts_with("${") && value.ends_with('}')
}

fn file_supplied_credential(connection: &serde_json::Map<String, Value>) -> bool {
    // Only the credential field the declared kind actually consumes counts; any other kind is ambient.
    let key = match connection.get("kind").and_then(Value::as_str) {
        Some("key") => "apiKey",

        _ => return false,
    };
    matches!(connection.get(key), Some(Value::String(s)) if !s.is_empty() && !is_reference(s))
}

/// Return the effective destination if the file chose it, else `None`.
fn file_controlled_destination(value: Option<&Value>) -> Option<String> {
    let value = match value? {
        Value::Null => return None,
        Value::String(s) => s,
        other => return Some(other.to_string()),
    };
    if is_reference(value) {
        let inner = &value[2..value.len() - 1];
        let (protocol, rest) = inner.split_once(':').unwrap_or((inner, ""));
        if protocol.eq_ignore_ascii_case("env") {
            let (var_name, default) = rest.split_once(':').unwrap_or((rest, ""));
            if std::env::var_os(var_name).is_some() || default.is_empty() {
                return None;
            }
            return Some(default.to_string());
        }
    }
    Some(value.clone())
}

/// Return [`LoadError::UntrustedEndpoint`] if ambient credentials could reach a
/// file-chosen, untrusted destination.
///
/// `connection` is the RAW (unresolved) `model.connection` value.
pub fn check_connection_trust(
    connection: Option<&Value>,
    trusted_endpoints: &[String],
) -> Result<(), LoadError> {
    let Some(Value::Object(connection)) = connection else {
        return Ok(());
    };
    if connection.get("kind").and_then(Value::as_str) == Some("reference")
        || file_supplied_credential(connection)
    {
        return Ok(());
    }
    for key in DESTINATION_KEYS {
        if let Some(destination) = file_controlled_destination(connection.get(key)) {
            if !is_trusted_endpoint(&destination, trusted_endpoints) {
                return Err(LoadError::UntrustedEndpoint(format!(
                    "Connection {key} '{destination}' is not trusted to receive ambient credentials. \
                     Set the {key} via ${{env:VAR}}, add its origin to trusted_endpoints or \
                     {TRUSTED_ENDPOINTS_ENV}, or use 'kind: reference'."
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loader::{LoadOptions, load_with_options};
    use serial_test::serial;
    use std::path::{Path, PathBuf};

    struct EnvGuard(Vec<(&'static str, Option<std::ffi::OsString>)>);

    impl EnvGuard {
        fn new(vars: &[(&'static str, Option<&str>)]) -> Self {
            let mut saved = vec![(
                TRUSTED_ENDPOINTS_ENV,
                std::env::var_os(TRUSTED_ENDPOINTS_ENV),
            )];
            unsafe { std::env::remove_var(TRUSTED_ENDPOINTS_ENV) };
            for (k, v) in vars {
                saved.push((k, std::env::var_os(k)));
                match v {
                    Some(v) => unsafe { std::env::set_var(k, v) },
                    None => unsafe { std::env::remove_var(k) },
                }
            }
            EnvGuard(saved)
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (k, v) in self.0.iter().rev() {
                match v {
                    Some(v) => unsafe { std::env::set_var(k, v) },
                    None => unsafe { std::env::remove_var(k) },
                }
            }
        }
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("prompty_trust_{name}_{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(dir: &Path, connection: &str) -> PathBuf {
        let p = dir.join("t.prompty");
        std::fs::write(
            &p,
            format!("---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n{connection}\n---\nHello\n"),
        )
        .unwrap();
        p
    }

    fn load_err(p: &Path, trusted: &[&str]) -> LoadError {
        let options = LoadOptions {
            trusted_endpoints: trusted.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        load_with_options(p, options).expect_err("expected load to fail")
    }

    fn endpoint(p: &Path, trusted: &[&str]) -> String {
        let options = LoadOptions {
            trusted_endpoints: trusted.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        let agent = load_with_options(p, options).expect("expected load to succeed");
        crate::model_access::model_connection(&agent.model)["endpoint"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    }

    fn trusted(url: &str, extra: &[&str]) -> bool {
        let extra: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
        is_trusted_endpoint(url, &extra)
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn builtin_trusted() {
        let _env = EnvGuard::new(&[]);
        for url in [
            "https://api.openai.com/v1",
            "https://API.OpenAI.com:443",
            "https://myres.openai.azure.com/",
            "https://a.b.services.ai.azure.com/api/projects/p",
            "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        ] {
            assert!(trusted(url, &[]), "{url} should be trusted");
        }
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn untrusted() {
        let _env = EnvGuard::new(&[]);
        for url in [
            "http://api.openai.com",
            "https://api.openai.com:8443",
            "https://openai.azure.com",
            "https://api.openai.com.evil.com",
            "https://evilopenai.azure.com",
            "https://api.openai.com@evil.com",
            "https://evil.com\\@api.openai.com",
            "http://localhost:11434",
            "not a url",
            "ftp://api.openai.com",
            "https://api.openai.com:99999",
            "https://[::1",
            "",
        ] {
            assert!(!trusted(url, &[]), "{url} should be untrusted");
        }
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn host_option_and_wildcard() {
        let _env = EnvGuard::new(&[]);
        assert!(trusted(
            "http://localhost:11434/v1",
            &["http://LOCALHOST:11434"]
        ));
        assert!(trusted("https://x.contoso.com", &["https://*.contoso.com"]));
        assert!(!trusted("https://contoso.com", &["https://*.contoso.com"]));
        assert!(trusted("http://[::1]:8080/x", &["http://[::1]:8080"]));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn env_list_and_star() {
        let _env = EnvGuard::new(&[(
            TRUSTED_ENDPOINTS_ENV,
            Some(" https://a.example.com , http://localhost:8080"),
        )]);
        assert!(trusted("http://localhost:8080/x", &[]));
        assert!(!trusted("http://localhost:8081", &[]));
        unsafe { std::env::set_var(TRUSTED_ENDPOINTS_ENV, "*") };
        assert!(trusted("http://anything.example", &[]));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn ambient_literal_endpoint_rejected() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("ambient");
        let p = write(
            &tmp.0,
            "    kind: foundry\n    endpoint: http://127.0.0.1:9999",
        );
        let err = load_err(&p, &[]);
        assert!(matches!(err, LoadError::UntrustedEndpoint(_)));
        assert!(err.to_string().contains("127.0.0.1"));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn env_key_literal_endpoint_rejected() {
        let _env = EnvGuard::new(&[("PROMPTY_TRUST_SOME_KEY", Some("secret"))]);
        let tmp = TempDir::new("envkey");
        let p = write(
            &tmp.0,
            "    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:PROMPTY_TRUST_SOME_KEY}",
        );
        assert!(load_err(&p, &[]).to_string().contains("not trusted"));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn oauth_token_url_checked() {
        let _env = EnvGuard::new(&[("PROMPTY_TRUST_SECRET", Some("s"))]);
        let tmp = TempDir::new("oauth");
        let p = write(
            &tmp.0,
            "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n    \
             clientSecret: ${env:PROMPTY_TRUST_SECRET}\n    tokenUrl: https://evil.example.com/token",
        );
        assert!(load_err(&p, &[]).to_string().contains("tokenUrl"));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn mismatched_credential_field_rejected() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("mismatch");
        let p = write(
            &tmp.0,
            "    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk",
        );
        assert!(load_err(&p, &[]).to_string().contains("not trusted"));
        let p = write(
            &tmp.0,
            "    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk",
        );
        assert!(load_err(&p, &[]).to_string().contains("not trusted"));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn literal_key_allowed() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("literal");
        let p = write(
            &tmp.0,
            "    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine",
        );
        assert_eq!(endpoint(&p, &[]), "http://127.0.0.1:9999");
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn env_endpoint_allowed() {
        let _env = EnvGuard::new(&[("PROMPTY_TRUST_EP", Some("http://127.0.0.1:9999"))]);
        let tmp = TempDir::new("envep");
        let p = write(
            &tmp.0,
            "    kind: foundry\n    endpoint: ${env:PROMPTY_TRUST_EP}",
        );
        assert_eq!(endpoint(&p, &[]), "http://127.0.0.1:9999");
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn env_default_used_rejected() {
        let _env = EnvGuard::new(&[("PROMPTY_TRUST_UNSET_EP", None)]);
        let tmp = TempDir::new("envdefault");
        let p = write(
            &tmp.0,
            "    kind: foundry\n    endpoint: ${env:PROMPTY_TRUST_UNSET_EP:http://127.0.0.1:9999}",
        );
        assert!(load_err(&p, &[]).to_string().contains("not trusted"));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn trusted_option_allows() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("option");
        let p = write(
            &tmp.0,
            "    kind: foundry\n    endpoint: http://127.0.0.1:9999/api",
        );
        assert_eq!(
            endpoint(&p, &["http://127.0.0.1:9999"]),
            "http://127.0.0.1:9999/api"
        );
    }

    #[tokio::test]
    #[serial(prompty_trusted_env)]
    async fn async_honors_option() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("async");
        let p = write(
            &tmp.0,
            "    kind: foundry\n    endpoint: http://127.0.0.1:9999",
        );
        assert!(
            crate::loader::load_async(&p).await.is_err(),
            "untrusted endpoint must be rejected"
        );
        let options = LoadOptions {
            trusted_endpoints: vec!["http://127.0.0.1:9999".to_string()],
            ..Default::default()
        };
        let agent = crate::loader::load_async_with_options(&p, options)
            .await
            .unwrap();
        assert_eq!(
            crate::model_access::model_connection(&agent.model)["endpoint"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            "http://127.0.0.1:9999"
        );
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn file_model_reference_checked() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("filemodel");
        std::fs::write(
            tmp.0.join("model.json"),
            r#"{"id": "gpt-4", "connection": {"kind": "foundry", "endpoint": "https://evil.example.com"}}"#,
        )
        .unwrap();
        let p = tmp.0.join("t.prompty");
        std::fs::write(&p, "---\nname: t\nmodel: ${file:model.json}\n---\nHi\n").unwrap();
        assert!(load_err(&p, &[]).to_string().contains("not trusted"));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn file_connection_traversal_is_file_reference() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("traversal");
        let sub = tmp.0.join("prompts");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(
            tmp.0.join("conn.json"),
            r#"{"kind": "foundry", "endpoint": "https://evil.example.com"}"#,
        )
        .unwrap();
        let p = sub.join("t.prompty");
        std::fs::write(
            &p,
            "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:../conn.json}\n---\nHi\n",
        )
        .unwrap();
        assert!(matches!(load_err(&p, &[]), LoadError::FileReference { .. }));
    }

    #[test]
    #[serial(prompty_trusted_env)]
    fn frontmatter_cannot_self_trust() {
        let _env = EnvGuard::new(&[]);
        let tmp = TempDir::new("selftrust");
        let p = tmp.0.join("t.prompty");
        std::fs::write(
            &p,
            "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n\
             model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n",
        )
        .unwrap();
        assert!(matches!(load_err(&p, &[]), LoadError::UntrustedEndpoint(_)));
    }
}
