//! Agent memory: host-neutral, tiered recall, formatting, and mutation logic
//! over the generated memory data contract.
//!
//! The data types (`MemoryEntry`, `MemoryCategory`, `MemoryStore`) are generated
//! from TypeSpec and re-exported here. This module adds the deterministic,
//! app-agnostic logic the engine owns on top of them — recall ranking, tiered
//! system-prompt injection, cap eviction, and whole-store entry mutation —
//! mirroring how the engine owns deterministic logic while a host owns only
//! persistence.
//!
//! Memory is tiered by [`MemoryCategory`]: `Core` memories are persistent facts
//! injected into every system prompt, deduplicated on write by identical tags,
//! and boosted during recall; `Archival` memories are compressed summaries
//! surfaced only through recall and preferred for eviction; `Insight` memories
//! are explicitly saved reflections surfaced through recall. These three
//! behavioral semantics are general (host-neutral) and are what the recall,
//! injection, and eviction logic act on.
//!
//! A host implements [`MemoryPort`] to persist the whole-store snapshot
//! (`load`/`save`); everything else lives here so every runtime and host shares
//! one canonical memory contract rather than reimplementing it. The one thing
//! that stays host-side is convention: a host associates a memory with, say, a
//! session by adding a `session:{id}` tag — that is host usage of the general
//! `tags` field, not engine logic.

pub use crate::model::{MemoryCategory, MemoryEntry, MemoryStore};

/// Host-owned persistence for a whole-store memory snapshot.
///
/// The host implements only load/save of the entire [`MemoryStore`]; the engine
/// owns recall, formatting, eviction, and mutation via the inherent methods on
/// [`MemoryStore`]. This mirrors [`crate::DurabilityPort`]: the host owns
/// persistence, the engine owns deterministic logic.
pub trait MemoryPort: Send + Sync {
    /// Load the whole memory store snapshot.
    fn load(&self) -> MemoryStore;

    /// Persist the whole memory store snapshot.
    fn save(&self, store: &MemoryStore) -> Result<(), String>;
}

/// A recalled memory paired with its deterministic relevance score.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoredMemory {
    /// The recalled memory.
    pub entry: MemoryEntry,
    /// The deterministic relevance score (higher is more relevant).
    pub score: f64,
    /// The number of distinct query keywords matched by this memory.
    pub keyword_matches: usize,
}

fn query_tokens(query: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    for raw in query.split_whitespace() {
        let token = raw
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase();
        if !token.is_empty() && !tokens.contains(&token) {
            tokens.push(token);
        }
    }
    tokens
}

/// Whether two entries carry identical tag sets, treating an absent list and an
/// empty list as equal. Used for core deduplication on write.
fn tags_eq(a: &Option<Vec<String>>, b: &Option<Vec<String>>) -> bool {
    let empty: Vec<String> = Vec::new();
    let a = a.as_ref().unwrap_or(&empty);
    let b = b.as_ref().unwrap_or(&empty);
    a == b
}

/// Score an entry against the query tokens.
///
/// Returns `(weighted_score, distinct_matches)` where a keyword found in the
/// content contributes `2.0` and a keyword found in the tags contributes `3.0`
/// (tags are weighted higher because they are curated). When the entry matches
/// at all and is a [`MemoryCategory::Core`] memory, a `+1.0` tier boost is added
/// because core facts are the persistent, always-relevant tier. `distinct_matches`
/// counts how many distinct query keywords matched anywhere. Both are `0` for an
/// empty query.
fn score_entry(entry: &MemoryEntry, tokens: &[String]) -> (f64, usize) {
    if tokens.is_empty() {
        return (0.0, 0);
    }
    let content = entry.content.to_lowercase();
    let tags: Vec<String> = entry
        .tags
        .as_ref()
        .map(|t| t.iter().map(|s| s.to_lowercase()).collect())
        .unwrap_or_default();

    let mut weighted = 0.0;
    let mut distinct = 0;
    for token in tokens {
        let in_content = content.contains(token);
        let in_tags = tags.iter().any(|tag| tag.contains(token));
        if in_content || in_tags {
            distinct += 1;
        }
        if in_content {
            weighted += 2.0;
        }
        if in_tags {
            weighted += 3.0;
        }
    }
    if weighted > 0.0 && entry.category == MemoryCategory::Core {
        weighted += 1.0;
    }
    (weighted, distinct)
}

impl MemoryStore {
    /// Append a memory to the end of the store with no tier policy applied.
    ///
    /// Low-level insertion. Use [`MemoryStore::remember`] to apply core
    /// deduplication and cap eviction.
    pub fn add(&mut self, entry: MemoryEntry) {
        self.entries.push(entry);
    }

    /// Insert a memory applying tier policy: a new [`MemoryCategory::Core`]
    /// memory first evicts any existing core memory carrying identical tags (so
    /// a restated fact replaces the old one), then the memory is appended, then
    /// the store is evicted down to `max_entries` (see
    /// [`MemoryStore::evict_to_cap`]). A `max_entries` of `0` means no cap.
    pub fn remember(&mut self, entry: MemoryEntry, max_entries: usize) {
        if entry.category == MemoryCategory::Core {
            self.entries
                .retain(|e| e.category != MemoryCategory::Core || !tags_eq(&e.tags, &entry.tags));
        }
        self.entries.push(entry);
        self.evict_to_cap(max_entries);
    }

    /// Evict memories until the store holds at most `max_entries`, preferring to
    /// remove the oldest [`MemoryCategory::Archival`] memory (archival summaries
    /// are the disposable tier) and otherwise the oldest memory. Returns the
    /// number of memories evicted. A `max_entries` of `0` means no cap and
    /// evicts nothing.
    pub fn evict_to_cap(&mut self, max_entries: usize) -> usize {
        if max_entries == 0 {
            return 0;
        }
        let mut evicted = 0;
        while self.entries.len() > max_entries {
            let victim = self
                .entries
                .iter()
                .position(|e| e.category == MemoryCategory::Archival)
                .unwrap_or(0);
            self.entries.remove(victim);
            evicted += 1;
        }
        evicted
    }

    /// Replace the memory at `index`.
    pub fn update(&mut self, index: usize, entry: MemoryEntry) -> Result<(), String> {
        if index >= self.entries.len() {
            return Err(format!(
                "memory index {index} out of bounds (len {})",
                self.entries.len()
            ));
        }
        self.entries[index] = entry;
        Ok(())
    }

    /// Replace only the content of the memory at `index`, preserving its
    /// category, timestamp, and tags.
    pub fn update_content(
        &mut self,
        index: usize,
        content: impl Into<String>,
    ) -> Result<(), String> {
        if index >= self.entries.len() {
            return Err(format!(
                "memory index {index} out of bounds (len {})",
                self.entries.len()
            ));
        }
        self.entries[index].content = content.into();
        Ok(())
    }

    /// Remove and return the memory at `index`.
    pub fn remove(&mut self, index: usize) -> Result<MemoryEntry, String> {
        if index >= self.entries.len() {
            return Err(format!(
                "memory index {index} out of bounds (len {})",
                self.entries.len()
            ));
        }
        Ok(self.entries.remove(index))
    }

    /// Remove memories in `category`, or all memories when `category` is `None`.
    /// Returns the number of memories removed.
    pub fn clear(&mut self, category: Option<MemoryCategory>) -> usize {
        let before = self.entries.len();
        match category {
            Some(cat) => self.entries.retain(|e| e.category != cat),
            None => self.entries.clear(),
        }
        before - self.entries.len()
    }

    /// Number of memories in the store.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the store has no memories.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The [`MemoryCategory::Core`] memories, in insertion order.
    pub fn core_memories(&self) -> Vec<&MemoryEntry> {
        self.entries
            .iter()
            .filter(|e| e.category == MemoryCategory::Core)
            .collect()
    }

    /// Deterministically recall the most relevant memories for `query`.
    ///
    /// Ranking is lexical and dependency-free. Each memory is scored by summing,
    /// over the distinct query keywords, `2.0` for a keyword found in the
    /// content and `3.0` for one found in the tags (tags weighted higher because
    /// they are curated), plus a `1.0` boost for a matching
    /// [`MemoryCategory::Core`] memory (core is the persistent, always-relevant
    /// tier). Ties are broken by the original insertion order as a stable final
    /// tiebreak. When `query` has no keywords, all memories are returned in
    /// insertion order with score `0`. When `limit` is `0`, all matching
    /// memories are returned. A host wanting vector recall carries embeddings in
    /// host storage and does so itself.
    pub fn recall(&self, query: &str, limit: usize) -> Vec<ScoredMemory> {
        let tokens = query_tokens(query);
        let has_query = !tokens.is_empty();

        let mut scored: Vec<(usize, ScoredMemory)> = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| {
                let (score, matches) = score_entry(entry, &tokens);
                if has_query && matches == 0 {
                    return None;
                }
                Some((
                    index,
                    ScoredMemory {
                        entry: entry.clone(),
                        score,
                        keyword_matches: matches,
                    },
                ))
            })
            .collect();

        scored.sort_by(|(a_index, a), (b_index, b)| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a_index.cmp(b_index))
        });

        let mut results: Vec<ScoredMemory> = scored.into_iter().map(|(_, s)| s).collect();
        if limit > 0 && results.len() > limit {
            results.truncate(limit);
        }
        results
    }

    /// Format the [`MemoryCategory::Core`] memories as a block for injection into
    /// a system prompt. Returns an empty string when there are no core memories
    /// so a host can conditionally inject. Only core memories are injected
    /// because they are the persistent, always-relevant tier; archival and
    /// insight memories surface through [`MemoryStore::recall`]. Output is
    /// deterministic and host-neutral.
    pub fn format_for_system_prompt(&self) -> String {
        let core = self.core_memories();
        if core.is_empty() {
            return String::new();
        }
        let mut out = String::from("## Memory\n");
        for entry in core {
            out.push_str(&format!("- {}\n", entry.content));
        }
        out
    }
}

/// Format a recall result set for presentation, e.g. to surface which memories
/// informed a response. Returns an empty string for an empty result set. Each
/// result is numbered and tagged with its category; tags, when present, follow
/// on an indented line. Output is deterministic and host-neutral.
pub fn format_recall_results(results: &[ScoredMemory]) -> String {
    if results.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for (i, scored) in results.iter().enumerate() {
        out.push_str(&format!(
            "{}. [{}] {}\n",
            i + 1,
            scored.entry.category.as_str(),
            scored.entry.content
        ));
        if let Some(tags) = scored.entry.tags.as_ref().filter(|t| !t.is_empty()) {
            out.push_str(&format!("   tags: {}\n", tags.join(", ")));
        }
    }
    out
}
