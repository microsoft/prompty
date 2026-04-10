//! `${protocol:value}` reference resolution.
//!
//! Recursively walks all string values in a `serde_json::Value` tree,
//! resolving `${env:VAR}`, `${env:VAR:default}`, and `${file:path}`.

use std::path::Path;

use super::error::LoadError;

/// Recursively resolve `${protocol:value}` references in-place.
pub fn resolve_references(value: &mut serde_json::Value, agent_dir: &Path) -> Result<(), LoadError> {
    match value {
        serde_json::Value::Object(map) => {
            // Collect keys first to avoid borrow issues
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                let val = map.get(&key).cloned();
                if let Some(serde_json::Value::String(s)) = val {
                    if let Some(resolved) = try_resolve_string(&s, &key, agent_dir)? {
                        map.insert(key, resolved);
                    }
                } else if let Some(mut inner) = val {
                    resolve_references(&mut inner, agent_dir)?;
                    map.insert(key, inner);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                resolve_references(item, agent_dir)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Try to resolve a single `${protocol:value}` string without error propagation.
/// Returns `Some(resolved_value)` if the string was a valid reference that could
/// be resolved, `None` otherwise (non-reference strings, unknown protocols, or
/// errors are all silently skipped).
///
/// Used by `LoadContext.pre_process` to resolve references as the model tree loads.
pub fn resolve_single_ref(s: &str, agent_dir: &Path) -> Option<serde_json::Value> {
    try_resolve_string(s, "<pre_process>", agent_dir).ok().flatten()
}

/// Try to resolve a single string value. Returns `Some(resolved)` if it was
/// a `${protocol:value}` reference, `None` if it should be kept as-is.
fn try_resolve_string(
    s: &str,
    key: &str,
    agent_dir: &Path,
) -> Result<Option<serde_json::Value>, LoadError> {
    if !s.starts_with("${") || !s.ends_with('}') {
        return Ok(None);
    }

    let inner = &s[2..s.len() - 1];
    let Some(colon_idx) = inner.find(':') else {
        return Ok(None);
    };

    let protocol = inner[..colon_idx].to_lowercase();
    let val = &inner[colon_idx + 1..];

    match protocol.as_str() {
        "env" => resolve_env(val, key),
        "file" => resolve_file(val, agent_dir, key),
        _ => Ok(None), // Unknown protocol — leave as-is
    }
}

/// Resolve `${env:VAR}` or `${env:VAR:default}`.
fn resolve_env(val: &str, key: &str) -> Result<Option<serde_json::Value>, LoadError> {
    let next_colon = val.find(':');
    let var_name = match next_colon {
        Some(pos) => &val[..pos],
        None => val,
    };
    let default_val = next_colon.map(|pos| &val[pos + 1..]);

    match std::env::var(var_name) {
        Ok(env_val) => Ok(Some(serde_json::Value::String(env_val))),
        Err(_) => match default_val {
            Some(d) => Ok(Some(serde_json::Value::String(d.to_string()))),
            None => Err(LoadError::EnvVarNotSet {
                var_name: var_name.to_string(),
                key: key.to_string(),
            }),
        },
    }
}

/// Resolve `${file:relative/path}`.
fn resolve_file(
    relative_path: &str,
    agent_dir: &Path,
    _key: &str,
) -> Result<Option<serde_json::Value>, LoadError> {
    let full_path = agent_dir.join(relative_path);
    let content = std::fs::read_to_string(&full_path).map_err(|e| LoadError::FileReference {
        path: full_path.clone(),
        detail: e.to_string(),
    })?;

    let ext = full_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "json" => {
            let parsed: serde_json::Value = serde_json::from_str(&content)
                .map_err(|e| LoadError::FileReference {
                    path: full_path,
                    detail: format!("Invalid JSON: {e}"),
                })?;
            Ok(Some(parsed))
        }
        "yaml" | "yml" => {
            let parsed: serde_json::Value = serde_yaml::from_str(&content)
                .map_err(|e| LoadError::FileReference {
                    path: full_path,
                    detail: format!("Invalid YAML: {e}"),
                })?;
            Ok(Some(parsed))
        }
        _ => Ok(Some(serde_json::Value::String(content))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_resolution() {
        unsafe { std::env::set_var("PROMPTY_TEST_VAR", "hello") };
        let mut val = serde_json::json!({
            "endpoint": "${env:PROMPTY_TEST_VAR}"
        });
        resolve_references(&mut val, Path::new(".")).unwrap();
        assert_eq!(val["endpoint"], "hello");
        unsafe { std::env::remove_var("PROMPTY_TEST_VAR") };
    }

    #[test]
    fn test_env_default() {
        let mut val = serde_json::json!({
            "endpoint": "${env:PROMPTY_DEFINITELY_MISSING:fallback}"
        });
        resolve_references(&mut val, Path::new(".")).unwrap();
        assert_eq!(val["endpoint"], "fallback");
    }

    #[test]
    fn test_env_missing_error() {
        let mut val = serde_json::json!({
            "endpoint": "${env:PROMPTY_DEFINITELY_MISSING}"
        });
        let result = resolve_references(&mut val, Path::new("."));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("PROMPTY_DEFINITELY_MISSING"));
    }

    #[test]
    fn test_nested_resolution() {
        unsafe { std::env::set_var("PROMPTY_NESTED_VAR", "resolved") };
        let mut val = serde_json::json!({
            "model": {
                "connection": {
                    "endpoint": "${env:PROMPTY_NESTED_VAR}"
                }
            }
        });
        resolve_references(&mut val, Path::new(".")).unwrap();
        assert_eq!(val["model"]["connection"]["endpoint"], "resolved");
        unsafe { std::env::remove_var("PROMPTY_NESTED_VAR") };
    }

    #[test]
    fn test_non_reference_strings_unchanged() {
        let mut val = serde_json::json!({
            "name": "test",
            "description": "not a ${reference"
        });
        resolve_references(&mut val, Path::new(".")).unwrap();
        assert_eq!(val["name"], "test");
        assert_eq!(val["description"], "not a ${reference");
    }

    #[test]
    fn test_file_resolution_json() {
        // Create a temp JSON file
        let dir = std::env::temp_dir().join("prompty_resolve_test");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("config.json");
        std::fs::write(&file_path, r#"{"endpoint": "https://api.example.com", "apiKey": "test123"}"#).unwrap();

        let mut val = serde_json::json!({
            "connection": "${file:config.json}"
        });
        resolve_references(&mut val, &dir).unwrap();

        // JSON files should be parsed into structured data
        assert_eq!(val["connection"]["endpoint"], "https://api.example.com");
        assert_eq!(val["connection"]["apiKey"], "test123");

        // Cleanup
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_resolution_yaml() {
        let dir = std::env::temp_dir().join("prompty_resolve_yaml_test");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("config.yaml");
        std::fs::write(&file_path, "endpoint: https://api.example.com\nmodel: gpt-4").unwrap();

        let mut val = serde_json::json!({
            "config": "${file:config.yaml}"
        });
        resolve_references(&mut val, &dir).unwrap();

        assert_eq!(val["config"]["endpoint"], "https://api.example.com");
        assert_eq!(val["config"]["model"], "gpt-4");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_resolution_plain_text() {
        let dir = std::env::temp_dir().join("prompty_resolve_txt_test");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("prompt.txt");
        std::fs::write(&file_path, "You are a helpful assistant.").unwrap();

        let mut val = serde_json::json!({
            "system_prompt": "${file:prompt.txt}"
        });
        resolve_references(&mut val, &dir).unwrap();

        assert_eq!(val["system_prompt"], "You are a helpful assistant.");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_resolution_missing_file() {
        let mut val = serde_json::json!({
            "config": "${file:nonexistent.json}"
        });
        let result = resolve_references(&mut val, Path::new("."));
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("nonexistent.json"));
    }

    #[test]
    fn test_file_resolution_nested() {
        let dir = std::env::temp_dir().join("prompty_resolve_nested_test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("conn.json"), r#"{"kind": "key", "apiKey": "sk-test"}"#).unwrap();

        let mut val = serde_json::json!({
            "model": {
                "connection": "${file:conn.json}"
            }
        });
        resolve_references(&mut val, &dir).unwrap();

        assert_eq!(val["model"]["connection"]["kind"], "key");
        assert_eq!(val["model"]["connection"]["apiKey"], "sk-test");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_array_resolution() {
        unsafe { std::env::set_var("PROMPTY_ARR_TEST", "resolved") };
        let mut val = serde_json::json!({
            "items": [
                {"value": "${env:PROMPTY_ARR_TEST}"},
                {"value": "static"}
            ]
        });
        resolve_references(&mut val, Path::new(".")).unwrap();
        assert_eq!(val["items"][0]["value"], "resolved");
        assert_eq!(val["items"][1]["value"], "static");
        unsafe { std::env::remove_var("PROMPTY_ARR_TEST") };
    }
}
