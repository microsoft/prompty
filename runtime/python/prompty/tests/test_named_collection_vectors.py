"""Execute the shared named-collection vectors against the emitted Python models.

Ported from ``runtime/rust/prompty/tests/named_collection_vectors.rs`` so the
contract is exercised in Python as well. Rust was its only executable home for
most of this effort; Go, TypeScript and C# ports landed alongside this one.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from prompty.model import Prompty

_VECTORS_PATH = Path(__file__).resolve().parents[4] / "spec" / "vectors" / "model" / "named_collection_vectors.json"


def _vectors() -> list[dict[str, Any]]:
    document: dict[str, Any] = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))
    return document["vectors"]


def _vectors_for(operation: str) -> list[dict[str, Any]]:
    return [vector for vector in _vectors() if vector["operation"] == operation]


def _semantic_entries(collection: Any) -> list[dict[str, Any]]:
    """Normalize either named-collection wire form into comparable entries.

    Array form supplies ``name`` already (defaulted to empty when absent);
    object form carries it as the key.
    """
    if isinstance(collection, list):
        entries = []
        for entry in collection:
            assert isinstance(entry, dict), "array-form named collection entries must be objects"
            normalized = dict(entry)
            normalized.setdefault("name", "")
            entries.append(normalized)
        return entries
    if isinstance(collection, dict):
        entries = []
        for name, entry in collection.items():
            assert isinstance(entry, dict), "object-form named collection entries must be objects"
            normalized = dict(entry)
            normalized["name"] = name
            entries.append(normalized)
        return entries
    raise AssertionError(f"named collection must be a list or dict, got {collection!r}")


def _assert_subset(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"[{path}] expected object, got {actual!r}"
        for key, expected_value in expected.items():
            assert key in actual, f"[{path}] missing expected key {key!r}"
            _assert_subset(actual[key], expected_value, f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"[{path}] expected array, got {actual!r}"
        assert len(actual) == len(expected), f"[{path}] array length changed"
        for index, expected_value in enumerate(expected):
            _assert_subset(actual[index], expected_value, f"{path}[{index}]")
    else:
        assert actual == expected, f"[{path}] value changed: expected {expected!r}, got {actual!r}"


def _assert_collection(vector_name: str, collection: Any, expected: dict[str, Any]) -> None:
    if isinstance(collection, list):
        actual_format = "array"
    elif isinstance(collection, dict):
        actual_format = "object"
    else:
        actual_format = "invalid"
    assert actual_format == expected["collectionFormat"], f"[{vector_name}] canonical collection format changed"

    # wireEntries assert that the raw saved entry at an index never materializes
    # the listed fields -- they are not entry subsets.
    for assertion in expected.get("wireEntries", []):
        assert isinstance(collection, list), f"[{vector_name}] wire entry assertions require array form"
        index = assertion["index"]
        assert index < len(collection), f"[{vector_name}] missing wire entry at index {index}"
        entry = collection[index]
        for field in assertion["absentFields"]:
            assert field not in entry, f"[{vector_name}] wire entry {index} unexpectedly serialized field {field!r}"

    actual_entries = _semantic_entries(collection)
    expected_entries = expected["entries"]
    assert len(actual_entries) == len(expected_entries), f"[{vector_name}] named collection entry count changed"

    # absentEntryFields applies to every entry, not only the matching one.
    for entry in actual_entries:
        for field in expected.get("absentEntryFields", []):
            assert entry.get(field) is None, (
                f"[{vector_name}] entry {entry.get('name')!r} unexpectedly populated field {field!r}"
            )

    if expected.get("preserveOrder") is True:
        for index, expected_entry in enumerate(expected_entries):
            _assert_subset(actual_entries[index], expected_entry, f"{vector_name}.entries[{index}]")
    else:
        actual_by_name = {entry["name"]: entry for entry in actual_entries}
        for expected_entry in expected_entries:
            name = expected_entry["name"]
            assert name in actual_by_name, f"[{vector_name}] missing named entry {name!r}"
            _assert_subset(actual_by_name[name], expected_entry, f"{vector_name}.entries.{name}")


@pytest.mark.parametrize("vector", _vectors_for("load-save-reload"), ids=lambda vector: vector["name"])
def test_named_collection_roundtrip_vectors(vector: dict[str, Any]) -> None:
    """Load, save and reload a named collection without changing its canonical form."""

    name = vector["name"]
    collection_path = vector["collectionPath"]

    loaded = Prompty.load(vector["input"])
    saved = loaded.save()
    assert collection_path in saved, f"[{name}] missing collection {collection_path!r}"
    _assert_collection(name, saved[collection_path], vector["expected"])

    reloaded = Prompty.load(saved)
    resaved = reloaded.save()
    assert collection_path in resaved, f"[{name}] reload lost collection {collection_path!r}"
    _assert_collection(name, resaved[collection_path], vector["expected"])


@pytest.mark.parametrize("vector", _vectors_for("load-error"), ids=lambda vector: vector["name"])
def test_named_collection_rejection_vectors(vector: dict[str, Any]) -> None:
    """Reject malformed named-collection entry shapes rather than silently coercing them."""

    with pytest.raises(Exception):  # noqa: B017 - backends raise differing concrete types
        Prompty.load(vector["input"])
