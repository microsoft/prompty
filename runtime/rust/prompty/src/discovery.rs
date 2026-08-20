//! Cross-runtime model-capability enrichment for provider discovery.
//!
//! Provider `/models` endpoints vary in richness: some (Anthropic, Foundry)
//! return capability fields directly, while others (OpenAI) return only ids. To
//! keep discovery results consistent across providers *and* across runtimes,
//! Prompty ships a single shared, provider-keyed capability dataset
//! (`spec/data/model_capabilities.json`) and applies it with one rule:
//!
//! > **Provider-supplied fields always win.** Dataset entries only fill fields
//! > the provider left empty (fill-only-missing). Matching is by longest prefix
//! > on the model id.
//!
//! **Canonical source vs. vendored copy.** The cross-runtime source of truth is
//! `spec/data/model_capabilities.json`. Because a packaged crate
//! (`cargo publish`) can only bundle files *inside* the crate directory, this
//! crate embeds a **vendored copy** at `runtime/rust/prompty/src/` via
//! [`include_str!`] — so a shipped crate has no filesystem dependency on the
//! repo's `spec/` directory. The two files MUST stay byte-identical; the
//! `vendored_copy_matches_spec` test enforces this whenever the repo layout is
//! available (it is a no-op in an unpacked/published context). Every other
//! runtime follows the same pattern: vendor a copy into its own package tree and
//! guard drift, so the generated `vectors.json` (enrich operation)
//! keeps them convergent.
//!
//! To refresh: edit `spec/data/model_capabilities.json`, then copy it to
//! `runtime/rust/prompty/src/model_capabilities.json` (the drift test will fail
//! until you do).
//!
//! This dataset is intentionally **not** emitted from TypeSpec: it is volatile
//! provider data (context windows, modalities, new model families) refreshed as
//! a snapshot, whereas TypeSpec owns the structural [`ModelInfo`] contract.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde_json::Value;

use crate::model::ModelInfo;

/// The shared capability dataset, embedded at compile time from the crate's
/// vendored copy so the runtime has no filesystem dependency on the repo's
/// `spec/` directory. Canonical source: `spec/data/model_capabilities.json`
/// (kept byte-identical by the `vendored_copy_matches_spec` test).
const CAPABILITY_DATASET: &str = include_str!("model_capabilities.json");

/// Fallback capability fields for a single model, as looked up from the shared
/// dataset. All fields are optional; `None` means "the dataset does not supply
/// this field" and the caller should leave whatever the provider returned.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModelCapabilities {
    /// Maximum context window size in tokens.
    pub context_window: Option<i32>,
    /// Input modalities the model accepts.
    pub input_modalities: Option<Vec<String>>,
    /// Output modalities the model can produce.
    pub output_modalities: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct CapabilityEntry {
    prefix: String,
    capabilities: ModelCapabilities,
}

/// Provider-keyed capability lookup, parsed once from the embedded dataset.
#[derive(Debug, Default)]
struct CapabilityTable {
    providers: HashMap<String, Vec<CapabilityEntry>>,
}

impl CapabilityTable {
    /// Parse a capability table from the shared dataset JSON value.
    ///
    /// Entries are sorted longest-prefix-first per provider so lookup order is
    /// independent of the order authored in the file.
    fn from_value(value: &Value) -> Self {
        let mut providers: HashMap<String, Vec<CapabilityEntry>> = HashMap::new();

        if let Some(map) = value.get("providers").and_then(Value::as_object) {
            for (provider, entries) in map {
                let Some(list) = entries.as_array() else {
                    continue;
                };
                let mut parsed: Vec<CapabilityEntry> = list
                    .iter()
                    .filter_map(CapabilityEntry::from_value)
                    .collect();
                // Longest prefix first, so `find` returns the most specific match.
                parsed.sort_by_key(|b| std::cmp::Reverse(b.prefix.len()));
                providers.insert(provider.clone(), parsed);
            }
        }

        Self { providers }
    }

    fn lookup(&self, provider: &str, id: &str) -> Option<&ModelCapabilities> {
        self.providers
            .get(provider)?
            .iter()
            .find(|entry| prefix_matches(id, &entry.prefix))
            .map(|entry| &entry.capabilities)
    }
}

/// Whether `id` is matched by dataset `prefix` under the cross-runtime rule.
///
/// A prefix matches only at a token boundary: `id` must either equal `prefix`
/// exactly, or the character immediately following the prefix must be a
/// separator (any non-alphanumeric character, e.g. `-`, `.`, `:`). This keeps
/// real ids matching (`gpt-4` → `gpt-4-0613`, `gpt-4o` → `gpt-4o-2024-05-13`)
/// while rejecting accidental substring hits (`gpt-4` must NOT match a future
/// `gpt-45`). Every runtime MUST implement this same boundary rule so the
/// shared enrichment vectors converge.
fn prefix_matches(id: &str, prefix: &str) -> bool {
    if !id.starts_with(prefix) {
        return false;
    }
    // `id.starts_with(prefix)` guarantees `prefix.len()` is a char boundary.
    match id[prefix.len()..].chars().next() {
        None => true,
        Some(c) => !c.is_ascii_alphanumeric(),
    }
}

impl CapabilityEntry {
    fn from_value(value: &Value) -> Option<Self> {
        let prefix = value.get("prefix").and_then(Value::as_str)?.to_string();
        Some(Self {
            prefix,
            capabilities: ModelCapabilities {
                context_window: value
                    .get("contextWindow")
                    .and_then(Value::as_i64)
                    .map(|v| v as i32),
                input_modalities: parse_modalities(value.get("inputModalities")),
                output_modalities: parse_modalities(value.get("outputModalities")),
            },
        })
    }
}

/// Parse a modality array, preserving the distinction between "absent" (`None`)
/// and "present but empty" (`Some(vec![])`, e.g. embeddings).
fn parse_modalities(value: Option<&Value>) -> Option<Vec<String>> {
    value.and_then(Value::as_array).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(ToString::to_string))
            .collect()
    })
}

static TABLE: LazyLock<CapabilityTable> = LazyLock::new(|| {
    let value: Value = serde_json::from_str(CAPABILITY_DATASET)
        .expect("embedded spec/data/model_capabilities.json must be valid JSON");
    CapabilityTable::from_value(&value)
});

/// Look up fallback capabilities for a model id within a provider's dataset.
///
/// Returns `None` when the provider has no entry matching `id`. Matching is by
/// longest prefix, applied only at token boundaries (see [`prefix_matches`]).
pub fn lookup(provider: &str, id: &str) -> Option<ModelCapabilities> {
    TABLE.lookup(provider, id).cloned()
}

/// Enrich a [`ModelInfo`] using the shared capability dataset.
///
/// Applies the cross-runtime fill-only-missing rule: a dataset field is written
/// only when the corresponding [`ModelInfo`] field is still empty
/// (`context_window` is `None`; a modality list is `None`). Provider-supplied
/// values are never overwritten. A dataset modality of `Some(vec![])` (e.g.
/// embeddings) is a valid fill and will replace a `None` list.
pub trait EnrichArgs {
    fn enrich(self) -> ModelInfo;
}

impl EnrichArgs for (ModelInfo, &str) {
    fn enrich(self) -> ModelInfo {
        let (base, provider) = self;
        enrich_model_info(base, provider)
    }
}

impl EnrichArgs for (&str, &mut ModelInfo) {
    fn enrich(self) -> ModelInfo {
        let (provider, info) = self;
        let enriched = enrich_model_info(info.clone(), provider);
        *info = enriched.clone();
        enriched
    }
}

pub fn enrich<A, B>(a: A, b: B) -> ModelInfo
where
    (A, B): EnrichArgs,
{
    (a, b).enrich()
}

fn enrich_model_info(mut base: ModelInfo, provider: &str) -> ModelInfo {
    let Some(caps) = TABLE.lookup(provider, &base.id) else {
        return base;
    };

    if base.context_window.is_none() {
        if let Some(window) = caps.context_window {
            base.context_window = Some(window);
        }
    }
    if base.input_modalities.is_none() {
        if let Some(ref modalities) = caps.input_modalities {
            base.input_modalities = Some(modalities.clone());
        }
    }
    if base.output_modalities.is_none() {
        if let Some(ref modalities) = caps.output_modalities {
            base.output_modalities = Some(modalities.clone());
        }
    }

    base
}

/// Map a raw provider model/deployment/catalog payload to canonical [`ModelInfo`].
///
/// This is a mechanical cross-runtime adapter over provider discovery response
/// shapes. It copies the full raw payload into `additional_properties` and only
/// populates canonical fields that the provider actually supplied.
pub fn map_model(raw: &Value, provider: &str) -> ModelInfo {
    let data = raw.as_object();
    let mut info = ModelInfo {
        additional_properties: if data.is_some() {
            raw.clone()
        } else {
            Value::Null
        },
        ..Default::default()
    };

    match provider {
        "anthropic" => {
            info.id = get_str(raw, "id").unwrap_or_default();
            info.display_name = get_str(raw, "display_name");
            info.owned_by = Some("anthropic".to_string());
            info.context_window = get_i32(raw, "context_length");
            info.input_modalities = get_string_array(raw, "input_modalities");
            info.output_modalities = get_string_array(raw, "output_modalities");
        }
        "foundry" => map_foundry_model(raw, &mut info),
        _ => {
            info.id = get_str(raw, "id").unwrap_or_default();
            info.owned_by = get_str(raw, "owned_by");
        }
    }

    if info.id.is_empty() {
        info.id = String::new();
    }

    info
}

fn map_foundry_model(raw: &Value, info: &mut ModelInfo) {
    if let Some(props) = raw.get("properties") {
        let model = props.get("model").unwrap_or(&Value::Null);
        let caps = props.get("capabilities").unwrap_or(&Value::Null);

        info.id = get_str(raw, "name").unwrap_or_default();
        info.display_name = get_str(model, "name");
        info.owned_by = get_str(model, "publisher");
        info.context_window = get_i32(model, "maxContextLength");
        info.input_modalities = get_string_array(caps, "supportedInputModalities");
        info.output_modalities = get_string_array(caps, "supportedOutputModalities");
    } else if raw.get("modelName").is_some()
        || get_str(raw, "type").as_deref() == Some("ModelDeployment")
    {
        info.id = get_str(raw, "name").unwrap_or_default();
        info.display_name = get_str(raw, "modelName");
        info.owned_by = get_str(raw, "modelPublisher");
        info.context_window = get_i32(raw, "maxContextLength");
    } else {
        info.id = get_str(raw, "id").unwrap_or_default();
        info.owned_by = get_str(raw, "owned_by");
        info.context_window = get_i32(raw, "maxContextLength");
    }
}

fn get_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn get_i32(value: &Value, key: &str) -> Option<i32> {
    value.get(key).and_then(Value::as_i64).map(|v| v as i32)
}

fn get_string_array(value: &Value, key: &str) -> Option<Vec<String>> {
    value.get(key).and_then(Value::as_array).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(ToString::to_string))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: Behavioral unit tests for `lookup`/`enrich`/`map_model` were removed
    // in favor of the shared TypeSpec `@vector` conformance suite
    // (DiscoveryConformance.enrich / .mapModel in tests/model/), which exercises
    // this exact module across every runtime. Only the vendored-dataset drift
    // guard below is kept, as it verifies repo infrastructure rather than
    // behavior and has no vector equivalent.

    /// The crate's vendored dataset copy (embedded via `include_str!`) MUST stay
    /// byte-for-byte in sync with the canonical cross-runtime source in `spec/`.
    /// This runs only when the repo layout is present; in an unpacked/published
    /// crate the `spec/` path is absent and the check is skipped.
    #[test]
    fn vendored_copy_matches_spec() {
        let spec_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../spec/data/model_capabilities.json");
        let Ok(spec_contents) = std::fs::read_to_string(&spec_path) else {
            // Not in a repo checkout (e.g. published crate) — nothing to verify.
            return;
        };
        let spec_json: Value = serde_json::from_str(&spec_contents)
            .expect("canonical spec/data/model_capabilities.json must be valid JSON");
        let vendored_json: Value = serde_json::from_str(CAPABILITY_DATASET)
            .expect("vendored data/model_capabilities.json must be valid JSON");
        assert_eq!(
            vendored_json, spec_json,
            "runtime/rust/prompty/src/model_capabilities.json is out of sync with \
             spec/data/model_capabilities.json — re-copy the canonical file",
        );
    }
}
