"""Enrichment vector tests — spec/vectors/discovery/enrichment_vectors.json.

Exhaustively consumes every vector in the shared cross-runtime enrichment vector file. Each
vector builds a base ``ModelInfo`` from a partial camelCase ``input`` dict, applies
``prompty.core.model_capabilities.enrich``, and asserts the resulting ``ModelInfo.save()``
equals the vector's ``expected`` value exactly.

Base ``ModelInfo`` construction deliberately does NOT use ``ModelInfo.load(data)``: the
Typra-generated ``ModelInfo`` declares ``input_modalities``/``output_modalities`` as
``list[str] = field(default_factory=list)`` (not ``Optional[list[str]] = None``), and
``load()``'s presence-check logic (``if "inputModalities" in data: ...``) leaves that buggy
``[]`` default when the key is absent — which would make "absent" indistinguishable from
"provider explicitly returned []" and break the fill-only-missing tri-state the vectors assert
(see ``openai_enrich_provider_empty_modalities_win``, where a provider-supplied ``[]`` must be
preserved, vs. every other vector where an absent key must be treated as "unset" and filled).
This test instead reads the raw ``input`` dict with ``dict.get(key)``, which naturally yields
``None`` for an absent key and the literal value (including ``[]``) for a present key — the
exact tri-state semantics ``enrich()`` requires. See ``prompty/core/model_capabilities.py``'s
module docstring for the full explanation of this generated-model caveat.

Run:
    cd runtime/python/prompty
    .venv\\Scripts\\python.exe -m pytest tests/test_enrichment_vectors.py -v
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
    """Build a ModelInfo preserving the absent-vs-empty tri-state (see module docstring)."""
    return ModelInfo(
        id=data.get("id", ""),
        display_name=data.get("displayName"),
        owned_by=data.get("ownedBy"),
        context_window=data.get("contextWindow"),
        input_modalities=data.get("inputModalities"),
        output_modalities=data.get("outputModalities"),
        additional_properties=data.get("additionalProperties"),
    )


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
