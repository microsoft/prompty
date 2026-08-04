"""Unit tests for prompty.core.model_capabilities — the shared enrichment primitive.

Covers longest-prefix matching, token-boundary rules, and the fill-only-missing contract in
isolation from any provider wire mapping (see ``test_discovery_vectors.py`` /
``test_enrichment_vectors.py`` for the vector-driven cross-runtime parity tests). Also guards
against drift between the vendored copy of the dataset and its canonical spec source.
"""

from __future__ import annotations

import json
from pathlib import Path

from prompty.core.model_capabilities import ModelCapabilities, enrich, lookup
from prompty.model import ModelInfo

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
SPEC_DATASET = REPO_ROOT / "spec" / "data" / "model_capabilities.json"
VENDORED_DATASET = Path(__file__).resolve().parent.parent / "prompty" / "data" / "model_capabilities.json"


# ---------------------------------------------------------------------------
# Drift guard
# ---------------------------------------------------------------------------


class TestVendoredDatasetMatchesSpec:
    """The vendored copy under prompty/data/ must never drift from spec/data/."""

    def test_vendored_copy_is_byte_identical_to_spec(self) -> None:
        assert SPEC_DATASET.exists(), f"canonical spec dataset not found at {SPEC_DATASET}"
        assert VENDORED_DATASET.exists(), f"vendored dataset not found at {VENDORED_DATASET}"
        spec_bytes = SPEC_DATASET.read_bytes()
        vendored_bytes = VENDORED_DATASET.read_bytes()
        assert vendored_bytes == spec_bytes, (
            f"{VENDORED_DATASET} has drifted from {SPEC_DATASET}. "
            "Refresh the vendored copy: Copy-Item spec/data/model_capabilities.json "
            "runtime/python/prompty/prompty/data/model_capabilities.json"
        )

    def test_vendored_copy_matches_spec_as_json_value(self) -> None:
        # Belt-and-suspenders structural check independent of exact byte encoding.
        with open(SPEC_DATASET, encoding="utf-8") as f:
            spec_value = json.load(f)
        with open(VENDORED_DATASET, encoding="utf-8") as f:
            vendored_value = json.load(f)
        assert vendored_value == spec_value


# ---------------------------------------------------------------------------
# lookup()
# ---------------------------------------------------------------------------


class TestLookup:
    def test_exact_prefix_match(self) -> None:
        caps = lookup("openai", "gpt-4o")
        assert caps == ModelCapabilities(
            context_window=128_000, input_modalities=["text", "image"], output_modalities=["text"]
        )

    def test_longest_prefix_wins_over_shorter_prefix(self) -> None:
        # "gpt-4o-mini" and "gpt-4o" both match "gpt-4o-mini-2024-07-18"; the more specific
        # (longer) prefix's capabilities must be returned.
        caps = lookup("openai", "gpt-4o-mini-2024-07-18")
        assert caps is not None
        assert caps.context_window == 128_000
        assert caps.input_modalities == ["text", "image"]
        assert caps.output_modalities == ["text"]

    def test_gpt4_prefix_matches_dated_snapshot(self) -> None:
        caps = lookup("openai", "gpt-4-0613")
        assert caps is not None
        assert caps.context_window == 8192

    def test_token_boundary_rejects_accidental_substring(self) -> None:
        # "gpt-4" must NOT match a hypothetical future "gpt-45" model.
        assert lookup("openai", "gpt-45-future") is None

    def test_token_boundary_allows_dot_separator(self) -> None:
        caps = lookup("openai", "gpt-3.5-turbo-0125")
        assert caps is not None
        assert caps.context_window == 16385

    def test_unknown_model_id_returns_none(self) -> None:
        assert lookup("openai", "ft:custom-model:acme::xyz") is None

    def test_unknown_provider_returns_none(self) -> None:
        assert lookup("does-not-exist", "gpt-4o") is None

    def test_foundry_has_no_dataset_entries(self) -> None:
        # spec/data/model_capabilities.json currently only has an "openai" provider key.
        assert lookup("foundry", "gpt-4o") is None

    def test_anthropic_has_no_dataset_entries(self) -> None:
        assert lookup("anthropic", "claude-sonnet-4-20250514") is None

    def test_embedding_model_has_empty_output_modalities(self) -> None:
        caps = lookup("openai", "text-embedding-3-small")
        assert caps is not None
        assert caps.output_modalities == []

    def test_image_model_has_no_context_window(self) -> None:
        caps = lookup("openai", "dall-e-3")
        assert caps is not None
        assert caps.context_window is None
        assert caps.output_modalities == ["image"]


# ---------------------------------------------------------------------------
# enrich()
# ---------------------------------------------------------------------------


class TestEnrich:
    def test_fills_all_missing_fields(self) -> None:
        info = ModelInfo(id="gpt-4o", input_modalities=None, output_modalities=None)
        enrich("openai", info)
        assert info.context_window == 128_000
        assert info.input_modalities == ["text", "image"]
        assert info.output_modalities == ["text"]

    def test_does_not_overwrite_provider_context_window(self) -> None:
        info = ModelInfo(id="gpt-4o", context_window=999, input_modalities=None, output_modalities=None)
        enrich("openai", info)
        assert info.context_window == 999
        assert info.input_modalities == ["text", "image"]

    def test_provider_supplied_empty_list_wins_over_dataset(self) -> None:
        info = ModelInfo(id="gpt-4o", input_modalities=[], output_modalities=None)
        enrich("openai", info)
        assert info.input_modalities == []
        assert info.output_modalities == ["text"]

    def test_unknown_id_is_noop(self) -> None:
        info = ModelInfo(id="ft:custom-model:acme::xyz", input_modalities=None, output_modalities=None)
        enrich("openai", info)
        assert info.context_window is None
        assert info.input_modalities is None
        assert info.output_modalities is None

    def test_prefix_requires_token_boundary(self) -> None:
        info = ModelInfo(id="gpt-45-future", input_modalities=None, output_modalities=None)
        enrich("openai", info)
        assert info.context_window is None

    def test_dataset_empty_modality_fills_none(self) -> None:
        # A dataset-declared [] (embeddings' outputModalities) is a valid fill for a missing
        # (None) field, distinct from a provider explicitly supplying [].
        info = ModelInfo(id="text-embedding-3-small", input_modalities=None, output_modalities=None)
        enrich("openai", info)
        assert info.output_modalities == []

    def test_anthropic_enrich_is_noop_without_dataset_entry(self) -> None:
        info = ModelInfo(
            id="claude-sonnet-4-20250514",
            context_window=200_000,
            input_modalities=["text", "image"],
            output_modalities=["text"],
        )
        enrich("anthropic", info)
        assert info.context_window == 200_000
        assert info.input_modalities == ["text", "image"]
        assert info.output_modalities == ["text"]
