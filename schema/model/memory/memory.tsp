import "@typra/emitter";
import "../core/core.tsp";

namespace Prompty;

/**
 * The tier of an agent memory in a general, host-neutral tiered-memory model.
 *
 * This taxonomy is behavioral, not application-specific: each tier carries a
 * canonical meaning that the engine's deterministic recall, system-prompt
 * injection, and eviction logic act on. It is a general agent-memory
 * architecture (the same tiering popularized by MemGPT-style memory), not any
 * host's domain vocabulary.
 *
 * - `core`: persistent, always-injected facts about the user or project. Core
 *   memories are injected into every system prompt, deduplicated by identical
 *   tags on write, and given a small relevance boost during recall.
 * - `archival`: compressed summaries of past sessions or episodes. Archival
 *   memories surface only through recall and are the preferred eviction target
 *   when the store exceeds its configured cap.
 * - `insight`: explicitly saved reflections or insights. Surfaced through recall.
 *
 * A host maps its own application categories onto these three general tiers; the
 * three behavioral semantics (always-inject / evictable-summary / explicit) are
 * what the engine relies on.
 */
alias MemoryCategory = "core" | "archival" | "insight";

/**
 * A single agent memory — the canonical, host-neutral unit of agent memory.
 *
 * `content` is the memory text, `category` places it in a general tier,
 * `createdAt` records when the memory was formed (intrinsic, portable data), and
 * `tags` are general labels used for keyword recall, grouping, and core
 * deduplication. Host-specific associations (for example a session association)
 * are expressed through the general `tags` field by convention — e.g. a
 * `session:{id}` tag — never as a canonical field. A host needing per-entry
 * bookkeeping, a stable id, or a stored embedding vector layers it in host
 * storage; those are not canonical fields.
 */
model MemoryEntry {
  @doc("The memory content")
  @sample(#{ content: "The user prefers concise answers." })
  content: string = "";

  @doc("The general tier of the memory")
  @sample(#{ category: "core" })
  category: MemoryCategory = "core";

  @doc("ISO 8601 UTC timestamp recording when the memory was formed; intrinsic, portable data")
  @sample(#{ createdAt: "2026-06-09T20:00:00Z" })
  createdAt?: string;

  @doc("General labels for the memory; used for keyword recall, grouping, and core deduplication")
  @sample(#{ tags: #["preference", "tone"] })
  tags?: string[];
}

/**
 * A whole-store snapshot of agent memory.
 *
 * The canonical persisted shape a host loads and saves as one unit. A host
 * backend implements only load/save of this snapshot; the engine owns the
 * deterministic recall, formatting, tiered injection, eviction, and
 * entry-mutation logic on top of it.
 */
model MemoryStore {
  @doc("The memories held in the store, in insertion order")
  @sample(#{ entries: #[] })
  entries: MemoryEntry[];
}
