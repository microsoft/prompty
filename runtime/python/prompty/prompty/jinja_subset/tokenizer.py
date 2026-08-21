"""Prompty Jinja Subset — reference tokenizer.

Scans a raw template string into a flat token stream of literal text and tag
regions (``{{ }}`` expressions, ``{% %}`` statements, ``{# #}`` comments),
applying the ``{%- … -%}`` / ``{{- … -}}`` whitespace-trim markers.

This is the Phase 2 Python **reference** implementation for the Prompty Jinja
Subset (``spec/jinja-grammar.md`` §2). It is additive and intentionally NOT
registered as a renderer entry point; it exists as the conformance oracle.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["Token", "tokenize", "TemplateSyntaxError"]


class TemplateSyntaxError(ValueError):
    """Raised when the template cannot be tokenized or parsed."""


@dataclass
class Token:
    """A single lexical token.

    ``type`` is one of ``"text"``, ``"expr"``, ``"stmt"``. Comment tokens are
    dropped during tokenization (after their trim markers are applied to
    neighbours). ``value`` is the raw text for ``"text"`` tokens or the inner
    (delimiter- and trim-marker-stripped) source for tag tokens.
    """

    type: str
    value: str
    trim_left: bool = False
    trim_right: bool = False


_OPENERS = {"{{": ("expr", "}}"), "{%": ("stmt", "%}"), "{#": ("comment", "#}")}


def tokenize(template: str) -> list[Token]:
    """Tokenize ``template`` into text/expr/stmt tokens with trims applied."""
    raw: list[Token] = []
    i = 0
    n = len(template)
    text_start = 0

    while i < n:
        two = template[i : i + 2]
        if two in _OPENERS:
            # Flush any pending literal text.
            if i > text_start:
                raw.append(Token("text", template[text_start:i]))
            kind, close = _OPENERS[two]
            close_idx = template.find(close, i + 2)
            if close_idx == -1:
                raise TemplateSyntaxError(f"Unclosed '{two}' tag at offset {i}")
            inner = template[i + 2 : close_idx]
            trim_left = inner.startswith("-")
            trim_right = inner.endswith("-")
            if trim_left:
                inner = inner[1:]
            if trim_right:
                inner = inner[:-1]
            if kind != "comment":
                raw.append(Token(kind, inner.strip(), trim_left, trim_right))
            else:
                # Comment produces no node but still carries trim semantics.
                raw.append(Token("comment", "", trim_left, trim_right))
            i = close_idx + len(close)
            text_start = i
        else:
            i += 1

    if text_start < n:
        raw.append(Token("text", template[text_start:]))

    _apply_trims(raw)
    return [t for t in raw if t.type != "comment"]


def _apply_trims(tokens: list[Token]) -> None:
    """Apply ``-`` trim markers in place, stripping neighbouring whitespace."""
    for idx, tok in enumerate(tokens):
        if tok.type == "text":
            continue
        if tok.trim_left and idx > 0 and tokens[idx - 1].type == "text":
            tokens[idx - 1].value = tokens[idx - 1].value.rstrip()
        if tok.trim_right and idx + 1 < len(tokens) and tokens[idx + 1].type == "text":
            tokens[idx + 1].value = tokens[idx + 1].value.lstrip()
