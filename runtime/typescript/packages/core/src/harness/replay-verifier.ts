// Copyright (c) Microsoft. All rights reserved.

import {
  ReplayMismatch,
  ReplayVerificationRequest,
  ReplayVerificationResult,
  type ReplayJournalRecord,
} from "../model/index.js";

export { ReplayVerificationRequest, ReplayVerificationResult };

function comparable(record: ReplayJournalRecord | undefined): string | undefined {
  return record === undefined ? undefined : JSON.stringify(record.save());
}

/** Verifies an actual normalized replay journal against expected records. */
export class ReferenceReplayVerifier {
  verify(request: ReplayVerificationRequest): ReplayVerificationResult {
    const expected = request.expected ?? [];
    const actual = request.actual ?? [];
    const max = Math.max(expected.length, actual.length);
    const mismatches: ReplayMismatch[] = [];

    for (let index = 0; index < max; index += 1) {
      const expectedRecord = expected[index];
      const actualRecord = actual[index];
      if (comparable(expectedRecord) !== comparable(actualRecord)) {
        mismatches.push(
          new ReplayMismatch({
            index,
            expected: expectedRecord,
            actual: actualRecord,
            message: expectedRecord === undefined
              ? "Unexpected extra replay record"
              : actualRecord === undefined
                ? "Missing replay record"
                : "Replay record mismatch",
          }),
        );
      }
    }

    return new ReplayVerificationResult({
      status: mismatches.length === 0 ? "passed" : "failed",
      mismatches,
      expectedCount: expected.length,
      actualCount: actual.length,
    });
  }
}
