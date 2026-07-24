//! Tests for the host-neutral, tiered agent-memory logic (`prompty::memory`)
//! layered on the generated memory data contract.

use prompty::{
    MemoryCategory, MemoryEntry, MemoryPort, MemoryStore, ScoredMemory, format_recall_results,
};
use std::sync::Mutex;

fn entry(content: &str, category: MemoryCategory, created_at: &str, tags: &[&str]) -> MemoryEntry {
    MemoryEntry {
        content: content.to_string(),
        category,
        created_at: if created_at.is_empty() {
            None
        } else {
            Some(created_at.to_string())
        },
        tags: if tags.is_empty() {
            None
        } else {
            Some(tags.iter().map(|s| s.to_string()).collect())
        },
    }
}

fn store_of(entries: Vec<MemoryEntry>) -> MemoryStore {
    MemoryStore { entries }
}

fn contents(results: &[ScoredMemory]) -> Vec<String> {
    results.iter().map(|s| s.entry.content.clone()).collect()
}

use MemoryCategory::{Archival, Core, Insight};

// --- Recall ranking -------------------------------------------------------

#[test]
fn recall_ranks_by_weighted_score() {
    let store = store_of(vec![
        // matches only "sky" in content -> weighted 2.0
        entry("the sky is clear", Insight, "2024-01-01T00:00:00Z", &[]),
        // matches "blue" and "sky" in content -> weighted 4.0
        entry(
            "favorite color is blue sky",
            Insight,
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
        entry("all about space", Insight, "2024-01-01T00:00:00Z", &[]),
        // "space" in tags -> 3.0
        entry(
            "unrelated text",
            Insight,
            "2024-01-02T00:00:00Z",
            &["space"],
        ),
    ]);

    let results = store.recall("space", 0);
    assert_eq!(results[0].entry.content, "unrelated text");
    assert_eq!(results[0].score, 3.0);
    assert_eq!(results[1].score, 2.0);
}

#[test]
fn recall_boosts_core_tier_by_one() {
    let store = store_of(vec![
        // archival: "deploy" in content -> 2.0
        entry("run the deploy", Archival, "2024-01-01T00:00:00Z", &[]),
        // core: "deploy" in content -> 2.0 + 1.0 core boost = 3.0
        entry("always deploy on green", Core, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("deploy", 0);
    assert_eq!(results[0].entry.content, "always deploy on green");
    assert_eq!(results[0].score, 3.0);
    assert_eq!(results[1].entry.content, "run the deploy");
    assert_eq!(results[1].score, 2.0);
}

#[test]
fn recall_core_boost_only_applies_on_a_match() {
    // A non-matching core memory is not surfaced (boost only applies when the
    // keyword score is already > 0).
    let store = store_of(vec![
        entry("persistent fact", Core, "2024-01-01T00:00:00Z", &[]),
        entry("about widgets", Insight, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("widgets", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].entry.content, "about widgets");
}

#[test]
fn recall_filters_out_non_matches_for_a_query() {
    let store = store_of(vec![
        entry("cats are great", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("dogs are loyal", Insight, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("dogs", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].entry.content, "dogs are loyal");
}

#[test]
fn recall_is_case_and_punctuation_insensitive() {
    let store = store_of(vec![entry(
        "The Sky Is Blue.",
        Insight,
        "2024-01-01T00:00:00Z",
        &[],
    )]);

    let results = store.recall("SKY, blue!", 0);
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].keyword_matches, 2);
    assert_eq!(results[0].score, 4.0);
}

#[test]
fn recall_empty_query_returns_all_in_insertion_order() {
    let store = store_of(vec![
        entry("first", Insight, "2024-01-03T00:00:00Z", &[]),
        entry("second", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("third", Insight, "2024-01-02T00:00:00Z", &[]),
    ]);

    let results = store.recall("", 0);
    assert_eq!(results.len(), 3);
    assert_eq!(contents(&results), vec!["first", "second", "third"]);
}

#[test]
fn recall_uses_insertion_order_as_stable_tiebreak() {
    // Equal keyword scores -> original insertion order preserved.
    let store = store_of(vec![
        entry("alpha match", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("beta match", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("gamma match", Insight, "2024-01-01T00:00:00Z", &[]),
    ]);

    let results = store.recall("match", 0);
    assert_eq!(
        contents(&results),
        vec!["alpha match", "beta match", "gamma match"]
    );
}

#[test]
fn recall_respects_limit_and_zero_means_unlimited() {
    let store = store_of(vec![
        entry("a match", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("b match", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("c match", Insight, "2024-01-01T00:00:00Z", &[]),
    ]);

    assert_eq!(store.recall("match", 2).len(), 2);
    assert_eq!(store.recall("match", 0).len(), 3);
    assert_eq!(store.recall("match", 10).len(), 3);
}

#[test]
fn recall_is_deterministic_across_repeated_calls() {
    let store = store_of(vec![
        entry("alpha beta", Insight, "2024-01-01T00:00:00Z", &[]),
        entry("beta gamma", Core, "2024-01-02T00:00:00Z", &[]),
        entry("gamma delta", Archival, "2024-01-03T00:00:00Z", &[]),
    ]);

    let first = store.recall("beta gamma", 0);
    for _ in 0..5 {
        assert_eq!(store.recall("beta gamma", 0), first);
    }
}

// --- Mutations ------------------------------------------------------------

#[test]
fn add_appends_to_the_end() {
    let mut store = store_of(vec![entry("x", Insight, "t", &[])]);
    store.add(entry("y", Insight, "t", &[]));
    assert_eq!(store.len(), 2);
    assert_eq!(store.entries[1].content, "y");
}

#[test]
fn remember_dedups_core_by_identical_tags() {
    let mut store = store_of(vec![entry("old fact", Core, "t", &["subject"])]);
    store.remember(entry("new fact", Core, "t", &["subject"]), 0);
    // The prior core memory with identical tags is replaced, not accumulated.
    assert_eq!(store.len(), 1);
    assert_eq!(store.entries[0].content, "new fact");
}

#[test]
fn remember_does_not_dedup_core_with_different_tags_or_non_core() {
    let mut store = store_of(vec![entry("fact a", Core, "t", &["a"])]);
    store.remember(entry("fact b", Core, "t", &["b"]), 0);
    store.remember(entry("summary", Archival, "t", &["a"]), 0);
    assert_eq!(store.len(), 3);
}

#[test]
fn remember_evicts_to_cap_preferring_archival() {
    let mut store = store_of(vec![
        entry("core a", Core, "t", &["a"]),
        entry("archival b", Archival, "t", &[]),
    ]);
    // cap 2, add a third -> must evict; archival is the disposable tier.
    store.remember(entry("core c", Core, "t", &["c"]), 2);
    assert_eq!(store.len(), 2);
    assert_eq!(contents(&store.recall("", 0)), vec!["core a", "core c"]);
}

#[test]
fn evict_to_cap_falls_back_to_oldest_when_no_archival() {
    let mut store = store_of(vec![
        entry("core a", Core, "t", &["a"]),
        entry("core b", Core, "t", &["b"]),
        entry("core c", Core, "t", &["c"]),
    ]);
    let evicted = store.evict_to_cap(2);
    assert_eq!(evicted, 1);
    assert_eq!(contents(&store.recall("", 0)), vec!["core b", "core c"]);
}

#[test]
fn evict_to_cap_zero_means_no_cap() {
    let mut store = store_of(vec![
        entry("a", Insight, "t", &[]),
        entry("b", Insight, "t", &[]),
        entry("c", Insight, "t", &[]),
    ]);
    assert_eq!(store.evict_to_cap(0), 0);
    assert_eq!(store.len(), 3);
}

#[test]
fn update_replaces_in_place_and_bounds_checks() {
    let mut store = store_of(vec![
        entry("x", Insight, "t", &[]),
        entry("y", Insight, "t", &[]),
    ]);
    store.update(0, entry("z", Core, "t", &[])).unwrap();
    assert_eq!(store.entries[0].content, "z");
    assert_eq!(store.entries[0].category, Core);
    assert!(store.update(5, entry("c", Insight, "t", &[])).is_err());
}

#[test]
fn update_content_preserves_category_and_tags() {
    let mut store = store_of(vec![entry("old", Core, "2024-01-01T00:00:00Z", &["k"])]);
    store.update_content(0, "new").unwrap();
    assert_eq!(store.entries[0].content, "new");
    assert_eq!(store.entries[0].category, Core);
    assert_eq!(
        store.entries[0].tags.as_deref(),
        Some(&["k".to_string()][..])
    );
    assert!(store.update_content(9, "x").is_err());
}

#[test]
fn remove_returns_entry_and_bounds_checks() {
    let mut store = store_of(vec![
        entry("x", Insight, "t", &[]),
        entry("y", Insight, "t", &[]),
    ]);
    let removed = store.remove(0).unwrap();
    assert_eq!(removed.content, "x");
    assert_eq!(store.len(), 1);
    assert!(store.remove(5).is_err());
}

#[test]
fn clear_all_or_by_category() {
    let mut store = store_of(vec![
        entry("core a", Core, "t", &[]),
        entry("archival b", Archival, "t", &[]),
        entry("core c", Core, "t", &[]),
    ]);
    assert_eq!(store.clear(Some(Core)), 2);
    assert_eq!(contents(&store.recall("", 0)), vec!["archival b"]);
    assert_eq!(store.clear(None), 1);
    assert!(store.is_empty());
}

#[test]
fn core_memories_filters_the_core_tier() {
    let store = store_of(vec![
        entry("core a", Core, "t", &[]),
        entry("archival b", Archival, "t", &[]),
        entry("insight c", Insight, "t", &[]),
    ]);
    let core: Vec<&str> = store
        .core_memories()
        .iter()
        .map(|e| e.content.as_str())
        .collect();
    assert_eq!(core, vec!["core a"]);
}

// --- Formatting -----------------------------------------------------------

#[test]
fn format_for_system_prompt_is_empty_when_no_core() {
    let store = store_of(vec![
        entry("archival only", Archival, "t", &[]),
        entry("insight only", Insight, "t", &[]),
    ]);
    assert_eq!(store.format_for_system_prompt(), "");
}

#[test]
fn format_for_system_prompt_injects_only_core() {
    let store = store_of(vec![
        entry("persistent fact", Core, "t", &[]),
        entry("a summary", Archival, "t", &[]),
        entry("another fact", Core, "t", &[]),
    ]);
    let out = store.format_for_system_prompt();
    assert_eq!(out, "## Memory\n- persistent fact\n- another fact\n");
}

#[test]
fn format_recall_results_is_empty_for_no_results() {
    let empty: Vec<ScoredMemory> = Vec::new();
    assert_eq!(format_recall_results(&empty), "");
}

#[test]
fn format_recall_results_lists_category_and_tags() {
    let store = store_of(vec![entry(
        "run the deploy",
        Core,
        "2024-01-01T00:00:00Z",
        &["ops"],
    )]);
    let results = store.recall("deploy", 0);
    let out = format_recall_results(&results);
    assert_eq!(out, "1. [core] run the deploy\n   tags: ops\n");
}

// --- Durable round-trip ---------------------------------------------------

#[test]
fn entry_round_trips_through_canonical_camelcase_json() {
    let e = entry("hello", Core, "2024-01-01T00:00:00Z", &["greeting"]);
    let json = serde_json::to_value(&e).unwrap();

    // Canonical camelCase key; snake_case absent.
    assert_eq!(json["createdAt"], "2024-01-01T00:00:00Z");
    assert!(json.get("created_at").is_none());
    assert_eq!(json["tags"][0], "greeting");
    // Category serializes as a bare string, byte-identical to a host row.
    assert_eq!(json["category"], "core");

    let back: MemoryEntry = serde_json::from_value(json).unwrap();
    assert_eq!(back, e);
}

#[test]
fn entry_conditional_emit_omits_absent_optionals() {
    let e = MemoryEntry {
        content: "hi".to_string(),
        category: Insight,
        created_at: None,
        tags: None,
    };
    let json = serde_json::to_value(&e).unwrap();
    assert!(json.get("createdAt").is_none());
    assert!(json.get("tags").is_none());
    // category is always present (non-optional tier).
    assert_eq!(json["category"], "insight");
}

#[test]
fn category_serializes_as_a_bare_string() {
    assert_eq!(
        serde_json::to_value(Core).unwrap(),
        serde_json::json!("core")
    );
    assert_eq!(
        serde_json::to_value(Archival).unwrap(),
        serde_json::json!("archival")
    );
    assert_eq!(
        serde_json::to_value(Insight).unwrap(),
        serde_json::json!("insight")
    );

    let back: MemoryCategory = serde_json::from_value(serde_json::json!("archival")).unwrap();
    assert_eq!(back, Archival);
}

#[test]
fn host_row_round_trips_byte_identically() {
    // Mirrors a persisted host row exactly: { content, category, createdAt, tags }
    // with a bare-string category. It must load and re-save to the identical shape.
    let row = serde_json::json!({
        "content": "remember the deploy step",
        "category": "core",
        "createdAt": "2024-01-01T00:00:00Z",
        "tags": ["deploy"]
    });
    let e: MemoryEntry = serde_json::from_value(row.clone()).unwrap();
    assert_eq!(e.category, Core);
    assert_eq!(e.content, "remember the deploy step");
    assert_eq!(e.tags.as_deref(), Some(&["deploy".to_string()][..]));

    let round_tripped = serde_json::to_value(&e).unwrap();
    assert_eq!(round_tripped, row);
}

#[test]
fn store_round_trips_through_json() {
    let store = store_of(vec![
        entry("one", Core, "2024-01-01T00:00:00Z", &["t1"]),
        entry("two", Archival, "2024-01-02T00:00:00Z", &[]),
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
    store.remember(entry("remember this", Core, "t", &[]), 200);
    port.save(&store).unwrap();

    // A subsequent load observes the persisted snapshot and recall works on it.
    let reloaded = port.load();
    assert_eq!(reloaded.len(), 1);
    assert_eq!(
        reloaded.recall("remember", 0)[0].entry.content,
        "remember this"
    );
}
