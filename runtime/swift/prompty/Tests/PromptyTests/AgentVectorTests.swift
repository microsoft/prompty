import Foundation

import PromptyModel

import XCTest

/// Agent-stage conformance — drives the agent loop (`turn()`) against the
/// generated `agent` vectors.
///
/// Each vector supplies a `sequence` of canned LLM responses and the expected
/// final result (or error). A `MockExecutor` replays the canned responses by
/// call index; a `MockProcessor` projects each response into either the
/// processor's tool-call array or a content string. Tool handlers return the
/// vector's canned `tool_results`.
///
/// This mirrors the Rust reference harness (`tests/agent_vectors.rs`) so the
/// two runtimes are validated identically. The assertion contract matches the
/// Python reference: basic vectors assert only the final `result` (plus, for
/// bindings, the arguments the tool was invoked with); error vectors assert the
/// thrown message.
@testable import Prompty

final class AgentVectorTests: XCTestCase {

  // MARK: - Mock executor

  /// Replays canned LLM responses in order, ignoring the live messages.
  ///
  /// The loop's job under test is control flow, not prompt construction, so the
  /// executor answers purely from the vector's `sequence`.
  private final class MockExecutor: Executor {
    private let responses: [Any]
    private var index = 0

    init(responses: [Any]) {
      self.responses = responses
    }

    func execute(agent: Agent, messages: [Message]) async throws -> Any {
      defer { index += 1 }
      guard index < responses.count else {
        throw Prompty.InvokerError.execution(
          "MockExecutor: no more responses (requested index \(index))")
      }
      return responses[index]
    }

    /// Format the tool turn the loop appends between iterations.
    ///
    /// The mock executor ignores messages when replaying, so this only has to
    /// keep the conversation well-formed; the assistant tool-call metadata plus
    /// one `tool` message per result mirrors the OpenAI wire shape.
    func formatToolMessages(
      rawResponse: Any, toolCalls: [ToolCall], toolResults: [String], textContent: String?
    ) throws -> [Message] {
      var messages: [Message] = []

      let wireCalls: [Any] = toolCalls.map { call in
        [
          "id": call.id,
          "type": "function",
          "function": ["name": call.name, "arguments": call.arguments],
        ]
      }
      var assistant = Message.withText(.assistant, textContent ?? "")
      assistant.metadata = ["tool_calls": wireCalls]
      messages.append(assistant)

      for (call, result) in zip(toolCalls, toolResults) {
        messages.append(Message.toolResult(toolCallId: call.id, result: result))
      }
      return messages
    }
  }

  // MARK: - Mock processor

  /// Projects an OpenAI-style response into the loop's expected shape.
  ///
  /// A message carrying non-empty `tool_calls` becomes the `{ id, name,
  /// arguments }` array the pipeline reads tool calls from; otherwise the
  /// message content becomes the final string result.
  private struct MockProcessor: Processor {
    func process(agent: Agent, response: Any) async throws -> Any {
      guard let dict = response as? [String: Any],
        let choices = dict["choices"] as? [Any],
        let first = choices.first as? [String: Any],
        let message = first["message"] as? [String: Any]
      else {
        return ""
      }

      if let toolCalls = message["tool_calls"] as? [Any], !toolCalls.isEmpty {
        let calls: [Any] = toolCalls.compactMap { entry -> [String: Any]? in
          guard let call = entry as? [String: Any],
            let function = call["function"] as? [String: Any]
          else { return nil }
          return [
            "id": call["id"] as? String ?? "",
            "name": function["name"] as? String ?? "",
            "arguments": function["arguments"] as? String ?? "",
          ]
        }
        return calls
      }

      return message["content"] as? String ?? ""
    }
  }

  // MARK: - Harness

  /// One vector's worth of setup: a mock provider registered under a unique
  /// key, an agent whose instructions reproduce the input messages, and tool
  /// handlers backed by the vector's canned results.
  private struct Harness {
    let agent: Agent
    let tools: [String: ToolHandler]
    let registry: Registry
    let expected: [String: Any]
    let inputs: [String: Any]
    /// Arguments captured per tool name, for binding assertions.
    let captured: CapturedArguments
  }

  /// Thread-safe capture of the arguments each tool was invoked with.
  private final class CapturedArguments: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: [String: Any]] = [:]

    func record(_ name: String, _ arguments: [String: Any]) {
      lock.lock()
      defer { lock.unlock() }
      storage[name] = arguments
    }

    func arguments(for name: String) -> [String: Any]? {
      lock.lock()
      defer { lock.unlock() }
      return storage[name]
    }
  }

  /// Per-tool queue of canned results, popped in call order.
  private final class ResultQueue: @unchecked Sendable {
    private let lock = NSLock()
    private var results: [String]
    private var index = 0
    private let name: String

    init(name: String, results: [String]) {
      self.name = name
      self.results = results
    }

    func next() -> String {
      lock.lock()
      defer { lock.unlock() }
      defer { index += 1 }
      guard index < results.count else { return "(mock result #\(index) for \(name))" }
      return results[index]
    }
  }

  private func vector(_ name: String) throws -> [String: Any] {
    let all = try Spec.vectors("agent")
    guard let match = all.first(where: { ($0["name"] as? String) == name }) else {
      throw VectorFailure("agent vector '\(name)' not found")
    }
    return match
  }

  /// Build the harness for a named vector.
  ///
  /// `extraResponses` and `toolOverride` let error-case tests append a trailing
  /// response or restrict which tools are registered.
  private func harness(
    for name: String,
    extraResponses: [Any] = [],
    toolOverride: [String]? = nil
  ) throws -> Harness {
    let vector = try vector(name)
    let input = vector["input"] as? [String: Any] ?? [:]
    let sequence = vector["sequence"] as? [Any] ?? []
    let expected = vector["expected"] as? [String: Any] ?? [:]

    // A private registry keeps parallel vectors from colliding on provider key.
    let registry = Registry()
    registry.registerDefaults()
    let providerKey = "specmock_\(name)"

    var responses: [Any] = sequence.compactMap { step in
      (step as? [String: Any])?["llm_response"]
    }
    responses.append(contentsOf: extraResponses)

    registry.register(executor: MockExecutor(responses: responses), for: providerKey)
    registry.register(processor: MockProcessor(), for: providerKey)

    // Re-encode the input messages back into instructions, so `prepare`
    // reproduces them — matching the Rust reference harness.
    let messages = input["messages"] as? [Any] ?? []
    let instructionBlocks = messages.compactMap { entry -> String? in
      guard let message = entry as? [String: Any] else { return nil }
      let role = message["role"] as? String ?? "user"
      let content = message["content"] as? String ?? ""
      return "\(role):\n\(content)"
    }

    var data: [String: Any] = [
      "kind": "prompt",
      "name": "agent_test_\(name)",
      "model": ["id": "gpt-4", "provider": providerKey],
      "instructions": instructionBlocks.joined(separator: "\n\n"),
      "template": [
        "format": ["kind": "jinja2"],
        "parser": ["kind": "prompty"],
      ],
    ]
    if let tools = input["tools"] { data["tools"] = tools }
    let agent = try Agent.load(data)

    let inputs = input["parent_inputs"] as? [String: Any] ?? [:]
    let captured = CapturedArguments()
    let tools = buildToolHandlers(
      vector: vector, input: input, override: toolOverride, captured: captured)

    return Harness(
      agent: agent, tools: tools, registry: registry,
      expected: expected, inputs: inputs, captured: captured)
  }

  /// Build canned tool handlers keyed by tool name.
  ///
  /// Results across the whole sequence are queued per tool, mapped from each
  /// `tool_results` entry through the step's `expected_tool_calls` (id → name).
  /// Tools named only in `tool_functions` still get an empty queue so they are
  /// registered.
  private func buildToolHandlers(
    vector: [String: Any],
    input: [String: Any],
    override: [String]?,
    captured: CapturedArguments
  ) -> [String: ToolHandler] {
    var queues: [String: [String]] = [:]

    if let sequence = vector["sequence"] as? [Any] {
      for entry in sequence {
        guard let step = entry as? [String: Any] else { continue }
        let expectedCalls = step["expected_tool_calls"] as? [Any] ?? []
        let results = step["tool_results"] as? [Any] ?? []
        for resultEntry in results {
          guard let result = resultEntry as? [String: Any] else { continue }
          let callId = result["tool_call_id"] as? String ?? ""
          let text = result["result"] as? String ?? ""
          let name =
            expectedCalls.compactMap { $0 as? [String: Any] }
            .first(where: { ($0["id"] as? String) == callId })?["name"] as? String ?? "unknown"
          queues[name, default: []].append(text)
        }
      }
    }

    if let toolFunctions = input["tool_functions"] as? [String: Any] {
      for name in toolFunctions.keys where queues[name] == nil {
        queues[name] = []
      }
    }

    let allowed = override.map(Set.init)
    var handlers: [String: ToolHandler] = [:]
    for (name, results) in queues {
      if let allowed, !allowed.contains(name) { continue }
      let queue = ResultQueue(name: name, results: results)
      handlers[name] = .sync { arguments in
        captured.record(name, arguments)
        return queue.next()
      }
    }
    return handlers
  }

  private func runResult(_ name: String) async throws -> Any? {
    let harness = try harness(for: name)
    return try await Pipeline.turn(
      harness.agent, inputs: harness.inputs, tools: harness.tools, registry: harness.registry)
  }

  private func expectedResult(_ harness: Harness) throws -> String {
    try XCTUnwrap(harness.expected["result"] as? String)
  }

  // MARK: - Basic vectors

  func testBasicAgentVectors() async throws {
    var run = VectorRun(stage: "agent")
    let names = [
      "no_tool_calls",
      "single_tool_call",
      "multiple_tool_calls_single_turn",
      "multi_turn_tool_calls",
      "tool_result_message_format",
      "assistant_tool_calls_metadata",
      "empty_tool_result",
      "async_tool_function",
    ]

    for name in names {
      await run.checkAsync(name) {
        let harness = try self.harness(for: name)
        let result = try await Pipeline.turn(
          harness.agent, inputs: harness.inputs, tools: harness.tools,
          registry: harness.registry)
        let expected = try XCTUnwrap(harness.expected["result"] as? String)
        try expectEqual(result, expected, "result")
      }
    }

    run.assertClean()
  }

  func testAsyncToolFunctionUsesAsyncHandler() async throws {
    // async_tool_function's handler is defined async; drive it through the
    // async ToolHandler shape explicitly to prove that path executes.
    let harness = try harness(for: "async_tool_function")
    var tools = harness.tools
    tools["lookup"] = .async { _ in "found: test data" }

    let result = try await Pipeline.turn(
      harness.agent, inputs: harness.inputs, tools: tools, registry: harness.registry)
    try expectEqual(result, "I found: test data", "result")
  }

  // MARK: - Bindings

  func testBindingsInjectedIntoToolArguments() async throws {
    let harness = try harness(for: "bindings_injected")

    let result = try await Pipeline.turn(
      harness.agent, inputs: harness.inputs, tools: harness.tools, registry: harness.registry)
    try expectEqual(result, try expectedResult(harness), "result")

    // The binding must resolve `preferred_unit` from parent inputs and inject
    // it into the tool arguments, overriding whatever the model supplied.
    let step = try XCTUnwrap((try vector("bindings_injected")["sequence"] as? [Any])?.first)
    let expectedArgs = try XCTUnwrap(
      ((step as? [String: Any])?["expected_execution_args"] as? [String: Any])?["get_weather"]
        as? [String: Any])
    let actualArgs = try XCTUnwrap(harness.captured.arguments(for: "get_weather"))
    try expectEqual(actualArgs, expectedArgs, "get_weather execution args")
  }

  // MARK: - Error cases

  func testMaxIterationsExceeded() async throws {
    do {
      _ = try await runResult("max_iterations_exceeded")
      XCTFail("expected max_iterations_exceeded to throw")
    } catch let error as Prompty.InvokerError {
      let message = String(describing: error)
      XCTAssertTrue(
        message.contains("exceeded") && message.contains("iterations"),
        "expected an iteration-limit error, got: \(message)")
    }
  }

  func testToolNotRegisteredThrows() async throws {
    // Only get_weather is registered; the vector's response calls unknown_tool.
    let harness = try harness(for: "tool_not_registered_error", toolOverride: ["get_weather"])
    do {
      _ = try await Pipeline.turn(
        harness.agent, inputs: harness.inputs, tools: harness.tools,
        registry: harness.registry)
      XCTFail("expected tool_not_registered_error to throw")
    } catch let error as Prompty.InvokerError {
      let message = String(describing: error)
      XCTAssertTrue(
        message.contains("Tool not registered"),
        "expected a missing-tool error, got: \(message)")
    }
  }

  // MARK: - Extension support

  /// Thread-safe recorder for the events a vector's `on_event` sink emits.
  private final class EventRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [AgentEvent] = []

    func record(_ event: AgentEvent) {
      lock.lock()
      defer { lock.unlock() }
      events.append(event)
    }

    /// Event type strings in emission order.
    var types: [String] {
      lock.lock()
      defer { lock.unlock() }
      return events.map(\.type)
    }
  }

  /// A once-only latch: the first `trip()` returns true, all later ones false.
  private final class FirstCallLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var tripped = false

    func trip() -> Bool {
      lock.lock()
      defer { lock.unlock() }
      if tripped { return false }
      tripped = true
      return true
    }
  }

  /// Build the agent-loop options a vector's `input` extension keys describe.
  ///
  /// Reads `context_budget`, `guardrails`, `steering`, `parallel_tool_calls`,
  /// and wires the recorder when `on_event` is present. Cancellation is wired by
  /// the caller (it owns the token), so it is passed in.
  private func makeOptions(
    input: [String: Any],
    recorder: EventRecorder?,
    cancel: CancellationToken?
  ) -> Pipeline.Options {
    var options = Pipeline.Options()

    if let recorder {
      options.onEvent = { event in recorder.record(event) }
    }
    if let budget = input["context_budget"] as? Int {
      options.contextBudget = budget
    }
    if let parallel = input["parallel_tool_calls"] as? Bool {
      options.parallelToolCalls = parallel
    }
    options.cancel = cancel
    options.guardrails = makeGuardrails(input["guardrails"] as? [String: Any])
    options.steering = makeSteering(input["steering"] as? [String: Any])

    return options
  }

  /// Translate a vector's `guardrails` block into runtime guardrail closures.
  private func makeGuardrails(_ spec: [String: Any]?) -> Guardrails? {
    guard let spec else { return nil }
    var guardrails = Guardrails()

    if let input = spec["input"] as? [String: Any] {
      let deny = (input["action"] as? String) == "deny"
      let reason = input["reason"] as? String ?? "Input denied"
      guardrails.input = { _ in deny ? .deny(reason) : .allow() }
    }
    if let output = spec["output"] as? [String: Any] {
      let deny = (output["action"] as? String) == "deny"
      let reason = output["reason"] as? String ?? "Output denied"
      guardrails.output = { _ in deny ? .deny(reason) : .allow() }
    }
    if let tool = spec["tool"] as? [String: Any] {
      let denied = Set((tool["deny_tools"] as? [Any] ?? []).compactMap { $0 as? String })
      let reason = tool["reason"] as? String ?? "Tool denied"
      guardrails.tool = { name, _ in denied.contains(name) ? .deny(reason) : .allow() }
    }
    return guardrails
  }

  /// Translate a vector's `steering` block into a runtime steering queue.
  private func makeSteering(_ spec: [String: Any]?) -> Steering? {
    guard let spec, let messages = spec["messages"] as? [Any] else { return nil }
    let scheduled = messages.compactMap { entry -> SteeringMessage? in
      guard let message = entry as? [String: Any] else { return nil }
      return SteeringMessage(
        injectBeforeIteration: message["inject_before_iteration"] as? Int ?? 1,
        role: message["role"] as? String ?? "user",
        text: message["text"] as? String ?? "")
    }
    return Steering(scheduled)
  }

  /// Wrap every handler so the first tool call trips the shared latch, cancelling
  /// the token — the mechanism the `cancellation_between_*` vectors rely on.
  private func cancelOnFirstTool(
    _ tools: [String: ToolHandler],
    token: CancellationToken,
    reason: String
  ) -> [String: ToolHandler] {
    let latch = FirstCallLatch()
    var wrapped: [String: ToolHandler] = [:]
    for (name, handler) in tools {
      wrapped[name] = .async { arguments in
        let result = try await handler.invoke(arguments)
        if latch.trip() { token.cancel(reason: reason) }
        return result
      }
    }
    return wrapped
  }

  /// Assert the recorded events satisfy the vector's lenient event contract:
  /// every expected type (minus `status`) is present — with `tool_result` and
  /// `error` interchangeable — and a terminal `done`/`cancelled` event fired.
  private func assertEvents(_ recorder: EventRecorder, expected: [[String: Any]], _ label: String) {
    let actual = Set(recorder.types)
    let expectedTypes = Set(expected.compactMap { $0["type"] as? String }).subtracting(["status"])

    func satisfied(_ type: String) -> Bool {
      if actual.contains(type) { return true }
      if type == "error" && actual.contains("tool_result") { return true }
      if type == "tool_result" && actual.contains("error") { return true }
      return false
    }

    for type in expectedTypes {
      XCTAssertTrue(satisfied(type), "\(label): missing event '\(type)' in \(recorder.types)")
    }
    XCTAssertTrue(
      actual.contains("done") || actual.contains("cancelled"),
      "\(label): no terminal event in \(recorder.types)")
  }

  // MARK: - Extension vectors — result cases

  func testExtensionResultVectors() async throws {
    var run = VectorRun(stage: "agent")
    let names = [
      "context_trim_basic",
      "context_no_trim_when_fits",
      "context_preserves_system_messages",
      "guardrail_tool_deny",
      "guardrail_all_pass",
      "steering_inject_message",
      "steering_multiple_messages",
      "parallel_tools_basic",
      "parallel_tools_with_guardrail_deny",
      "events_basic_tool_loop",
      "events_no_tools",
      "events_error_logged",
    ]

    for name in names {
      await run.checkAsync(name) {
        let harness = try self.harness(for: name)
        let input = try self.vector(name)["input"] as? [String: Any] ?? [:]
        let hasEvents = input["on_event"] != nil
        let recorder = hasEvents ? EventRecorder() : nil
        let options = self.makeOptions(input: input, recorder: recorder, cancel: nil)

        let result = try await Pipeline.turn(
          harness.agent, inputs: harness.inputs, tools: harness.tools,
          registry: harness.registry, options: options)

        let expected = try XCTUnwrap(harness.expected["result"] as? String)
        try expectEqual(result, expected, "result")

        // Denied tools must never have executed.
        if let denied = harness.expected["denied_tools"] as? [Any] {
          for entry in denied {
            let tool = entry as? String ?? ""
            XCTAssertNil(
              harness.captured.arguments(for: tool),
              "\(name): denied tool '\(tool)' should not have executed")
          }
        }
        // Named tools must have executed, in any order.
        if let order = harness.expected["tool_execution_order"] as? [Any] {
          for entry in order {
            let tool = entry as? String ?? ""
            XCTAssertNotNil(
              harness.captured.arguments(for: tool),
              "\(name): tool '\(tool)' should have executed")
          }
        }
        if let recorder, let events = harness.expected["events"] as? [[String: Any]] {
          self.assertEvents(recorder, expected: events, name)
        }
      }
    }

    run.assertClean()
  }

  // MARK: - Extension vectors — guardrail error cases

  func testGuardrailInputDenyThrows() async throws {
    let harness = try harness(for: "guardrail_input_deny")
    let input = try vector("guardrail_input_deny")["input"] as? [String: Any] ?? [:]
    let options = makeOptions(input: input, recorder: nil, cancel: nil)
    do {
      _ = try await Pipeline.turn(
        harness.agent, inputs: harness.inputs, tools: harness.tools,
        registry: harness.registry, options: options)
      XCTFail("expected guardrail_input_deny to throw")
    } catch let error as GuardrailError {
      let reason = try XCTUnwrap(harness.expected["error_reason"] as? String)
      XCTAssertTrue(
        error.description.contains(reason),
        "expected reason '\(reason)', got: \(error.description)")
    }
  }

  func testGuardrailOutputDenyThrows() async throws {
    let harness = try harness(for: "guardrail_output_deny")
    let input = try vector("guardrail_output_deny")["input"] as? [String: Any] ?? [:]
    let options = makeOptions(input: input, recorder: nil, cancel: nil)
    do {
      _ = try await Pipeline.turn(
        harness.agent, inputs: harness.inputs, tools: harness.tools,
        registry: harness.registry, options: options)
      XCTFail("expected guardrail_output_deny to throw")
    } catch let error as GuardrailError {
      let reason = try XCTUnwrap(harness.expected["error_reason"] as? String)
      XCTAssertTrue(
        error.description.contains(reason),
        "expected reason '\(reason)', got: \(error.description)")
    }
  }

  // MARK: - Extension vectors — cancellation cases

  func testCancellationVectors() async throws {
    // before_llm cancels up front; the between_* vectors trip the token from the
    // first tool call and rely on the loop's cancel checks to stop the turn.
    for name in ["cancellation_before_llm", "cancellation_between_iterations", "cancellation_between_tools"] {
      let harness = try harness(for: name)
      let input = try vector(name)["input"] as? [String: Any] ?? [:]
      let cancelSpec = input["cancel"] as? [String: Any] ?? [:]
      let cancelledAt = cancelSpec["cancelled_at"] as? String ?? ""

      let token = CancellationToken()
      var tools = harness.tools
      if cancelledAt == "before_first_iteration" || cancelledAt.contains("before_iteration_1")
        || name == "cancellation_before_llm"
      {
        token.cancel(reason: "Cancellation requested before first iteration")
      } else {
        tools = cancelOnFirstTool(tools, token: token, reason: "Cancellation requested after \(cancelledAt)")
      }

      let recorder = EventRecorder()
      let options = makeOptions(input: input, recorder: recorder, cancel: token)

      do {
        _ = try await Pipeline.turn(
          harness.agent, inputs: harness.inputs, tools: tools,
          registry: harness.registry, options: options)
        XCTFail("\(name): expected cancellation to throw")
      } catch is CancelledError {
        if let events = harness.expected["events"] as? [[String: Any]] {
          assertEvents(recorder, expected: events, name)
        }
      }
    }
  }
}
