"""Cross-runtime model-capability enrichment for provider discovery.

Provider ``/models`` endpoints vary in richness: some (Anthropic, Foundry)
return capability fields directly, while others (OpenAI) return only ids. To
keep discovery results consistent across providers *and* across runtimes,
Prompty ships a single shared, provider-keyed capability dataset
(``spec/data/model_capabilities.json``) and applies it with one rule:

    Provider-supplied fields always win. Dataset entries only fill fields
    the provider left empty (fill-only-missing). Matching is by longest
    prefix on the model id, applied only at token boundaries.

**Canonical source vs. vendored copy.** The cross-runtime source of truth is
``spec/data/model_capabilities.json``. This package vendors a byte-identical
copy at ``prompty/data/model_capabilities.json`` so the installed package has
no filesystem dependency on the repo's ``spec/`` directory (mirrors
``runtime/rust/prompty/src/discovery.rs``, which embeds the same dataset via
``include_str!``). ``tests/test_model_capabilities.py`` guards against drift
between the two copies whenever the repo layout is available.

To refresh: edit ``spec/data/model_capabilities.json``, then copy it to
``runtime/python/prompty/prompty/data/model_capabilities.json`` (the drift
guard test will fail until you do).

This dataset is intentionally **not** emitted from TypeSpec/Typra: it is
volatile provider data (context windows, modalities, new model families)
refreshed as a snapshot, whereas TypeSpec/Typra owns the structural
:class:`~prompty.model.ModelInfo` contract consumed here.

The Typra-emitted :class:`~prompty.model.ModelInfo` preserves the tri-state
required by fill-only-missing enrichment: omitted modalities remain ``None``,
explicit empty arrays remain ``[]``, and populated arrays retain their values.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

__all__ = ["ModelCapabilities", "enrich", "lookup"]

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "model_capabilities.json"


@dataclass(frozen=True)
class ModelCapabilities:
    """Fallback capability fields for a single model, as looked up from the shared dataset.

    All fields are optional; ``None`` means "the dataset does not supply this field" and the
    caller should leave whatever the provider returned.
    """

    context_window: int | None = None
    input_modalities: list[str] | None = None
    output_modalities: list[str] | None = None


@dataclass(frozen=True)
class _CapabilityEntry:
    prefix: str
    capabilities: ModelCapabilities


def _parse_modalities(value: Any) -> list[str] | None:
    """Parse a modality array, distinguishing "absent" (None) from "present but empty" ([])."""
    if not isinstance(value, list):
        return None
    return [item for item in value if isinstance(item, str)]


def _entry_from_value(value: Any) -> _CapabilityEntry | None:
    if not isinstance(value, dict):
        return None
    prefix = value.get("prefix")
    if not isinstance(prefix, str):
        return None
    context_window = value.get("contextWindow")
    return _CapabilityEntry(
        prefix=prefix,
        capabilities=ModelCapabilities(
            context_window=context_window
            if isinstance(context_window, int) and not isinstance(context_window, bool)
            else None,
            input_modalities=_parse_modalities(value.get("inputModalities")),
            output_modalities=_parse_modalities(value.get("outputModalities")),
        ),
    )


class _CapabilityTable:
    """Provider-keyed capability lookup, parsed once from the vendored dataset."""

    def __init__(self, providers: dict[str, list[_CapabilityEntry]]) -> None:
        self._providers = providers

    @staticmethod
    def from_value(value: Any) -> _CapabilityTable:
        providers: dict[str, list[_CapabilityEntry]] = {}
        raw_providers = value.get("providers") if isinstance(value, dict) else None
        if isinstance(raw_providers, dict):
            for provider, entries in raw_providers.items():
                if not isinstance(entries, list):
                    continue
                parsed = [e for e in (_entry_from_value(item) for item in entries) if e is not None]
                # Longest prefix first, so the first match is the most specific.
                parsed.sort(key=lambda e: len(e.prefix), reverse=True)
                providers[provider] = parsed
        return _CapabilityTable(providers)

    def lookup(self, provider: str, model_id: str) -> ModelCapabilities | None:
        for entry in self._providers.get(provider, []):
            if _prefix_matches(model_id, entry.prefix):
                return entry.capabilities
        return None


def _prefix_matches(model_id: str, prefix: str) -> bool:
    """Whether `model_id` is matched by dataset `prefix` under the cross-runtime rule.

    A prefix matches only at a token boundary: `model_id` must either equal `prefix`
    exactly, or the character immediately following the prefix must be a separator
    (any non-ASCII-alphanumeric character, e.g. ``-``, ``.``, ``:``). This keeps real
    ids matching (``gpt-4`` -> ``gpt-4-0613``, ``gpt-4o`` -> ``gpt-4o-2024-05-13``)
    while rejecting accidental substring hits (``gpt-4`` must NOT match a future
    ``gpt-45``). Every runtime MUST implement this same boundary rule so the shared
    enrichment vectors converge.
    """
    if not model_id.startswith(prefix):
        return False
    rest = model_id[len(prefix) :]
    if not rest:
        return True
    ch = rest[0]
    return not (ch.isascii() and ch.isalnum())


@lru_cache(maxsize=1)
def _table() -> _CapabilityTable:
    with open(_DATA_PATH, encoding="utf-8") as f:
        value = json.load(f)
    return _CapabilityTable.from_value(value)


def lookup(provider: str, model_id: str) -> ModelCapabilities | None:
    """Look up fallback capabilities for a model id within a provider's dataset.

    Returns ``None`` when the provider has no entry matching ``model_id``. Matching is by
    longest prefix, applied only at token boundaries (see :func:`_prefix_matches`).
    """
    return _table().lookup(provider, model_id)


def enrich(provider: str, info: Any) -> None:
    """Enrich a :class:`~prompty.model.ModelInfo` in place using the shared capability dataset.

    Applies the cross-runtime fill-only-missing rule: a dataset field is written only when the
    corresponding ``ModelInfo`` field is still empty (``context_window`` is ``None``; a modality
    list is ``None``). Provider-supplied values are never overwritten. A dataset modality of
    ``[]`` (e.g. embeddings) is a valid fill and will replace a ``None`` list.

    Callers MUST have constructed ``info`` with explicit ``None`` for
    ``input_modalities``/``output_modalities`` when the provider did not supply them — see the
    module docstring for why the generated ``ModelInfo`` default cannot be relied on for this.
    """
    caps = lookup(provider, info.id)
    if caps is None:
        return

    if info.context_window is None and caps.context_window is not None:
        info.context_window = caps.context_window
    if info.input_modalities is None and caps.input_modalities is not None:
        info.input_modalities = caps.input_modalities
    if info.output_modalities is None and caps.output_modalities is not None:
        info.output_modalities = caps.output_modalities
