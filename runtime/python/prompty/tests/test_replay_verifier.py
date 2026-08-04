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


def test_replay_verifier_reports_missing_trailing_records() -> None:
    expected = [
        ReplayJournalRecord(kind="turn", type="turn_start", turn_id="turn-1", iteration=0),
        ReplayJournalRecord(kind="turn", type="turn_end", turn_id="turn-1", iteration=1, status="success"),
    ]

    result = ReferenceReplayVerifier().verify(ReplayVerificationRequest(expected=expected, actual=expected[:1]))

    assert result.status == "failed"
    assert result.expected_count == 2
    assert result.actual_count == 1
    assert result.mismatches[0].index == 1
    assert result.mismatches[0].expected == expected[1]
    assert result.mismatches[0].actual is None
    assert result.mismatches[0].message == "Missing replay record"


def test_replay_verifier_reports_unexpected_trailing_records() -> None:
    actual = [
        ReplayJournalRecord(kind="turn", type="turn_start", turn_id="turn-1", iteration=0),
        ReplayJournalRecord(kind="turn", type="turn_end", turn_id="turn-1", iteration=1, status="success"),
    ]

    result = ReferenceReplayVerifier().verify(ReplayVerificationRequest(expected=actual[:1], actual=actual))

    assert result.status == "failed"
    assert result.mismatches[0].index == 1
    assert result.mismatches[0].expected is None
    assert result.mismatches[0].actual == actual[1]
    assert result.mismatches[0].message == "Unexpected extra replay record"


def test_replay_verifier_reports_every_mismatch_in_order() -> None:
    result = ReferenceReplayVerifier().verify(
        ReplayVerificationRequest(
            expected=[
                ReplayJournalRecord(kind="turn", type="turn_start", turn_id="turn-1", iteration=0),
                ReplayJournalRecord(kind="summary", session_id="session-1", status="success"),
            ],
            actual=[
                ReplayJournalRecord(kind="turn", type="turn_end", turn_id="turn-1", iteration=1),
                ReplayJournalRecord(kind="summary", session_id="session-1", status="error"),
            ],
        )
    )

    assert [mismatch.index for mismatch in result.mismatches] == [0, 1]
    assert all(mismatch.message == "Replay record mismatch" for mismatch in result.mismatches)
