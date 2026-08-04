"""Validate the canonical atomic Property scalar coercion contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from prompty.model import Property

_VECTORS_PATH = (
    Path(__file__).resolve().parents[4] / "spec" / "vectors" / "model" / "property_scalar_coercion_vectors.json"
)


def test_all_primitive_property_scalars_coerce_atomically() -> None:
    """Infer and preserve every primitive scalar coercion branch."""

    document: dict[str, Any] = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))
    vector = document["vectors"][0]
    assert vector["name"] == "all_primitive_property_scalars_coerce_atomically"
    assert vector["operation"] == "load"
    assert [case["name"] for case in vector["cases"]] == ["string", "integer", "float", "boolean"]

    for case in vector["cases"]:
        loaded = Property.load(case["input"])
        assert loaded.kind == case["expected"]["kind"], case["name"]
        assert type(loaded.example) is type(case["expected"]["example"]), case["name"]
        assert loaded.example == case["expected"]["example"], case["name"]
