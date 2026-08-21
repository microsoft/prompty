"""Prompty Jinja Subset — Python reference implementation (Phase 2).

This subpackage is the conformance **oracle** for the Prompty Jinja Subset
(``spec/jinja-subset.md`` + ``spec/jinja-grammar.md``): a small, owned
tokenizer → recursive-descent parser → evaluator with deliberately portable
"B2" leaf semantics. Every shared render/AST/security golden is generated from
this reference.

It is **additive and inert**: it is NOT registered as a ``prompty.renderers``
entry point and does NOT replace the default ``jinja2`` renderer or the current
flat-string render→parse contract. Wiring it into the pipeline (and porting it
to the other runtimes) is Phase 3+.

Public surface:

- :func:`parse_template` — template string → parse AST dict.
- :func:`render` — template + inputs → flat rendered string.
- :func:`render_segments` — template + inputs → provenance-tagged segments.
- :class:`Segment`, :class:`StrictViolation`, :data:`UNDEFINED`.
"""

from __future__ import annotations

from .evaluator import (
    UNDEFINED,
    Segment,
    StrictViolation,
    render,
    render_segments,
)
from .parser import parse_template
from .tokenizer import TemplateSyntaxError, Token, tokenize

__all__ = [
    "parse_template",
    "render",
    "render_segments",
    "tokenize",
    "Token",
    "Segment",
    "StrictViolation",
    "TemplateSyntaxError",
    "UNDEFINED",
]
