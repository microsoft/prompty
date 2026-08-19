import Foundation

/// The agent loop — the `agent` stage of the spec (`turn()`).
///
/// `run` answers a single provider round trip. An agent instead runs a loop:
/// call the model, and while it keeps asking for tools, execute those tools,
/// append the results, and call again — stopping when the model answers with
/// content or the iteration budget is exhausted.
///
/// This mirrors the reference agent loop the cross-runtime `agent` vectors are
/// written against. Behavioural parity here means Swift matches Python and
/// TypeScript, which implement this stage; the durable `turn`-stage journal
/// engine remains Rust-only and is intentionally out of scope.
import PromptyModel

/// A tool the agent loop can dispatch to.
///
/// Both shapes take the tool call's decoded, binding-injected arguments and
/// return the string the model sees as the tool result. `sync` covers the
/// common case; `async` lets a handler await I/O without blocking the loop.
public enum ToolHandler {
  case sync(([String: Any]) throws -> String)
  case async(([String: Any]) async throws -> String)

  /// Invoke the handler, awaiting the async form.
  func invoke(_ arguments: [String: Any]) async throws -> String {
    switch self {
    case .sync(let body):
      return try body(arguments)
    case .async(let body):
      return try await body(arguments)
    }
  }
}

/// The default ceiling on agent-loop iterations.
///
/// A model that keeps requesting tools without ever answering would loop
/// forever; this bounds that. It matches the reference runtimes' default of 10.
public let defaultMaxIterations = 10

extension Pipeline {

  /// Run the agent loop for a loaded prompt.
  ///
  /// The prompt's `instructions` seed the conversation through ``prepare``.
  /// Each iteration executes the model, projects its response through the
  /// processor, and — when the model requested tools — runs the matching
  /// handlers, injects any bound arguments (spec §9.6), appends the assistant
  /// tool-call turn plus one message per result, and calls the model again.
  ///
  /// The loop ends when the model answers with content, returning that content.
  /// It throws when the model names a tool with no registered handler, or when
  /// the iteration budget is exceeded.
  ///
  /// The raw processor output is used directly rather than routing through
  /// ``process(_:response:registry:)``: the loop needs the processor's tool-call
  /// projection, and the structured-output wrap `process` applies is a final
  /// step that would obscure it.
  /// Optional agent-loop hooks (spec extension stages).
  ///
  /// Every field is off by default, so the basic loop is unaffected. When set,
  /// they layer in — in the exact order the reference loop applies them —
  /// steering injection, context trimming, guardrails, cancellation, and event
  /// emission. See ``AgentExtensions``.
  public struct Options {
    public var onEvent: EventCallback?
    public var cancel: CancellationToken?
    public var contextBudget: Int?
    public var guardrails: Guardrails?
    public var steering: Steering?
    /// Accepted for parity with providers that flag concurrent tool calls; the
    /// loop always executes a turn's calls in order, which matches the reference
    /// result vectors. It never rejects `true`.
    public var parallelToolCalls: Bool

    public init(
      onEvent: EventCallback? = nil,
      cancel: CancellationToken? = nil,
      contextBudget: Int? = nil,
      guardrails: Guardrails? = nil,
      steering: Steering? = nil,
      parallelToolCalls: Bool = false
    ) {
      self.onEvent = onEvent
      self.cancel = cancel
      self.contextBudget = contextBudget
      self.guardrails = guardrails
      self.steering = steering
      self.parallelToolCalls = parallelToolCalls
    }
  }

  public static func turn(
    _ agent: Agent,
    inputs: [String: Any] = [:],
    tools: [String: ToolHandler] = [:],
    maxIterations: Int = defaultMaxIterations,
    registry: Registry = .shared,
    options: Options = Options()
  ) async throws -> Any? {
    registry.registerDefaults()

    var messages = try await prepare(agent, inputs: inputs, registry: registry)
    let executor = try registry.executor(for: agent.providerKind)
    let processor = try registry.processor(for: agent.providerKind)

    let emit: (AgentEvent) -> Void = { options.onEvent?($0) }

    func checkCancel() throws {
      guard let cancel = options.cancel, cancel.isCancelled else { return }
      let reason = cancel.reason ?? "Cancellation requested"
      emit(.cancelled(reason: reason))
      throw CancelledError(reason: reason)
    }

    emit(.status(message: "Starting agent loop"))

    var iteration = 0
    while true {
      iteration += 1

      // 1. Cancellation — checked before any model work this iteration.
      try checkCancel()

      // 2. Steering — inject any messages scheduled for this iteration.
      if let steering = options.steering {
        let due = steering.drain(iteration: iteration)
        if !due.isEmpty {
          for message in due {
            messages.append(Message.withText(Role.parseOptional(message.role) ?? .user, message.text))
          }
          emit(.status(message: "Injecting steering message"))
          emit(.messagesUpdated(count: messages.count))
        }
      }

      // 3. Context budget — best-effort trim (never alters the vector result,
      // which the mock executor drives by call index, so this stays a no-op on
      // the conformance path while remaining a real hook for live use).
      if let budget = options.contextBudget {
        messages = trimToContextBudget(messages, budget: budget)
      }

      // 4. Input guardrail — a deny aborts the turn.
      if let check = options.guardrails?.input {
        let verdict = check(messages)
        if !verdict.allowed {
          emit(.error(message: verdict.reason))
          throw GuardrailError(reason: verdict.reason)
        }
      }

      let response = try await executor.execute(agent: agent, messages: messages)
      let processed = try await processor.process(agent: agent, response: response)

      let calls = toolCalls(in: processed)
      if calls.isEmpty {
        // 5. Output guardrail — checked on the final answer.
        if let check = options.guardrails?.output, let text = processed as? String {
          let verdict = check(text)
          if !verdict.allowed {
            emit(.error(message: verdict.reason))
            throw GuardrailError(reason: verdict.reason)
          }
        }
        emit(.done(response: processed))
        return processed
      }

      if iteration > maxIterations {
        throw InvokerError.execution(
          "Agent loop exceeded \(maxIterations) iterations. "
            + "The model kept requesting tool calls without producing a final answer.")
      }

      var results: [String] = []
      results.reserveCapacity(calls.count)
      for (index, call) in calls.enumerated() {
        // Cancellation between tools — before dispatching a *subsequent* call,
        // so a token tripped by one tool stops the rest of the turn.
        if index > 0 {
          try checkCancel()
        }

        let arguments = boundArguments(agent, call: call, inputs: inputs)
        emit(.toolCallStart(name: call.name, arguments: call.arguments))

        // Tool guardrail — a deny skips execution and substitutes a denial.
        if let check = options.guardrails?.tool {
          let verdict = check(call.name, arguments)
          if !verdict.allowed {
            let denial = "Tool '\(call.name)' denied by guardrail: \(verdict.reason)"
            results.append(denial)
            emit(.toolResult(name: call.name, result: denial))
            continue
          }
        }

        guard let handler = tools[call.name] else {
          throw InvokerError.execution("Tool not registered: \(call.name)")
        }

        let result: String
        do {
          result = try await handler.invoke(arguments)
        } catch {
          // A tool that throws is logged as an error result and the loop
          // continues, matching the reference dispatcher.
          result = "Error calling '\(call.name)': \(error)"
        }
        results.append(result)
        emit(.toolResult(name: call.name, result: result))
      }

      let toolTurn = try executor.formatToolMessages(
        rawResponse: response,
        toolCalls: calls,
        toolResults: results,
        textContent: nil
      )
      messages.append(contentsOf: toolTurn)
      emit(.messagesUpdated(count: messages.count))
    }
  }

  /// Trim the conversation toward a token budget, preserving system messages.
  ///
  /// Best-effort and intentionally conservative: it estimates tokens at four
  /// characters each and drops the oldest non-system messages until the estimate
  /// fits. The reference contract asserts only the final result (not the trimmed
  /// window), so this never needs to be exact — it just must not corrupt the
  /// conversation.
  static func trimToContextBudget(_ messages: [Message], budget: Int) -> [Message] {
    func estimate(_ message: Message) -> Int { max(1, message.textContent.count / 4) }

    var total = messages.reduce(0) { $0 + estimate($1) }
    guard total > budget else { return messages }

    var trimmed = messages
    while total > budget, trimmed.count > 1,
      let dropIndex = trimmed.firstIndex(where: { $0.role != .system })
    {
      total -= estimate(trimmed[dropIndex])
      trimmed.remove(at: dropIndex)
    }
    return trimmed
  }
}

/// Run the agent loop for a loaded prompt.
///
/// Free-function alias for ``Pipeline/turn(_:inputs:tools:maxIterations:registry:)``.
public func turn(
  _ agent: Agent,
  inputs: [String: Any] = [:],
  tools: [String: ToolHandler] = [:],
  maxIterations: Int = defaultMaxIterations,
  registry: Registry = .shared,
  options: Pipeline.Options = Pipeline.Options()
) async throws -> Any? {
  try await Pipeline.turn(
    agent, inputs: inputs, tools: tools, maxIterations: maxIterations, registry: registry,
    options: options)
}
