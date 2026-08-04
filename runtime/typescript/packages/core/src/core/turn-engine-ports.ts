/**
 * Runtime-local effect ports for the canonical TypeScript turn engine.
 */

import { Message } from "../model/conversation/message.js";
import { TextPart } from "../model/conversation/content-part.js";
import { EngineCheckpoint } from "../model/pipeline/engine-checkpoint.js";
import { EngineEvent } from "../model/pipeline/engine-event.js";
import { EnginePermissionDecision } from "../model/pipeline/engine-permission-decision.js";
import { FinalOutputPolicyRequest } from "../model/pipeline/final-output-policy-request.js";
import { FinalOutputPolicyResult } from "../model/pipeline/final-output-policy-result.js";
import { HostPolicyRequest } from "../model/pipeline/host-policy-request.js";
import { HostPolicyResult } from "../model/pipeline/host-policy-result.js";
import { ModelInvocationRequest } from "../model/pipeline/model-invocation-request.js";
import { ModelInvocationResponse } from "../model/pipeline/model-invocation-response.js";
import { ModelToolRequest } from "../model/pipeline/model-tool-request.js";
import { ModelToolResult } from "../model/pipeline/model-tool-result.js";
import { RetryPolicyRequest } from "../model/pipeline/retry-policy-request.js";
import { TurnCommit } from "../model/pipeline/turn-commit.js";
import {
  TurnCancellationError,
  TurnCancellationToken,
} from "./turn-engine-cancellation.js";

/** Runtime port failure classification used by retry and reconciliation logic. */
export class TurnPortError extends Error {
  readonly outcomeUnknown: boolean;
  readonly configurationError: boolean;
  readonly metadata: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      outcomeUnknown?: boolean;
      configurationError?: boolean;
      metadata?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "TurnPortError";
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.configurationError = options.configurationError ?? false;
    this.metadata = options.metadata ?? {};
  }

  static indeterminate(
    message: string,
    metadata: Record<string, unknown> = {},
  ): TurnPortError {
    return new TurnPortError(message, {
      outcomeUnknown: true,
      metadata,
    });
  }

  static configuration(message: string): TurnPortError {
    return new TurnPortError(message, { configurationError: true });
  }
}

/** Typed host-policy rejection committed as a failed turn. */
export class TurnHostPolicyError extends Error {
  readonly errorKind: string;

  constructor(errorKind: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TurnHostPolicyError";
    this.errorKind = errorKind;
  }
}

/** Ephemeral provider output that does not affect semantic event ordering. */
export type ModelStreamChunk =
  | { kind: "text"; value: string }
  | { kind: "thinking"; value: string }
  | { kind: "provider"; value: unknown };

export interface ModelStreamPort {
  emit(chunk: ModelStreamChunk): Promise<void> | void;
}

export interface ModelPort {
  invoke(
    request: ModelInvocationRequest,
    cancellation: TurnCancellationToken,
    stream: ModelStreamPort,
  ): Promise<ModelInvocationResponse>;
}

export interface HostPolicyPort {
  beforeModel(
    request: HostPolicyRequest,
    cancellation: TurnCancellationToken,
  ): Promise<HostPolicyResult>;

  beforeCommit(
    request: FinalOutputPolicyRequest,
    cancellation: TurnCancellationToken,
  ): Promise<FinalOutputPolicyResult>;
}

export interface RetryPolicyPort {
  backoff(
    request: RetryPolicyRequest,
    cancellation: TurnCancellationToken,
  ): Promise<void>;
}

/** Converts a completed model/tool batch into provider-valid messages. */
export interface ConversationPort {
  formatToolExchange(
    response: ModelInvocationResponse,
    results: readonly ModelToolResult[],
  ): Message[];
}

export interface PermissionPort {
  authorize(
    request: ModelToolRequest,
    cancellation: TurnCancellationToken,
  ): Promise<EnginePermissionDecision>;
}

export interface ToolPort {
  execute(
    request: ModelToolRequest,
    cancellation: TurnCancellationToken,
  ): Promise<ModelToolResult>;
}

/** Atomically persists semantic events and the checkpoint containing them. */
export interface DurabilityPort {
  append(event: EngineEvent): Promise<void>;

  appendWithCheckpoint(
    events: readonly EngineEvent[],
    checkpoint: EngineCheckpoint,
  ): Promise<void>;
}

export interface PostCommitPort {
  afterCommit(
    effectId: string,
    commit: TurnCommit,
    cancellation: TurnCancellationToken,
  ): Promise<void>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  nextId(kind: string): string;
}

export class AllowAllPermissionPort implements PermissionPort {
  async authorize(): Promise<EnginePermissionDecision> {
    return new EnginePermissionDecision({
      approved: true,
      reason: "allow_all",
    });
  }
}

export class NoopDurabilityPort implements DurabilityPort {
  async append(): Promise<void> {}

  async appendWithCheckpoint(): Promise<void> {}
}

export class NoopPostCommitPort implements PostCommitPort {
  async afterCommit(): Promise<void> {}
}

export class NoopModelStreamPort implements ModelStreamPort {
  emit(): void {}
}

export class NoopHostPolicyPort implements HostPolicyPort {
  async beforeModel(request: HostPolicyRequest): Promise<HostPolicyResult> {
    return new HostPolicyResult({
      messages: request.messages,
      stablePrefixMessages: request.stablePrefixMessages,
    });
  }

  async beforeCommit(
    request: FinalOutputPolicyRequest,
  ): Promise<FinalOutputPolicyResult> {
    return new FinalOutputPolicyResult({ output: request.output });
  }
}

export class NoopRetryPolicyPort implements RetryPolicyPort {
  async backoff(
    _request: RetryPolicyRequest,
    cancellation: TurnCancellationToken,
  ): Promise<void> {
    if (cancellation.isCancellationRequested) {
      throw new TurnCancellationError("Retry backoff was cancelled");
    }
  }
}

export class UnavailableToolPort implements ToolPort {
  async execute(request: ModelToolRequest): Promise<ModelToolResult> {
    throw TurnPortError.configuration(
      `No tool binding is registered for '${request.name}'`,
    );
  }
}

/**
 * Provider-neutral conversation formatter preserving assistant content and
 * original model-request order.
 */
export class DefaultConversationPort implements ConversationPort {
  formatToolExchange(
    response: ModelInvocationResponse,
    results: readonly ModelToolResult[],
  ): Message[] {
    const messages = [...(response.assistantMessages ?? [])];
    for (const request of response.toolRequests ?? []) {
      const result = results.find((candidate) => candidate.requestId === request.id);
      if (!result) {
        throw TurnPortError.configuration(
          `Tool exchange is missing result '${request.id}'`,
        );
      }
      messages.push(toolResultMessage(request.id, modelVisibleToolOutput(result)));
    }
    return messages;
  }
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

/** Process-local unique identifiers suitable for default non-deterministic runs. */
export class DefaultIdGenerator implements IdGenerator {
  #counter = 0;

  nextId(kind: string): string {
    this.#counter += 1;
    return `${kind}-${Date.now().toString(36)}-${this.#counter.toString(36)}`;
  }
}

export function modelVisibleToolOutput(result: ModelToolResult): string {
  if (typeof result.output === "string") {
    return result.output;
  }
  if (result.output === undefined) {
    return "";
  }
  return JSON.stringify(result.output);
}

export function toolResultMessage(requestId: string, value: string): Message {
  return new Message({
    role: "tool",
    parts: [new TextPart({ value })],
    metadata: { tool_call_id: requestId },
  });
}

export function normalizePortError(error: unknown): TurnPortError {
  if (error instanceof TurnPortError) {
    return error;
  }
  if (error instanceof Error) {
    return new TurnPortError(error.message, { cause: error });
  }
  return new TurnPortError(String(error));
}

