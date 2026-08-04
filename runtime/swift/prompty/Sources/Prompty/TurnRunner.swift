import Foundation
import PromptyModel

/// A durable, replayable single-turn runner.
///
/// This is the Swift counterpart of `ReferenceTurnRunner` in
/// `runtime/rust/prompty/src/harness.rs`. It drives one turn to completion —
/// model call, permission gate, host tool execution, checkpointing — while
/// emitting the exact event sequence pinned by
/// `spec/vectors/harness/replay_vectors.json`, so a journal produced here
/// replays identically against any other runtime.
///
/// The clock and id factory are injected so a run is byte-for-byte
/// reproducible; durability adapters are injected so the same loop works
/// against in-memory, on-disk, or remote storage.
public struct ReferenceTurnRunner {
  public typealias ModelCallback = (TurnModelRequest) async throws -> TurnModelResponse
  public typealias Clock = () -> String
  public typealias IdFactory = (String) -> String

  private let eventSink: any EventSink
  private let journal: any EventJournalWriter
  private let checkpointStore: any CheckpointStore
  private let permissionResolver: any PermissionResolver
  private let hostToolExecutor: any HostToolExecutor
  private let invokeModel: ModelCallback
  private let now: Clock
  private let nextId: IdFactory

  public init(
    eventSink: any EventSink,
    journal: any EventJournalWriter,
    checkpointStore: any CheckpointStore,
    permissionResolver: any PermissionResolver,
    hostToolExecutor: any HostToolExecutor,
    invokeModel: @escaping ModelCallback,
    now: @escaping Clock = { ISO8601DateFormatter().string(from: Date()) },
    nextId: @escaping IdFactory = { "\($0)-\(UUID().uuidString)" }
  ) {
    self.eventSink = eventSink
    self.journal = journal
    self.checkpointStore = checkpointStore
    self.permissionResolver = permissionResolver
    self.hostToolExecutor = hostToolExecutor
    self.invokeModel = invokeModel
    self.now = now
    self.nextId = nextId
  }

  // MARK: - Turn loop

  public func run(_ request: RunTurnRequest) async throws -> RunTurnResult {
    // A negative budget is clamped rather than rejected so a caller cannot
    // accidentally invert the loop guard.
    let maxIterations = Int(max(request.options?.maxIterations ?? 10, 0))
    let inputs = request.inputs ?? [:]

    var checkpoints: [Checkpoint] = []
    var toolResults: [HostToolResult] = []
    var pendingResults: [HostToolResult] = []
    var iteration = 0
    var output: Any?
    var status: RunTurnStatus = .success

    try emitSession(.sessionStart, request: request)
    try emitTurn(.turnStart, request: request, iteration: 0)

    // `maxIterations == 0` means "never call the model", so the guard is
    // evaluated before the first invocation as well as between rounds.
    while iteration < maxIterations {
      var modelRequest = TurnModelRequest(
        sessionId: request.sessionId, turnId: request.turnId, iteration: Int32(iteration))
      modelRequest.inputs = inputs
      modelRequest.options = request.options
      modelRequest.toolResults = pendingResults

      try emitTurn(.llmStart, request: request, iteration: iteration)
      let response = try await invokeModel(modelRequest)
      try emitTurn(.llmComplete, request: request, iteration: iteration)

      let checkpoint = try await recordCheckpoint(
        request: request, iteration: iteration, state: response.checkpointState)
      checkpoints.append(checkpoint)

      let requests = response.toolRequests ?? []
      guard !requests.isEmpty else {
        output = response.output
        iteration += 1
        break
      }

      pendingResults = []
      for toolRequest in requests {
        let result = try await runTool(toolRequest, request: request, iteration: iteration)
        pendingResults.append(result)
        toolResults.append(result)
      }
      try emitTurn(.messagesUpdated, request: request, iteration: iteration)

      iteration += 1

      // The budget is consumed by the round that just ran, so exhaustion is
      // reported against the iteration that would have run next.
      if iteration >= maxIterations {
        status = .error
        output = ["message": "Maximum turn iterations reached"]
        try emitTurn(
          .error, request: request, iteration: iteration, payload: ["errorKind": "max_iterations"])
        break
      }
    }

    try emitTurn(
      .turnEnd, request: request, iteration: iteration, payload: ["status": status.rawValue])
    try emitSession(
      .sessionEnd, request: request, payload: ["status": status.rawValue])

    var summary = SessionSummary(sessionId: request.sessionId)
    summary.status = status == .success ? .success : .error
    summary.turns = 1
    summary.checkpoints = Int32(checkpoints.count)
    _ = try journal.close(summary: summary)

    var result = RunTurnResult(
      sessionId: request.sessionId, turnId: request.turnId, status: status,
      iterations: Int32(iteration))
    result.output = output
    result.toolResults = toolResults
    result.checkpoints = checkpoints
    return result
  }

  // MARK: - Tool round

  /// Gate a single tool call on permission, then execute it.
  ///
  /// A denial is turned into an unsuccessful result rather than an error so the
  /// model sees — and can respond to — the refusal on the next iteration.
  private func runTool(
    _ toolRequest: HostToolRequest, request: RunTurnRequest, iteration: Int
  ) async throws -> HostToolResult {
    let requestId = toolRequest.requestId ?? nextId("exec")
    let permissionId = "\(requestId)-permission"

    var permissionRequest = PermissionRequest(permission: "tool:\(toolRequest.toolName)")
    permissionRequest.requestId = permissionId
    permissionRequest.toolCallId = toolRequest.toolCallId
    permissionRequest.target = toolRequest.toolName

    try emitTurn(
      .permissionRequested, request: request, iteration: iteration,
      payload: ["requestId": permissionId, "toolName": toolRequest.toolName])

    let decision = try await permissionResolver.request(request: permissionRequest)

    try emitTurn(
      .permissionCompleted, request: request, iteration: iteration,
      payload: ["requestId": permissionId, "approved": decision.approved])

    let result: HostToolResult
    if decision.approved {
      try emitTurn(
        .toolExecutionStart, request: request, iteration: iteration,
        payload: ["toolName": toolRequest.toolName])

      result = try await hostToolExecutor.execute(request: toolRequest)

      try emitTurn(
        .toolExecutionComplete, request: request, iteration: iteration,
        payload: resultPayload(result))
    } else {
      var denied = HostToolResult(
        requestId: toolRequest.requestId,
        toolCallId: toolRequest.toolCallId,
        toolName: toolRequest.toolName,
        success: false
      )
      denied.errorKind = "permission_denied"
      denied.result = ["message": decision.reason ?? "Permission denied"]
      result = denied
    }

    try emitTurn(
      .toolResult, request: request, iteration: iteration, payload: resultPayload(result))
    return result
  }

  private func resultPayload(_ result: HostToolResult) -> [String: Any] {
    var payload: [String: Any] = [
      "toolName": result.toolName,
      "success": result.success,
    ]
    if let errorKind = result.errorKind { payload["errorKind"] = errorKind }
    return payload
  }

  // MARK: - Durability

  private func recordCheckpoint(
    request: RunTurnRequest, iteration: Int, state: [String: Any]?
  ) async throws -> Checkpoint {
    var checkpoint = Checkpoint(title: "Iteration \(iteration)")
    checkpoint.id = nextId("checkpoint")
    checkpoint.sessionId = request.sessionId
    checkpoint.turnId = request.turnId
    checkpoint.checkpointNumber = Int32(iteration)
    checkpoint.state = state
    checkpoint.createdAt = now()

    let saved = try await checkpointStore.save(checkpoint: checkpoint)
    try emitSession(
      .checkpointCreated, request: request, payload: ["checkpointId": saved.id ?? ""])
    return saved
  }

  /// Every event goes to the sink first and the journal second, so an
  /// observer never sees an event that was not durably recorded behind it.
  private func emitTurn(
    _ type: TurnEventType, request: RunTurnRequest, iteration: Int,
    payload: [String: Any] = [:]
  ) throws {
    var event = TurnEvent(id: nextId("event"), type: type, timestamp: now())
    event.turnId = request.turnId
    event.iteration = Int32(iteration)
    event.payload = payload

    _ = try eventSink.emitTurn(turnEvent: event)
    _ = try journal.appendTurn(turnEvent: event)
  }

  private func emitSession(
    _ type: SessionEventType, request: RunTurnRequest, payload: [String: Any] = [:]
  ) throws {
    var event = SessionEvent(id: nextId("event"), type: type, timestamp: now())
    event.sessionId = request.sessionId
    event.turnId = request.turnId
    event.payload = payload

    _ = try eventSink.emitSession(sessionEvent: event)
    _ = try journal.appendSession(sessionEvent: event)
  }
}
