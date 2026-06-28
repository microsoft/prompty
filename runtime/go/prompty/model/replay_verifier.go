package prompty

import (
	"encoding/json"
	"fmt"
)

// ReferenceReplayVerifier compares normalized replay journal records.
type ReferenceReplayVerifier struct{}

// Verify returns a generated replay verification result.
func (ReferenceReplayVerifier) Verify(request ReplayVerificationRequest) ReplayVerificationResult {
	expected := request.Expected
	actual := request.Actual
	max := len(expected)
	if len(actual) > max {
		max = len(actual)
	}
	mismatches := []ReplayMismatch{}

	for index := 0; index < max; index++ {
		var expectedRecord *ReplayJournalRecord
		var actualRecord *ReplayJournalRecord
		if index < len(expected) {
			expectedRecord = &expected[index]
		}
		if index < len(actual) {
			actualRecord = &actual[index]
		}
		if comparableReplayRecord(expectedRecord) != comparableReplayRecord(actualRecord) {
			message := "Replay record mismatch"
			if expectedRecord == nil {
				message = "Unexpected extra replay record"
			} else if actualRecord == nil {
				message = "Missing replay record"
			}
			mismatches = append(mismatches, ReplayMismatch{
				Index:    int32(index),
				Expected: expectedRecord,
				Actual:   actualRecord,
				Message:  message,
			})
		}
	}

	status := ReplayVerificationStatusPassed
	if len(mismatches) > 0 {
		status = ReplayVerificationStatusFailed
	}
	return ReplayVerificationResult{
		Status:        status,
		Mismatches:    mismatches,
		ExpectedCount: int32(len(expected)),
		ActualCount:   int32(len(actual)),
	}
}

func comparableReplayRecord(record *ReplayJournalRecord) string {
	if record == nil {
		return "<nil>"
	}
	bytes, err := json.Marshal(record.Save(NewSaveContext()))
	if err != nil {
		return fmt.Sprintf("<error:%v>", err)
	}
	return string(bytes)
}
