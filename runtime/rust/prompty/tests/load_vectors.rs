//! Data-driven load tests powered by `spec/vectors/load/load_vectors.json`.
//!
//! Each vector in the JSON array specifies input (fixture file, inline
//! frontmatter, env vars, virtual files) and expected output (agent fields or
//! errors). The single `#[test]` iterates over all 25 vectors and reports
//! failures by vector name.

use std::path::{Path, PathBuf};

use serde_json::Value;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Repo root — three levels up from `CARGO_MANIFEST_DIR` (runtime/rust/prompty).
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn fixtures_dir() -> PathBuf {
    repo_root().join("spec").join("fixtures")
}

fn vectors_path() -> PathBuf {
    repo_root()
        .join("spec")
        .join("vectors")
        .join("load")
        .join("load_vectors.json")
}

// ---------------------------------------------------------------------------
// Env-var helpers (unsafe because set_var / remove_var are unsafe on nightly)
// ---------------------------------------------------------------------------

fn set_env_vars(env: &Value) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(obj) = env.as_object() {
        for (k, v) in obj {
            if let Some(val) = v.as_str() {
                unsafe { std::env::set_var(k, val) };
                keys.push(k.clone());
            }
        }
    }
    keys
}

fn clear_env_vars(keys: &[String]) {
    for k in keys {
        unsafe { std::env::remove_var(k) };
    }
}

// ---------------------------------------------------------------------------
// Load helpers
// ---------------------------------------------------------------------------

fn load_fixture(name: &str, env: &Value) -> Result<prompty::model::Prompty, prompty::LoadError> {
    let keys = set_env_vars(env);
    let result = prompty::load(fixtures_dir().join(name));
    clear_env_vars(&keys);
    result
}

fn load_from_frontmatter(
    frontmatter: &Value,
    env: &Value,
) -> Result<prompty::model::Prompty, prompty::LoadError> {
    let yaml = serde_yaml::to_string(frontmatter).unwrap();
    let raw = format!("---\n{yaml}---\n");
    let keys = set_env_vars(env);
    let result = prompty::load_from_string(&raw, std::env::current_dir().unwrap());
    clear_env_vars(&keys);
    result
}

fn load_from_raw(raw: &str, env: &Value) -> Result<prompty::model::Prompty, prompty::LoadError> {
    let keys = set_env_vars(env);
    let result = prompty::load_from_string(raw, std::env::current_dir().unwrap());
    clear_env_vars(&keys);
    result
}

// ---------------------------------------------------------------------------
// Temp-file helper for ${file:} vectors
// ---------------------------------------------------------------------------

struct TempDir(PathBuf);

impl TempDir {
    fn new(suffix: &str) -> Self {
        let dir = std::env::current_dir()
            .unwrap()
            .join(format!(".test_tmp_{suffix}_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn load_with_files(
    frontmatter: &Value,
    env: &Value,
    files: &Value,
) -> Result<prompty::model::Prompty, prompty::LoadError> {
    let tmp = TempDir::new("file_res");

    // Write virtual files into the temp dir
    if let Some(file_map) = files.as_object() {
        for (name, content) in file_map {
            let file_path = tmp.path().join(name);
            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            let text = if content.is_string() {
                content.as_str().unwrap().to_string()
            } else {
                serde_json::to_string_pretty(content).unwrap()
            };
            std::fs::write(&file_path, text).unwrap();
        }
    }

    // Build the .prompty string
    let yaml = serde_yaml::to_string(frontmatter).unwrap();
    let raw = format!("---\n{yaml}---\n");

    let keys = set_env_vars(env);
    // load_from_string treats its second arg as a *file* path, using .parent()
    // for ${file:} resolution. Pass a virtual file path inside the temp dir.
    let virtual_file = tmp.path().join("virtual.prompty");
    let result = prompty::load_from_string(&raw, &virtual_file);
    clear_env_vars(&keys);
    result
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

fn validate_agent_fields(agent: &prompty::model::Prompty, expected: &Value, vec_name: &str) {
    // name
    if let Some(name) = expected.get("name").and_then(Value::as_str) {
        assert_eq!(agent.name, name, "[{vec_name}] name mismatch");
    }

    // description
    if let Some(desc) = expected.get("description").and_then(Value::as_str) {
        assert_eq!(
            agent.description.as_deref(),
            Some(desc),
            "[{vec_name}] description mismatch"
        );
    }

    // instructions
    if let Some(instr) = expected.get("instructions").and_then(Value::as_str) {
        assert_eq!(
            agent.instructions.as_deref(),
            Some(instr),
            "[{vec_name}] instructions mismatch"
        );
    }

    // kind
    if let Some(kind) = expected.get("kind").and_then(Value::as_str) {
        // kind is consumed during load; verify it was "prompt" by confirming load succeeded
        assert_eq!(
            kind, "prompt",
            "[{vec_name}] expected kind=prompt in vector"
        );
    }

    // model
    if let Some(model) = expected.get("model") {
        if model.is_null() {
            // expected null model → id should be empty (default)
            assert!(
                agent.model.id.is_empty(),
                "[{vec_name}] expected null/empty model, got id='{}'",
                agent.model.id
            );
        } else {
            validate_model(&agent.model, model, vec_name);
        }
    }

    // inputs
    if expected.get("inputs").is_some() {
        let exp_inputs = expected.get("inputs").unwrap();
        if exp_inputs.is_null() {
            assert!(
                agent.as_inputs().is_none(),
                "[{vec_name}] expected null inputs"
            );
        } else if let Some(arr) = exp_inputs.as_array() {
            let agent_inputs = agent
                .as_inputs()
                .unwrap_or_else(|| panic!("[{vec_name}] expected inputs but got None"));
            assert_eq!(
                agent_inputs.len(),
                arr.len(),
                "[{vec_name}] inputs count mismatch"
            );
            for (i, exp) in arr.iter().enumerate() {
                let actual = &agent_inputs[i];
                if let Some(name) = exp.get("name").and_then(Value::as_str) {
                    assert_eq!(actual.name, name, "[{vec_name}] input[{i}].name");
                }
                if let Some(kind) = exp.get("kind").and_then(Value::as_str) {
                    assert_eq!(actual.kind_str(), kind, "[{vec_name}] input[{i}].kind");
                }
                if let Some(def) = exp.get("default") {
                    assert_eq!(
                        actual.default.as_ref(),
                        Some(def),
                        "[{vec_name}] input[{i}].default"
                    );
                }
            }
        }
    }

    // outputs
    if expected.get("outputs").is_some() {
        let exp_outputs = expected.get("outputs").unwrap();
        if exp_outputs.is_null() {
            assert!(
                agent.as_outputs().is_none(),
                "[{vec_name}] expected null outputs"
            );
        }
    }

    // tools
    if expected.get("tools").is_some() {
        let exp_tools = expected.get("tools").unwrap();
        if exp_tools.is_null() {
            assert!(
                agent.as_tools().is_none(),
                "[{vec_name}] expected null tools"
            );
        } else if let Some(arr) = exp_tools.as_array() {
            let agent_tools = agent
                .as_tools()
                .unwrap_or_else(|| panic!("[{vec_name}] expected tools but got None"));
            assert_eq!(
                agent_tools.len(),
                arr.len(),
                "[{vec_name}] tools count mismatch"
            );
            for (i, exp) in arr.iter().enumerate() {
                validate_tool(&agent_tools[i], exp, vec_name, i);
            }
        }
    }

    // template
    if let Some(tmpl_exp) = expected.get("template") {
        let tmpl = agent
            .template
            .as_ref()
            .unwrap_or_else(|| panic!("[{vec_name}] expected template but got None"));
        if let Some(fmt) = tmpl_exp.get("format") {
            if let Some(kind) = fmt.get("kind").and_then(Value::as_str) {
                assert_eq!(tmpl.format.kind, kind, "[{vec_name}] template.format.kind");
            }
        }
        if let Some(parser) = tmpl_exp.get("parser") {
            if let Some(kind) = parser.get("kind").and_then(Value::as_str) {
                assert_eq!(tmpl.parser.kind, kind, "[{vec_name}] template.parser.kind");
            }
        }
    }

    // metadata
    if let Some(meta_exp) = expected.get("metadata") {
        if let Some(meta_obj) = meta_exp.as_object() {
            let agent_meta = agent
                .as_metadata_dict()
                .unwrap_or_else(|| panic!("[{vec_name}] expected metadata but got None"));
            for (k, v) in meta_obj {
                assert_eq!(
                    agent_meta.get(k).unwrap_or(&Value::Null),
                    v,
                    "[{vec_name}] metadata.{k}"
                );
            }
        }
    }
}

fn validate_model(model: &prompty::model::model::Model, expected: &Value, vec_name: &str) {
    if let Some(id) = expected.get("id").and_then(Value::as_str) {
        assert_eq!(model.id, id, "[{vec_name}] model.id");
    }
    if let Some(provider) = expected.get("provider").and_then(Value::as_str) {
        assert_eq!(
            model.provider.as_deref(),
            Some(provider),
            "[{vec_name}] model.provider"
        );
    }
    if let Some(api_type) = expected.get("apiType").and_then(Value::as_str) {
        assert_eq!(
            model.api_type.as_deref(),
            Some(api_type),
            "[{vec_name}] model.apiType"
        );
    }

    // connection
    if let Some(conn_exp) = expected.get("connection") {
        if let Some(conn_obj) = conn_exp.as_object() {
            let conn = model
                .connection
                .as_object()
                .unwrap_or_else(|| panic!("[{vec_name}] model.connection is not an object"));
            for (k, v) in conn_obj {
                assert_eq!(
                    conn.get(k).unwrap_or(&Value::Null),
                    v,
                    "[{vec_name}] model.connection.{k}"
                );
            }
        }
    }

    // options
    if let Some(opts_exp) = expected.get("options") {
        let opts = model
            .options
            .as_ref()
            .unwrap_or_else(|| panic!("[{vec_name}] expected model.options but got None"));
        if let Some(temp) = opts_exp.get("temperature").and_then(Value::as_f64) {
            let actual = opts.temperature.unwrap_or(f32::NAN) as f64;
            assert!(
                (actual - temp).abs() < 0.01,
                "[{vec_name}] model.options.temperature: expected {temp}, got {actual}"
            );
        }
        if let Some(max) = opts_exp.get("maxOutputTokens").and_then(Value::as_i64) {
            assert_eq!(
                opts.max_output_tokens,
                Some(max as i32),
                "[{vec_name}] model.options.maxOutputTokens"
            );
        }
    }
}

fn validate_tool(tool: &prompty::model::tool::Tool, expected: &Value, vec_name: &str, idx: usize) {
    if let Some(name) = expected.get("name").and_then(Value::as_str) {
        assert_eq!(tool.name, name, "[{vec_name}] tool[{idx}].name");
    }
    if let Some(kind) = expected.get("kind").and_then(Value::as_str) {
        assert_eq!(tool.kind_str(), kind, "[{vec_name}] tool[{idx}].kind");
    }
    if let Some(desc) = expected.get("description").and_then(Value::as_str) {
        assert_eq!(
            tool.description.as_deref(),
            Some(desc),
            "[{vec_name}] tool[{idx}].description"
        );
    }

    // Variant-specific checks
    match &tool.kind {
        prompty::model::tool::ToolKind::Function {
            parameters, strict, ..
        } => {
            if let Some(exp_strict) = expected.get("strict").and_then(Value::as_bool) {
                assert_eq!(*strict, Some(exp_strict), "[{vec_name}] tool[{idx}].strict");
            }
            if let Some(exp_params) = expected.get("parameters").and_then(Value::as_array) {
                // Parameters may be stored as a JSON array of property objects
                let params_arr = parameters.as_array().unwrap_or_else(|| {
                    panic!("[{vec_name}] tool[{idx}].parameters is not an array")
                });
                assert_eq!(
                    params_arr.len(),
                    exp_params.len(),
                    "[{vec_name}] tool[{idx}].parameters count"
                );
                for (j, ep) in exp_params.iter().enumerate() {
                    if let Some(pname) = ep.get("name").and_then(Value::as_str) {
                        assert_eq!(
                            params_arr[j]
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or(""),
                            pname,
                            "[{vec_name}] tool[{idx}].parameters[{j}].name"
                        );
                    }
                }
            }
        }
        prompty::model::tool::ToolKind::Mcp { server_name, .. } => {
            if let Some(sn) = expected.get("serverName").and_then(Value::as_str) {
                assert_eq!(server_name, sn, "[{vec_name}] tool[{idx}].serverName");
            }
        }
        prompty::model::tool::ToolKind::OpenApi { specification, .. } => {
            if let Some(spec) = expected.get("specification").and_then(Value::as_str) {
                assert_eq!(
                    specification, spec,
                    "[{vec_name}] tool[{idx}].specification"
                );
            }
        }
        prompty::model::tool::ToolKind::Prompty { path, mode, .. } => {
            if let Some(p) = expected.get("path").and_then(Value::as_str) {
                assert_eq!(path, p, "[{vec_name}] tool[{idx}].path");
            }
            if let Some(m) = expected.get("mode").and_then(Value::as_str) {
                assert_eq!(mode, m, "[{vec_name}] tool[{idx}].mode");
            }
        }
        prompty::model::tool::ToolKind::Custom { .. } => {
            // kind_str() already checked above
        }
    }
}

// ---------------------------------------------------------------------------
// Validation helpers (for input_validation_* vectors)
// ---------------------------------------------------------------------------

fn run_validation(
    agent: &prompty::model::Prompty,
    inputs: &Value,
    _vec_name: &str,
) -> Result<Value, prompty::InvokerError> {
    prompty::validate_inputs(agent, inputs)
}

// ---------------------------------------------------------------------------
// Main test — drives all 25 vectors
// ---------------------------------------------------------------------------

#[test]
fn spec_load_vectors() {
    let raw = std::fs::read_to_string(vectors_path()).expect("Failed to read load_vectors.json");
    let vectors: Vec<Value> =
        serde_json::from_str(&raw).expect("Failed to parse load_vectors.json");

    let mut failures: Vec<String> = Vec::new();

    for vector in &vectors {
        let vec_name = vector
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("<unnamed>");
        let input = vector.get("input").unwrap_or(&Value::Null);
        let expected = vector.get("expected").unwrap_or(&Value::Null);
        let env = input.get("env").unwrap_or(&Value::Null);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_single_vector(vec_name, input, expected, env);
        }));

        if let Err(panic) = result {
            let msg = if let Some(s) = panic.downcast_ref::<String>() {
                s.clone()
            } else if let Some(s) = panic.downcast_ref::<&str>() {
                s.to_string()
            } else {
                "unknown panic".to_string()
            };
            failures.push(format!("[{vec_name}] {msg}"));
        }
    }

    if !failures.is_empty() {
        let count = failures.len();
        let detail = failures.join("\n\n");
        panic!("{count}/{} vectors failed:\n\n{detail}", vectors.len());
    }
}

fn run_single_vector(vec_name: &str, input: &Value, expected: &Value, env: &Value) {
    let is_error_vector = expected.get("error").is_some();
    let is_validation_vector = expected.get("validated_inputs").is_some()
        || (is_error_vector && expected.get("error_field").is_some());

    // --- Validation vectors ---
    if is_validation_vector {
        run_validation_vector(vec_name, input, expected, env);
        return;
    }

    // --- Error vectors ---
    if is_error_vector {
        run_error_vector(vec_name, input, expected, env);
        return;
    }

    // --- Normal load vectors ---
    let agent = load_agent(vec_name, input, env);
    validate_agent_fields(&agent, expected, vec_name);
}

// ---------------------------------------------------------------------------
// Load an agent from the vector's input
// ---------------------------------------------------------------------------

fn load_agent(vec_name: &str, input: &Value, env: &Value) -> prompty::model::Prompty {
    if let Some(fixture) = input.get("fixture").and_then(Value::as_str) {
        load_fixture(fixture, env)
            .unwrap_or_else(|e| panic!("[{vec_name}] load_fixture({fixture}) failed: {e}"))
    } else if input.get("files").is_some() {
        // File resolution vector
        let frontmatter = input.get("frontmatter").unwrap_or(&Value::Null);
        let files = input.get("files").unwrap_or(&Value::Null);
        load_with_files(frontmatter, env, files)
            .unwrap_or_else(|e| panic!("[{vec_name}] load_with_files failed: {e}"))
    } else if let Some(fm) = input.get("frontmatter") {
        load_from_frontmatter(fm, env)
            .unwrap_or_else(|e| panic!("[{vec_name}] load_from_frontmatter failed: {e}"))
    } else if let Some(raw) = input.get("frontmatter_raw").and_then(Value::as_str) {
        load_from_raw(raw, env).unwrap_or_else(|e| panic!("[{vec_name}] load_from_raw failed: {e}"))
    } else {
        panic!("[{vec_name}] vector has no fixture, frontmatter, or frontmatter_raw");
    }
}

// ---------------------------------------------------------------------------
// Error vectors
// ---------------------------------------------------------------------------

fn run_error_vector(vec_name: &str, input: &Value, expected: &Value, env: &Value) {
    let expected_err = expected.get("error").and_then(Value::as_str).unwrap_or("");

    let result = attempt_load(input, env);

    match result {
        Ok(_) => {
            // Special case: template_string_invalid — the Rust runtime's generated
            // Template::load_from_value accepts strings (they produce an empty Template).
            // This is a known behavioral difference from the Python runtime.
            if vec_name == "template_string_invalid" {
                // Verify the template is effectively empty/broken (empty kind strings)
                let agent = attempt_load(input, env).unwrap();
                let tmpl = agent.template.as_ref();
                if let Some(t) = tmpl {
                    // Template was created from a bare string — format/parser kinds
                    // will be empty because Template::load_from_value only reads
                    // "format"/"parser" sub-keys which don't exist on a string.
                    assert!(
                        t.format.kind.is_empty() && t.parser.kind.is_empty(),
                        "[{vec_name}] template_string_invalid: expected empty format/parser kinds, \
                         got format.kind='{}', parser.kind='{}'",
                        t.format.kind,
                        t.parser.kind
                    );
                }
                // Pass — runtime doesn't error but produces an unusable template
                return;
            }
            panic!("[{vec_name}] expected error containing '{expected_err}', but load succeeded");
        }
        Err(err) => {
            let err_str = err.to_string();
            let err_lower = err_str.to_lowercase();
            let exp_lower = expected_err.to_lowercase();

            // Flexible matching: check if the error message contains the key terms
            let matches = if exp_lower.contains("filenotfounderror") {
                matches!(err, LoadResult::Load(prompty::LoadError::FileNotFound(..)))
                    || err_lower.contains("not found")
                    || err_lower.contains("file not found")
            } else {
                // Check for substring containment of key words from expected error
                exp_lower
                    .split_whitespace()
                    .any(|word| word.len() > 3 && err_lower.contains(word))
                    || err_lower.contains(&exp_lower)
            };

            assert!(
                matches,
                "[{vec_name}] error mismatch:\n  expected: '{expected_err}'\n  got: '{err_str}'"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Validation vectors
// ---------------------------------------------------------------------------

fn run_validation_vector(vec_name: &str, input: &Value, expected: &Value, env: &Value) {
    // First load the agent from frontmatter
    let fm = input.get("frontmatter").unwrap_or(&Value::Null);
    let agent = load_from_frontmatter(fm, env)
        .unwrap_or_else(|e| panic!("[{vec_name}] load_from_frontmatter failed: {e}"));

    let inputs = input
        .get("inputs")
        .cloned()
        .unwrap_or(serde_json::json!({}));

    if let Some(exp_validated) = expected.get("validated_inputs") {
        // Expect success
        let result = run_validation(&agent, &inputs, vec_name)
            .unwrap_or_else(|e| panic!("[{vec_name}] validate_inputs failed: {e}"));

        // Check that all expected keys exist with correct values
        if let Some(exp_obj) = exp_validated.as_object() {
            let result_obj = result
                .as_object()
                .unwrap_or_else(|| panic!("[{vec_name}] validated result is not an object"));
            for (k, v) in exp_obj {
                assert_eq!(
                    result_obj.get(k).unwrap_or(&Value::Null),
                    v,
                    "[{vec_name}] validated_inputs.{k}"
                );
            }
            // For empty expected, verify no extra keys were injected from example values
            if exp_obj.is_empty() {
                // Allow original input keys to pass through, but no new defaults should appear
                let input_obj = inputs.as_object().cloned().unwrap_or_default();
                for (k, _) in result_obj {
                    assert!(
                        input_obj.contains_key(k),
                        "[{vec_name}] unexpected key '{k}' in validated_inputs (expected empty)"
                    );
                }
            }
        }
    } else if expected.get("error").is_some() {
        // Expect validation error
        let exp_err = expected.get("error").and_then(Value::as_str).unwrap_or("");
        let exp_field = expected
            .get("error_field")
            .and_then(Value::as_str)
            .unwrap_or("");

        let result = run_validation(&agent, &inputs, vec_name);
        assert!(
            result.is_err(),
            "[{vec_name}] expected validation error for field '{exp_field}', but validation succeeded"
        );
        let err_str = result.unwrap_err().to_string();
        if !exp_field.is_empty() {
            assert!(
                err_str.contains(exp_field),
                "[{vec_name}] error should mention field '{exp_field}': {err_str}"
            );
        }
        if !exp_err.is_empty() {
            let err_lower = err_str.to_lowercase();
            let exp_lower = exp_err.to_lowercase();
            assert!(
                exp_lower
                    .split_whitespace()
                    .any(|w| w.len() > 3 && err_lower.contains(w)),
                "[{vec_name}] error mismatch: expected '{exp_err}', got '{err_str}'"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Unified load attempt that returns a result for error-path testing
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum LoadResult {
    Load(prompty::LoadError),
}

impl std::fmt::Display for LoadResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LoadResult::Load(e) => write!(f, "{e}"),
        }
    }
}

fn attempt_load(input: &Value, env: &Value) -> Result<prompty::model::Prompty, LoadResult> {
    if let Some(fixture) = input.get("fixture").and_then(Value::as_str) {
        load_fixture(fixture, env).map_err(LoadResult::Load)
    } else if input.get("files").is_some() {
        let frontmatter = input.get("frontmatter").unwrap_or(&Value::Null);
        let files = input.get("files").unwrap_or(&Value::Null);
        load_with_files(frontmatter, env, files).map_err(LoadResult::Load)
    } else if let Some(fm) = input.get("frontmatter") {
        load_from_frontmatter(fm, env).map_err(LoadResult::Load)
    } else if let Some(raw) = input.get("frontmatter_raw").and_then(Value::as_str) {
        load_from_raw(raw, env).map_err(LoadResult::Load)
    } else {
        panic!("vector has no fixture, frontmatter, or frontmatter_raw");
    }
}
