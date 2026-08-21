"""Prompty Jinja Subset — reference evaluator.

Walks the parse AST from :mod:`.parser` with an input scope and produces the
**rendered segment tree** (``spec/jinja-grammar.md`` §7): an ordered list of
provenance-tagged segments (``literal`` from the template, ``interp`` from an
input value). Concatenating segment texts yields the flat rendered string.

Implements the B2 leaf semantics of §5 (Bucket A value decisions): lowercase
booleans, empty-string for null/undefined, insertion-order dict iteration, the
six core filters plus ``replace``, and the ``loop`` object. A ``strict`` input
property whose interpolated value forges a role boundary raises loudly
(``StrictViolation``) — prevention-by-construction plus fail-closed (§8.4 of the
companion spec).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from .parser import parse_template

__all__ = [
    "render",
    "render_segments",
    "parse_template",
    "Segment",
    "StrictViolation",
    "UNDEFINED",
]


class StrictViolation(ValueError):
    """Raised when a ``strict`` input value violates a structural invariant."""


class _Undefined:
    """Sentinel for missing lookups. Falsy; stringifies to empty."""

    _instance: _Undefined | None = None

    def __new__(cls) -> _Undefined:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return "UNDEFINED"


UNDEFINED = _Undefined()

# Role-boundary pattern used for strict prompt-injection deterrence (§8.4).
_ROLE_BOUNDARY = re.compile(r"(?im)^\s*(system|user|assistant|developer)\s*:")


@dataclass
class Segment:
    """A provenance-tagged output segment (§7)."""

    kind: str  # "literal" | "interp"
    text: str
    source: str | None = None
    strict: bool = False


@dataclass
class _Frame:
    scope: dict[str, object]
    strict_props: set[str] = field(default_factory=set)


# --- value semantics (§5) ---------------------------------------------------


def _truthy(value: object) -> bool:
    if value is UNDEFINED or value is None or value is False:
        return False
    if isinstance(value, (str, bytes, list, tuple, dict, set)):
        return len(value) > 0
    if isinstance(value, (int, float)):
        return value != 0
    return True


def _stringify(value: object) -> str:
    if value is UNDEFINED or value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else f"{value:g}"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "".join(_stringify(v) for v in value)
    return str(value)


# --- expression evaluation --------------------------------------------------


def _lookup(root: str, scope: Mapping[str, object]) -> object:
    if root in scope:
        return scope[root]
    return UNDEFINED


def _access(value: object, seg: dict, scope: Mapping[str, object]) -> object:
    if value is UNDEFINED or value is None:
        return UNDEFINED
    if seg["kind"] == "attr":
        name = seg["name"]
        if isinstance(value, Mapping):
            return value[name] if name in value else UNDEFINED
        return getattr(value, name, UNDEFINED)
    # index
    index = _eval_expr(seg["expr"], scope)
    try:
        if isinstance(value, Mapping):
            return value[index] if index in value else UNDEFINED
        if isinstance(value, (list, tuple, str)):
            return value[int(index)]
    except (KeyError, IndexError, TypeError, ValueError):
        return UNDEFINED
    return UNDEFINED


def _eval_expr(expr: dict, scope: Mapping[str, object]) -> object:
    kind = expr["kind"]
    if kind == "lit":
        return expr["value"]
    if kind == "var":
        value = _lookup(expr["root"], scope)
        for seg in expr["path"]:
            value = _access(value, seg, scope)
        return value
    if kind == "filter":
        return _apply_filter(expr, scope)
    if kind == "unary":
        return not _truthy(_eval_expr(expr["operand"], scope))
    if kind == "binary":
        return _eval_binary(expr, scope)
    raise ValueError(f"Unknown expression kind: {kind!r}")


def _eval_binary(expr: dict, scope: Mapping[str, object]) -> object:
    op = expr["operator"]
    if op == "and":
        left = _eval_expr(expr["left"], scope)
        return _eval_expr(expr["right"], scope) if _truthy(left) else left
    if op == "or":
        left = _eval_expr(expr["left"], scope)
        return left if _truthy(left) else _eval_expr(expr["right"], scope)
    left = _eval_expr(expr["left"], scope)
    right = _eval_expr(expr["right"], scope)
    if op == "in":
        try:
            if isinstance(right, Mapping):
                return left in right
            if isinstance(right, (list, tuple, str)):
                return left in right
        except TypeError:
            return False
        return False
    lc = None if left is UNDEFINED else left
    rc = None if right is UNDEFINED else right
    if op == "==":
        return lc == rc
    if op == "!=":
        return lc != rc
    try:
        if op == "<":
            return lc < rc  # type: ignore[operator]
        if op == ">":
            return lc > rc  # type: ignore[operator]
        if op == "<=":
            return lc <= rc  # type: ignore[operator]
        if op == ">=":
            return lc >= rc  # type: ignore[operator]
    except TypeError:
        return False
    raise ValueError(f"Unknown binary operator: {op!r}")


def _apply_filter(expr: dict, scope: Mapping[str, object]) -> object:
    name = expr["name"]
    value = _eval_expr(expr["input"], scope)
    args = [_eval_expr(a, scope) for a in expr["args"]]
    if name == "upper":
        return _stringify(value).upper()
    if name == "lower":
        return _stringify(value).lower()
    if name == "trim":
        return _stringify(value).strip()
    if name == "join":
        sep = _stringify(args[0]) if args else ""
        seq = value if isinstance(value, (list, tuple)) else []
        return sep.join(_stringify(v) for v in seq)
    if name == "length":
        if value is UNDEFINED or value is None:
            return 0
        try:
            return len(value)  # type: ignore[arg-type]
        except TypeError:
            return 0
    if name == "default":
        fallback = args[0] if args else ""
        return fallback if (value is UNDEFINED or value is None) else value
    if name == "replace":
        if len(args) < 2:
            raise ValueError("replace filter requires (old, new) arguments")
        return _stringify(value).replace(_stringify(args[0]), _stringify(args[1]))
    raise ValueError(f"Unknown filter: {name!r}")


# --- rendering to segments --------------------------------------------------


def _iter_seq(value: object) -> Iterable[object]:
    if value is UNDEFINED or value is None:
        return []
    if isinstance(value, Mapping):
        return list(value.keys())  # insertion order (Bucket A #7)
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, str):
        return list(value)
    return []


def _interp_source(expr: dict) -> str | None:
    """Return the root property name for a bare ``{{ var }}`` interpolation."""
    if expr["kind"] == "var":
        return expr["root"]
    return None


def _render_nodes(nodes: Sequence[dict], frame: _Frame, out: list[Segment]) -> None:
    for node in nodes:
        kind = node["kind"]
        if kind == "text":
            if node["value"]:
                out.append(Segment("literal", node["value"]))
        elif kind == "interp":
            expr = node["expr"]
            value = _eval_expr(expr, frame.scope)
            text = _stringify(value)
            source = _interp_source(expr)
            is_strict = source is not None and source in frame.strict_props
            if is_strict and _ROLE_BOUNDARY.search(text):
                raise StrictViolation(
                    f"strict input {source!r} produced a forged role boundary: {text!r}"
                )
            out.append(Segment("interp", text, source=source, strict=is_strict))
        elif kind == "if":
            _render_if(node, frame, out)
        elif kind == "for":
            _render_for(node, frame, out)
        else:
            raise ValueError(f"Unknown node kind: {kind!r}")


def _render_if(node: dict, frame: _Frame, out: list[Segment]) -> None:
    for branch in node["branches"]:
        if _truthy(_eval_expr(branch["test"], frame.scope)):
            _render_nodes(branch["body"], frame, out)
            return
    if "elseBody" in node:
        _render_nodes(node["elseBody"], frame, out)


def _render_for(node: dict, frame: _Frame, out: list[Segment]) -> None:
    items = list(_iter_seq(_eval_expr(node["seq"], frame.scope)))
    total = len(items)
    loop_var = node["loopVar"]
    for idx, item in enumerate(items):
        child_scope = dict(frame.scope)
        child_scope[loop_var] = item
        child_scope["loop"] = {
            "index": idx + 1,
            "index0": idx,
            "first": idx == 0,
            "last": idx == total - 1,
            "length": total,
        }
        _render_nodes(node["body"], _Frame(child_scope, frame.strict_props), out)


def render_segments(
    template: str,
    inputs: Mapping[str, object] | None = None,
    strict_props: Iterable[str] | None = None,
) -> list[Segment]:
    """Render ``template`` into a provenance-tagged segment list (§7)."""
    frame = _Frame(dict(inputs or {}), set(strict_props or ()))
    out: list[Segment] = []
    _render_nodes(parse_template(template)["nodes"], frame, out)
    return out


def render(
    template: str,
    inputs: Mapping[str, object] | None = None,
    strict_props: Iterable[str] | None = None,
) -> str:
    """Render ``template`` to the flat string (concatenated segment texts)."""
    return "".join(seg.text for seg in render_segments(template, inputs, strict_props))
