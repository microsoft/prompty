"""Verify normalized replay journals against generated harness contracts."""

from __future__ import annotations

from ..model import (
    ReplayJournalRecord,
    ReplayMismatch,
    ReplayVerificationRequest,
    ReplayVerificationResult,
)


def _comparable(record: ReplayJournalRecord | None) -> dict | None:
    return None if record is None else record.save()


class ReferenceReplayVerifier:
    """Compare expected and actual normalized replay journal records."""

    def verify(self, request: ReplayVerificationRequest) -> ReplayVerificationResult:
        """Return generated replay verification result data."""
        expected = request.expected or []
        actual = request.actual or []
        mismatches: list[ReplayMismatch] = []

        for index in range(max(len(expected), len(actual))):
            expected_record = expected[index] if index < len(expected) else None
            actual_record = actual[index] if index < len(actual) else None
            if _comparable(expected_record) != _comparable(actual_record):
                if expected_record is None:
                    message = "Unexpected extra replay record"
                elif actual_record is None:
                    message = "Missing replay record"
                else:
                    message = "Replay record mismatch"
                mismatches.append(
                    ReplayMismatch(
                        index=index,
                        expected=expected_record,
                        actual=actual_record,
                        message=message,
                    )
                )

        return ReplayVerificationResult(
            status="passed" if not mismatches else "failed",
            mismatches=mismatches,
            expected_count=len(expected),
            actual_count=len(actual),
        )
