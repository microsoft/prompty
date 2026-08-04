//! Resolve Anthropic API endpoints consistently across provider operations.

use serde_json::Value;

const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";

pub(crate) fn build_api_url(connection: &Value, resource: &str) -> String {
    let endpoint = connection
        .get("endpoint")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            std::env::var("ANTHROPIC_BASE_URL")
                .ok()
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

    let base = endpoint.trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{base}/{resource}")
    } else {
        format!("{base}/v1/{resource}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;

    struct BaseUrlGuard(Option<std::ffi::OsString>);

    impl BaseUrlGuard {
        fn set(value: Option<&str>) -> Self {
            let original = std::env::var_os("ANTHROPIC_BASE_URL");
            match value {
                Some(value) => unsafe { std::env::set_var("ANTHROPIC_BASE_URL", value) },
                None => unsafe { std::env::remove_var("ANTHROPIC_BASE_URL") },
            }
            Self(original)
        }
    }

    impl Drop for BaseUrlGuard {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => unsafe { std::env::set_var("ANTHROPIC_BASE_URL", value) },
                None => unsafe { std::env::remove_var("ANTHROPIC_BASE_URL") },
            }
        }
    }

    #[test]
    #[serial]
    fn default_endpoint_is_used_when_unconfigured() {
        let _guard = BaseUrlGuard::set(None);

        assert_eq!(
            build_api_url(&json!({}), "messages"),
            "https://api.anthropic.com/v1/messages"
        );
    }

    #[test]
    #[serial]
    fn connection_endpoint_takes_precedence_over_environment() {
        let _guard = BaseUrlGuard::set(Some("https://environment.example/v1"));
        let connection = json!({"endpoint": "https://connection.example/v1/"});

        assert_eq!(
            build_api_url(&connection, "messages"),
            "https://connection.example/v1/messages"
        );
    }

    #[test]
    #[serial]
    fn environment_endpoint_is_used_without_duplicate_v1() {
        let _guard = BaseUrlGuard::set(Some("https://environment.example/v1/"));

        assert_eq!(
            build_api_url(&json!({}), "messages"),
            "https://environment.example/v1/messages"
        );
        assert_eq!(
            build_api_url(&json!({}), "models"),
            "https://environment.example/v1/models"
        );
    }
}
