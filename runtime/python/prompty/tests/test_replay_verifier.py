from __future__ import annotations

from prompty import ReferenceReplayVerifier
from prompty.model import ReplayJournalRecord, ReplayVerificationRequest


def test_replay_verifier_passes_identical_records() -> None:
    record = ReplayJournalRecord(
        kind="turn",
        type="turn_end",
        turn_id="turn-1",
        iteration=1,
        status="success",
    )

    result = ReferenceReplayVerifier().verify(ReplayVerificationRequest(expected=[record], actual=[record]))

    assert result.status == "passed"
    assert result.mismatches == []
    assert result.expected_count == 1
    assert result.actual_count == 1


def test_replay_verifier_reports_mismatches_with_generated_types() -> None:
    result = ReferenceReplayVerifier().verify(
        ReplayVerificationRequest(
            expected=[ReplayJournalRecord(kind="summary", session_id="session-1", status="success")],
            actual=[ReplayJournalRecord(kind="summary", session_id="session-1", status="error")],
        )
    )

    assert result.status == "failed"
    assert result.mismatches[0].index == 0
    assert result.mismatches[0].message == "Replay record mismatch"
