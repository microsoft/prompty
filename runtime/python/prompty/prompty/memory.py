"""Provide host-neutral agent memory behavior.

This module layers deterministic recall, formatting, mutation, and snapshot
persistence helpers on top of the generated memory data contract. Hosts own only
where a memory snapshot is stored; the runtime owns the portable behavior.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from .model import MemoryEntry, MemoryStore

__all__ = [
    "MemoryEntry",
    "MemoryPort",
    "MemoryStore",
    "ScoredMemory",
    "add_memory",
    "clear_memory",
    "core_memories",
    "evict_to_cap",
    "format_for_system_prompt",
    "format_recall_results",
    "recall",
    "remember",
    "remove_memory",
    "update_content",
    "update_memory",
]

CORE = "core"
ARCHIVAL = "archival"


class MemoryPort(Protocol):
    """Host-owned persistence for a whole-store memory snapshot."""

    def load(self) -> MemoryStore:
        """Load the whole memory store snapshot."""

    def save(self, store: MemoryStore) -> None:
        """Persist the whole memory store snapshot."""


@dataclass(frozen=True)
class ScoredMemory:
    """A recalled memory paired with its deterministic relevance score."""

    entry: MemoryEntry
    score: float
    keyword_matches: int


def _query_tokens(query: str) -> list[str]:
    tokens: list[str] = []
    for raw in query.split():
        token = re.sub(r"^\W+|\W+$", "", raw, flags=re.UNICODE).lower()
        if token and token not in tokens:
            tokens.append(token)
    return tokens


def _tags_equal(left: list[str] | None, right: list[str] | None) -> bool:
    return (left or []) == (right or [])


def _score_entry(entry: MemoryEntry, tokens: list[str]) -> tuple[float, int]:
    if not tokens:
        return 0.0, 0

    content = entry.content.lower()
    tags = [tag.lower() for tag in (entry.tags or [])]

    weighted = 0.0
    distinct = 0
    for token in tokens:
        in_content = token in content
        in_tags = any(token in tag for tag in tags)
        if in_content or in_tags:
            distinct += 1
        if in_content:
            weighted += 2.0
        if in_tags:
            weighted += 3.0

    if weighted > 0.0 and entry.category == CORE:
        weighted += 1.0
    return weighted, distinct


def add_memory(store: MemoryStore, entry: MemoryEntry) -> None:
    """Append a memory to the end of the store with no tier policy applied."""

    store.entries.append(entry)


def remember(store: MemoryStore, entry: MemoryEntry, max_entries: int = 0) -> None:
    """Insert a memory applying core deduplication and cap eviction."""

    if entry.category == CORE:
        store.entries = [
            existing
            for existing in store.entries
            if existing.category != CORE or not _tags_equal(existing.tags, entry.tags)
        ]
    store.entries.append(entry)
    evict_to_cap(store, max_entries)


def evict_to_cap(store: MemoryStore, max_entries: int) -> int:
    """Evict to ``max_entries``, preferring oldest archival memories."""

    if max_entries == 0:
        return 0

    evicted = 0
    while len(store.entries) > max_entries:
        victim = next((i for i, entry in enumerate(store.entries) if entry.category == ARCHIVAL), 0)
        del store.entries[victim]
        evicted += 1
    return evicted


def update_memory(store: MemoryStore, index: int, entry: MemoryEntry) -> None:
    """Replace the memory at ``index``."""

    if index >= len(store.entries):
        raise IndexError(f"memory index {index} out of bounds (len {len(store.entries)})")
    store.entries[index] = entry


def update_content(store: MemoryStore, index: int, content: str) -> None:
    """Replace only the content of the memory at ``index``."""

    if index >= len(store.entries):
        raise IndexError(f"memory index {index} out of bounds (len {len(store.entries)})")
    store.entries[index].content = content


def remove_memory(store: MemoryStore, index: int) -> MemoryEntry:
    """Remove and return the memory at ``index``."""

    if index >= len(store.entries):
        raise IndexError(f"memory index {index} out of bounds (len {len(store.entries)})")
    return store.entries.pop(index)


def clear_memory(store: MemoryStore, category: str | None = None) -> int:
    """Remove memories in ``category`` or all memories when omitted."""

    before = len(store.entries)
    if category is None:
        store.entries.clear()
    else:
        store.entries = [entry for entry in store.entries if entry.category != category]
    return before - len(store.entries)


def core_memories(store: MemoryStore) -> list[MemoryEntry]:
    """Return core-tier memories in insertion order."""

    return [entry for entry in store.entries if entry.category == CORE]


def recall(store: MemoryStore, query: str, limit: int = 0) -> list[ScoredMemory]:
    """Deterministically recall the most relevant memories for ``query``."""

    tokens = _query_tokens(query)
    has_query = bool(tokens)
    scored: list[tuple[int, ScoredMemory]] = []

    for index, entry in enumerate(store.entries):
        score, matches = _score_entry(entry, tokens)
        if has_query and matches == 0:
            continue
        scored.append((index, ScoredMemory(entry=entry, score=score, keyword_matches=matches)))

    scored.sort(key=lambda item: (-item[1].score, item[0]))
    results = [item[1] for item in scored]
    if limit > 0:
        return results[:limit]
    return results


def format_for_system_prompt(store: MemoryStore) -> str:
    """Format core memories as a deterministic system-prompt block."""

    core = core_memories(store)
    if not core:
        return ""
    return "## Memory\n" + "".join(f"- {entry.content}\n" for entry in core)


def format_recall_results(results: list[ScoredMemory]) -> str:
    """Format recalled memories for presentation."""

    if not results:
        return ""

    lines: list[str] = []
    for index, scored in enumerate(results, start=1):
        lines.append(f"{index}. [{scored.entry.category}] {scored.entry.content}")
        if scored.entry.tags:
            lines.append(f"   tags: {', '.join(scored.entry.tags)}")
    return "\n".join(lines) + "\n"
