"""Enrichment vector tests — spec/vectors/discovery/enrichment_vectors.json.

Exhaustively consumes every vector in the shared cross-runtime enrichment vector file. Each
vector builds a base ``ModelInfo`` from a partial camelCase ``input`` dict, applies
``prompty.core.model_capabilities.enrich``, and asserts the resulting ``ModelInfo.save()``
equals the vector's ``expected`` value exactly.

Base ``ModelInfo`` construction uses the emitted loader so the vectors exercise its native
absent-vs-empty modality tri-state before enrichment.

Run:
    cd runtime/python/prompty
    uv run pytest tests/test_enrichment_vectors.py -v
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from prompty.core.model_capabilities import enrich
from prompty.model import ModelInfo

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
ENRICHMENT_VECTORS_PATH = REPO_ROOT / "spec" / "vectors" / "discovery" / "enrichment_vectors.json"


def _load_enrichment_vectors() -> list[dict[str, Any]]:
    with open(ENRICHMENT_VECTORS_PATH, encoding="utf-8") as f:
        payload = json.load(f)
    vectors = payload["vectors"]
    assert isinstance(vectors, list) and len(vectors) > 0, "enrichment_vectors.json must contain at least one vector"
    return vectors


_VECTORS = _load_enrichment_vectors()


def _build_base_model_info(data: dict[str, Any]) -> ModelInfo:
    """Build a ModelInfo through the emitted loader."""
    return ModelInfo.load(data)


@pytest.mark.parametrize("vector", _VECTORS, ids=[v["name"] for v in _VECTORS])
def test_enrichment_vector(vector: dict[str, Any]) -> None:
    info = _build_base_model_info(vector["input"])
    enrich(vector["provider"], info)
    assert info.save() == vector["expected"], f"{vector['name']}: enrichment mismatch"


def test_vector_count_is_exhaustive() -> None:
    """Drift guard: fail loudly if the vectors file grows without this suite noticing."""
    names = {v["name"] for v in _VECTORS}
    assert len(names) == len(_VECTORS), "vector names must be unique"
    assert len(_VECTORS) > 0


def test_all_vector_providers_are_known() -> None:
    """Drift guard: fail if a vector references a provider this harness has never validated."""
    known_providers = {"openai", "anthropic", "foundry"}
    seen = {v["provider"] for v in _VECTORS}
    unknown = seen - known_providers
    assert not unknown, f"enrichment_vectors.json references unexpected providers: {unknown}"
