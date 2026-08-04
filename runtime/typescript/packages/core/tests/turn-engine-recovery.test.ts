import { describe, expect, it } from "vitest";

import { Message } from "../src/model/conversation/message.js";
import { ModelInvocationResponse } from "../src/model/pipeline/model-invocation-response.js";
import { ModelToolResult } from "../src/model/pipeline/model-tool-result.js";
import { ResumeContext } from "../src/model/pipeline/resume-context.js";
import { ContextPipeline } from "../src/core/turn-engine-context.js";
import { TurnCancellationToken } from "../src/core/turn-engine-cancellation.js";
import {
  TurnEngine,
  TurnEngineRecoveryRequiredError,
  TurnEngineRequest,
} from "../src/core/turn-engine.js";
import { TurnPortError } from "../src/core/turn-engine-ports.js";
import {
  DeterministicClock,
  DeterministicIds,
  RecordingDurabilityPort,
  ScriptedModelPort,
  ScriptedToolPort,
  response,
} from "./turn-engine-harness.js";

function makeEngine(options: {
  model: ScriptedModelPort;
  tools?: ScriptedToolPort;
  durability?: RecordingDurabilityPort;
}): {
  engine: TurnEngine;
  durability: RecordingDurabilityPort;
} {
  const durability = options.durability ?? new RecordingDurabilityPort();
  return {
    engine: new TurnEngine(new ContextPipeline(), {
      model: options.model,
      tools: options.tools,
      durability,
      clock: new DeterministicClock(),
      ids: new DeterministicIds(),
    }),
    durability,
  };
}

function request(options: Partial<ConstructorParameters<typeof TurnEngineRequest>[0]> = {}): TurnEngineRequest {
  return new TurnEngineRequest({
    sessionId: "session-recovery",
    turnId: "turn-recovery",
    messages: [Message.user("run")],
    ...options,
  });
}

describe("turn-engine durability and resume", () => {
  it("persists each checkpoint event atomically with its represented state", async () => {
    const model = new ScriptedModelPort([
      response({
        tools: [
          { id: "call-a", name: "echo" },
          { id: "call-b", name: "echo" },
        ],
      }),
      response({ output: "done" }),
    ]);
    const tools = new ScriptedToolPort(
      async (toolRequest) =>
        new ModelToolResult({
          requestId: toolRequest.id,
          name: toolRequest.name,
          output: toolRequest.id,
        }),
    );
    const { engine, durability } = makeEngine({ model, tools });

    await engine.run(request());

    expect(durability.attemptedAtomicWrites.length).toBeGreaterThan(0);
    for (const write of durability.attemptedAtomicWrites) {
      expect(write.events.at(-1)?.kind).toBe("checkpoint_created");
      expect(write.events.at(-1)?.sequence).toBe(
        write.checkpoint.lastSequence + 1,
      );
      expect(write.checkpoint.stablePrefixMessages).toBe(1);
    }
  });

  it("resumes a completed model response without invoking the model again and uses the journal tail", async () => {
    const firstDurability = new RecordingDurabilityPort();
    firstDurability.failAtomicAt = 1;
    const firstModel = new ScriptedModelPort([response({ output: "saved" })]);
    const { engine: firstEngine } = makeEngine({
      model: firstModel,
      durability: firstDurability,
    });

    const error = await firstEngine.run(request()).catch((caught) => caught);
    expect(error).toBeInstanceOf(TurnEngineRecoveryRequiredError);
    const recovery = error as TurnEngineRecoveryRequiredError;
    expect(recovery.stage).toBe("model response");
    expect(recovery.checkpoint.finalOutputReady).toBe(true);
    expect(firstModel.requests).toHaveLength(1);

    const resumedModel = new ScriptedModelPort([]);
    const resumedDurability = new RecordingDurabilityPort();
    const { engine: resumedEngine } = makeEngine({
      model: resumedModel,
      durability: resumedDurability,
    });
    const result = await resumedEngine.resume(
      new ResumeContext({
        checkpoint: recovery.checkpoint,
        maxIterations: 10,
        maxModelAttempts: 3,
        lastJournalSequence: 40,
      }),
    );

    expect(result.commit.status).toBe("success");
    expect(result.commit.output).toBe("saved");
    expect(resumedModel.requests).toHaveLength(0);
    expect(resumedDurability.events[0].sequence).toBe(41);
  });

  it("resumes a partially committed tool batch at the next uncommitted effect", async () => {
    const firstDurability = new RecordingDurabilityPort();
    firstDurability.failAtomicAt = 2;
    const model = new ScriptedModelPort([
      response({
        tools: [
          { id: "call-a", name: "echo" },
          { id: "call-b", name: "echo" },
        ],
      }),
      response({ output: "done" }),
    ]);
    const executed: string[] = [];
    const tools = new ScriptedToolPort(async (toolRequest) => {
      executed.push(toolRequest.id);
      return new ModelToolResult({
        requestId: toolRequest.id,
        name: toolRequest.name,
        output: toolRequest.id,
      });
    });
    const { engine } = makeEngine({
      model,
      tools,
      durability: firstDurability,
    });

    const error = await engine.run(request()).catch((caught) => caught);
    expect(error).toBeInstanceOf(TurnEngineRecoveryRequiredError);
    const recovery = error as TurnEngineRecoveryRequiredError;
    expect(recovery.checkpoint.pendingToolRequests?.map((item) => item.id)).toEqual([
      "call-b",
    ]);
    expect(recovery.checkpoint.completedToolResults?.map((item) => item.requestId)).toEqual([
      "call-a",
    ]);

    const resumedDurability = new RecordingDurabilityPort();
    const { engine: resumedEngine } = makeEngine({
      model,
      tools,
      durability: resumedDurability,
    });
    const result = await resumedEngine.resume(
      new ResumeContext({
        checkpoint: recovery.checkpoint,
        maxIterations: 10,
        maxModelAttempts: 3,
        lastJournalSequence: 75,
      }),
    );

    expect(result.commit.status).toBe("success");
    expect(executed).toEqual(["call-a", "call-b"]);
    expect(model.requests).toHaveLength(2);
    expect(resumedDurability.events[0].sequence).toBe(76);
    expect(result.snapshots?.[0].stablePrefixMessages).toBe(1);
  });
});

describe("turn-engine reconciliation", () => {
  it("does not retry an indeterminate model and resumes from an explicit resolution", async () => {
    const model = new ScriptedModelPort([
      TurnPortError.indeterminate("provider outcome unknown", {
        responseId: "resp-1",
      }),
    ]);
    const { engine, durability } = makeEngine({ model });

    const blocked = await engine.run(request({ maxModelAttempts: 5 }));
    expect(blocked.commit.status).toBe("reconciliation_required");
    expect(model.requests).toHaveLength(1);
    const checkpoint = durability.checkpoints.find(
      (candidate) => candidate.modelReconciliation !== undefined,
    );
    expect(checkpoint?.reconciliationRequired).toBe(true);
    expect(checkpoint?.modelReconciliation?.failedAttempt).toBe(0);

    const resumedModel = new ScriptedModelPort([]);
    const resumedDurability = new RecordingDurabilityPort();
    const { engine: resumedEngine } = makeEngine({
      model: resumedModel,
      durability: resumedDurability,
    });
    const result = await resumedEngine.resumeAfterModelReconciliation(
      new ResumeContext({
        checkpoint: checkpoint!,
        maxIterations: 10,
        maxModelAttempts: 5,
        lastJournalSequence: blocked.commit.lastSequence,
      }),
      new ModelInvocationResponse({ output: "reconciled" }),
    );

    expect(result.commit.status).toBe("success");
    expect(result.commit.output).toBe("reconciled");
    expect(resumedModel.requests).toHaveLength(0);
    expect(resumedDurability.events.map((event) => event.kind)).toContain(
      "model_invocation_reconciled",
    );
  });

  it("does not repeat an indeterminate tool after host reconciliation", async () => {
    const model = new ScriptedModelPort([
      response({
        tools: [{ id: "call-unknown", name: "write" }],
      }),
      response({ output: "continued" }),
    ]);
    const tools = new ScriptedToolPort(async () => {
      throw TurnPortError.indeterminate("write may have completed");
    });
    const { engine, durability } = makeEngine({ model, tools });

    const blocked = await engine.run(request());
    expect(blocked.commit.status).toBe("reconciliation_required");
    expect(tools.requests).toHaveLength(1);
    const checkpoint = durability.checkpoints.find(
      (candidate) =>
        candidate.completedToolResults?.at(-1)?.outcome === "indeterminate",
    );
    expect(checkpoint?.pendingToolRequests).toHaveLength(0);

    const resumedDurability = new RecordingDurabilityPort();
    const { engine: resumedEngine } = makeEngine({
      model,
      tools,
      durability: resumedDurability,
    });
    const result = await resumedEngine.resumeAfterToolReconciliation(
      new ResumeContext({
        checkpoint: checkpoint!,
        maxIterations: 10,
        maxModelAttempts: 3,
        lastJournalSequence: blocked.commit.lastSequence,
      }),
      new ModelToolResult({
        requestId: "call-unknown",
        name: "write",
        outcome: "success",
        output: "confirmed",
      }),
    );

    expect(result.commit.status).toBe("success");
    expect(result.commit.output).toBe("continued");
    expect(tools.requests).toHaveLength(1);
    expect(resumedDurability.events.map((event) => event.kind)).toContain(
      "tool_result_reconciled",
    );
  });
});

describe("turn-engine retry and cancellation boundaries", () => {
  it("reuses the same immutable snapshot for equal model attempts", async () => {
    const model = new ScriptedModelPort([
      new TurnPortError("transient"),
      response({ output: "retried" }),
    ]);
    const { engine } = makeEngine({ model });

    const result = await engine.run(request({ maxModelAttempts: 2 }));

    expect(result.commit.status).toBe("success");
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0].context).toBe(model.requests[1].context);
    expect(Object.isFrozen(model.requests[0].context)).toBe(true);
    expect(result.commit.iterations).toBe(1);
  });

  it("applies the same model-attempt budget to later tool-calling rounds", async () => {
    const model = new ScriptedModelPort([
      response({ tools: [{ id: "call-a", name: "echo" }] }),
      new TurnPortError("second-round transient"),
      response({ output: "recovered" }),
    ]);
    const tools = new ScriptedToolPort(
      async (toolRequest) =>
        new ModelToolResult({
          requestId: toolRequest.id,
          name: toolRequest.name,
          output: "ok",
        }),
    );
    const { engine } = makeEngine({ model, tools });

    const result = await engine.run(request({ maxModelAttempts: 2 }));

    expect(result.commit.status).toBe("success");
    expect(result.commit.output).toBe("recovered");
    expect(result.commit.iterations).toBe(2);
    expect(model.requests).toHaveLength(3);
    expect(model.requests[1].context).toBe(model.requests[2].context);
  });

  it("persists a completed model response before honoring cancellation at commit", async () => {
    const cancellation = new TurnCancellationToken();
    const model = new ScriptedModelPort([
      () => {
        cancellation.cancel();
        return response({ output: "must not commit success" });
      },
    ]);
    const { engine, durability } = makeEngine({ model });

    const result = await engine.run(request(), cancellation);

    expect(result.commit.status).toBe("cancelled");
    expect(durability.events.map((event) => event.kind)).toContain(
      "model_invocation_completed",
    );
    expect(durability.events.map((event) => event.kind)).not.toContain(
      "post_commit_started",
    );
  });
});
