/// Provider-agnostic single-turn engine — the ``TurnConformance.runTurn`` engine.
///
/// Swift counterpart of Python's ``prompty.core.turn_engine`` and the Rust
/// ``prompty::engine::turn``. It owns the *snapshot and portability* turn
/// contract asserted by `schema/model/conformance/vectors/turn.tsp` (stage
/// `turn`). Like ``AgentLoopEngine`` it is provider-agnostic: the turn is driven
/// by an abstract `invokeModel` callback plus optional `resolvePermission` /
/// `executeTool` callbacks, so every provider shares one engine and supplies only
/// wire translation.
///
/// Observable contract (verified against all 5 `runTurn` vectors):
/// * `iterations` — number of model invocations.
/// * `snapshots` — one per model iteration. `snapshotStablePrefixes[i]` is the
///   stable message-prefix length at snapshot *i*; `snapshotPortability[i]` is the
///   provider-state portability entering iteration *i* (`portable` until a model
///   turn declares `nextPortability: "delegated"`, applied to the following
///   snapshot).
/// * `commitPortability` / `delegatedState` — portability and delegated state
///   carried at commit time.
/// * `toolResults` / `toolResultOrder` — count and ordered tool-call ids.
/// * `eventKinds` — the exact lifecycle event order.
import Foundation

public enum TurnEngine {
  public static let defaultMaxIterations = 10
  public static let portabilityPortable = "portable"
  public static let portabilityDelegated = "delegated"

  /// A tool invocation requested by the model.
  public struct ToolCall {
    public let id: String
    public let name: String
    public let arguments: [String: Any]

    public init(id: String, name: String, arguments: [String: Any] = [:]) {
      self.id = id
      self.name = name
      self.arguments = arguments
    }
  }

  /// A normalized single model turn.
  ///
  /// `output` is set for a final answer; `toolCalls` for a tool round.
  /// `nextPortability`/`delegatedState` declare the provider-state portability
  /// transition that applies to the *next* snapshot.
  public struct ModelTurn {
    public let output: Any?
    public let toolCalls: [ToolCall]
    public let nextPortability: String?
    public let delegatedState: [Any]?

    public init(
      output: Any? = nil, toolCalls: [ToolCall] = [], nextPortability: String? = nil,
      delegatedState: [Any]? = nil
    ) {
      self.output = output
      self.toolCalls = toolCalls
      self.nextPortability = nextPortability
      self.delegatedState = delegatedState
    }
  }

  /// The outcome of one tool invocation within a turn.
  public struct ToolResult {
    public let id: String
    public let result: Any?
    public let success: Bool
  }

  /// The observable result of a single turn.
  public struct Result {
    public var status: String
    public var output: Any?
    public var iterations = 0
    public var snapshots = 0
    public var snapshotStablePrefixes: [Int] = []
    public var snapshotPortability: [String] = []
    public var commitPortability: String
    public var delegatedStateCount = 0
    public var toolResults: [ToolResult] = []
    public var toolResultOrder: [String] = []
    public var events: [String] = []
  }

  /// Run one turn and return its snapshot/portability observable result.
  ///
  /// Deterministic: given the same callbacks and inputs it always produces the
  /// same snapshots, portability transitions, tool ordering, and lifecycle events.
  public static func run(
    messages: [[String: Any]],
    invokeModel: (Int, [ToolResult]) -> ModelTurn,
    resolvePermission: ((ToolCall) -> Bool)? = nil,
    executeTool: ((ToolCall) -> Any?)? = nil,
    cancelBeforeRun: Bool = false,
    maxIterations: Int = defaultMaxIterations
  ) -> Result {
    var result = Result(status: "success", commitPortability: portabilityPortable)

    func emit(_ kind: String) { result.events.append(kind) }

    emit("turn_started")

    if cancelBeforeRun {
      emit("turn_cancelled")
      result.status = "cancelled"
      result.output = nil
      return result
    }

    let stablePrefix = messages.count
    var pendingPortability = portabilityPortable
    var delegatedState: [Any] = []
    var pendingToolResults: [ToolResult] = []
    let approve = resolvePermission ?? { _ in true }
    let dispatch = executeTool ?? { _ in nil }

    for iteration in 0..<maxIterations {
      result.iterations = iteration + 1

      emit("context_prepared")
      emit("model_invocation_started")
      let turn = invokeModel(iteration, pendingToolResults)
      emit("model_invocation_completed")

      result.snapshotPortability.append(pendingPortability)
      result.snapshotStablePrefixes.append(stablePrefix)
      result.snapshots += 1
      emit("checkpoint_created")

      if turn.nextPortability == portabilityDelegated {
        pendingPortability = portabilityDelegated
        delegatedState = turn.delegatedState ?? []
      }

      if turn.toolCalls.isEmpty {
        result.output = turn.output
        result.commitPortability = pendingPortability
        result.delegatedStateCount = delegatedState.count
        emit("turn_committed")
        emit("post_commit_started")
        emit("post_commit_completed")
        return result
      }

      pendingToolResults = []
      for call in turn.toolCalls {
        emit("permission_requested")
        let approved = approve(call)
        emit("permission_resolved")
        let toolResult: ToolResult
        if approved {
          emit("tool_execution_started")
          let output = dispatch(call)
          emit("tool_execution_completed")
          toolResult = ToolResult(id: call.id, result: output, success: true)
        } else {
          toolResult = ToolResult(
            id: call.id,
            result: ["message": "Permission denied", "error_kind": "permission_denied"],
            success: false)
        }
        emit("checkpoint_created")
        result.toolResults.append(toolResult)
        result.toolResultOrder.append(call.id)
        pendingToolResults.append(toolResult)
      }

      for _ in turn.toolCalls { emit("tool_result_committed") }
      emit("conversation_updated")
      emit("checkpoint_created")
    }

    result.status = "error"
    result.commitPortability = pendingPortability
    result.delegatedStateCount = delegatedState.count
    return result
  }
}
