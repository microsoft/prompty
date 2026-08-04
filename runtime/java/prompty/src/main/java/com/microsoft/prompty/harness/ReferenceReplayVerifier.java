package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.ReplayJournalRecord;
import com.microsoft.prompty.model.ReplayMismatch;
import com.microsoft.prompty.model.ReplayVerificationRequest;
import com.microsoft.prompty.model.ReplayVerificationResult;
import com.microsoft.prompty.model.ReplayVerificationStatus;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.TypraJson;
import java.util.ArrayList;
import java.util.List;

/**
 * Verifies normalized replay journal records.
 *
 * <p>Comparison is positional and reports <em>every</em> divergence rather than stopping at the
 * first. A replay that drifts usually drifts once and then stays shifted, so a report naming only
 * the first mismatch tends to describe the symptom rather than the cause; seeing the whole shape of
 * the divergence is what tells you whether a record was inserted, dropped, or merely changed.
 *
 * <p>Records are compared by their saved shape, not by identity, so a record rebuilt from a journal
 * file compares equal to the one the engine emitted.
 */
public final class ReferenceReplayVerifier {

  public ReplayVerificationResult verify(ReplayVerificationRequest request) {
    List<ReplayJournalRecord> expected = request.expected == null ? List.of() : request.expected;
    List<ReplayJournalRecord> actual = request.actual == null ? List.of() : request.actual;
    int max = Math.max(expected.size(), actual.size());

    List<ReplayMismatch> mismatches = new ArrayList<>();
    for (int index = 0; index < max; index++) {
      ReplayJournalRecord expectedRecord = index < expected.size() ? expected.get(index) : null;
      ReplayJournalRecord actualRecord = index < actual.size() ? actual.get(index) : null;
      if (comparable(expectedRecord).equals(comparable(actualRecord))) {
        continue;
      }
      ReplayMismatch mismatch = new ReplayMismatch();
      mismatch.index = index;
      mismatch.expected = expectedRecord;
      mismatch.actual = actualRecord;
      mismatch.message =
          expectedRecord == null
              ? "Unexpected extra replay record"
              : actualRecord == null ? "Missing replay record" : "Replay record mismatch";
      mismatches.add(mismatch);
    }

    ReplayVerificationResult result = new ReplayVerificationResult();
    result.status =
        mismatches.isEmpty() ? ReplayVerificationStatus.PASSED : ReplayVerificationStatus.FAILED;
    result.expectedCount = expected.size();
    result.actualCount = actual.size();
    result.mismatches = mismatches;
    return result;
  }

  private static String comparable(ReplayJournalRecord record) {
    return record == null ? "\u0000absent" : TypraJson.stringify(record.save(new SaveContext()));
  }
}
