//! Loader integration tests using shared spec vectors from `spec/vectors/load/`.
//!
//! These tests exercise the full load pipeline: frontmatter splitting, reference
//! resolution, model shorthand expansion, and typed construction.

use serial_test::serial;
use std::path::PathBuf;

/// Path to the spec fixtures directory.
fn fixtures_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent() // runtime/rust/
        .unwrap()
        .parent() // runtime/
        .unwrap()
        .parent() // repo root
        .unwrap()
        .join("spec")
        .join("fixtures")
}

/// Load a fixture `.prompty` file with optional env vars set.
fn load_fixture(
    name: &str,
    env_vars: &[(&str, &str)],
) -> Result<prompty::model::Prompty, prompty::LoadError> {
    // Set env vars
    for (k, v) in env_vars {
        unsafe { std::env::set_var(k, v) };
    }

    let result = prompty::load(fixtures_dir().join(name));

    // Clean up env vars
    for (k, _) in env_vars {
        unsafe { std::env::remove_var(k) };
    }

    result
}

/// Load from frontmatter dict (no file, for vector tests that provide inline frontmatter).
fn load_from_frontmatter(
    frontmatter: &serde_json::Value,
    env_vars: &[(&str, &str)],
) -> Result<prompty::model::Prompty, prompty::LoadError> {
    // Build a fake .prompty string from the frontmatter
    let yaml = serde_yaml::to_string(frontmatter).unwrap();
    let raw = format!("---\n{yaml}---\n");

    for (k, v) in env_vars {
        unsafe { std::env::set_var(k, v) };
    }

    let result = prompty::load_from_string(&raw, std::env::current_dir().unwrap());

    for (k, _) in env_vars {
        unsafe { std::env::remove_var(k) };
    }

    result
}

// ===== Spec vector tests =====

#[test]
#[serial]
fn test_basic_load() {
    let agent = load_fixture(
        "basic.prompty",
        &[
            ("OPENAI_ENDPOINT", "https://test.openai.com"),
            ("OPENAI_API_KEY", "sk-test123"),
        ],
    )
    .unwrap();

    assert_eq!(agent.name, "basic-prompt");
    assert_eq!(
        agent.description.as_deref(),
        Some("A basic prompt for testing")
    );
    assert_eq!(agent.model.id, "gpt-4");
    assert_eq!(agent.model.provider.as_deref(), Some("openai"));
    assert_eq!(
        agent.model.api_type.as_ref().map(|t| t.as_str()),
        Some("chat")
    );

    // Connection
    let conn = agent.model.connection.as_object().unwrap();
    assert_eq!(conn["kind"], "key");
    assert_eq!(conn["endpoint"], "https://test.openai.com");
    assert_eq!(conn["apiKey"], "sk-test123");

    // Options
    let opts = agent.model.options.as_ref().unwrap();
    assert!((opts.temperature.unwrap() - 0.7_f32).abs() < f32::EPSILON);
    assert_eq!(opts.max_output_tokens.unwrap(), 1000);

    // Template
    let tmpl = agent.template.as_ref().unwrap();
    assert_eq!(tmpl.format.kind, "jinja2");
    assert_eq!(tmpl.parser.kind, "prompty");

    // Instructions (body)
    let instructions = agent.instructions.as_ref().unwrap();
    assert!(instructions.starts_with("system:"));
    assert!(instructions.contains("{{firstName}}"));
    assert!(instructions.contains("{{question}}"));

    // Inputs
    let inputs = agent.as_inputs().unwrap();
    assert_eq!(inputs.len(), 3);
    assert_eq!(inputs[0].name, "firstName");
    assert_eq!(inputs[0].kind_str(), "string");
    assert_eq!(inputs[1].name, "lastName");
    assert_eq!(inputs[2].name, "question");
}

#[test]
#[serial]
fn test_minimal_load() {
    let agent = load_fixture("minimal.prompty", &[]).unwrap();

    assert_eq!(agent.name, "minimal");
    assert_eq!(agent.model.id, "gpt-4");
    assert_eq!(agent.instructions.as_deref(), Some("system:\nHello world."));
    assert!(agent.as_inputs().is_none());
    assert!(agent.as_outputs().is_none());
    assert!(agent.as_tools().is_none());
}

#[test]
#[serial]
fn test_model_shorthand() {
    let fm = serde_json::json!({
        "name": "test",
        "model": "gpt-4o"
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    assert_eq!(agent.model.id, "gpt-4o");
}

#[test]
#[serial]
fn test_env_resolution() {
    let fm = serde_json::json!({
        "name": "env-test",
        "model": {
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "${env:MY_VAR}"
            }
        }
    });
    let agent = load_from_frontmatter(&fm, &[("MY_VAR", "hello")]).unwrap();
    let conn = agent.model.connection.as_object().unwrap();
    assert_eq!(conn["endpoint"], "hello");
}

#[test]
#[serial]
fn test_env_default() {
    let fm = serde_json::json!({
        "name": "env-default-test",
        "model": {
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "${env:MISSING_VAR:fallback_value}"
            }
        }
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    let conn = agent.model.connection.as_object().unwrap();
    assert_eq!(conn["endpoint"], "fallback_value");
}

#[test]
#[serial]
fn test_env_missing_error() {
    let fm = serde_json::json!({
        "name": "env-error-test",
        "model": {
            "id": "gpt-4",
            "connection": {
                "kind": "key",
                "endpoint": "${env:NONEXISTENT}"
            }
        }
    });
    let result = load_from_frontmatter(&fm, &[]);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("NONEXISTENT"));
}

#[test]
#[serial]
fn test_kind_always_prompt() {
    let agent = load_fixture("minimal.prompty", &[]).unwrap();
    // The kind is injected but not stored as a field on Prompty — it's
    // consumed during load. We verify the load succeeded (which requires
    // kind = "prompt" internally).
    assert_eq!(agent.name, "minimal");
}

#[test]
#[serial]
fn test_missing_file_error() {
    let result = prompty::load(fixtures_dir().join("nonexistent.prompty"));
    assert!(result.is_err());
}

#[test]
#[serial]
fn test_invalid_frontmatter_error() {
    let raw = "---\nname: [invalid\n---\nHello";
    let result = prompty::load_from_string(raw, std::env::current_dir().unwrap());
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.to_string().to_lowercase().contains("frontmatter")
            || err.to_string().to_lowercase().contains("yaml"),
        "Error should mention frontmatter: {err}"
    );
}

#[test]
#[serial]
fn test_instructions_from_body() {
    let agent = load_fixture(
        "basic.prompty",
        &[
            ("OPENAI_ENDPOINT", "https://test.openai.com"),
            ("OPENAI_API_KEY", "sk-test123"),
        ],
    )
    .unwrap();

    let expected = "system:\nYou are an AI assistant who helps people find information.\n\n# Customer\nYou are helping {{firstName}} {{lastName}} to find answers to their questions.\n\nuser:\n{{question}}";
    assert_eq!(agent.instructions.as_deref(), Some(expected));
}

#[test]
#[serial]
fn test_tools_function_load() {
    let agent = load_fixture("tools_function.prompty", &[]).unwrap();

    assert_eq!(agent.name, "function-tools");
    assert_eq!(
        agent.model.api_type.as_ref().map(|t| t.as_str()),
        Some("chat")
    );

    let tools = agent.as_tools().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "get_weather");
    assert_eq!(tools[0].kind_str(), "function");
}

#[test]
#[serial]
fn test_embedding_load() {
    let agent = load_fixture(
        "embedding.prompty",
        &[
            ("OPENAI_ENDPOINT", "https://test.openai.com"),
            ("OPENAI_API_KEY", "sk-test123"),
        ],
    )
    .unwrap();

    assert_eq!(agent.name, "embedding");
    assert_eq!(agent.model.id, "text-embedding-3-small");
    assert_eq!(
        agent.model.api_type.as_ref().map(|t| t.as_str()),
        Some("embedding")
    );
}

#[test]
#[serial]
fn test_empty_frontmatter_body_only() {
    let fm = serde_json::json!({
        "name": "empty-fm"
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    assert_eq!(agent.name, "empty-fm");
    assert!(agent.as_inputs().is_none());
    assert!(agent.as_tools().is_none());
}

#[test]
#[serial]
fn test_connection_types_load() {
    let fm = serde_json::json!({
        "name": "connection-test",
        "model": {
            "id": "gpt-4",
            "connection": {
                "kind": "anonymous",
                "endpoint": "https://localhost:8080"
            }
        }
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    let conn = agent.model.connection.as_object().unwrap();
    assert_eq!(conn["kind"], "anonymous");
    assert_eq!(conn["endpoint"], "https://localhost:8080");
}

#[test]
#[serial]
fn test_input_scalar_shorthand() {
    let fm = serde_json::json!({
        "name": "scalar-test",
        "model": "gpt-4",
        "inputs": [
            { "name": "topic", "kind": "string", "default": "science" },
            { "name": "count", "kind": "integer", "default": 5 }
        ]
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    let inputs = agent.as_inputs().unwrap();
    assert_eq!(inputs.len(), 2);
    assert_eq!(inputs[0].name, "topic");
    assert_eq!(inputs[0].kind_str(), "string");
    assert_eq!(inputs[1].name, "count");
    assert_eq!(inputs[1].kind_str(), "integer");
}

#[test]
#[serial]
fn test_tools_mcp_load() {
    let fm = serde_json::json!({
        "name": "mcp-test",
        "model": "gpt-4",
        "tools": [
            {
                "name": "filesystem",
                "kind": "mcp",
                "serverName": "fs-server",
                "connection": { "kind": "reference", "name": "my-mcp" }
            }
        ]
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    let tools = agent.as_tools().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "filesystem");
    assert_eq!(tools[0].kind_str(), "mcp");
}

#[test]
#[serial]
fn test_tools_openapi_load() {
    let fm = serde_json::json!({
        "name": "openapi-test",
        "model": "gpt-4",
        "tools": [
            {
                "name": "weather_api",
                "kind": "openapi",
                "specification": "./weather.json",
                "connection": { "kind": "key", "endpoint": "https://api.weather.com" }
            }
        ]
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    let tools = agent.as_tools().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "weather_api");
    assert_eq!(tools[0].kind_str(), "openapi");
}

#[test]
#[serial]
fn test_tools_custom_load() {
    let fm = serde_json::json!({
        "name": "custom-tool-test",
        "model": "gpt-4",
        "tools": [
            {
                "name": "my_tool",
                "kind": "my_provider",
                "connection": { "kind": "key", "endpoint": "https://custom.example.com" }
            }
        ]
    });
    let agent = load_from_frontmatter(&fm, &[]).unwrap();
    let tools = agent.as_tools().unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "my_tool");
    assert_eq!(tools[0].kind_str(), "my_provider");
}

#[test]
#[serial]
fn test_metadata_preserved() {
    let agent = load_fixture(
        "basic.prompty",
        &[
            ("OPENAI_ENDPOINT", "https://test.openai.com"),
            ("OPENAI_API_KEY", "sk-test123"),
        ],
    )
    .unwrap();

    let meta = agent.as_metadata_dict().unwrap();
    let authors = meta["authors"].as_array().unwrap();
    assert_eq!(authors[0], "testauthor");

    // Source path injected
    assert!(meta.contains_key("__source_path"));
}

#[test]
#[serial]
fn test_threaded_load() {
    let agent = load_fixture("threaded.prompty", &[]).unwrap();
    assert_eq!(agent.name, "threaded-chat");

    let inputs = agent.as_inputs().unwrap();
    // Should have a thread-type input
    let thread_input = inputs.iter().find(|i| i.kind_str() == "thread");
    assert!(thread_input.is_some(), "Expected a thread-kind input");
}
