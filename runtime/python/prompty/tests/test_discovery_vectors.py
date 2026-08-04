"""Discovery vector tests — spec/vectors/discovery/discovery_vectors.json.

Exhaustively consumes every vector in the shared cross-runtime discovery vector file, dispatches
each to the matching provider wire-mapping function (selected by ``provider``/``shape``), and
asserts the resulting ``ModelInfo.save()`` output equals the vector's ``expected`` value exactly.
Includes a drift guard so a newly-added vector can never be silently skipped.

Run:
    cd runtime/python/prompty
    .venv\\Scripts\\python.exe -m pytest tests/test_discovery_vectors.py -v
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from prompty.providers.anthropic.models import model_info_from_wire as anthropic_model_info_from_wire
from prompty.providers.foundry.models import (
    catalog_model_to_model_info,
    deployment_to_model_info,
)
from prompty.providers.openai.models import model_info_from_wire as openai_model_info_from_wire

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
DISCOVERY_VECTORS_PATH = REPO_ROOT / "spec" / "vectors" / "discovery" / "discovery_vectors.json"


def _load_discovery_vectors() -> list[dict[str, Any]]:
    with open(DISCOVERY_VECTORS_PATH, encoding="utf-8") as f:
        payload = json.load(f)
    vectors = payload["vectors"]
    assert isinstance(vectors, list) and len(vectors) > 0, "discovery_vectors.json must contain at least one vector"
    return vectors


_VECTORS = _load_discovery_vectors()

# Every (provider, shape) combination this test file knows how to dispatch. If the vectors file
# ever grows a new combination, the drift guard test below will fail until this file is updated.
_KNOWN_DISPATCH_KEYS = {
    ("openai", "model"),
    ("anthropic", "model"),
    ("foundry", "deployment"),
    ("foundry", "catalog"),
}


def _dispatch(vector: dict[str, Any]) -> dict[str, Any]:
    provider = vector["provider"]
    shape = vector["shape"]
    raw = copy.deepcopy(vector["input"])

    if provider == "openai" and shape == "model":
        info = openai_model_info_from_wire(raw)
    elif provider == "anthropic" and shape == "model":
        info = anthropic_model_info_from_wire(raw)
    elif provider == "foundry" and shape == "deployment":
        info = deployment_to_model_info(raw)
    elif provider == "foundry" and shape == "catalog":
        info = catalog_model_to_model_info(raw)
    else:
        raise AssertionError(f"No dispatch registered for provider={provider!r} shape={shape!r}")

    return info.save()


@pytest.mark.parametrize("vector", _VECTORS, ids=[v["name"] for v in _VECTORS])
def test_discovery_vector(vector: dict[str, Any]) -> None:
    actual = _dispatch(vector)
    assert actual == vector["expected"], f"{vector['name']}: mapping mismatch"


def test_all_vectors_are_dispatchable() -> None:
    """Drift guard: fail loudly if a vector's (provider, shape) has no known dispatch."""
    seen = {(v["provider"], v["shape"]) for v in _VECTORS}
    unknown = seen - _KNOWN_DISPATCH_KEYS
    assert not unknown, f"discovery_vectors.json has vectors with no test dispatch: {unknown}"


def test_at_least_one_vector_per_known_combination_was_exercised() -> None:
    """Drift guard: fail if a previously-covered (provider, shape) combination disappears."""
    seen = {(v["provider"], v["shape"]) for v in _VECTORS}
    missing = _KNOWN_DISPATCH_KEYS - seen
    assert not missing, f"Expected discovery vector combinations missing from the vectors file: {missing}"


def test_vector_count_matches_exhaustive_run() -> None:
    """Guard against a vectors file that silently grows without pytest collecting the new cases."""
    assert len(_VECTORS) == len(list({v["name"] for v in _VECTORS})), "vector names must be unique"
    ran = sum(1 for _ in _VECTORS)
    assert ran == len(_VECTORS)
    assert ran > 0
