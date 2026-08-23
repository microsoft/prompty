"""Streaming-failure reconciliation over classified provider stream chunks.

Canonical, provider-agnostic reconciliation of a ``StreamChunk`` sequence into
the streaming-failure contract asserted by the ``Processor.processStream``
vectors: the preserved partial text, whether the stream requires reconciliation
(an indeterminate terminal failure), and whether a completion was committed.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from ..model import FailureChunk, StreamChunk, TextChunk

__all__ = ["StreamReconciliation", "reconcile_stream"]


@dataclass
class StreamReconciliation:
    """Outcome of reconciling a classified stream-chunk sequence."""

    partial_text: str
    requires_reconciliation: bool
    completion_committed: bool

    def save(self) -> dict[str, Any]:
        """Serialize to the canonical processStream wire shape."""
        return {
            "partialText": self.partial_text,
            "requiresReconciliation": self.requires_reconciliation,
            "completionCommitted": self.completion_committed,
        }


def reconcile_stream(chunks: Iterable[StreamChunk]) -> StreamReconciliation:
    """Reconcile classified stream chunks into a :class:`StreamReconciliation`.

    Partial text is the concatenation of every text chunk emitted before a
    terminal failure. A stream requires reconciliation when any terminal failure
    is indeterminate (the provider outcome is unknown). A completion is committed
    only when the stream terminates with no failure at all.
    """
    materialized = list(chunks)
    partial_text = "".join(chunk.value for chunk in materialized if isinstance(chunk, TextChunk))
    failures = [chunk for chunk in materialized if isinstance(chunk, FailureChunk)]
    requires_reconciliation = any(failure.failure.outcome == "indeterminate" for failure in failures)
    completion_committed = len(failures) == 0
    return StreamReconciliation(
        partial_text=partial_text,
        requires_reconciliation=requires_reconciliation,
        completion_committed=completion_committed,
    )
