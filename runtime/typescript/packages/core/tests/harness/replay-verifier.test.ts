import {
  ReferenceReplayVerifier,
} from "../../src/index";
import {
  ReplayJournalRecord,
  ReplayVerificationRequest,
} from "../../src/model/index";

describe("ReferenceReplayVerifier", () => {
  it("passes identical normalized replay records", () => {
    const record = new ReplayJournalRecord({
      kind: "turn",
      type: "turn_end",
      turnId: "turn-1",
      iteration: 1,
      status: "success",
    });

    const result = new ReferenceReplayVerifier().verify(
      new ReplayVerificationRequest({ expected: [record], actual: [record] }),
    );

    expect(result.status).toBe("passed");
    expect(result.mismatches).toEqual([]);
    expect(result.expectedCount).toBe(1);
    expect(result.actualCount).toBe(1);
  });

  it("reports mismatches with generated contract types", () => {
    const result = new ReferenceReplayVerifier().verify(
      new ReplayVerificationRequest({
        expected: [new ReplayJournalRecord({ kind: "summary", sessionId: "session-1", status: "success" })],
        actual: [new ReplayJournalRecord({ kind: "summary", sessionId: "session-1", status: "error" })],
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.mismatches?.[0]).toMatchObject({
      index: 0,
      message: "Replay record mismatch",
    });
  });
});
