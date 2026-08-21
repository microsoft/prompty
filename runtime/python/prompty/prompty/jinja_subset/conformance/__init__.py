"""Conformance corpus and generated goldens for the Prompty Jinja Subset.

The reference oracle (:mod:`prompty.jinja_subset`) generates ``render_golden``,
``ast_golden``, and ``segments_golden`` from ``corpus.json`` via
:mod:`prompty.jinja_subset.conformance.generate_goldens`. These are the seeds
for the future shared conformance vectors (Phase 3); they are additive and do
not participate in the emitted cross-runtime harness yet.
"""

from __future__ import annotations
