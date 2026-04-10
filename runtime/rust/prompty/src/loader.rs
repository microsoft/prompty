//! Prompty loader — loads `.prompty` files into typed `Prompty` objects.
//!
//! Splits frontmatter (YAML) from the markdown body, resolves
//! `${protocol:value}` references (env vars, file includes) via
//! `LoadContext.pre_process`, and delegates to `Prompty::load_from_value()`.

use std::path::{Path, PathBuf};

use crate::model::context::LoadContext;
use crate::model::Prompty;

mod error;
mod frontmatter;
mod resolve;

pub use error::LoadError;

/// Load a `.prompty` file and return a typed `Prompty`.
///
/// Per the spec, the runtime MUST NOT auto-load `.env` files.
/// Environment variable loading is the application's responsibility.
///
/// # Errors
///
/// Returns `LoadError` if the file cannot be read, the frontmatter is
/// malformed, or `${env:VAR}` / `${file:path}` references cannot be resolved.
pub fn load(path: impl AsRef<Path>) -> Result<Prompty, LoadError> {
    let resolved = path.as_ref().canonicalize().map_err(|e| {
        LoadError::FileNotFound(path.as_ref().to_path_buf(), e.to_string())
    })?;

    let span = crate::tracing::Tracer::start("load");
    span.emit("signature", &serde_json::json!("prompty.load"));
    span.emit("inputs", &serde_json::json!({ "path": resolved.display().to_string() }));

    let raw = std::fs::read_to_string(&resolved).map_err(|e| {
        LoadError::FileNotFound(resolved.clone(), e.to_string())
    })?;

    // Normalize line endings (Windows \r\n → \n)
    let raw = raw.replace("\r\n", "\n");

    match build_agent(&raw, &resolved) {
        Ok(agent) => {
            span.emit("result", &serde_json::json!({ "name": agent.name }));
            span.end();
            Ok(agent)
        }
        Err(e) => {
            span.emit("error", &serde_json::json!(e.to_string()));
            span.end();
            Err(e)
        }
    }
}

/// Asynchronously load a `.prompty` file and return a typed `Prompty`.
///
/// Uses `tokio::fs` for non-blocking file I/O, avoiding blocking the async
/// runtime's thread pool. Equivalent to `load()` but suitable for async contexts.
///
/// # Errors
///
/// Returns `LoadError` if the file cannot be read, the frontmatter is
/// malformed, or `${env:VAR}` / `${file:path}` references cannot be resolved.
pub async fn load_async(path: impl AsRef<Path>) -> Result<Prompty, LoadError> {
    let path_buf = path.as_ref().to_path_buf();
    let resolved = tokio::fs::canonicalize(&path_buf).await.map_err(|e| {
        LoadError::FileNotFound(path_buf.clone(), e.to_string())
    })?;

    let span = crate::tracing::Tracer::start("load");
    span.emit("signature", &serde_json::json!("prompty.load"));
    span.emit("inputs", &serde_json::json!({ "path": resolved.display().to_string() }));

    let raw = tokio::fs::read_to_string(&resolved).await.map_err(|e| {
        LoadError::FileNotFound(resolved.clone(), e.to_string())
    })?;

    // Normalize line endings (Windows \r\n → \n)
    let raw = raw.replace("\r\n", "\n");

    match build_agent(&raw, &resolved) {
        Ok(agent) => {
            span.emit("result", &serde_json::json!({ "name": agent.name }));
            span.end();
            Ok(agent)
        }
        Err(e) => {
            span.emit("error", &serde_json::json!(e.to_string()));
            span.end();
            Err(e)
        }
    }
}

/// Load from raw `.prompty` content with an explicit base path for
/// `${file:...}` resolution.
///
/// Useful when the `.prompty` content comes from a string rather than a file.
pub fn load_from_string(raw: &str, base_path: impl AsRef<Path>) -> Result<Prompty, LoadError> {
    build_agent(raw, base_path.as_ref())
}

// ---------------------------------------------------------------------------
// Internal pipeline
// ---------------------------------------------------------------------------

fn build_agent(raw: &str, file_path: &Path) -> Result<Prompty, LoadError> {
    // 1. Split frontmatter + body
    let (mut data, body) = frontmatter::split(raw)?;

    // 2. If there's a body (instructions), merge it in
    //    Trim trailing newlines (editors add them) but preserve leading/internal whitespace
    let body = body.trim_end_matches('\n').trim_end_matches('\r');
    if !body.is_empty() {
        data.insert(
            "instructions".to_string(),
            serde_json::Value::String(body.to_string()),
        );
    }

    // 3. Inject kind = "prompt" — .prompty files are always PromptAgents
    data.insert(
        "kind".to_string(),
        serde_json::Value::String("prompt".to_string()),
    );

    // 4. Build LoadContext with ${env:} / ${file:} resolution as pre_process
    let agent_dir = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let ctx = make_load_context(agent_dir);

    // 5. Resolve references on the top-level data before loading
    //    (pre_process handles nested dicts as the model recurses)
    let mut value = serde_json::Value::Object(data);
    resolve::resolve_references(&mut value, file_path.parent().unwrap_or(Path::new(".")))?;

    // 6. Load via emitter-generated typed constructor with context
    let agent = Prompty::load_from_value(&value, &ctx);

    // 7. Store source path in metadata for PromptyTool resolution
    let mut result = agent;
    let meta = ensure_metadata_object(&mut result);
    meta.insert(
        "__source_path".to_string(),
        serde_json::Value::String(file_path.to_string_lossy().to_string()),
    );

    Ok(result)
}

/// Build a `LoadContext` with `pre_process` wired to resolve `${env:}` / `${file:}`.
fn make_load_context(agent_dir: PathBuf) -> LoadContext {
    LoadContext {
        pre_process: Some(Box::new(move |mut value| {
            // Walk all string values in this dict and resolve ${protocol:value} refs
            if let Some(obj) = value.as_object_mut() {
                for val in obj.values_mut() {
                    if let Some(s) = val.as_str() {
                        if let Some(resolved) = resolve::resolve_single_ref(s, &agent_dir) {
                            *val = resolved;
                        }
                    }
                }
            }
            value
        })),
        post_process: None,
    }
}

/// Ensure `metadata` is an object; create one if it's null or not already an object.
fn ensure_metadata_object(agent: &mut Prompty) -> &mut serde_json::Map<String, serde_json::Value> {
    if !agent.metadata.is_object() {
        agent.metadata = serde_json::Value::Object(serde_json::Map::new());
    }
    // Safety: we just ensured it's an object above
    agent.metadata.as_object_mut().unwrap()
}


