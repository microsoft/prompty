import { Message } from "../src/model/conversation/message.js";
import { EngineCheckpoint } from "../src/model/pipeline/engine-checkpoint.js";
import { EngineEvent } from "../src/model/pipeline/engine-event.js";
import { EnginePermissionDecision } from "../src/model/pipeline/engine-permission-decision.js";
import { InvocationContextState } from "../src/model/pipeline/invocation-context-state.js";
import { ModelInvocationRequest } from "../src/model/pipeline/model-invocation-request.js";
import { ModelInvocationResponse } from "../src/model/pipeline/model-invocation-response.js";
import { ModelToolRequest } from "../src/model/pipeline/model-tool-request.js";
import { ModelToolResult } from "../src/model/pipeline/model-tool-result.js";
import type {
  Clock,
  DurabilityPort,
  IdGenerator,
  ModelPort,
  ModelStreamPort,
  PermissionPort,
  ToolPort,
} from "../src/core/turn-engine-ports.js";
import { TurnPortError } from "../src/core/turn-engine-ports.js";
import type { TurnCancellationToken } from "../src/core/turn-engine-cancellation.js";

export type ModelStep =
  | ModelInvocationResponse
  | Error
  | ((
      request: ModelInvocationRequest,
      cancellation: TurnCancellationToken,
    ) => ModelInvocationResponse | Promise<ModelInvocationResponse>);

export class ScriptedModelPort implements ModelPort {
  readonly requests: ModelInvocationRequest[] = [];
  readonly steps: ModelStep[];

  constructor(steps: readonly ModelStep[]) {
    this.steps = [...steps];
  }

  async invoke(
    request: ModelInvocationRequest,
    cancellation: TurnCancellationToken,
    _stream: ModelStreamPort,
  ): Promise<ModelInvocationResponse> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (!step) {
      throw new TurnPortError("Model script exhausted");
    }
    if (step instanceof Error) {
      throw step;
    }
    return typeof step === "function"
      ? step(request, cancellation)
      : step;
  }
}

export class ScriptedToolPort implements ToolPort {
  readonly requests: ModelToolRequest[] = [];

  constructor(
    readonly handler: (
      request: ModelToolRequest,
      cancellation: TurnCancellationToken,
    ) => ModelToolResult | Promise<ModelToolResult>,
  ) {}

  async execute(
    request: ModelToolRequest,
    cancellation: TurnCancellationToken,
  ): Promise<ModelToolResult> {
    this.requests.push(request);
    return this.handler(request, cancellation);
  }
}

export class SelectivePermissionPort implements PermissionPort {
  readonly requests: ModelToolRequest[] = [];

  constructor(readonly denied: ReadonlySet<string> = new Set()) {}

  async authorize(
    request: ModelToolRequest,
  ): Promise<EnginePermissionDecision> {
    this.requests.push(request);
    const approved = !this.denied.has(request.name);
    return new EnginePermissionDecision({
      approved,
      reason: approved ? "allowed" : "denied by test",
    });
  }
}

export class RecordingDurabilityPort implements DurabilityPort {
  readonly events: EngineEvent[] = [];
  readonly checkpoints: EngineCheckpoint[] = [];
  readonly attemptedAtomicWrites: {
    events: readonly EngineEvent[];
    checkpoint: EngineCheckpoint;
  }[] = [];
  atomicCalls = 0;
  failAtomicAt?: number;
  failAppendKind?: EngineEvent["kind"];

  async append(event: EngineEvent): Promise<void> {
    if (event.kind === this.failAppendKind) {
      throw new TurnPortError(`append failed for ${event.kind}`);
    }
    this.events.push(event);
  }

  async appendWithCheckpoint(
    events: readonly EngineEvent[],
    checkpoint: EngineCheckpoint,
  ): Promise<void> {
    this.atomicCalls += 1;
    this.attemptedAtomicWrites.push({ events, checkpoint });
    if (this.atomicCalls === this.failAtomicAt) {
      throw new TurnPortError("atomic write failed");
    }
    this.events.push(...events);
    this.checkpoints.push(checkpoint);
  }
}

export class DeterministicClock implements Clock {
  #tick = 0;

  now(): string {
    this.#tick += 1;
    return `2026-01-01T00:00:${this.#tick.toString().padStart(2, "0")}Z`;
  }
}

export class DeterministicIds implements IdGenerator {
  readonly #counts = new Map<string, number>();

  nextId(kind: string): string {
    const next = (this.#counts.get(kind) ?? 0) + 1;
    this.#counts.set(kind, next);
    return `${kind}-${next}`;
  }
}

export function response(options: {
  output?: unknown;
  assistant?: string;
  tools?: readonly {
    id: string;
    name: string;
    arguments?: unknown;
  }[];
  portability?: InvocationContextState["portability"];
  delegatedState?: InvocationContextState["delegatedState"];
}): ModelInvocationResponse {
  return new ModelInvocationResponse({
    output: options.output,
    assistantMessages:
      options.assistant === undefined
        ? []
        : [Message.assistant(options.assistant)],
    toolRequests: (options.tools ?? []).map(
      (tool) =>
        new ModelToolRequest({
          id: tool.id,
          name: tool.name,
          arguments: tool.arguments,
        }),
    ),
    nextContextState:
      options.portability === undefined
        ? undefined
        : new InvocationContextState({
            portability: options.portability,
            delegatedState: options.delegatedState,
          }),
  });
}

