import Foundation

/// Agent-loop extensions — cancellation, guardrails, steering, and events.
///
/// These mirror the extension hooks the cross-runtime `agent` vectors exercise
/// (`context_*`, `guardrail_*`, `steering_*`, `parallel_*`, `events_*`,
/// `cancellation_*`). They are the same behaviours Python and TypeScript layer
/// onto their agent loops; Swift matches that lenient contract rather than the
/// stricter durable-`turn` engine, which stays Rust-only.
import PromptyModel

// MARK: - Cancellation

/// A cooperative cancellation signal for the agent loop.
///
/// The loop checks ``isCancelled`` at the top of every iteration and between
/// tools; when set, it emits a `cancelled` event and throws ``CancelledError``.
/// Thread-safe so a tool handler can cancel mid-turn.
public final class CancellationToken: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  private var storedReason: String?

  public init() {}

  /// Request cancellation, optionally recording why.
  public func cancel(reason: String? = nil) {
    lock.lock()
    defer { lock.unlock() }
    cancelled = true
    if let reason { storedReason = reason }
  }

  /// Whether cancellation has been requested.
  public var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  /// The reason recorded at cancellation, if any.
  public var reason: String? {
    lock.lock()
    defer { lock.unlock() }
    return storedReason
  }
}

/// Thrown by the agent loop when a ``CancellationToken`` is tripped.
public struct CancelledError: Error, CustomStringConvertible {
  public let reason: String

  public init(reason: String = "Cancelled") {
    self.reason = reason
  }

  public var description: String { "CancelledError: \(reason)" }
}

// MARK: - Guardrails

/// The verdict a guardrail returns for a given check.
public struct GuardrailResult {
  public let allowed: Bool
  public let reason: String

  public init(allowed: Bool, reason: String = "") {
    self.allowed = allowed
    self.reason = reason
  }

  /// Allow the checked action to proceed.
  public static func allow() -> GuardrailResult { GuardrailResult(allowed: true) }

  /// Deny the checked action, recording why.
  public static func deny(_ reason: String) -> GuardrailResult {
    GuardrailResult(allowed: false, reason: reason)
  }
}

/// The three guardrail hooks the agent loop consults.
///
/// - `input` runs on the conversation before each model call; a deny aborts the
///   turn with a ``GuardrailError``.
/// - `output` runs on the model's final text; a deny aborts with ``GuardrailError``.
/// - `tool` runs on each tool call before execution; a deny skips execution and
///   substitutes a denial string as the tool result, letting the loop continue.
public struct Guardrails {
  public var input: (([Message]) -> GuardrailResult)?
  public var output: ((String) -> GuardrailResult)?
  public var tool: ((String, [String: Any]) -> GuardrailResult)?

  public init(
    input: (([Message]) -> GuardrailResult)? = nil,
    output: ((String) -> GuardrailResult)? = nil,
    tool: ((String, [String: Any]) -> GuardrailResult)? = nil
  ) {
    self.input = input
    self.output = output
    self.tool = tool
  }
}

/// Thrown when an input or output guardrail denies the turn.
public struct GuardrailError: Error, CustomStringConvertible {
  public let reason: String

  public init(reason: String) {
    self.reason = reason
  }

  public var description: String { "GuardrailError: \(reason)" }
}

// MARK: - Steering

/// A steering message scheduled for injection before a given iteration.
public struct SteeringMessage {
  public let injectBeforeIteration: Int
  public let role: String
  public let text: String

  public init(injectBeforeIteration: Int, role: String, text: String) {
    self.injectBeforeIteration = injectBeforeIteration
    self.role = role
    self.text = text
  }
}

/// A queue of steering messages injected into a running agent loop.
///
/// At the top of iteration *n* the loop drains every message scheduled for
/// `injectBeforeIteration == n`, appends them to the conversation, and emits a
/// `messages_updated` event. Thread-safe so messages can be enqueued mid-turn.
public final class Steering: @unchecked Sendable {
  private let lock = NSLock()
  private var pending: [SteeringMessage]

  public init(_ messages: [SteeringMessage] = []) {
    self.pending = messages
  }

  /// Enqueue a steering message.
  public func send(_ message: SteeringMessage) {
    lock.lock()
    defer { lock.unlock() }
    pending.append(message)
  }

  /// Remove and return the messages scheduled for the given iteration.
  public func drain(iteration: Int) -> [SteeringMessage] {
    lock.lock()
    defer { lock.unlock() }
    let due = pending.filter { $0.injectBeforeIteration == iteration }
    pending.removeAll { $0.injectBeforeIteration == iteration }
    return due
  }
}

// MARK: - Events

/// A lifecycle event emitted by the agent loop.
///
/// Consumers observe progress without steering it. `status` frames the loop;
/// `toolCallStart`/`toolResult` bracket each tool; `messagesUpdated` fires when
/// the conversation grows; the loop ends with exactly one terminal event —
/// `done`, `cancelled`, or (for a fatal error) `error`.
public enum AgentEvent {
  case status(message: String)
  case toolCallStart(name: String, arguments: String)
  case toolResult(name: String, result: String)
  case messagesUpdated(count: Int)
  case done(response: Any?)
  case cancelled(reason: String)
  case error(message: String)

  /// The wire type string, matching the cross-runtime event vectors.
  public var type: String {
    switch self {
    case .status: return "status"
    case .toolCallStart: return "tool_call_start"
    case .toolResult: return "tool_result"
    case .messagesUpdated: return "messages_updated"
    case .done: return "done"
    case .cancelled: return "cancelled"
    case .error: return "error"
    }
  }
}

/// A sink the agent loop pushes ``AgentEvent`` values to.
public typealias EventCallback = @Sendable (AgentEvent) -> Void
