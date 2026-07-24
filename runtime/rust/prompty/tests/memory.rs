//! Tests for the host-neutral agent-memory logic (`prompty::memory`) layered on
//! the generated memory data contract.

use prompty::{
    MemoryCategory, MemoryEntry, MemoryPort, MemoryStore, ScoredMemory, format_recall_results,
};
use std::sync::Mutex;

fn cat(kind: &str) -> MemoryCategory {
    MemoryCategory {
        kind: kind.to_string(),
        label: None,
    }
}

fn entry(content: &str, importance: f32, created_at: &str, tags: &[&str]) -> MemoryEntry {
    MemoryEntry {
        content: content.to_string(),
        category: cat("semantic"),
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

fn contents(results: &[ScoredMemory]) -> Vec<String> {
    results.iter().map(|s| s.entry.content.clone()).collect()
}

// --- Recall ranking -------------------------------------------------------

#[test]
fn recall_ranks_weighted_score_above_importance() {
    let store = store_of(vec![
        // matches only "sky" in content -> weighted 2.0, importance high
        entry("the sky is clear", 0.9, "2024-01-01T00:00:00Z", &[]),
        // matches "blue" and "sky" in content -> weighted 4.0, importance low
        entry(
            "favorite color is blue sky",
            0.1,
            "2024-01-02T00:00:00Z",
            &[],
        ),
    ]);

    let results = store.recall("blue sky", 0);
    assert_eq!(results[0].entry.content, "favorite color is blue sky");
    assert_eq!(results[0].keyword_matches, 2);
    assert_eq!(results[0].score, 4.0);
    assert_eq!(results[1].entry.content, "the sky is clear");
    assert_eq!(results[1].keyword_matches, 1);
    assert_eq!(results[1].score, 2.0);
}

#[test]
fn recall_weights_tag_matches_higher_than_content() {
    let store = store_of(vec![
        // "space" in content -> 2.0
        entry("all about space", 0.5, "2024-01-01T00:00:00Z", &[]),
        // "space" in tags -> 3.0
        entry("unrelated text", 0.5, "2024-01-02T00:00:00Z", &["space"]),
    ]);

    let results = store.recall("space", 0);
    assert_eq!(results[0].entry.content, "unrelated text");
    assert_eq!(results[0].score, 3.0);
    assert_eq!(results[1].score, 2.0);
}

#[test]
fn recall_filters_out_non_matches_for_a_query() {
    let store = store_of(vec![
        entry("cats are great", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("dogs are loyal", 0.5, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("dogs", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].entry.content, "dogs are loyal");
}

#[test]
fn recall_matches_tags_as_well_as_content() {
    let store = store_of(vec![entry(
        "no relevant words here",
        0.5,
        "2024-01-01T00:00:00Z",
        &["astronomy", "space"],
    )]);

    let results = store.recall("astronomy", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].keyword_matches, 1);
    assert_eq!(results[0].score, 3.0);
}

#[test]
fn recall_is_case_and_punctuation_insensitive() {
    let store = store_of(vec![entry(
        "The Sky Is Blue.",
        0.5,
        "2024-01-01T00:00:00Z",
        &[],
    )]);

    let results = store.recall("SKY, blue!", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].keyword_matches, 2);
    assert_eq!(results[0].score, 4.0);
}

#[test]
fn recall_empty_query_ranks_all_by_importance_then_recency() {
    let store = store_of(vec![
        entry("low", 0.2, "2024-01-03T00:00:00Z", &[]),
        entry("older-high", 0.8, "2024-01-01T00:00:00Z", &[]),
        entry("newer-high", 0.8, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("", 0);
    assert_eq!(results.len(), 3);
    // 0.8 entries tie on importance -> more recent createdAt wins;
    // 0.2 entry has lowest importance -> last.
    assert_eq!(contents(&results), vec!["newer-high", "older-high", "low"]);
}

#[test]
fn recall_uses_insertion_order_as_stable_final_tiebreak() {
    // Identical importance + createdAt, empty query so content is not a ranking
    // signal -> original insertion order preserved.
    let store = store_of(vec![
        entry("first", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("second", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("third", 0.5, "2024-01-01T00:00:00Z", &[]),
    ]);

    let results = store.recall("", 0);
    assert_eq!(contents(&results), vec!["first", "second", "third"]);
}

#[test]
fn recall_respects_limit_and_zero_means_unlimited() {
    let store = store_of(vec![
        entry("a", 0.9, "2024-01-01T00:00:00Z", &[]),
        entry("b", 0.8, "2024-01-01T00:00:00Z", &[]),
        entry("c", 0.7, "2024-01-01T00:00:00Z", &[]),
    ]);

    assert_eq!(store.recall("", 2).len(), 2);
    assert_eq!(store.recall("", 0).len(), 3);
    assert_eq!(store.recall("", 10).len(), 3);
}

#[test]
fn recall_is_deterministic_across_repeated_calls() {
    let store = store_of(vec![
        entry("alpha beta", 0.5, "2024-01-01T00:00:00Z", &[]),
        entry("beta gamma", 0.5, "2024-01-02T00:00:00Z", &[]),
        entry("gamma delta", 0.5, "2024-01-03T00:00:00Z", &[]),
    ]);

    let first = store.recall("beta gamma", 0);
    for _ in 0..5 {
        assert_eq!(store.recall("beta gamma", 0), first);
    }
}

// --- Mutations ------------------------------------------------------------

#[test]
fn add_appends_to_the_end() {
    let mut store = store_of(vec![entry("x", 0.5, "t", &[])]);
    store.add(entry("y", 0.5, "t", &[]));
    assert_eq!(store.len(), 2);
    assert_eq!(store.entries[1].content, "y");
}

#[test]
fn update_replaces_in_place_and_bounds_checks() {
    let mut store = store_of(vec![entry("x", 0.5, "t", &[]), entry("y", 0.5, "t", &[])]);
    store.update(0, entry("z", 0.5, "t", &[])).unwrap();
    assert_eq!(store.entries[0].content, "z");
    assert!(store.update(5, entry("c", 0.5, "t", &[])).is_err());
}

#[test]
fn remove_returns_entry_and_bounds_checks() {
    let mut store = store_of(vec![entry("x", 0.5, "t", &[]), entry("y", 0.5, "t", &[])]);
    let removed = store.remove(0).unwrap();
    assert_eq!(removed.content, "x");
    assert_eq!(store.len(), 1);
    assert!(store.remove(5).is_err());
}

#[test]
fn clear_empties_the_store() {
    let mut store = store_of(vec![entry("x", 0.5, "t", &[])]);
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
    let mut e = entry("user prefers dark mode", 0.5, "t", &[]);
    e.category = MemoryCategory {
        kind: "preference".to_string(),
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
    let e = entry("hello", 0.75, "2024-01-01T00:00:00Z", &["greeting"]);
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
        content: "hi".to_string(),
        category: cat("semantic"),
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
fn category_coerces_a_bare_string_the_way_a_host_persists_it() {
    // A host that persists `category` as a bare string (e.g. "core") loads
    // losslessly into the open kind, without any host-specific enum.
    let from_str: MemoryCategory = serde_json::from_value(serde_json::json!("core")).unwrap();
    assert_eq!(from_str.kind, "core");
    assert_eq!(from_str.label, None);

    // On save it canonicalizes to the object form (consistent with all coerce
    // types), which still round-trips back to the same value.
    let json = serde_json::to_value(&from_str).unwrap();
    assert_eq!(json, serde_json::json!({ "kind": "core" }));
    let back: MemoryCategory = serde_json::from_value(json).unwrap();
    assert_eq!(back, from_str);
}

#[test]
fn category_object_form_with_label_round_trips() {
    let obj = MemoryCategory {
        kind: "procedural".to_string(),
        label: Some("how-to".to_string()),
    };
    let json = serde_json::to_value(&obj).unwrap();
    assert_eq!(json["kind"], "procedural");
    assert_eq!(json["label"], "how-to");
    let back: MemoryCategory = serde_json::from_value(json).unwrap();
    assert_eq!(back, obj);
}

#[test]
fn entry_with_bare_string_category_round_trips_like_a_host_row() {
    // Mirrors a host row: { content, category: "core", createdAt, tags }.
    let row = serde_json::json!({
        "content": "remember the deploy step",
        "category": "core",
        "createdAt": "2024-01-01T00:00:00Z",
        "tags": ["deploy"]
    });
    let e: MemoryEntry = serde_json::from_value(row).unwrap();
    assert_eq!(e.category.kind, "core");
    assert_eq!(e.content, "remember the deploy step");
    assert_eq!(e.tags.as_deref(), Some(&["deploy".to_string()][..]));
}

#[test]
fn store_round_trips_through_json() {
    let store = store_of(vec![
        entry("one", 0.5, "2024-01-01T00:00:00Z", &["t1"]),
        entry("two", 0.6, "2024-01-02T00:00:00Z", &[]),
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
    store.add(entry("remember this", 0.5, "t", &[]));
    port.save(&store).unwrap();

    // A subsequent load observes the persisted snapshot and recall works on it.
    let reloaded = port.load();
    assert_eq!(reloaded.len(), 1);
    assert_eq!(
        reloaded.recall("remember", 0)[0].entry.content,
        "remember this"
    );
}
