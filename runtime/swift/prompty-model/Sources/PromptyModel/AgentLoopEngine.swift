/// Provider-agnostic agent loop — the canonical ``TurnConformance.run`` engine.
///
/// This is the Swift counterpart of Python's ``prompty.core.agent_loop`` and the
/// Rust ``prompty::engine::agent_loop``. It owns the *observable* agent-loop
/// contract asserted by the cross-runtime `@vector` suite
/// (`schema/model/conformance/vectors/agent.tsp`, stage `agent`). It is
/// deliberately provider-agnostic: the loop is driven by two callbacks —
/// `invokeModel(conversation) -> ModelResponse` and `dispatchTool(call) -> String`
/// — so the same engine backs every provider. Providers supply only the wire
/// translation that turns a raw response into an ``AgentModelResponse``; they
/// never re-implement the loop, its accounting, or its event vocabulary.
///
/// Observable contract (verified against all 28 `run` vectors):
/// * `iterations` counts LLM calls (not tool rounds).
/// * `totalMessages` = `conversation.count + (anyToolRound ? 1 : 0)`.
/// * `messagesUpdated.message_count` = `conversation.count + 1` at emit time.
/// * Events fire in a fixed order: `status` → `tool_call_start` → `tool_result`
///   → `messages_updated` → optional steering `status`/`messages_updated` →
///   `done`; `cancelled` replaces the tail on a cancellation.
import Foundation

public enum AgentLoopEngine {
  /// The default ceiling on agent-loop iterations.
  public static let defaultMaxIterations = 10
  /// Prefix used by the scripted compaction summary system message.
  public static let summaryPrefix = "[Summary of earlier conversation] "

  static let cancelledError = "CancelledError"
  static let guardrailError = "GuardrailError"

  /// A single tool invocation requested by the model.
  public struct ToolCall {
    public let id: String
    public let name: String
    /// Raw JSON string exactly as the model emitted it.
    public let arguments: String

    public init(id: String, name: String, arguments: String) {
      self.id = id
      self.name = name
      self.arguments = arguments
    }
  }

  /// A normalized single-turn model response.
  ///
  /// `rawToolCalls` carries the provider's exact tool-call array so the
  /// assistant message's `metadata.tool_calls` round-trips byte-for-byte; when
  /// omitted the engine reconstructs it from ``ToolCall`` fields.
  public struct ModelResponse {
    public let content: String?
    public let toolCalls: [ToolCall]
    public let rawToolCalls: [[String: Any]]?

    public init(
      content: String? = nil, toolCalls: [ToolCall] = [], rawToolCalls: [[String: Any]]? = nil
    ) {
      self.content = content
      self.toolCalls = toolCalls
      self.rawToolCalls = rawToolCalls
    }
  }

  /// Outcome of a guardrail check.
  public struct GuardrailDecision {
    public let allowed: Bool
    public let reason: String?

    public init(allowed: Bool, reason: String? = nil) {
      self.allowed = allowed
      self.reason = reason
    }
  }

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

  /// The observable result of an agent-loop run.
  public struct Result {
    public var result: String?
    public var iterations = 0
    public var conversation: [[String: Any]] = []
    public var events: [[String: Any]] = []
    public var toolRounds = 0
    public var toolsExecuted = 0
    public var toolExecutionOrder: [String] = []
    public var deniedTools: [String] = []
    public var trimmedMessages: [[String: Any]]?
    public var error: String?
    public var errorType: String?
    public var errorReason: String?

    /// Conversation length plus the conformance `+1` when tools ran.
    public var totalMessages: Int { conversation.count + (toolRounds > 0 ? 1 : 0) }
  }

  // MARK: - Message helpers

  static func assistantToolCallsMessage(_ response: ModelResponse) -> [String: Any] {
    let toolCalls: [[String: Any]]
    if let raw = response.rawToolCalls {
      toolCalls = raw
    } else {
      toolCalls = response.toolCalls.map { tc in
        [
          "id": tc.id, "type": "function",
          "function": ["name": tc.name, "arguments": tc.arguments],
        ]
      }
    }
    return ["role": "assistant", "content": "", "metadata": ["tool_calls": toolCalls]]
  }

  static func toolMessage(_ callId: String, _ content: String) -> [String: Any] {
    ["role": "tool", "content": content, "metadata": ["tool_call_id": callId]]
  }

  static func charCount(_ messages: [[String: Any]]) -> Int {
    messages.reduce(0) { total, message in
      if let content = message["content"] as? String { return total + content.count }
      return total
    }
  }

  static func parseArgs(_ arguments: String) -> [String: Any] {
    guard !arguments.isEmpty, let data = arguments.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    return parsed
  }

  static func defaultSummary(_ droppedUsers: [[String: Any]]) -> String {
    let topics = droppedUsers.compactMap { m -> String? in
      guard let content = m["content"] as? String else { return nil }
      let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
    return summaryPrefix + "User asked about " + topics.joined(separator: "; ")
  }

  static func maybeTrim(
    _ conversation: [[String: Any]], contextBudget: Int?, summarize: (([[String: Any]]) -> String)?
  ) -> [[String: Any]]? {
    guard let budget = contextBudget, charCount(conversation) > budget else { return nil }

    let systems = conversation.filter { ($0["role"] as? String) == "system" }
    let users = conversation.filter { ($0["role"] as? String) == "user" }
    let droppedUsers = users.isEmpty ? [] : Array(users.dropLast())
    let lastUser = users.last

    let summaryText = summarize?(droppedUsers) ?? defaultSummary(droppedUsers)
    var trimmed = systems
    trimmed.append(["role": "system", "content": summaryText])
    if let lastUser { trimmed.append(["role": "user", "content": lastUser["content"] ?? ""]) }
    return trimmed
  }

  // MARK: - Loop

  /// Run the canonical agent loop and return its observable result.
  ///
  /// Parameters mirror the `run` vector inputs. `cancelAt` accepts the scripted
  /// positions `"before_iteration"`, `"before_iteration_<n>"`, and
  /// `"after_tool_<i>"`. The loop is deterministic.
  public static func run(
    messages: [[String: Any]],
    invokeModel: ([[String: Any]]) -> ModelResponse,
    dispatchTool: (ToolCall) -> String,
    isToolRegistered: ((String) -> Bool)? = nil,
    maxIterations: Int = defaultMaxIterations,
    inputGuardrail: (([[String: Any]]) -> GuardrailDecision)? = nil,
    outputGuardrail: ((ModelResponse) -> GuardrailDecision)? = nil,
    toolGuardrail: ((String, [String: Any]) -> GuardrailDecision)? = nil,
    steering: [SteeringMessage] = [],
    cancelAt: String? = nil,
    contextBudget: Int? = nil,
    summarize: (([[String: Any]]) -> String)? = nil
  ) -> Result {
    var result = Result()
    var conversation = messages

    func emit(_ type: String, _ data: [String: Any]) {
      result.events.append(["type": type, "data": data])
    }

    emit("status", ["message": "Starting agent loop"])

    if let trimmed = maybeTrim(conversation, contextBudget: contextBudget, summarize: summarize) {
      conversation = trimmed
      result.trimmedMessages = trimmed
    }

    var steeringPending = steering
    let registered = isToolRegistered ?? { _ in true }

    while true {
      let iterationNumber = result.iterations + 1

      if cancelAt == "before_iteration", iterationNumber == 1 {
        emit("cancelled", ["reason": "Cancellation requested before first iteration"])
        result.error = cancelledError
        result.conversation = conversation
        return result
      }
      if cancelAt == "before_iteration_\(iterationNumber)" {
        emit("cancelled", ["reason": "Cancellation requested before iteration \(iterationNumber)"])
        result.error = cancelledError
        result.conversation = conversation
        return result
      }

      let toInject = steeringPending.filter { $0.injectBeforeIteration == iterationNumber }
      if !toInject.isEmpty {
        steeringPending.removeAll { $0.injectBeforeIteration == iterationNumber }
        emit("status", ["message": "Injecting steering message"])
        for s in toInject { conversation.append(["role": s.role, "content": s.text]) }
        emit("messages_updated", ["message_count": conversation.count + 1])
      }

      if let inputGuardrail {
        let decision = inputGuardrail(conversation)
        if !decision.allowed {
          result.error = guardrailError
          result.errorReason = decision.reason
          result.conversation = conversation
          return result
        }
      }

      let response = invokeModel(conversation)
      result.iterations += 1

      if let outputGuardrail {
        let decision = outputGuardrail(response)
        if !decision.allowed {
          result.error = guardrailError
          result.errorReason = decision.reason
          result.conversation = conversation
          return result
        }
      }

      if !response.toolCalls.isEmpty {
        conversation.append(assistantToolCallsMessage(response))
        result.toolRounds += 1
        var cancelled = false

        for (idx, call) in response.toolCalls.enumerated() {
          emit("tool_call_start", ["name": call.name, "arguments": call.arguments])

          if let toolGuardrail {
            let decision = toolGuardrail(call.name, parseArgs(call.arguments))
            if !decision.allowed {
              result.deniedTools.append(call.name)
              let denial = "Tool denied by guardrail: \(decision.reason ?? "")"
              conversation.append(toolMessage(call.id, denial))
              continue
            }
          }

          if !registered(call.name) {
            result.error = "Tool not registered: \(call.name)"
            result.errorType = "ValueError"
            result.conversation = conversation
            return result
          }

          let output = dispatchTool(call)
          result.toolsExecuted += 1
          result.toolExecutionOrder.append(call.name)
          emit("tool_result", ["name": call.name, "result": output])
          conversation.append(toolMessage(call.id, output))

          if cancelAt == "after_tool_\(idx)" {
            emit("cancelled", ["reason": "Cancellation requested after tool execution"])
            result.error = cancelledError
            cancelled = true
            break
          }
        }

        if cancelled {
          result.conversation = conversation
          return result
        }

        emit("messages_updated", ["message_count": conversation.count + 1])

        if result.iterations > maxIterations {
          result.error = "Agent loop exceeded \(maxIterations) iterations"
          result.conversation = conversation
          return result
        }
        continue
      }

      result.result = response.content
      conversation.append(["role": "assistant", "content": response.content ?? ""])
      emit("done", ["response": response.content ?? NSNull()])
      result.conversation = conversation
      return result
    }
  }
}
