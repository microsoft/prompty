"""Test host-neutral memory behavior."""

from __future__ import annotations

from prompty import (
    MemoryEntry,
    MemoryPort,
    MemoryStore,
    ScoredMemory,
    add_memory,
    clear_memory,
    core_memories,
    evict_to_cap,
    format_for_system_prompt,
    format_recall_results,
    recall,
    remember,
    remove_memory,
    update_content,
    update_memory,
)


def entry(content: str, category: str = "insight", created_at: str | None = "t", tags: list[str] | None = None):
    """Build a generated memory entry."""

    return MemoryEntry(content=content, category=category, created_at=created_at, tags=tags)


def store_of(entries: list[MemoryEntry]) -> MemoryStore:
    """Build a generated memory store."""

    return MemoryStore(entries=entries)


def contents(results: list[ScoredMemory]) -> list[str]:
    """Return recalled memory contents."""

    return [result.entry.content for result in results]


def test_recall_ranks_by_weighted_score() -> None:
    store = store_of(
        [
            entry("the sky is clear"),
            entry("favorite color is blue sky"),
        ]
    )

    results = recall(store, "blue sky")
    assert results[0].entry.content == "favorite color is blue sky"
    assert results[0].keyword_matches == 2
    assert results[0].score == 4.0
    assert results[1].entry.content == "the sky is clear"
    assert results[1].keyword_matches == 1
    assert results[1].score == 2.0


def test_recall_weights_tag_matches_higher_than_content() -> None:
    store = store_of(
        [
            entry("all about space"),
            entry("unrelated text", tags=["space"]),
        ]
    )

    results = recall(store, "space")
    assert results[0].entry.content == "unrelated text"
    assert results[0].score == 3.0
    assert results[1].score == 2.0


def test_recall_boosts_core_tier_by_one() -> None:
    store = store_of(
        [
            entry("run the deploy", "archival"),
            entry("always deploy on green", "core"),
        ]
    )

    results = recall(store, "deploy")
    assert results[0].entry.content == "always deploy on green"
    assert results[0].score == 3.0
    assert results[1].entry.content == "run the deploy"
    assert results[1].score == 2.0


def test_recall_filters_non_matches_and_is_case_punctuation_insensitive() -> None:
    store = store_of(
        [
            entry("The Sky Is Blue."),
            entry("dogs are loyal"),
        ]
    )

    results = recall(store, "SKY, blue!")
    assert len(results) == 1
    assert results[0].keyword_matches == 2
    assert results[0].score == 4.0


def test_recall_empty_query_returns_all_in_insertion_order() -> None:
    store = store_of(
        [
            entry("first", created_at="2024-01-03T00:00:00Z"),
            entry("second", created_at="2024-01-01T00:00:00Z"),
            entry("third", created_at="2024-01-02T00:00:00Z"),
        ]
    )

    assert contents(recall(store, "")) == ["first", "second", "third"]


def test_recall_uses_insertion_order_as_stable_tiebreak_and_limit() -> None:
    store = store_of(
        [
            entry("alpha match"),
            entry("beta match"),
            entry("gamma match"),
        ]
    )

    assert contents(recall(store, "match", 2)) == ["alpha match", "beta match"]
    assert contents(recall(store, "match", 0)) == ["alpha match", "beta match", "gamma match"]


def test_add_and_remember_apply_tier_policy() -> None:
    store = store_of([entry("x")])
    add_memory(store, entry("y"))
    assert [item.content for item in store.entries] == ["x", "y"]

    store = store_of([entry("old fact", "core", tags=["subject"])])
    remember(store, entry("new fact", "core", tags=["subject"]))
    assert [item.content for item in store.entries] == ["new fact"]

    remember(store, entry("summary", "archival", tags=["subject"]))
    assert [item.content for item in store.entries] == ["new fact", "summary"]


def test_remember_evicts_to_cap_preferring_archival() -> None:
    store = store_of(
        [
            entry("core a", "core", tags=["a"]),
            entry("archival b", "archival"),
        ]
    )

    remember(store, entry("core c", "core", tags=["c"]), 2)
    assert [item.content for item in store.entries] == ["core a", "core c"]


def test_evict_to_cap_falls_back_to_oldest_and_zero_means_no_cap() -> None:
    store = store_of(
        [
            entry("core a", "core", tags=["a"]),
            entry("core b", "core", tags=["b"]),
            entry("core c", "core", tags=["c"]),
        ]
    )

    assert evict_to_cap(store, 2) == 1
    assert [item.content for item in store.entries] == ["core b", "core c"]
    assert evict_to_cap(store, 0) == 0


def test_update_remove_clear_and_core_filter() -> None:
    store = store_of(
        [
            entry("x"),
            entry("y", "core", tags=["k"]),
            entry("z", "archival"),
        ]
    )

    update_memory(store, 0, entry("replacement", "core"))
    update_content(store, 1, "new y")
    removed = remove_memory(store, 2)
    assert removed.content == "z"
    assert [item.content for item in core_memories(store)] == ["replacement", "new y"]
    assert clear_memory(store, "core") == 2
    assert store.entries == []


def test_update_bounds_checks() -> None:
    store = store_of([entry("x")])

    try:
        update_memory(store, 5, entry("y"))
    except IndexError as exc:
        assert "memory index 5 out of bounds" in str(exc)
    else:
        raise AssertionError("expected update_memory to raise")

    try:
        update_content(store, 5, "y")
    except IndexError as exc:
        assert "memory index 5 out of bounds" in str(exc)
    else:
        raise AssertionError("expected update_content to raise")

    try:
        remove_memory(store, 5)
    except IndexError as exc:
        assert "memory index 5 out of bounds" in str(exc)
    else:
        raise AssertionError("expected remove_memory to raise")


def test_formatting_helpers() -> None:
    store = store_of(
        [
            entry("persistent fact", "core"),
            entry("a summary", "archival"),
            entry("another fact", "core"),
        ]
    )

    assert format_for_system_prompt(store) == "## Memory\n- persistent fact\n- another fact\n"
    assert format_recall_results([]) == ""
    assert format_recall_results(recall(store_of([entry("run the deploy", "core", tags=["ops"])]), "deploy")) == (
        "1. [core] run the deploy\n   tags: ops\n"
    )


class InMemoryPort:
    """Test memory port."""

    def __init__(self, store: MemoryStore) -> None:
        self.store = store

    def load(self) -> MemoryStore:
        return MemoryStore.load(self.store.save())

    def save(self, store: MemoryStore) -> None:
        self.store = MemoryStore.load(store.save())


def test_memory_port_load_save_snapshot_round_trip() -> None:
    port: MemoryPort = InMemoryPort(store_of([]))
    store = port.load()
    remember(store, entry("remember this", "core"), 200)
    port.save(store)

    reloaded = port.load()
    assert len(reloaded.entries) == 1
    assert recall(reloaded, "remember")[0].entry.content == "remember this"
