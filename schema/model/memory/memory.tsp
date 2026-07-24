import "@typra/emitter";
import "../core/core.tsp";

namespace Prompty;

alias memoryCategoryKind =
  | "semantic"
  | "episodic"
  | "procedural"
  | "preference";

/**
 * The classification of an agent memory.
 *
 * `kind` is a general, host-neutral taxonomy: `semantic` (facts and durable
 * knowledge), `episodic` (specific events or interactions), `procedural`
 * (skills or how-to), and `preference` (user or agent preferences). A host with
 * a finer-grained or application-specific taxonomy maps it onto one of these
 * general kinds and carries the raw label in `label` (or in entry metadata),
 * rather than introducing an application-specific canonical variant.
 */
@coerce(string, #{ kind: "{value}" }, "kind", "Memory Category", "semantic")
model MemoryCategory {
  @doc("The general memory category: 'semantic', 'episodic', 'procedural', or 'preference'")
  @sample(#{ kind: "semantic" })
  kind: memoryCategoryKind;

  @doc("Optional finer-grained or host-specific classification within the general kind")
  @sample(#{ label: "project-fact" })
  label?: string;
}

/**
 * A single agent memory.
 *
 * The canonical, host-neutral unit of agent memory. `content` is the memory
 * text; `category` classifies it; `createdAt`, `tags`, and `importance` are
 * intrinsic scoring inputs consumed by deterministic recall. Any host-specific
 * bookkeeping (source, session association, application taxonomy, or a stored
 * embedding vector for host-side vector recall) lives in `metadata`, never as a
 * canonical field.
 */
model MemoryEntry {
  @doc("Stable unique identifier for the memory")
  @sample(#{ id: "mem-0001" })
  id: string = "";

  @doc("The memory content")
  @sample(#{ content: "The user prefers concise answers." })
  content: string = "";

  @doc("The classification of the memory")
  @sample(#{ category: #{ kind: "preference" } })
  category: MemoryCategory;

  @doc("ISO 8601 UTC timestamp when the memory was created; consumed as a recency input by recall")
  @sample(#{ createdAt: "2026-06-09T20:00:00Z" })
  createdAt?: string;

  @doc("General labels for the memory; consumed as keyword inputs by recall")
  @sample(#{ tags: #["preference", "tone"] })
  tags?: string[];

  @doc("Optional salience weight in the range 0..1; consumed as a ranking input by recall")
  @sample(#{ importance: 0.8 })
  importance?: float32;

  @doc("Opaque host-specific memory metadata (e.g. source, session association, raw application taxonomy, or a stored embedding vector for host-side vector recall)")
  metadata?: Record<unknown> = #{};
}

/**
 * A whole-store snapshot of agent memory.
 *
 * The canonical persisted shape a host loads and saves as one unit. A host
 * backend implements only load/save of this snapshot; the engine owns the
 * deterministic recall, formatting, and entry-mutation logic on top of it.
 */
model MemoryStore {
  @doc("The memories held in the store, in insertion order")
  @sample(#{ entries: #[] })
  entries: MemoryEntry[];

  @doc("Opaque host-specific store metadata")
  metadata?: Record<unknown> = #{};
}
