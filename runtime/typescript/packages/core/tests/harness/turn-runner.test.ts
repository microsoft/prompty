import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AllowAllPermissionResolver,
  CollectingEventSink,
  DenyAllPermissionResolver,
  FunctionHostToolExecutor,
  HostToolRequest,
  InMemoryCheckpointStore,
  JsonlEventJournalWriter,
  ReferenceTurnRunner,
  type HostToolExecutor,
} from "../../src/index";
import { TurnOptions } from "../../src/model/index";

function fixedIds(): (prefix: string) => string {
  let index = 0;
  return (prefix: string) => `${prefix}-${++index}`;
}

function journalRecords(path: string): unknown[] {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

type ReplayVector = {
  version: number;
  clock: string;
  sessionId: string;
  turnId: string;
  scenarios: Array<{
    name: string;
    inputs?: Record<string, unknown>;
    maxIterations?: number;
    expected: string[];
  }>;
};

function replayVectors(): ReplayVector {
  const vectors = JSON.parse(
    readFileSync(new URL("../../../../../../spec/vectors/harness/replay_vectors.json", import.meta.url), "utf8"),
  );
  if (vectors.version !== 1) {
    throw new Error(`Unsupported replay vector version ${vectors.version}`);
  }
  return vectors;
}

function normalizeJournal(records: unknown[]): string[] {
  return records.map((record: any) => {
    if (record.kind === "summary") {
      const summary = record.summary;
      return `summary:${summary.sessionId}:${summary.status}:turns=${summary.turns}:checkpoints=${summary.checkpoints}`;
    }

    const event = record.event;
    if (record.kind === "session") {
      if (event.type === "session_end") {
        return `session:${event.type}:${event.sessionId}:${event.turnId}:${event.payload.status}`;
      }
      return `session:${event.type}:${event.sessionId}:${event.turnId}`;
    }

    const payload = event.payload ?? {};
    switch (event.type) {
      case "permission_requested":
        return `turn:${event.type}:${event.iteration}:${payload.requestId}`;
      case "permission_completed":
        return `turn:${event.type}:${event.iteration}:${payload.approved}`;
      case "tool_execution_start":
        return `turn:${event.type}:${event.iteration}:${payload.toolName}`;
      case "tool_execution_complete":
      case "tool_result":
        return [
          `turn:${event.type}:${event.iteration}:${payload.toolName}:${payload.success}`,
          payload.errorKind,
        ].filter(Boolean).join(":");
      case "error":
        return `turn:${event.type}:${event.iteration}:${payload.errorKind}`;
      case "turn_end":
        return `turn:${event.type}:${event.iteration}:${payload.status}`;
      default:
        return `turn:${event.type}:${event.iteration}`;
    }
  });
}

function modelForScenario(name: string): (request: any) => unknown {
  return (request) => {
    if (name === "no_tool") {
      return {
        output: { text: `hello ${request.inputs.name}` },
        checkpointState: { stable: true },
      };
    }
    if (request.iteration === 0) {
      const toolName = name === "tool_failure" ? "fail" : "add";
      return {
        toolRequests: [
          new HostToolRequest({
            requestId: "exec-1",
            toolCallId: "call-1",
            toolName,
            arguments: { a: 2, b: 3 },
          }),
        ],
      };
    }
    return { output: { toolResult: request.toolResults[0]?.result, errorKind: request.toolResults[0]?.errorKind } };
  };
}

describe("ReferenceTurnRunner", () => {
  it("emits, journals, and checkpoints a deterministic single turn in order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prompty-turn-"));
    try {
      const journalPath = join(dir, "trace.jsonl");
      const sink = new CollectingEventSink();
      const checkpointStore = new InMemoryCheckpointStore();
      const runner = new ReferenceTurnRunner({
        eventSink: sink,
        journal: new JsonlEventJournalWriter(journalPath),
        checkpointStore,
        permissionResolver: new AllowAllPermissionResolver(),
        hostToolExecutor: new FunctionHostToolExecutor({}),
        invokeModel: (request) =>
          ({
            output: { text: `hello ${request.inputs.name}` },
            checkpointState: { stable: true },
          }),
        now: () => "2026-06-28T00:00:00Z",
        nextId: fixedIds(),
      });

      const result = await runner.run({
        sessionId: "session-1",
        turnId: "turn-1",
        inputs: { name: "Ada" },
        options: new TurnOptions({ maxIterations: 3 }),
      });

      expect(result).toMatchObject({
        sessionId: "session-1",
        turnId: "turn-1",
        status: "success",
        iterations: 1,
        output: { text: "hello Ada" },
      });
      expect(sink.sessionEvents.map((event) => event.type)).toEqual([
        "session_start",
        "checkpoint_created",
        "session_end",
      ]);
      expect(sink.turnEvents.map((event) => event.type)).toEqual([
        "turn_start",
        "llm_start",
        "llm_complete",
        "turn_end",
      ]);
      await expect(checkpointStore.load("session-1", "turn-1-checkpoint-0")).resolves.toMatchObject({
        state: { stable: true, output: { text: "hello Ada" } },
      });
      expect(journalRecords(journalPath).map((record: any) => record.kind)).toEqual([
        "session",
        "turn",
        "turn",
        "turn",
        "session",
        "turn",
        "session",
        "summary",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requests permission and executes host tools before the final model response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prompty-turn-tool-"));
    try {
      const sink = new CollectingEventSink();
      const runner = new ReferenceTurnRunner({
        eventSink: sink,
        journal: new JsonlEventJournalWriter(join(dir, "trace.jsonl")),
        checkpointStore: new InMemoryCheckpointStore(),
        permissionResolver: new AllowAllPermissionResolver(),
        hostToolExecutor: new FunctionHostToolExecutor({
          add: (args) => Number(args.a) + Number(args.b),
        }),
        invokeModel: (request) => {
          if (request.iteration === 0) {
            return {
              toolRequests: [
                new HostToolRequest({
                  requestId: "exec-1",
                  toolCallId: "call-1",
                  toolName: "add",
                  arguments: { a: 2, b: 3 },
                }),
              ],
            };
          }
          return { output: { toolResult: request.toolResults[0]?.result } };
        },
        now: () => "2026-06-28T00:00:00Z",
        nextId: fixedIds(),
      });

      const result = await runner.run({ sessionId: "session-1", turnId: "turn-1" });

      expect(result.output).toEqual({ toolResult: 5 });
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0]).toMatchObject({ success: true, result: 5 });
      expect(sink.turnEvents.map((event) => event.type)).toEqual([
        "turn_start",
        "llm_start",
        "llm_complete",
        "permission_requested",
        "permission_completed",
        "tool_execution_start",
        "tool_execution_complete",
        "tool_result",
        "messages_updated",
        "llm_start",
        "llm_complete",
        "turn_end",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records denied permission without executing the host tool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prompty-turn-deny-"));
    try {
      const sink = new CollectingEventSink();
      const executor: HostToolExecutor = {
        execute: async () => {
          throw new Error("should not execute");
        },
      };
      const runner = new ReferenceTurnRunner({
        eventSink: sink,
        journal: new JsonlEventJournalWriter(join(dir, "trace.jsonl")),
        checkpointStore: new InMemoryCheckpointStore(),
        permissionResolver: new DenyAllPermissionResolver(),
        hostToolExecutor: executor,
        invokeModel: (request) =>
          request.iteration === 0
            ? {
                toolRequests: [new HostToolRequest({ requestId: "exec-1", toolName: "shell" })],
              }
            : { output: { denied: request.toolResults[0]?.errorKind } },
        now: () => "2026-06-28T00:00:00Z",
        nextId: fixedIds(),
      });

      const result = await runner.run({ sessionId: "session-1", turnId: "turn-1" });

      expect(result.output).toEqual({ denied: "permission_denied" });
      expect(result.toolResults[0]).toMatchObject({ success: false, errorKind: "permission_denied" });
      expect(sink.turnEvents.map((event) => event.type)).not.toContain("tool_execution_start");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces host tool failure as replayable tool results", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prompty-turn-fail-"));
    try {
      const runner = new ReferenceTurnRunner({
        eventSink: new CollectingEventSink(),
        journal: new JsonlEventJournalWriter(join(dir, "trace.jsonl")),
        checkpointStore: new InMemoryCheckpointStore(),
        permissionResolver: new AllowAllPermissionResolver(),
        hostToolExecutor: new FunctionHostToolExecutor({
          fail: () => {
            throw new Error("boom");
          },
        }),
        invokeModel: (request) =>
          request.iteration === 0
            ? {
                toolRequests: [new HostToolRequest({ requestId: "exec-1", toolName: "fail" })],
              }
            : { output: request.toolResults[0]?.save() },
        now: () => "2026-06-28T00:00:00Z",
        nextId: fixedIds(),
      });

      const result = await runner.run({ sessionId: "session-1", turnId: "turn-1" });

      expect(result.output).toMatchObject({ success: false, errorKind: "exception", result: { message: "boom" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("produces deterministic journal records when clock and ids are injected", async () => {
    async function runOnce(path: string): Promise<unknown[]> {
      const runner = new ReferenceTurnRunner({
        eventSink: new CollectingEventSink(),
        journal: new JsonlEventJournalWriter(path),
        checkpointStore: new InMemoryCheckpointStore(),
        permissionResolver: new AllowAllPermissionResolver(),
        hostToolExecutor: new FunctionHostToolExecutor({}),
        invokeModel: () => ({ output: "done" }),
        now: () => "2026-06-28T00:00:00Z",
        nextId: fixedIds(),
      });
      await runner.run({ sessionId: "session-1", turnId: "turn-1" });
      return journalRecords(path);
    }

    const dir = mkdtempSync(join(tmpdir(), "prompty-turn-deterministic-"));
    try {
      await expect(runOnce(join(dir, "first.jsonl"))).resolves.toEqual(await runOnce(join(dir, "second.jsonl")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches shared golden replay journal vectors", async () => {
    const vectors = replayVectors();

    for (const scenario of vectors.scenarios) {
      const dir = mkdtempSync(join(tmpdir(), `prompty-replay-${scenario.name}-`));
      try {
        const runner = new ReferenceTurnRunner({
          eventSink: new CollectingEventSink(),
          journal: new JsonlEventJournalWriter(join(dir, "trace.jsonl")),
          checkpointStore: new InMemoryCheckpointStore(),
          permissionResolver:
            scenario.name === "permission_denied"
              ? new DenyAllPermissionResolver()
              : new AllowAllPermissionResolver(),
          hostToolExecutor: new FunctionHostToolExecutor({
            add: (args) => Number(args.a) + Number(args.b),
            fail: () => {
              throw new Error("boom");
            },
          }),
          invokeModel: modelForScenario(scenario.name),
          now: () => vectors.clock,
          nextId: fixedIds(),
        });

        await runner.run({
          sessionId: vectors.sessionId,
          turnId: vectors.turnId,
          inputs: scenario.inputs,
          options: new TurnOptions({ maxIterations: scenario.maxIterations }),
        });

        expect(normalizeJournal(journalRecords(join(dir, "trace.jsonl"))), scenario.name).toEqual(scenario.expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
