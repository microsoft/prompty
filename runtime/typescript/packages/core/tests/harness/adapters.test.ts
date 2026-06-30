import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AllowAllPermissionResolver,
  Checkpoint,
  CollectingEventSink,
  DenyAllPermissionResolver,
  FunctionHostToolExecutor,
  HostToolRequest,
  InMemoryCheckpointStore,
  JsonlEventJournalWriter,
  PermissionRequest,
  SessionEvent,
  SessionSummary,
  TurnEvent,
} from "../../src/index";

function turnEvent(): TurnEvent {
  return new TurnEvent({
    id: "turn-event",
    type: "turn_start",
    timestamp: "2026-06-10T00:00:00Z",
    payload: { phase: "start" },
  });
}

function sessionEvent(): SessionEvent {
  return new SessionEvent({
    id: "session-event",
    type: "session_start",
    timestamp: "2026-06-10T00:00:00Z",
    sessionId: "session-1",
    payload: { phase: "start" },
  });
}

describe("harness reference adapters", () => {
  it("collects emitted events in order", () => {
    const sink = new CollectingEventSink();

    expect(sink.emitTurn(turnEvent())).toBe(true);
    expect(sink.emitSession(sessionEvent())).toBe(true);

    expect(sink.turnEvents.map((event) => event.id)).toEqual(["turn-event"]);
    expect(sink.sessionEvents.map((event) => event.id)).toEqual(["session-event"]);
  });

  it("writes JSONL event journal records", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompty-trace-"));
    try {
      const path = join(dir, "trace.jsonl");
      const writer = new JsonlEventJournalWriter(path);

      writer.appendTurn(turnEvent());
      writer.appendSession(sessionEvent());
      writer.close(new SessionSummary({ sessionId: "session-1", turns: 1 }));

      const lines = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(lines.map((line) => line.kind)).toEqual(["turn", "session", "summary"]);
      expect(lines[0].event.id).toBe("turn-event");
      expect(lines[1].event.id).toBe("session-event");
      expect(lines[2].summary.sessionId).toBe("session-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when writing after trace close", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompty-trace-"));
    try {
      const writer = new JsonlEventJournalWriter(join(dir, "trace.jsonl"));

      expect(writer.close(null)).toBe(true);
      expect(writer.appendTurn(turnEvent())).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores checkpoints by session and checkpoint id", async () => {
    const store = new InMemoryCheckpointStore();
    const checkpoint = new Checkpoint({ id: "checkpoint-1", sessionId: "session-1", title: "First" });

    await expect(store.save(checkpoint)).resolves.toBe(checkpoint);
    await expect(store.load("session-1", "checkpoint-1")).resolves.toBe(checkpoint);
    await expect(store.load("session-1", "missing")).resolves.toBeNull();
    await expect(store.listCheckpoints("session-1")).resolves.toEqual([checkpoint]);
  });

  it("requires checkpoint identifiers when saving", async () => {
    const store = new InMemoryCheckpointStore();

    await expect(store.save(new Checkpoint({ id: "checkpoint-1", title: "Missing session" }))).rejects.toThrow(
      "sessionId",
    );
    await expect(store.save(new Checkpoint({ sessionId: "session-1", title: "Missing id" }))).rejects.toThrow("id");
  });

  it("resolves allow-all and deny-all permissions", async () => {
    const request = new PermissionRequest({
      requestId: "permission-1",
      toolCallId: "tool-call-1",
      permission: "tool.execute",
    });

    await expect(new AllowAllPermissionResolver().request(request)).resolves.toMatchObject({
      requestId: "permission-1",
      toolCallId: "tool-call-1",
      permission: "tool.execute",
      approved: true,
      reason: "allow_all",
    });
    await expect(new DenyAllPermissionResolver().request(request)).resolves.toMatchObject({
      approved: false,
      reason: "deny_all",
    });
  });

  it("executes registered host tool functions", async () => {
    const executor = new FunctionHostToolExecutor({
      add: (args) => Number(args.a) + Number(args.b),
    });

    await expect(
      executor.execute(new HostToolRequest({ requestId: "exec-1", toolName: "add", arguments: { a: 2, b: 3 } })),
    ).resolves.toMatchObject({
      requestId: "exec-1",
      toolName: "add",
      success: true,
      result: 5,
    });
  });

  it("passes empty arguments to host tool functions when omitted", async () => {
    const executor = new FunctionHostToolExecutor({
      count: (args) => Object.keys(args).length,
    });

    await expect(executor.execute(new HostToolRequest({ toolName: "count" }))).resolves.toMatchObject({
      success: true,
      result: 0,
    });
  });

  it("returns failed host tool results for missing or throwing handlers", async () => {
    const executor = new FunctionHostToolExecutor({
      fail: () => {
        throw new Error("boom");
      },
    });

    await expect(executor.execute(new HostToolRequest({ toolName: "missing" }))).resolves.toMatchObject({
      success: false,
      errorKind: "not_found",
    });
    await expect(executor.execute(new HostToolRequest({ toolName: "fail" }))).resolves.toMatchObject({
      success: false,
      errorKind: "exception",
      result: { message: "boom" },
    });
  });
});
