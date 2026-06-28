// Copyright (c) Microsoft. All rights reserved.

import {
  Checkpoint,
  HostToolRequest,
  HostToolResult,
  PermissionRequest,
  SessionEvent,
  SessionSummary,
  TurnEvent,
  TurnOptions,
  type CheckpointStore,
  type EventJournalWriter,
  type EventSink,
  type HostToolExecutor,
  type PermissionResolver,
} from "../model/index.js";

type JsonRecord = Record<string, unknown>;

export interface TurnModelRequest {
  sessionId: string;
  turnId: string;
  iteration: number;
  inputs: JsonRecord;
  options: TurnOptions;
  toolResults: HostToolResult[];
}

export interface TurnModelResponse {
  output?: unknown;
  toolRequests?: HostToolRequest[];
  checkpointState?: JsonRecord;
}

export type TurnModelCallback = (request: TurnModelRequest) => TurnModelResponse | Promise<TurnModelResponse>;

export interface TurnRunnerDependencies {
  eventSink: EventSink;
  journal: EventJournalWriter;
  checkpointStore: CheckpointStore;
  permissionResolver: PermissionResolver;
  hostToolExecutor: HostToolExecutor;
  invokeModel: TurnModelCallback;
  now?: () => string;
  nextId?: (prefix: string) => string;
}

export interface RunTurnRequest {
  sessionId: string;
  turnId: string;
  inputs?: JsonRecord;
  options?: TurnOptions;
}

export interface RunTurnResult {
  sessionId: string;
  turnId: string;
  status: "success" | "error";
  output?: unknown;
  iterations: number;
  toolResults: HostToolResult[];
  checkpoints: Checkpoint[];
}

export class ReferenceTurnRunner {
  private sequence = 0;

  constructor(private readonly dependencies: TurnRunnerDependencies) {}

  async run(request: RunTurnRequest): Promise<RunTurnResult> {
    const options = request.options ?? new TurnOptions();
    const inputs = request.inputs ?? {};
    const maxIterations = options.maxIterations ?? 10;
    const checkpoints: Checkpoint[] = [];
    const allToolResults: HostToolResult[] = [];
    let pendingToolResults: HostToolResult[] = [];
    let output: unknown;
    let status: "success" | "error" = "success";
    let iterations = 0;

    this.recordSession("session_start", request.sessionId, request.turnId, {
      sessionId: request.sessionId,
      schemaVersion: "1",
    });
    this.recordTurn("turn_start", request.turnId, 0, {
      inputs,
      maxIterations,
    });

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      iterations = iteration + 1;
      this.recordTurn("llm_start", request.turnId, iteration, {
        attempt: 0,
      });

      const modelResponse = await this.dependencies.invokeModel({
        sessionId: request.sessionId,
        turnId: request.turnId,
        iteration,
        inputs,
        options,
        toolResults: pendingToolResults,
      });

      this.recordTurn("llm_complete", request.turnId, iteration, {});

      const checkpoint = await this.saveCheckpoint(request.sessionId, request.turnId, iteration, modelResponse);
      checkpoints.push(checkpoint);

      const toolRequests = modelResponse.toolRequests ?? [];
      if (toolRequests.length === 0) {
        output = modelResponse.output;
        break;
      }

      pendingToolResults = [];
      for (const toolRequest of toolRequests) {
        const toolResult = await this.resolveAndExecuteTool(request.turnId, iteration, toolRequest);
        pendingToolResults.push(toolResult);
        allToolResults.push(toolResult);
      }

      this.recordTurn("messages_updated", request.turnId, iteration, {
        toolResults: pendingToolResults.map((result) => result.save()),
      });
    }

    if (output === undefined && pendingToolResults.length > 0) {
      status = "error";
      output = { message: "Maximum turn iterations reached" };
      this.recordTurn("error", request.turnId, iterations, {
        errorKind: "max_iterations",
        message: "Maximum turn iterations reached",
      });
    }

    this.recordTurn("turn_end", request.turnId, iterations, {
      iterations,
      status,
      response: output,
    });
    this.recordSession("session_end", request.sessionId, request.turnId, {
      sessionId: request.sessionId,
      status,
      reason: "turn_complete",
    });
    this.dependencies.journal.close(
      new SessionSummary({
        sessionId: request.sessionId,
        status,
        turns: 1,
        checkpoints: checkpoints.length,
      }),
    );

    return {
      sessionId: request.sessionId,
      turnId: request.turnId,
      status,
      output,
      iterations,
      toolResults: allToolResults,
      checkpoints,
    };
  }

  private async saveCheckpoint(
    sessionId: string,
    turnId: string,
    iteration: number,
    modelResponse: TurnModelResponse,
  ): Promise<Checkpoint> {
    const checkpoint = new Checkpoint({
      id: `${turnId}-checkpoint-${iteration}`,
      sessionId,
      turnId,
      checkpointNumber: iteration + 1,
      title: `Turn ${turnId} iteration ${iteration}`,
      state: {
        iteration,
        output: modelResponse.output,
        toolRequests: (modelResponse.toolRequests ?? []).map((toolRequest) => toolRequest.save()),
        ...(modelResponse.checkpointState ?? {}),
      },
      createdAt: this.timestamp(),
    });
    const saved = await this.dependencies.checkpointStore.save(checkpoint);
    this.recordSession("checkpoint_created", sessionId, turnId, {
      checkpointId: saved.id,
      checkpointNumber: saved.checkpointNumber,
    });
    return saved;
  }

  private async resolveAndExecuteTool(
    turnId: string,
    iteration: number,
    toolRequest: HostToolRequest,
  ): Promise<HostToolResult> {
    const permission = new PermissionRequest({
      requestId: toolRequest.requestId ? `${toolRequest.requestId}-permission` : this.id("permission"),
      toolCallId: toolRequest.toolCallId,
      permission: "tool.execute",
      target: toolRequest.toolName,
      details: toolRequest.save(),
    });

    this.recordTurn("permission_requested", turnId, iteration, permission.save());
    const decision = await this.dependencies.permissionResolver.request(permission);
    this.recordTurn("permission_completed", turnId, iteration, decision.save());

    if (!decision.approved) {
      return new HostToolResult({
        requestId: toolRequest.requestId,
        toolCallId: toolRequest.toolCallId,
        toolName: toolRequest.toolName,
        success: false,
        errorKind: "permission_denied",
        result: { message: decision.reason ?? "Permission denied" },
      });
    }

    this.recordTurn("tool_execution_start", turnId, iteration, toolRequest.save());
    const result = await this.dependencies.hostToolExecutor.execute(toolRequest);
    this.recordTurn("tool_execution_complete", turnId, iteration, result.save());
    this.recordTurn("tool_result", turnId, iteration, result.save());
    return result;
  }

  private recordTurn(type: TurnEvent["type"], turnId: string, iteration: number, payload: JsonRecord): void {
    const event = new TurnEvent({
      id: this.id("turn-event"),
      type,
      timestamp: this.timestamp(),
      turnId,
      iteration,
      payload,
    });
    this.dependencies.eventSink.emitTurn(event);
    this.dependencies.journal.appendTurn(event);
  }

  private recordSession(type: SessionEvent["type"], sessionId: string, turnId: string, payload: JsonRecord): void {
    const event = new SessionEvent({
      id: this.id("session-event"),
      type,
      timestamp: this.timestamp(),
      sessionId,
      turnId,
      payload,
    });
    this.dependencies.eventSink.emitSession(event);
    this.dependencies.journal.appendSession(event);
  }

  private timestamp(): string {
    return this.dependencies.now?.() ?? new Date().toISOString();
  }

  private id(prefix: string): string {
    if (this.dependencies.nextId) {
      return this.dependencies.nextId(prefix);
    }
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

