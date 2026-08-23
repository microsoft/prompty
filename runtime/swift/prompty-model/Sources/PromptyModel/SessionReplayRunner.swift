/// Provider-agnostic session replay runner — the ``TurnConformance.replay`` engine.
///
/// Swift counterpart of the C# ``ReferenceTurnRunner`` and Java
/// ``ReferenceTurnRunner``. It owns the *durable session/turn journal* contract
/// asserted by `schema/model/conformance/vectors` (stage `replay`): a session is
/// opened, a single turn drives the model→permission→tool loop, checkpoints are
/// recorded per model iteration, and the session is closed with a summary.
///
/// Like ``TurnEngine`` and ``AgentLoopEngine`` it is provider-agnostic: the turn
/// is driven by abstract `invokeModel` / `resolvePermission` / `executeTool`
/// callbacks. The observable event trace *emerges* from real control flow — the
/// caller supplies only the scripted model, tool handlers, and permission mode
/// that define a scenario, never the resulting events.
import Foundation

public enum SessionReplayRunner {
  public static let defaultMaxIterations = 10

  /// A host-tool invocation requested by the model.
  public struct ToolRequest {
    public let requestId: String
    public let toolCallId: String
    public let toolName: String
    public let arguments: [String: Any]

    public init(
      requestId: String, toolCallId: String, toolName: String,
      arguments: [String: Any] = [:]
    ) {
      self.requestId = requestId
      self.toolCallId = toolCallId
      self.toolName = toolName
      self.arguments = arguments
    }
  }

  /// A normalized single model turn: a final `output`, or `toolRequests`.
  public struct ModelResponse {
    public let output: Any?
    public let toolRequests: [ToolRequest]

    public init(output: Any? = nil, toolRequests: [ToolRequest] = []) {
      self.output = output
      self.toolRequests = toolRequests
    }
  }

  /// The outcome of one host-tool invocation.
  public struct ToolOutcome {
    public let success: Bool
    public let result: Any?
    public let errorKind: String?

    public init(success: Bool, result: Any? = nil, errorKind: String? = nil) {
      self.success = success
      self.result = result
      self.errorKind = errorKind
    }
  }

  /// One durable journal record. `scope` is `session`, `turn`, or `summary`;
  /// `payload` carries the fields replay verification projects.
  public struct Record {
    public let scope: String
    public let type: String
    public let sessionId: String
    public let turnId: String
    public let iteration: Int
    public let payload: [String: Any]
  }

  /// Run a single session turn and return its durable event journal.
  ///
  /// Deterministic: given the same callbacks and inputs it always emits the same
  /// session/turn lifecycle events, checkpoint count, permission flow, tool
  /// ordering, and summary.
  public static func run(
    sessionId: String,
    turnId: String,
    inputs: [String: Any],
    maxIterations: Int?,
    invokeModel: (Int, [ToolOutcome]) -> ModelResponse,
    resolvePermission: (ToolRequest) -> Bool,
    executeTool: (ToolRequest) throws -> ToolOutcome
  ) -> [Record] {
    let limit = max(maxIterations ?? defaultMaxIterations, 0)
    var records: [Record] = []

    func session(_ type: String, _ payload: [String: Any] = [:]) {
      records.append(
        Record(
          scope: "session", type: type, sessionId: sessionId, turnId: turnId,
          iteration: 0, payload: payload))
    }
    func turn(_ type: String, _ iteration: Int, _ payload: [String: Any] = [:]) {
      records.append(
        Record(
          scope: "turn", type: type, sessionId: sessionId, turnId: turnId,
          iteration: iteration, payload: payload))
    }

    var checkpoints = 0
    var pending: [ToolOutcome] = []
    var hasFinalOutput = false
    var status = "success"
    var iterations = 0

    session("session_start")
    turn("turn_start", 0)

    for iteration in 0..<limit {
      iterations = iteration + 1
      turn("llm_start", iteration)
      let response = invokeModel(iteration, pending)
      turn("llm_complete", iteration)

      // One checkpoint per model iteration (a session-scoped durable event).
      checkpoints += 1
      session("checkpoint_created")

      if response.toolRequests.isEmpty {
        hasFinalOutput = true
        break
      }

      pending = []
      for request in response.toolRequests {
        pending.append(resolveAndExecute(request, iteration, turn, resolvePermission, executeTool))
      }
      turn("messages_updated", iteration)
    }

    if !hasFinalOutput && !pending.isEmpty {
      status = "error"
      turn("error", iterations, ["errorKind": "max_iterations"])
    }

    turn("turn_end", iterations, ["status": status])
    session("session_end", ["status": status])
    records.append(
      Record(
        scope: "summary", type: "summary", sessionId: sessionId, turnId: turnId,
        iteration: 0,
        payload: ["status": status, "turns": 1, "checkpoints": checkpoints]))

    return records
  }

  /// Resolve permission for a tool request, then execute it (or record the
  /// denial), emitting the durable turn events in contract order.
  private static func resolveAndExecute(
    _ request: ToolRequest,
    _ iteration: Int,
    _ turn: (String, Int, [String: Any]) -> Void,
    _ resolvePermission: (ToolRequest) -> Bool,
    _ executeTool: (ToolRequest) throws -> ToolOutcome
  ) -> ToolOutcome {
    let permissionId = "\(request.requestId)-permission"
    turn("permission_requested", iteration, ["requestId": permissionId])
    let approved = resolvePermission(request)
    turn("permission_completed", iteration, ["approved": approved])

    if !approved {
      turn(
        "tool_result", iteration,
        ["toolName": request.toolName, "success": false, "errorKind": "permission_denied"])
      return ToolOutcome(
        success: false, result: ["message": "Permission denied"],
        errorKind: "permission_denied")
    }

    turn("tool_execution_start", iteration, ["toolName": request.toolName])
    let outcome: ToolOutcome
    if let executed = try? executeTool(request) {
      outcome = executed
    } else {
      outcome = ToolOutcome(
        success: false, result: ["message": "Tool execution failed"],
        errorKind: "exception")
    }
    var completePayload: [String: Any] = [
      "toolName": request.toolName, "success": outcome.success,
    ]
    if let errorKind = outcome.errorKind {
      completePayload["errorKind"] = errorKind
    }
    turn("tool_execution_complete", iteration, completePayload)
    turn("tool_result", iteration, completePayload)
    return outcome
  }
}
