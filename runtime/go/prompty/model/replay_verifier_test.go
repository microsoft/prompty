package prompty

import "testing"

func TestReferenceReplayVerifierPassesIdenticalRecords(t *testing.T) {
	record := ReplayJournalRecord{
		Kind:      ReplayRecordKindTurn,
		Type:      stringPtr("turn_end"),
		TurnId:    stringPtr("turn-1"),
		Iteration: int32Ptr(1),
		Status:    ptrReplayRecordStatus(ReplayRecordStatusSuccess),
	}

	result := ReferenceReplayVerifier{}.Verify(ReplayVerificationRequest{
		Expected: []ReplayJournalRecord{record},
		Actual:   []ReplayJournalRecord{record},
	})

	if result.Status != ReplayVerificationStatusPassed || len(result.Mismatches) != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ExpectedCount != 1 || result.ActualCount != 1 {
		t.Fatalf("unexpected counts: %#v", result)
	}
}

func TestReferenceReplayVerifierReportsMismatches(t *testing.T) {
	result := ReferenceReplayVerifier{}.Verify(ReplayVerificationRequest{
		Expected: []ReplayJournalRecord{{
			Kind:      ReplayRecordKindSummary,
			SessionId: stringPtr("session-1"),
			Status:    ptrReplayRecordStatus(ReplayRecordStatusSuccess),
		}},
		Actual: []ReplayJournalRecord{{
			Kind:      ReplayRecordKindSummary,
			SessionId: stringPtr("session-1"),
			Status:    ptrReplayRecordStatus(ReplayRecordStatusError),
		}},
	})

	if result.Status != ReplayVerificationStatusFailed {
		t.Fatalf("expected failure: %#v", result)
	}
	if result.Mismatches[0].Index != 0 || result.Mismatches[0].Message != "Replay record mismatch" {
		t.Fatalf("unexpected mismatch: %#v", result.Mismatches[0])
	}
}

func ptrReplayRecordStatus(value ReplayRecordStatus) *ReplayRecordStatus {
	return &value
}
