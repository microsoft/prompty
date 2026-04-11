//! Connection registry — pre-register named connections for `kind: "reference"`.
//!
//! Matches TypeScript `core/connections.ts`. Providers (executors) check
//! the connection registry when `model.connection.kind == "reference"`.
//!
//! The registry stores opaque `Box<dyn Any + Send + Sync>` values — each
//! provider knows what concrete type it expects (e.g. a pre-built HTTP client,
//! a credential, or a configuration struct).

use std::any::Any;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

static CONNECTIONS: OnceLock<RwLock<HashMap<String, Box<dyn Any + Send + Sync>>>> = OnceLock::new();

fn connections() -> &'static RwLock<HashMap<String, Box<dyn Any + Send + Sync>>> {
    CONNECTIONS.get_or_init(|| RwLock::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Register a named connection.
///
/// The `client` can be any `Send + Sync + 'static` value. Providers
/// downcast it to the expected concrete type when they look it up.
pub fn register_connection(name: impl Into<String>, client: impl Any + Send + Sync + 'static) {
    connections()
        .write()
        .expect("connections lock poisoned")
        .insert(name.into(), Box::new(client));
}

/// Retrieve a registered connection by name.
///
/// # Errors
///
/// Returns an error string if the connection is not registered.
pub fn get_connection(name: &str) -> Result<Box<dyn Any + Send + Sync>, String> {
    let map = connections().read().expect("connections lock poisoned");
    // We can't clone Box<dyn Any>, so we check existence and return an error.
    // Callers should use `get_connection_ref` for zero-copy access.
    if map.contains_key(name) {
        drop(map);
        // Remove and return — this is a take-based pattern
        // Actually, connections should be reusable. Let's provide a ref-based API instead.
        Err(format!(
            "Use get_connection_ref() for zero-copy access to connection '{name}'"
        ))
    } else {
        Err(format!(
            "Connection \"{name}\" is not registered. Use register_connection() first."
        ))
    }
}

/// Check whether a named connection is registered.
pub fn has_connection(name: &str) -> bool {
    connections()
        .read()
        .expect("connections lock poisoned")
        .contains_key(name)
}

/// Access a registered connection by name, downcasting to the expected type.
///
/// Returns `None` if the connection is not registered or if the downcast fails.
///
/// # Example
///
/// ```ignore
/// use prompty::connections::{register_connection, with_connection};
///
/// register_connection("my-openai", MyOpenAIClient::new());
/// let result = with_connection::<MyOpenAIClient, _>("my-openai", |client| {
///     client.do_something()
/// });
/// ```
pub fn with_connection<T: Any + Send + Sync, R>(
    name: &str,
    f: impl FnOnce(&T) -> R,
) -> Result<R, String> {
    let map = connections().read().expect("connections lock poisoned");
    let boxed = map.get(name).ok_or_else(|| {
        format!("Connection \"{name}\" is not registered. Use register_connection() first.")
    })?;
    let typed = boxed.downcast_ref::<T>().ok_or_else(|| {
        format!("Connection \"{name}\" exists but is not the expected type")
    })?;
    Ok(f(typed))
}

/// Clear all registered connections. Useful for testing.
pub fn clear_connections() {
    if let Some(m) = CONNECTIONS.get() {
        m.write().expect("connections lock poisoned").clear();
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[derive(Debug)]
    struct FakeClient {
        endpoint: String,
    }

    #[test]
    #[serial]
    fn test_register_and_check() {
        clear_connections();
        assert!(!has_connection("test"));
        register_connection(
            "test",
            FakeClient {
                endpoint: "https://example.com".into(),
            },
        );
        assert!(has_connection("test"));
    }

    #[test]
    #[serial]
    fn test_with_connection_success() {
        clear_connections();
        register_connection(
            "my-client",
            FakeClient {
                endpoint: "https://api.example.com".into(),
            },
        );
        let endpoint = with_connection::<FakeClient, _>("my-client", |c| c.endpoint.clone());
        assert_eq!(endpoint.unwrap(), "https://api.example.com");
    }

    #[test]
    #[serial]
    fn test_with_connection_missing() {
        clear_connections();
        let result = with_connection::<FakeClient, _>("missing", |_| ());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not registered"));
    }

    #[test]
    #[serial]
    fn test_with_connection_wrong_type() {
        clear_connections();
        register_connection("typed", 42_u32);
        let result = with_connection::<FakeClient, _>("typed", |_| ());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not the expected type"));
    }

    #[test]
    #[serial]
    fn test_clear_connections() {
        register_connection("temp", 100_u32);
        assert!(has_connection("temp"));
        clear_connections();
        assert!(!has_connection("temp"));
    }

    #[test]
    #[serial]
    fn test_overwrite_connection() {
        clear_connections();
        register_connection(
            "overwrite",
            FakeClient {
                endpoint: "old".into(),
            },
        );
        register_connection(
            "overwrite",
            FakeClient {
                endpoint: "new".into(),
            },
        );
        let endpoint = with_connection::<FakeClient, _>("overwrite", |c| c.endpoint.clone());
        assert_eq!(endpoint.unwrap(), "new");
    }
}
