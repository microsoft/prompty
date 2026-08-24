import Foundation
import PromptyModel

/// An observability record of a single agent-loop run (``Pipeline/turn(_:inputs:tools:maxIterations:registry:options:)``).
///
/// Attach one through ``Pipeline/Options/trace`` and the loop fills it in as it
/// runs: the conversation it built, the tools it dispatched, the lifecycle
/// events it emitted, and — on the paths that abort — why. It is a read-only
/// window onto what the loop already does; attaching a trace changes nothing
/// about how the loop behaves, only what it reports. Nothing here alters control
/// flow, and a run with no trace attached takes exactly the same path.
///
/// The projection mirrors the model-package reference engine (`AgentLoopEngine`
/// in `PromptyModel`) field-for-field, so the production loop and the reference
/// engine describe an identical run identically:
///
/// - ``iterations`` — model calls made (a denial or cancellation before the
///   first call leaves this at zero).
/// - ``messageSequence`` — the canonical conversation, one dictionary per
///   message, in wire shape (`role`/`content`, with tool-call and tool-result
///   metadata where present).
/// - ``events`` — the lifecycle event stream (`status`, `tool_call_start`,
///   `tool_result`, `messages_updated`, `done`, `cancelled`).
/// - ``toolsExecuted`` / ``toolExecutionOrder`` — handlers actually invoked, in
///   dispatch order (a guardrail denial is recorded in ``deniedTools`` instead,
///   never here).
/// - ``deniedTools`` — tool calls a guardrail blocked before execution.
/// - ``trimmedMessages`` — the compacted conversation when context trimming
///   fired, otherwise `nil`.
/// - ``result`` — the final model answer, when the loop completed normally.
/// - ``error`` / ``errorType`` / ``errorReason`` — the canonical failure
///   description on an aborting path.
///
/// That parity is what lets the cross-runtime `agent` vectors be asserted
/// against a real `turn()` rather than only its final result.
///
/// ``error`` / ``errorType`` / ``errorReason`` carry the *canonical* failure
/// labels of that shared projection (the same keys every runtime reports), not
/// the text of the Swift error `turn()` throws. On the max-iterations path, for
/// example, ``error`` is the short canonical form while the thrown
/// ``InvokerError`` carries a longer human message. The trace describes the run
/// in the cross-language vocabulary; the throw carries the caller-facing detail.
///
/// One trace records one run: pass a fresh ``AgentTrace`` to each ``Pipeline/turn``
/// call. ``begin(initial:)`` clears any prior state, so a trace is also safe to
/// reuse sequentially, but a single instance must not be shared across
/// overlapping runs.
///
/// Thread-safe: a tool handler running on another task may read a partial trace
/// without tearing.
public final class AgentTrace: @unchecked Sendable {
  private let lock = NSLock()

  private var _iterations = 0
  private var _messageSequence: [[String: Any]] = []
  private var _events: [[String: Any]] = []
  private var _toolsExecuted = 0
  private var _toolExecutionOrder: [String] = []
  private var _deniedTools: [String] = []
  private var _trimmedMessages: [[String: Any]]?
  private var _toolRounds = 0
  private var _result: Any?
  private var _error: String?
  private var _errorType: String?
  private var _errorReason: String?

  public init() {}

  private func withLock<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  // MARK: - Public read surface

  /// The number of model calls the loop made.
  public var iterations: Int { withLock { _iterations } }

  /// The canonical conversation, one wire-shaped dictionary per message.
  public var messageSequence: [[String: Any]] { withLock { _messageSequence } }

  /// The lifecycle event stream, in emission order.
  public var events: [[String: Any]] { withLock { _events } }

  /// The count of tool handlers actually invoked.
  public var toolsExecuted: Int { withLock { _toolsExecuted } }

  /// The names of the tools invoked, in dispatch order.
  public var toolExecutionOrder: [String] { withLock { _toolExecutionOrder } }

  /// The names of tool calls a guardrail denied before execution.
  public var deniedTools: [String] { withLock { _deniedTools } }

  /// The compacted conversation when context trimming fired, else `nil`.
  public var trimmedMessages: [[String: Any]]? { withLock { _trimmedMessages } }

  /// The final model answer, when the loop completed normally.
  public var result: Any? { withLock { _result } }

  /// The canonical error label on an aborting path (e.g. `"CancelledError"`).
  public var error: String? { withLock { _error } }

  /// The error category, when one applies (e.g. `"ValueError"`).
  public var errorType: String? { withLock { _errorType } }

  /// The reason string carried by a guardrail denial.
  public var errorReason: String? { withLock { _errorReason } }

  /// Total messages the loop accounted for: the conversation length plus one
  /// when any tool round ran, matching the reference engine's `total_messages`.
  public var totalMessages: Int {
    withLock { _messageSequence.count + (_toolRounds > 0 ? 1 : 0) }
  }

  // MARK: - Recording (internal — driven only by the loop)

  /// Seed the conversation from the prepared messages and open the event stream.
  ///
  /// Clears any state from a prior run first, so an ``AgentTrace`` reused across
  /// sequential ``Pipeline/turn`` calls starts each run clean.
  func begin(initial messages: [Message]) {
    withLock {
      _iterations = 0
      _messageSequence = messages.map(Self.projectMessage)
      _events = [Self.event("status", ["message": "Starting agent loop"])]
      _toolsExecuted = 0
      _toolExecutionOrder = []
      _deniedTools = []
      _trimmedMessages = nil
      _toolRounds = 0
      _result = nil
      _error = nil
      _errorType = nil
      _errorReason = nil
    }
  }

  /// Count a completed model call.
  func recordIteration() {
    withLock { _iterations += 1 }
  }

  /// Replace the conversation with its trimmed form and remember it.
  func recordTrim(_ trimmed: [Message]) {
    withLock {
      let dicts = trimmed.map(Self.projectMessage)
      _messageSequence = dicts
      _trimmedMessages = dicts
    }
  }

  /// Append injected steering messages and emit the steering events.
  func recordSteering(_ messages: [Message]) {
    withLock {
      for message in messages { _messageSequence.append(Self.projectMessage(message)) }
      _events.append(Self.event("status", ["message": "Injecting steering message"]))
      _events.append(Self.event("messages_updated", ["message_count": _messageSequence.count + 1]))
    }
  }

  /// Open a tool round: append the assistant tool-call message.
  func beginToolRound(calls: [ToolCall]) {
    withLock {
      _toolRounds += 1
      _messageSequence.append(Self.assistantToolCallsMessage(calls))
    }
  }

  /// Record a tool call being dispatched (before its handler runs).
  func recordToolCallStart(name: String, arguments: String) {
    withLock {
      _events.append(Self.event("tool_call_start", ["name": name, "arguments": arguments]))
    }
  }

  /// Record a tool handler that actually ran, plus its result message.
  func recordToolExecuted(name: String, callId: String, result: String) {
    withLock {
      _toolsExecuted += 1
      _toolExecutionOrder.append(name)
      _events.append(Self.event("tool_result", ["name": name, "result": result]))
      _messageSequence.append(Self.toolMessage(callId: callId, content: result))
    }
  }

  /// Record a tool call a guardrail denied: no execution, no `tool_result`, but
  /// the denial still occupies its result slot in the conversation.
  func recordToolDenied(name: String, callId: String, denial: String) {
    withLock {
      _deniedTools.append(name)
      _messageSequence.append(Self.toolMessage(callId: callId, content: denial))
    }
  }

  /// Close a tool round: the conversation grew, so emit `messages_updated`.
  func recordToolRoundComplete() {
    withLock {
      _events.append(Self.event("messages_updated", ["message_count": _messageSequence.count + 1]))
    }
  }

  /// Record the final answer and the terminal `done` event.
  func recordDone(_ response: Any?) {
    withLock {
      _result = response
      _messageSequence.append(["role": "assistant", "content": Self.stringify(response)])
      _events.append(Self.event("done", ["response": response ?? ""]))
    }
  }

  /// Record cancellation: the canonical error label and the `cancelled` event.
  func recordCancelled(reason: String) {
    withLock {
      _error = "CancelledError"
      _events.append(Self.event("cancelled", ["reason": reason]))
    }
  }

  /// Record a guardrail denial (input or output): the label plus its reason.
  func recordGuardrailDenied(reason: String) {
    withLock {
      _error = "GuardrailError"
      _errorReason = reason
    }
  }

  /// Record a tool call naming a handler that was never registered.
  func recordToolNotRegistered(name: String) {
    withLock {
      _error = "Tool not registered: \(name)"
      _errorType = "ValueError"
    }
  }

  /// Record the iteration budget being exceeded.
  func recordMaxIterationsExceeded(_ maxIterations: Int) {
    withLock { _error = "Agent loop exceeded \(maxIterations) iterations" }
  }

  // MARK: - Canonical projection helpers

  /// Project a message to its wire dictionary (`role` + concatenated text).
  static func projectMessage(_ message: Message) -> [String: Any] {
    ["role": message.role.rawValue, "content": message.textContent]
  }

  /// The assistant turn that carries a round's tool calls, in wire shape.
  static func assistantToolCallsMessage(_ calls: [ToolCall]) -> [String: Any] {
    let toolCalls: [[String: Any]] = calls.map { call in
      [
        "id": call.id,
        "type": "function",
        "function": ["name": call.name, "arguments": call.arguments],
      ]
    }
    return ["role": "assistant", "content": "", "metadata": ["tool_calls": toolCalls]]
  }

  /// A tool-result message in wire shape.
  static func toolMessage(callId: String, content: String) -> [String: Any] {
    ["role": "tool", "content": content, "metadata": ["tool_call_id": callId]]
  }

  private static func event(_ type: String, _ data: [String: Any]) -> [String: Any] {
    ["type": type, "data": data]
  }

  private static func stringify(_ value: Any?) -> String {
    value as? String ?? ""
  }
}
