"""Structured result casting — §8.8 of the Prompty spec.

Provides ``StructuredResult`` (a dict subclass carrying raw JSON) and
``cast()`` for deserializing directly to typed objects without an
intermediate dict round-trip.
"""

from __future__ import annotations

import dataclasses
import json
from typing import Any, TypeVar

T = TypeVar("T")


class StructuredResult(dict):
    """Dict subclass carrying raw JSON for optimal casting.

    Behaves exactly like a dict but also stores the original JSON string
    so that :func:`cast` can deserialize directly to typed objects without
    a dict→JSON→T round-trip.
    """

    __slots__ = ("_raw_json",)

    def __init__(self, data: dict[str, Any], raw_json: str) -> None:
        super().__init__(data)
        self._raw_json = raw_json

    def __repr__(self) -> str:
        return f"StructuredResult({dict.__repr__(self)})"


def cast(result: Any, target_type: type[T]) -> T:
    """Deserialize a result directly to a typed object.

    Optimal path: when *result* is a :class:`StructuredResult`, deserializes
    from the raw JSON string — no intermediate dict round-trip.

    Supports:

    - ``dataclasses.dataclass``
    - ``TypedDict`` (treated as dict, validated by the type checker)
    - Pydantic ``BaseModel`` (if installed) — uses ``model_validate_json()``
    - Plain types (``int``, ``str``, ``float``, ``bool``, ``list``, ``dict``)
    """
    # 1. Get the raw JSON string
    if isinstance(result, StructuredResult):
        raw_json = result._raw_json
    elif isinstance(result, str):
        raw_json = result
    else:
        raw_json = json.dumps(result)

    # 2. Pydantic model — optimal path via model_validate_json
    if hasattr(target_type, "model_validate_json"):
        return target_type.model_validate_json(raw_json)  # type: ignore[return-value]

    # 3. Dataclass — parse JSON then construct
    if dataclasses.is_dataclass(target_type) and isinstance(target_type, type):
        data = json.loads(raw_json)
        if isinstance(data, dict):
            return target_type(**data)  # type: ignore[return-value]
        raise TypeError(f"Cannot cast {type(data).__name__} to dataclass {target_type.__name__}")

    # 4. Plain types (dict, list, int, str, float, bool)
    data = json.loads(raw_json)
    if target_type is dict or (hasattr(target_type, "__origin__") and target_type.__origin__ is dict):  # type: ignore[union-attr]
        if isinstance(data, dict):
            return data  # type: ignore[return-value]
    if target_type is list or (hasattr(target_type, "__origin__") and target_type.__origin__ is list):  # type: ignore[union-attr]
        if isinstance(data, list):
            return data  # type: ignore[return-value]
    if isinstance(data, target_type):  # type: ignore[arg-type]
        return data  # type: ignore[return-value]

    raise TypeError(f"Cannot cast JSON to {target_type}: got {type(data).__name__}")
