//! Agent memory: host-neutral recall, formatting, and mutation logic over the
//! generated memory data contract.
//!
//! The data types (`MemoryEntry`, `MemoryCategory`, `MemoryStore`) are generated
//! from TypeSpec and re-exported here. This module adds the deterministic,
//! app-agnostic logic the engine owns on top of them — recall ranking, prompt
//! formatting, and whole-store entry mutation — mirroring how the engine owns
//! deterministic logic while a host owns only persistence.
//!
//! A host implements [`MemoryPort`] to persist the whole-store snapshot
//! (`load`/`save`); everything else lives here so every runtime and host shares
//! one canonical recall and formatting contract rather than reimplementing it.

pub use crate::model::{MemoryCategory, MemoryEntry, MemoryStore};

/// Host-owned persistence for a whole-store memory snapshot.
///
/// The host implements only load/save of the entire [`MemoryStore`]; the engine
/// owns recall, formatting, and mutation via the inherent methods on
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

/// Score an entry against the query tokens.
///
/// Returns `(weighted_score, distinct_matches)` where a keyword found in the
/// content contributes `2.0` and a keyword found in the tags contributes `3.0`
/// (tags are weighted higher because they are curated), and `distinct_matches`
/// counts how many distinct query keywords matched anywhere. Both are `0` for
/// an empty query.
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
    (weighted, distinct)
}

impl MemoryStore {
    /// Append a memory to the end of the store.
    pub fn add(&mut self, entry: MemoryEntry) {
        self.entries.push(entry);
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

    /// Remove every memory from the store.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Number of memories in the store.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the store has no memories.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Deterministically recall the most relevant memories for `query`.
    ///
    /// Ranking is lexical and dependency-free. Each memory is scored by summing,
    /// over the distinct query keywords, `2.0` for a keyword found in the
    /// content and `3.0` for one found in the tags (tags weighted higher because
    /// they are curated). Ties are broken by `importance` (descending), then by
    /// recency (`createdAt`, compared lexically as ISO 8601), then by the
    /// original insertion order as a stable final tiebreak. The engine assigns
    /// no weight to `category` — any category-based priority is host policy.
    /// When `query` has no keywords, all memories are ranked by importance then
    /// recency. When `limit` is `0`, all matching memories are returned. A host
    /// wanting vector recall carries embeddings in entry metadata and does so
    /// itself.
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
                .then_with(|| {
                    b.entry
                        .importance
                        .unwrap_or(0.0)
                        .total_cmp(&a.entry.importance.unwrap_or(0.0))
                })
                .then_with(|| {
                    b.entry
                        .created_at
                        .as_deref()
                        .unwrap_or("")
                        .cmp(a.entry.created_at.as_deref().unwrap_or(""))
                })
                .then_with(|| a_index.cmp(b_index))
        });

        let mut results: Vec<ScoredMemory> = scored.into_iter().map(|(_, s)| s).collect();
        if limit > 0 && results.len() > limit {
            results.truncate(limit);
        }
        results
    }

    /// Format the whole store as a memory block for injection into a system
    /// prompt. Returns an empty string when the store is empty so a host can
    /// conditionally inject. Output is deterministic and host-neutral.
    pub fn format_for_system_prompt(&self) -> String {
        if self.entries.is_empty() {
            return String::new();
        }
        let mut out = String::from("## Memory\n");
        for entry in &self.entries {
            out.push_str(&format_entry_line(entry));
        }
        out
    }
}

fn format_entry_line(entry: &MemoryEntry) -> String {
    let label = entry
        .category
        .label
        .as_deref()
        .filter(|l| !l.is_empty())
        .map(|l| format!("{}/{}", entry.category.kind.as_str(), l))
        .unwrap_or_else(|| entry.category.kind.as_str().to_string());
    format!("- [{label}] {}\n", entry.content)
}

/// Format a recall result set for presentation, e.g. to surface which memories
/// informed a response. Returns an empty string for an empty result set.
/// Output is deterministic and host-neutral.
pub fn format_recall_results(results: &[ScoredMemory]) -> String {
    if results.is_empty() {
        return String::new();
    }
    let mut out = String::from("## Recalled memories\n");
    for scored in results {
        out.push_str(&format_entry_line(&scored.entry));
    }
    out
}
