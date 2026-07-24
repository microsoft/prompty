//! Tests for the host-neutral agent-memory logic (`prompty::memory`) layered on
//! the generated memory data contract.

use prompty::{
    MemoryCategory, MemoryEntry, MemoryPort, MemoryStore, ScoredMemory, format_recall_results,
    memoryCategoryKind,
};
use std::sync::Mutex;

fn entry(id: &str, content: &str, importance: f32, created_at: &str, tags: &[&str]) -> MemoryEntry {
    MemoryEntry {
        id: id.to_string(),
        content: content.to_string(),
        category: MemoryCategory {
            kind: memoryCategoryKind::Semantic,
            label: None,
        },
        created_at: Some(created_at.to_string()),
        tags: if tags.is_empty() {
            None
        } else {
            Some(tags.iter().map(|s| s.to_string()).collect())
        },
        importance: Some(importance),
        metadata: serde_json::Value::Null,
    }
}

fn store_of(entries: Vec<MemoryEntry>) -> MemoryStore {
    MemoryStore {
        entries,
        metadata: serde_json::Value::Null,
    }
}

// --- Recall ranking -------------------------------------------------------

#[test]
fn recall_ranks_keyword_matches_above_importance() {
    let store = store_of(vec![
        entry("a", "the sky is clear", 0.9, "2024-01-01T00:00:00Z", &[]),
        entry(
            "b",
            "favorite color is blue sky",
            0.1,
            "2024-01-02T00:00:00Z",
            &[],
        ),
    ]);

    let results = store.recall("blue sky", 0);
    // "b" matches both keywords, "a" matches only one — keyword count wins over
    // the higher importance of "a".
    assert_eq!(results[0].entry.id, "b");
    assert_eq!(results[0].keyword_matches, 2);
    assert_eq!(results[1].entry.id, "a");
    assert_eq!(results[1].keyword_matches, 1);
}

#[test]
fn recall_filters_out_non_matches_for_a_query() {
    let store = store_of(vec![
        entry("a", "cats are great", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("b", "dogs are loyal", 0.5, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("dogs", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].entry.id, "b");
}

#[test]
fn recall_matches_tags_as_well_as_content() {
    let store = store_of(vec![entry(
        "a",
        "no relevant words here",
        0.5,
        "2024-01-01T00:00:00Z",
        &["astronomy", "space"],
    )]);

    let results = store.recall("astronomy", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].keyword_matches, 1);
}

#[test]
fn recall_is_case_and_punctuation_insensitive() {
    let store = store_of(vec![entry(
        "a",
        "The Sky Is Blue.",
        0.5,
        "2024-01-01T00:00:00Z",
        &[],
    )]);

    let results = store.recall("SKY, blue!", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].keyword_matches, 2);
}

#[test]
fn recall_empty_query_ranks_all_by_importance_then_recency() {
    let store = store_of(vec![
        entry("a", "one", 0.2, "2024-01-03T00:00:00Z", &[]),
        entry("b", "two", 0.8, "2024-01-01T00:00:00Z", &[]),
        entry("c", "three", 0.8, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("", 0);
    assert_eq!(results.len(), 3);
    // b and c tie on importance (0.8) -> more recent createdAt wins (c > b);
    // a has lowest importance -> last.
    assert_eq!(results[0].entry.id, "c");
    assert_eq!(results[1].entry.id, "b");
    assert_eq!(results[2].entry.id, "a");
}

#[test]
fn recall_uses_insertion_order_as_stable_final_tiebreak() {
    // Identical importance + createdAt -> original order preserved.
    let store = store_of(vec![
        entry("a", "x", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("b", "x", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("c", "x", 0.5, "2024-01-01T00:00:00Z", &[]),
    ]);

    let results = store.recall("", 0);
    let ids: Vec<&str> = results.iter().map(|s| s.entry.id.as_str()).collect();
    assert_eq!(ids, vec!["a", "b", "c"]);
}

#[test]
fn recall_respects_limit_and_zero_means_unlimited() {
    let store = store_of(vec![
        entry("a", "x", 0.9, "2024-01-01T00:00:00Z", &[]),
        entry("b", "x", 0.8, "2024-01-01T00:00:00Z", &[]),
        entry("c", "x", 0.7, "2024-01-01T00:00:00Z", &[]),
    ]);

    assert_eq!(store.recall("", 2).len(), 2);
    assert_eq!(store.recall("", 0).len(), 3);
    assert_eq!(store.recall("", 10).len(), 3);
}

#[test]
fn recall_is_deterministic_across_repeated_calls() {
    let store = store_of(vec![
        entry("a", "alpha beta", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("b", "beta gamma", 0.5, "2024-01-02T00:00:00Z", &[]),
        entry("c", "gamma delta", 0.5, "2024-01-03T00:00:00Z", &[]),
    ]);

    let first = store.recall("beta gamma", 0);
    for _ in 0..5 {
        assert_eq!(store.recall("beta gamma", 0), first);
    }
}

// --- Mutations ------------------------------------------------------------

#[test]
fn add_appends_to_the_end() {
    let mut store = store_of(vec![entry("a", "x", 0.5, "t", &[])]);
    store.add(entry("b", "y", 0.5, "t", &[]));
    assert_eq!(store.len(), 2);
    assert_eq!(store.entries[1].id, "b");
}

#[test]
fn update_replaces_in_place_and_bounds_checks() {
    let mut store = store_of(vec![
        entry("a", "x", 0.5, "t", &[]),
        entry("b", "y", 0.5, "t", &[]),
    ]);
    store.update(0, entry("a2", "z", 0.5, "t", &[])).unwrap();
    assert_eq!(store.entries[0].id, "a2");
    assert!(store.update(5, entry("c", "c", 0.5, "t", &[])).is_err());
}

#[test]
fn remove_returns_entry_and_bounds_checks() {
    let mut store = store_of(vec![
        entry("a", "x", 0.5, "t", &[]),
        entry("b", "y", 0.5, "t", &[]),
    ]);
    let removed = store.remove(0).unwrap();
    assert_eq!(removed.id, "a");
    assert_eq!(store.len(), 1);
    assert!(store.remove(5).is_err());
}

#[test]
fn clear_empties_the_store() {
    let mut store = store_of(vec![entry("a", "x", 0.5, "t", &[])]);
    assert!(!store.is_empty());
    store.clear();
    assert!(store.is_empty());
    assert_eq!(store.len(), 0);
}

// --- Formatting -----------------------------------------------------------

#[test]
fn format_for_system_prompt_is_empty_when_no_memories() {
    let store = store_of(vec![]);
    assert_eq!(store.format_for_system_prompt(), "");
}

#[test]
fn format_for_system_prompt_lists_entries_with_category() {
    let mut e = entry("a", "user prefers dark mode", 0.5, "t", &[]);
    e.category = MemoryCategory {
        kind: memoryCategoryKind::Preference,
        label: Some("ui".to_string()),
    };
    let store = store_of(vec![e]);
    let out = store.format_for_system_prompt();
    assert_eq!(out, "## Memory\n- [preference/ui] user prefers dark mode\n");
}

#[test]
fn format_recall_results_is_empty_for_no_results() {
    let empty: Vec<ScoredMemory> = Vec::new();
    assert_eq!(format_recall_results(&empty), "");
}

#[test]
fn format_recall_results_lists_recalled_entries() {
    let store = store_of(vec![entry(
        "a",
        "the sky is blue",
        0.5,
        "2024-01-01T00:00:00Z",
        &[],
    )]);
    let results = store.recall("sky", 0);
    let out = format_recall_results(&results);
    assert_eq!(out, "## Recalled memories\n- [semantic] the sky is blue\n");
}

// --- Durable round-trip ---------------------------------------------------

#[test]
fn entry_round_trips_through_canonical_camelcase_json() {
    let e = entry("a", "hello", 0.75, "2024-01-01T00:00:00Z", &["greeting"]);
    let json = serde_json::to_value(&e).unwrap();

    // Canonical camelCase key; snake_case absent.
    assert_eq!(json["createdAt"], "2024-01-01T00:00:00Z");
    assert!(json.get("created_at").is_none());
    assert_eq!(json["importance"], 0.75);
    assert_eq!(json["tags"][0], "greeting");
    assert_eq!(json["category"]["kind"], "semantic");

    let back: MemoryEntry = serde_json::from_value(json).unwrap();
    assert_eq!(back, e);
}

#[test]
fn entry_conditional_emit_omits_absent_optionals() {
    let e = MemoryEntry {
        id: "a".to_string(),
        content: "hi".to_string(),
        category: MemoryCategory::default(),
        created_at: None,
        tags: None,
        importance: None,
        metadata: serde_json::Value::Null,
    };
    let json = serde_json::to_value(&e).unwrap();
    assert!(json.get("createdAt").is_none());
    assert!(json.get("tags").is_none());
    assert!(json.get("importance").is_none());
    assert!(json.get("metadata").is_none());
}

#[test]
fn category_coerces_bare_string_and_object_forms() {
    // Bare string coerces to { kind, label: None }.
    let from_str: MemoryCategory = serde_json::from_value(serde_json::json!("episodic")).unwrap();
    assert_eq!(from_str.kind, memoryCategoryKind::Episodic);
    assert_eq!(from_str.label, None);

    // Object form round-trips.
    let obj = MemoryCategory {
        kind: memoryCategoryKind::Procedural,
        label: Some("how-to".to_string()),
    };
    let json = serde_json::to_value(&obj).unwrap();
    assert_eq!(json["kind"], "procedural");
    assert_eq!(json["label"], "how-to");
    let back: MemoryCategory = serde_json::from_value(json).unwrap();
    assert_eq!(back, obj);
}

#[test]
fn store_round_trips_through_json() {
    let store = store_of(vec![
        entry("a", "one", 0.5, "2024-01-01T00:00:00Z", &["t1"]),
        entry("b", "two", 0.6, "2024-01-02T00:00:00Z", &[]),
    ]);
    let json = serde_json::to_value(&store).unwrap();
    let back: MemoryStore = serde_json::from_value(json).unwrap();
    assert_eq!(back, store);
}

// --- MemoryPort -----------------------------------------------------------

struct InMemoryPort {
    inner: Mutex<MemoryStore>,
}

impl MemoryPort for InMemoryPort {
    fn load(&self) -> MemoryStore {
        self.inner.lock().unwrap().clone()
    }

    fn save(&self, store: &MemoryStore) -> Result<(), String> {
        *self.inner.lock().unwrap() = store.clone();
        Ok(())
    }
}

#[test]
fn memory_port_load_save_snapshot_round_trip() {
    let port = InMemoryPort {
        inner: Mutex::new(store_of(vec![])),
    };

    // Host loads, engine mutates, host persists.
    let mut store = port.load();
    store.add(entry("a", "remember this", 0.5, "t", &[]));
    port.save(&store).unwrap();

    // A subsequent load observes the persisted snapshot and recall works on it.
    let reloaded = port.load();
    assert_eq!(reloaded.len(), 1);
    assert_eq!(reloaded.recall("remember", 0)[0].entry.id, "a");
}
