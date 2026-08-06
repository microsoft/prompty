"""Validate the canonical closed ContentPart discriminator contract."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from prompty.model import ContentPart, TextPart

_VECTORS_PATH = (
    Path(__file__).resolve().parents[4] / "spec" / "vectors" / "model" / "content_part_discriminator_vectors.json"
)


def _load_vectors() -> list[dict[str, Any]]:
    document: dict[str, Any] = json.loads(_VECTORS_PATH.read_text(encoding="utf-8"))
    return document["vectors"]


@pytest.mark.parametrize("vector", _load_vectors(), ids=lambda vector: vector["name"])
def test_content_part_discriminator_vectors_enforce_closed_case_sensitive_kinds(vector: dict[str, Any]) -> None:
    """Load known kinds and reject unknown or case-colliding discriminator values."""

    if vector["operation"] == "load":
        loaded = ContentPart.load(vector["input"])
        assert isinstance(loaded, TextPart), vector["name"]
        assert loaded.save() == vector["expected"], vector["name"]
        return

    with pytest.raises(ValueError) as error:
        ContentPart.load(vector["input"])

    diagnostic = str(error.value)
    assert vector["expected"]["discriminator"] in diagnostic, vector["name"]
    assert vector["expected"]["value"] in diagnostic, vector["name"]
