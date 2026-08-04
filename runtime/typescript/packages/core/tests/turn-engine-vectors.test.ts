import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Message } from "../src/model/conversation/message.js";
import { DelegatedStateReference } from "../src/model/pipeline/delegated-state-reference.js";
import { ModelToolResult } from "../src/model/pipeline/model-tool-result.js";
import { ContextPipeline } from "../src/core/turn-engine-context.js";
import { TurnCancellationToken } from "../src/core/turn-engine-cancellation.js";
import { TurnEngine, TurnEngineRequest } from "../src/core/turn-engine.js";
import {
  DeterministicClock,
  DeterministicIds,
  RecordingDurabilityPort,
  ScriptedModelPort,
  ScriptedToolPort,
  SelectivePermissionPort,
  response,
} from "./turn-engine-harness.js";

interface VectorMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface VectorModelStep {
  output?: unknown;
  assistant?: string;
  tools?: { id: string; name: string; arguments?: unknown }[];
  nextPortability?: "portable" | "delegated" | "opaque";
  delegatedState?: {
    provider: string;
    kind: string;
    id: string;
  }[];
}

interface TurnVector {
  name: string;
  cancelBeforeRun?: boolean;
  messages: VectorMessage[];
  model: VectorModelStep[];
  toolOutputs?: Record<string, unknown>;
  denyTools?: string[];
  expected: {
    status: "success" | "failed" | "cancelled" | "reconciliation_required";
    output?: unknown;
    iterations: number;
    snapshots: number;
    snapshotStablePrefixes?: number[];
    snapshotPortability?: string[];
    toolResults: number;
    toolResultOrder?: string[];
    commitPortability?: string;
    delegatedState?: number;
    eventKinds?: string[];
  };
}

const vectorPath = join(
  resolve(import.meta.dirname, "../../../../../spec"),
  "vectors",
  "engine",
  "turn_vectors.json",
);
const vectors = (
  JSON.parse(readFileSync(vectorPath, "utf8")) as {
    cases: TurnVector[];
  }
).cases;

describe("canonical turn-engine shared vectors", () => {
  it.each(vectors)("$name", async (vector) => {
    const model = new ScriptedModelPort(
      vector.model.map((step) =>
        response({
          output: step.output,
          assistant: step.assistant,
          tools: step.tools,
          portability: step.nextPortability,
          delegatedState: step.delegatedState?.map(
            (reference) => new DelegatedStateReference(reference),
          ),
        }),
      ),
    );
    const tool = new ScriptedToolPort(async (request) => {
      return new ModelToolResult({
        requestId: request.id,
        name: request.name,
        outcome: "success",
        output: vector.toolOutputs?.[request.id],
      });
    });
    const durability = new RecordingDurabilityPort();
    const engine = new TurnEngine(new ContextPipeline(), {
      model,
      tools: tool,
      permission: new SelectivePermissionPort(
        new Set(vector.denyTools ?? []),
      ),
      durability,
      clock: new DeterministicClock(),
      ids: new DeterministicIds(),
    });
    const cancellation = new TurnCancellationToken();
    if (vector.cancelBeforeRun) {
      cancellation.cancel();
    }

    const result = await engine.run(
      new TurnEngineRequest({
        sessionId: "session-vector",
        turnId: vector.name,
        messages: vector.messages.map(toMessage),
      }),
      cancellation,
    );

    expect(result.commit.status).toBe(vector.expected.status);
    if ("output" in vector.expected) {
      expect(result.commit.output).toEqual(vector.expected.output);
    }
    expect(result.commit.iterations).toBe(vector.expected.iterations);
    expect(result.snapshots).toHaveLength(vector.expected.snapshots);
    expect(result.toolResults).toHaveLength(vector.expected.toolResults);
    if (vector.expected.snapshotStablePrefixes) {
      expect(
        result.snapshots?.map((snapshot) => snapshot.stablePrefixMessages),
      ).toEqual(vector.expected.snapshotStablePrefixes);
    }
    if (vector.expected.snapshotPortability) {
      expect(
        result.snapshots?.map(
          (snapshot) => snapshot.contextState.portability,
        ),
      ).toEqual(vector.expected.snapshotPortability);
    }
    if (vector.expected.toolResultOrder) {
      expect(result.toolResults?.map((item) => item.requestId)).toEqual(
        vector.expected.toolResultOrder,
      );
    }
    if (vector.expected.commitPortability) {
      expect(result.commit.contextState.portability).toBe(
        vector.expected.commitPortability,
      );
    }
    if (vector.expected.delegatedState !== undefined) {
      expect(result.commit.contextState.delegatedState).toHaveLength(
        vector.expected.delegatedState,
      );
    }
    if (vector.expected.eventKinds) {
      expect(durability.events.map((event) => event.kind)).toEqual(
        vector.expected.eventKinds,
      );
    }
    if ((vector.denyTools ?? []).length > 0) {
      expect(durability.events.map((event) => event.kind)).toContain(
        "tool_result_committed",
      );
      expect(durability.events.map((event) => event.kind)).not.toContain(
        "tool_execution_completed",
      );
    }
    expect(durability.events.map((event) => event.sequence)).toEqual(
      durability.events.map((_, index) => index + 1),
    );
  });

  it("journals denied tools as committed results without execution events", async () => {
    const durability = new RecordingDurabilityPort();
    const tools = new ScriptedToolPort(async () => {
      throw new Error("denied tools must not execute");
    });
    const engine = new TurnEngine(new ContextPipeline(), {
      model: new ScriptedModelPort([
        response({
          tools: [{ id: "call-denied", name: "protected", arguments: {} }],
        }),
        response({ output: "Permission was denied" }),
      ]),
      tools,
      permission: new SelectivePermissionPort(new Set(["protected"])),
      durability,
      clock: new DeterministicClock(),
      ids: new DeterministicIds(),
    });

    const result = await engine.run(
      new TurnEngineRequest({
        sessionId: "session-denied",
        turnId: "turn-denied",
        messages: [Message.user("Read the protected resource")],
      }),
    );

    expect(tools.requests).toHaveLength(0);
    expect(result.toolResults).toEqual([
      expect.objectContaining({
        requestId: "call-denied",
        outcome: "failed",
        errorKind: "permission_denied",
      }),
    ]);
    const eventKinds = durability.events.map((event) => event.kind);
    expect(
      eventKinds.filter((kind) => kind === "tool_result_committed"),
    ).toHaveLength(1);
    expect(eventKinds).not.toContain("tool_execution_started");
    expect(eventKinds).not.toContain("tool_execution_completed");
  });
});

function toMessage(message: VectorMessage): Message {
  switch (message.role) {
    case "system":
      return Message.system(message.content);
    case "assistant":
      return Message.assistant(message.content);
    case "user":
      return Message.user(message.content);
  }
}
