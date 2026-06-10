// Copyright (c) Microsoft. All rights reserved.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  Checkpoint,
  HostToolRequest,
  HostToolResult,
  PermissionDecision,
  PermissionRequest,
  SessionEvent,
  SessionSummary,
  TurnEvent,
  type CheckpointStore,
  type EventSink,
  type HostToolExecutor,
  type PermissionResolver,
  type TraceWriter,
} from "../model/index.js";

type JsonRecord = Record<string, unknown>;
type ToolHandler = (args: JsonRecord, request: HostToolRequest) => unknown | Promise<unknown>;

function checkpointKey(sessionId: string, checkpointId: string): string {
  return `${sessionId}\u0000${checkpointId}`;
}

function requireCheckpointKey(checkpoint: Checkpoint): { sessionId: string; checkpointId: string } {
  if (!checkpoint.sessionId) {
    throw new Error("Checkpoint sessionId is required");
  }
  if (!checkpoint.id) {
    throw new Error("Checkpoint id is required");
  }
  return { sessionId: checkpoint.sessionId, checkpointId: checkpoint.id };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Captures emitted turn and session events in memory. */
export class CollectingEventSink implements EventSink {
  readonly turnEvents: TurnEvent[] = [];
  readonly sessionEvents: SessionEvent[] = [];

  emitTurn(turnEvent: TurnEvent): boolean {
    this.turnEvents.push(turnEvent);
    return true;
  }

  emitSession(sessionEvent: SessionEvent): boolean {
    this.sessionEvents.push(sessionEvent);
    return true;
  }
}

/** Appends replayable trace records as newline-delimited JSON. */
export class JsonlTraceWriter implements TraceWriter {
  private closed = false;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  appendTurn(turnEvent: TurnEvent): boolean {
    return this.write({ kind: "turn", event: turnEvent.save() });
  }

  appendSession(sessionEvent: SessionEvent): boolean {
    return this.write({ kind: "session", event: sessionEvent.save() });
  }

  close(summary: SessionSummary | null): boolean {
    if (summary) {
      if (!this.write({ kind: "summary", summary: summary.save() })) {
        return false;
      }
    }
    this.closed = true;
    return true;
  }

  private write(record: JsonRecord): boolean {
    if (this.closed) {
      return false;
    }
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  }
}

/** Stores checkpoints in memory by session and checkpoint identifier. */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, Checkpoint>();

  async save(checkpoint: Checkpoint): Promise<Checkpoint> {
    const { sessionId, checkpointId } = requireCheckpointKey(checkpoint);
    this.checkpoints.set(checkpointKey(sessionId, checkpointId), checkpoint);
    return checkpoint;
  }

  async load(sessionId: string, checkpointId: string): Promise<Checkpoint | null> {
    return this.checkpoints.get(checkpointKey(sessionId, checkpointId)) ?? null;
  }

  async listCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    return [...this.checkpoints.values()].filter((checkpoint) => checkpoint.sessionId === sessionId);
  }
}

/** Resolves every permission request as approved. */
export class AllowAllPermissionResolver implements PermissionResolver {
  async request(request: PermissionRequest): Promise<PermissionDecision> {
    return new PermissionDecision({
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      permission: request.permission,
      approved: true,
      reason: "allow_all",
    });
  }
}

/** Resolves every permission request as denied. */
export class DenyAllPermissionResolver implements PermissionResolver {
  async request(request: PermissionRequest): Promise<PermissionDecision> {
    return new PermissionDecision({
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      permission: request.permission,
      approved: false,
      reason: "deny_all",
    });
  }
}

/** Dispatches host tool requests to registered local functions. */
export class FunctionHostToolExecutor implements HostToolExecutor {
  constructor(private readonly handlers: Record<string, ToolHandler>) {}

  async execute(request: HostToolRequest): Promise<HostToolResult> {
    const started = Date.now();
    const handler = this.handlers[request.toolName];
    if (!handler) {
      return new HostToolResult({
        requestId: request.requestId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: false,
        errorKind: "not_found",
        result: { message: `No host tool registered for '${request.toolName}'` },
        durationMs: Date.now() - started,
      });
    }

    try {
      const result = await handler(request.arguments ?? {}, request);
      return new HostToolResult({
        requestId: request.requestId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: true,
        result,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      return new HostToolResult({
        requestId: request.requestId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: false,
        errorKind: "exception",
        result: { message: errorMessage(error) },
        durationMs: Date.now() - started,
      });
    }
  }
}
