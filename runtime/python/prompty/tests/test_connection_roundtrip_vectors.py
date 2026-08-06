"""Validate the canonical forward-compatible Connection roundtrip contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from prompty.model import Connection, ReferenceConnection

_VECTORS_PATH = Path(__file__).resolve().parents[4] / "spec" / "vectors" / "model" / "connection_roundtrip_vectors.json"


def _load_vectors() -> list[dict[str, Any]]:
    document: dict[str, Any] = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))
    return document["vectors"]


@pytest.mark.parametrize("vector", _load_vectors(), ids=lambda vector: vector["name"])
def test_connection_roundtrip_vectors_preserve_exact_discriminator_and_payload(vector: dict[str, Any]) -> None:
    """Preserve known and unknown Connection values through load, save, and reload."""

    assert vector["operation"] == "load-save-reload"
    expected = vector["expected"]

    loaded = Connection.load(vector["input"])
    if expected["kind"] == "reference":
        assert isinstance(loaded, ReferenceConnection), vector["name"]
    else:
        assert not isinstance(loaded, ReferenceConnection), vector["name"]

    saved = loaded.save()
    assert saved["kind"] == expected["kind"], vector["name"]
    assert saved == expected, vector["name"]

    reloaded = Connection.load(saved)
    resaved = reloaded.save()
    assert resaved["kind"] == expected["kind"], vector["name"]
    assert resaved == expected, vector["name"]
