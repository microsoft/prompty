"""Shared, cross-provider model-discovery algorithms.

This module owns the two behaviors validated by the ``DiscoveryConformance``
vectors — identically across every Prompty runtime:

* :func:`map_model` — map a raw provider model / deployment / catalog payload
  into a canonical :class:`~prompty.model.ModelInfo`.
* :func:`enrich` — fill *only* the missing capability fields of a sparse
  ``ModelInfo`` from the shared, embedded capability dataset
  (``model_capabilities.json``), using longest-prefix, token-boundary matching.

The dataset is deliberately NOT emitted from TypeSpec: it is volatile provider
data (context windows, modalities, new model families) refreshed as a snapshot.
Every runtime embeds a copy of the same file and applies the same rule:
provider-supplied fields always win; dataset entries fill only-missing fields.
"""

from __future__ import annotations

import json
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..model import ModelInfo

__all__ = ["map_model", "enrich", "match_capabilities"]

_DATASET_PATH = Path(__file__).parent / "model_capabilities.json"

# Capability fields that :func:`enrich` fills from the dataset. These are the
# only fields the dataset carries; ``id`` / ``displayName`` / ``ownedBy`` are
# always provider-supplied.
_CAPABILITY_FIELDS = ("context_window", "input_modalities", "output_modalities")

# Mapping from ModelInfo attribute name -> dataset (camelCase) key.
_DATASET_KEYS = {
    "context_window": "contextWindow",
    "input_modalities": "inputModalities",
    "output_modalities": "outputModalities",
}


@lru_cache(maxsize=1)
def _dataset() -> dict[str, Any]:
    """Load and cache the embedded capability dataset."""
    with _DATASET_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def _is_token_boundary(model_id: str, prefix: str) -> bool:
    """Return True if ``prefix`` ends at a token boundary within ``model_id``.

    A prefix matches only when it is either the whole id or is immediately
    followed by a non-alphanumeric separator (``-``, ``:``, ``.``, ``/`` ...).
    This prevents ``gpt-4`` from matching ``gpt-45-future`` while still
    matching ``gpt-4o-mini-2024-07-18`` against ``gpt-4o-mini``.
    """
    if model_id == prefix:
        return True
    if not model_id.startswith(prefix):
        return False
    return not model_id[len(prefix)].isalnum()


def match_capabilities(model_id: str, provider: str) -> dict[str, Any] | None:
    """Return the longest-prefix dataset entry for ``model_id`` under ``provider``.

    Returns ``None`` when the provider has no dataset entries or no prefix
    matches at a token boundary.
    """
    entries = _dataset().get("providers", {}).get(provider)
    if not entries:
        return None
    best: dict[str, Any] | None = None
    best_len = -1
    for entry in entries:
        prefix = entry.get("prefix", "")
        if _is_token_boundary(model_id, prefix) and len(prefix) > best_len:
            best = entry
            best_len = len(prefix)
    return best


def enrich(base: ModelInfo, provider: str) -> ModelInfo:
    """Fill only-missing ``ModelInfo`` capability fields from the dataset.

    Provider-supplied values always win: a field is filled only when it is
    ``None`` on ``base``. A present-but-empty list (e.g. ``[]`` for an
    embedding model's output modalities) is an intentional provider signal and
    is preserved. Mutates and returns ``base``.
    """
    entry = match_capabilities(base.id, provider)
    if entry is None:
        return base
    for attr in _CAPABILITY_FIELDS:
        if getattr(base, attr) is None:
            key = _DATASET_KEYS[attr]
            if key in entry:
                # Copy so a downstream mutation of the ModelInfo cannot corrupt
                # the lru_cached dataset (lists are shared references otherwise).
                setattr(base, attr, deepcopy(entry[key]))
    return base


def _as_dict(raw: Any) -> dict[str, Any]:
    """Coerce a raw provider payload (dict or SDK object) into a plain dict."""
    if isinstance(raw, dict):
        return raw
    for method in ("model_dump", "to_dict", "dict"):
        fn = getattr(raw, method, None)
        if callable(fn):
            try:
                result = fn()
            except TypeError:
                continue
            if isinstance(result, dict):
                return result
    data = getattr(raw, "__dict__", None)
    if isinstance(data, dict):
        return dict(data)
    return {}


def map_model(raw: Any, provider: str) -> ModelInfo:
    """Map a raw provider payload to a canonical :class:`ModelInfo`.

    Dispatches on ``provider`` to handle each provider's payload shape. The
    entire raw payload is echoed verbatim into ``additional_properties`` so no
    provider-specific field is lost. Absent fields remain ``None`` (and are
    therefore omitted by ``ModelInfo.save()``).
    """
    data = _as_dict(raw)
    info = ModelInfo()
    info.additional_properties = data

    if provider == "anthropic":
        info.id = data.get("id")
        info.display_name = data.get("display_name")
        info.owned_by = "anthropic"
        info.context_window = data.get("context_length")
        info.input_modalities = data.get("input_modalities")
        info.output_modalities = data.get("output_modalities")
    elif provider == "foundry":
        if "properties" in data:  # nested ARM deployment
            props = data.get("properties") or {}
            model = props.get("model") or {}
            caps = props.get("capabilities") or {}
            info.id = data.get("name")
            info.display_name = model.get("name")
            info.owned_by = model.get("publisher")
            info.context_window = model.get("maxContextLength")
            info.input_modalities = caps.get("supportedInputModalities")
            info.output_modalities = caps.get("supportedOutputModalities")
        elif "modelName" in data or data.get("type") == "ModelDeployment":  # flat deployment
            info.id = data.get("name")
            info.display_name = data.get("modelName")
            info.owned_by = data.get("modelPublisher")
            info.context_window = data.get("maxContextLength")
        else:  # catalog model
            info.id = data.get("id")
            info.owned_by = data.get("owned_by")
            info.context_window = data.get("maxContextLength")
    else:  # openai (default)
        info.id = data.get("id")
        info.owned_by = data.get("owned_by")

    if info.id is None:
        info.id = ""
    return info
