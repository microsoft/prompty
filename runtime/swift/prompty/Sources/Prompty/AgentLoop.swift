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
  public static func turn(
    _ agent: Agent,
    inputs: [String: Any] = [:],
    tools: [String: ToolHandler] = [:],
    maxIterations: Int = defaultMaxIterations,
    registry: Registry = .shared
  ) async throws -> Any? {
    registry.registerDefaults()

    var messages = try await prepare(agent, inputs: inputs, registry: registry)
    let executor = try registry.executor(for: agent.providerKind)
    let processor = try registry.processor(for: agent.providerKind)

    var iteration = 0
    while true {
      let response = try await executor.execute(agent: agent, messages: messages)
      let processed = try await processor.process(agent: agent, response: response)

      let calls = toolCalls(in: processed)
      if calls.isEmpty {
        return processed
      }

      iteration += 1
      if iteration > maxIterations {
        throw InvokerError.execution(
          "Agent loop exceeded \(maxIterations) iterations. "
            + "The model kept requesting tool calls without producing a final answer.")
      }

      var results: [String] = []
      results.reserveCapacity(calls.count)
      for call in calls {
        guard let handler = tools[call.name] else {
          throw InvokerError.execution("Tool not registered: \(call.name)")
        }
        let arguments = boundArguments(agent, call: call, inputs: inputs)
        results.append(try await handler.invoke(arguments))
      }

      let toolTurn = try executor.formatToolMessages(
        rawResponse: response,
        toolCalls: calls,
        toolResults: results,
        textContent: nil
      )
      messages.append(contentsOf: toolTurn)
    }
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
  registry: Registry = .shared
) async throws -> Any? {
  try await Pipeline.turn(
    agent, inputs: inputs, tools: tools, maxIterations: maxIterations, registry: registry)
}
