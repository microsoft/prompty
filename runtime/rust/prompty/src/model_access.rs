//! Public accessors for the coerce-union `Agent.model` value.
//!
//! `Model | string` lowers to `serde_json::Value` in the generated model, so a
//! `.prompty` `model: gpt-4o` shorthand arrives as a bare JSON string whose
//! value IS the coerce target (`id`), while the full object form carries `id`,
//! `apiType`, `provider`, `connection`, and `options`. Provider crates read
//! model fields through these helpers rather than off a typed struct, keeping
//! the bare-string shorthand and the object form on a single code path.

use serde_json::Value;

use crate::model::ModelOptions;
use crate::model::context::LoadContext;

/// The model id. A bare-string model shorthand IS the id; the object form
/// carries it under `id`. Absent/unknown shapes yield an empty string.
pub fn model_id(model: &Value) -> String {
    if let Some(s) = model.as_str() {
        return s.to_string();
    }
    model
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

/// The API type (`chat`, `embedding`, `image`, `responses`, ...), defaulting to
/// `chat`. Only the object form carries `apiType`; a bare-string shorthand has
/// none, so it defaults.
pub fn model_api_type(model: &Value) -> String {
    model
        .get("apiType")
        .and_then(|v| v.as_str())
        .unwrap_or("chat")
        .to_string()
}

/// The model provider discriminator (`openai`, `azure`, ...). Only the object
/// form carries `provider`; a bare-string shorthand has none.
pub fn model_provider(model: &Value) -> Option<String> {
    model
        .get("provider")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The typed model options, rehydrated from the object form's `options`. A
/// bare-string shorthand carries no options.
pub fn model_options(model: &Value) -> Option<ModelOptions> {
    model
        .get("options")
        .filter(|v| v.is_object() || v.is_array() || v.is_string())
        .map(|v| ModelOptions::load_from_value(v, &LoadContext::default()))
}

/// The connection sub-value (`Null` when absent). Reference resolution against
/// the registry is left to each provider.
pub fn model_connection(model: &Value) -> Value {
    model.get("connection").cloned().unwrap_or(Value::Null)
}
