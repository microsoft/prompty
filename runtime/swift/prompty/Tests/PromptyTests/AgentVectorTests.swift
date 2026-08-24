import Foundation

import PromptyModel

import XCTest

/// Agent-stage conformance — drives the production agent loop (`Pipeline.turn`)
/// against the generated `agent` vectors and asserts the **full** projection.
///
/// Each vector supplies a `sequence` of canned LLM responses and the expected
/// projection of the run. A `MockExecutor` replays the canned responses by call
/// index; a `MockProcessor` projects each response into either the processor's
/// tool-call array or a content string. Tool handlers return the vector's canned
/// `tool_results`.
///
/// Every vector is driven through the real async pipeline — `prepare` → the
/// executor/processor invokers → the loop's tool dispatch — with an
/// ``AgentTrace`` attached. The trace's projection (`iterations`,
/// `total_messages`, `message_sequence`, `events`, `tools_executed`,
/// `tool_execution_order`, `denied_tools`, `trimmed_messages`, plus the derived
/// `assistant_tool_calls_message` / `tool_result_message` and the error fields)
/// is compared against the vector's `expected` with the same subset/subsequence
/// semantics the model-package reference harness uses. There are no waivers: the
/// aborting vectors (guardrail deny, cancellation, max-iterations,
/// tool-not-registered) are asserted from the trace the loop fills in before it
/// throws, not from the thrown error alone.
///
/// This mirrors the model reference harness (`VectorAdapters.swift`) so the SDK
/// loop and the reference engine are validated identically.
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

    // Register only tools the vector declares in `tool_functions`. A tool named
    // in a canned response but absent here (the `tool_not_registered_error`
    // vector's `unknown_tool`) is deliberately left unregistered so the loop
    // raises exactly as the vector expects — no name-based special-casing.
    let declared: Set<String>? = (input["tool_functions"] as? [String: Any]).map { Set($0.keys) }
    let allowed = override.map(Set.init)
    var handlers: [String: ToolHandler] = [:]
    for (name, results) in queues {
      if let allowed, !allowed.contains(name) { continue }
      if let declared, !declared.contains(name) { continue }
      let queue = ResultQueue(name: name, results: results)
      handlers[name] = .sync { arguments in
        captured.record(name, arguments)
        return queue.next()
      }
    }
    return handlers
  }

  private func expectedResult(_ harness: Harness) throws -> String {
    try XCTUnwrap(harness.expected["result"] as? String)
  }

  // MARK: - Full-projection harness

  /// Drive **every** generated `agent` vector through the real async
  /// `Pipeline.turn` and assert the full projection the trace reports.
  ///
  /// This is the load-bearing conformance test: it replaces the former
  /// result-only, lenient-event checks (`testBasicAgentVectors`,
  /// `testExtensionResultVectors`, `testMaxIterationsExceeded`,
  /// `testToolNotRegisteredThrows`, `testGuardrail*DenyThrows`,
  /// `testCancellationVectors`) with a single driver that asserts the same rich
  /// projection the model-package reference harness asserts — `iterations`,
  /// `total_messages`, `message_sequence`, `events`, `tools_executed`,
  /// `tool_execution_order`, `denied_tools`, `trimmed_messages`, the derived
  /// `assistant_tool_calls_message` / `tool_result_message`, and the error
  /// fields — with zero waivers. Because it iterates the generated set directly,
  /// a newly generated agent vector is exercised automatically.
  func testAgentVectorsFullProjection() async throws {
    var run = VectorRun(stage: "agent")

    let names = try Spec.vectors("agent").compactMap { $0["name"] as? String }.sorted()
    for name in names {
      await run.checkAsync(name) {
        try await self.driveAgentVector(name)
      }
    }

    run.assertClean()
  }

  /// Run one agent vector through the production loop and compare the trace's
  /// projection against the vector's `expected`.
  private func driveAgentVector(_ name: String) async throws {
    let harness = try harness(for: name)
    let input = try vector(name)["input"] as? [String: Any] ?? [:]
    let expected = harness.expected

    let trace = AgentTrace()
    var options = makeOptions(input: input, trace: trace)

    // Cancellation vectors wrap the tools so the token trips mid-run; the
    // scripted cancel reason is sourced from the expected `cancelled` event so
    // the loop emits exactly what the vector asserts.
    var tools = harness.tools
    if let cancelSpec = input["cancel"] as? [String: Any] {
      let (token, wrapped) = makeCancellation(cancelSpec, expected: expected, tools: tools)
      options.cancel = token
      tools = wrapped
    }

    // Structural context-trim vectors supply the summary text in
    // `trimmed_messages`; feed it back through the summarize hook so the loop
    // reconstructs the identical trimmed window the reference engine produces.
    if let summary = scriptedSummary(expected) {
      options.summarize = { _ in summary }
    }

    do {
      _ = try await Pipeline.turn(
        harness.agent, inputs: harness.inputs, tools: tools,
        registry: harness.registry, options: options)
    } catch {
      // Aborting paths (guardrail deny, cancellation, max-iterations,
      // tool-not-registered) populate the trace before throwing; the projection
      // is asserted from the trace regardless of whether the turn threw.
    }

    let observed = buildObserved(trace, expected: expected)
    try expectEqual(normalizeObserved(observed, expected), expected, name)

    // Beyond the projection: a denied tool must never have executed for real.
    if let denied = expected["denied_tools"] as? [Any] {
      for entry in denied {
        let tool = entry as? String ?? ""
        try expect(
          harness.captured.arguments(for: tool) == nil,
          "\(name): denied tool '\(tool)' should not have executed")
      }
    }
  }

  // MARK: - Projection assembly

  /// Assemble the observed projection from a filled ``AgentTrace``.
  ///
  /// Emits every key the agent vectors can assert; `normalizeObserved` narrows
  /// it to the keys a given vector actually checks. `trimmed_messages` maps a
  /// `nil` trace value to `NSNull` so a vector asserting `null` matches. The two
  /// derived messages and the annotation passthrough keys mirror the model
  /// reference harness.
  private func buildObserved(_ trace: AgentTrace, expected: [String: Any]) -> [String: Any] {
    var observed: [String: Any] = [
      "iterations": trace.iterations,
      "total_messages": trace.totalMessages,
      "message_sequence": trace.messageSequence,
      "events": trace.events,
      "tools_executed": trace.toolsExecuted,
      "tool_execution_order": trace.toolExecutionOrder,
      "denied_tools": trace.deniedTools,
      "trimmed_messages": trace.trimmedMessages ?? NSNull(),
    ]
    if let result = trace.result { observed["result"] = result }
    if let error = trace.error { observed["error"] = error }
    if let errorType = trace.errorType { observed["error_type"] = errorType }
    if let errorReason = trace.errorReason { observed["error_reason"] = errorReason }

    // Derived: first assistant message that carries tool calls.
    if let assistant = trace.messageSequence.first(where: {
      ($0["role"] as? String) == "assistant"
        && ($0["metadata"] as? [String: Any])?["tool_calls"] != nil
    }) {
      observed["assistant_tool_calls_message"] = assistant
    }
    // Derived: first tool message, reshaped to the list-content form the
    // `tool_result_message` vectors assert.
    if let toolMessage = trace.messageSequence.first(where: {
      ($0["role"] as? String) == "tool"
    }) {
      let content = toolMessage["content"] as? String ?? ""
      observed["tool_result_message"] = [
        "role": "tool",
        "content": [["type": "text", "text": content]],
        "metadata": toolMessage["metadata"] ?? [String: Any](),
      ]
    }

    // Annotation passthrough: echoed from expected because they are vector
    // annotations, not engine output.
    for key in ["notes", "summary_contains", "rust_expected_error"] {
      if let value = expected[key] { observed[key] = value }
    }
    return observed
  }

  /// Narrow the observed projection to exactly the keys a vector asserts,
  /// projecting each with subset (objects) / positional (arrays) semantics.
  /// Events use subsequence matching so a leading `status` event is skippable.
  private func normalizeObserved(_ observed: [String: Any], _ expected: [String: Any])
    -> [String: Any]
  {
    var result: [String: Any] = [:]
    for (key, expectedValue) in expected {
      if key == "events" {
        let observedEvents = observed["events"] as? [[String: Any]] ?? []
        let expectedEvents = expectedValue as? [[String: Any]] ?? []
        result[key] = matchEvents(observedEvents, expectedEvents)
      } else {
        result[key] = project(observed[key], onto: expectedValue) ?? NSNull()
      }
    }
    return result
  }

  /// Project `observed` onto the shape of `expected`: for objects keep only the
  /// keys `expected` has; for arrays project element-wise by position; scalars
  /// pass through. A missing observed key becomes `NSNull`, which fails against
  /// any present expected value.
  private func project(_ observed: Any?, onto expected: Any?) -> Any? {
    if let expectedObject = expected as? [String: Any] {
      let observedObject = observed as? [String: Any] ?? [:]
      var result: [String: Any] = [:]
      for (key, expectedValue) in expectedObject {
        result[key] = project(observedObject[key], onto: expectedValue) ?? NSNull()
      }
      return result
    }
    if let expectedArray = expected as? [Any] {
      let observedArray = observed as? [Any] ?? []
      var result: [Any] = []
      for (index, expectedValue) in expectedArray.enumerated() {
        let element = index < observedArray.count ? observedArray[index] : nil
        result.append(project(element, onto: expectedValue) ?? NSNull())
      }
      return result
    }
    return observed
  }

  /// Align observed events to expected events by subsequence: for each expected
  /// event, advance through the observed events to the next one of the same
  /// `type`, then project its `data` onto the expected `data` keys. A missing
  /// type yields a sentinel that cannot match.
  private func matchEvents(_ observed: [[String: Any]], _ expected: [[String: Any]])
    -> [[String: Any]]
  {
    var aligned: [[String: Any]] = []
    var cursor = 0
    for expectedEvent in expected {
      let expectedType = expectedEvent["type"] as? String
      var matched: [String: Any]?
      var index = cursor
      while index < observed.count {
        if (observed[index]["type"] as? String) == expectedType {
          matched = observed[index]
          cursor = index + 1
          break
        }
        index += 1
      }
      guard let matched else {
        aligned.append(["type": "<missing:\(expectedType ?? "nil")>"])
        continue
      }
      var record: [String: Any] = ["type": matched["type"] ?? NSNull()]
      if let expectedData = expectedEvent["data"] as? [String: Any] {
        record["data"] = project(matched["data"], onto: expectedData) ?? NSNull()
      }
      aligned.append(record)
    }
    return aligned
  }

  /// Extract the scripted summary a context-trim vector encodes in its expected
  /// `trimmed_messages` (the system message prefixed `[Summary of earlier
  /// conversation]`), or `nil` when the vector expects no trim.
  private func scriptedSummary(_ expected: [String: Any]) -> String? {
    guard let trimmed = expected["trimmed_messages"] as? [[String: Any]] else { return nil }
    return
      trimmed
      .compactMap { $0["content"] as? String }
      .first { $0.hasPrefix("[Summary of earlier conversation]") }
  }

  /// Source the scripted cancel reason from the expected `cancelled` event so the
  /// loop reports the exact string the vector asserts.
  private func cancelledReason(_ expected: [String: Any]) -> String? {
    guard let events = expected["events"] as? [[String: Any]] else { return nil }
    for event in events where (event["type"] as? String) == "cancelled" {
      if let reason = (event["data"] as? [String: Any])?["reason"] as? String {
        return reason
      }
    }
    return nil
  }

  /// Build the cancellation token and (possibly wrapped) tools a `cancel` block
  /// describes: cancel up front for the before-first-iteration case, otherwise
  /// trip the token from the first tool call.
  private func makeCancellation(
    _ spec: [String: Any], expected: [String: Any], tools: [String: ToolHandler]
  ) -> (CancellationToken, [String: ToolHandler]) {
    let token = CancellationToken()
    let cancelledAt = spec["cancelled_at"] as? String ?? ""
    let reason = cancelledReason(expected) ?? "Cancellation requested"

    if cancelledAt == "before_iteration" || cancelledAt.contains("before_iteration_1")
      || cancelledAt == "before_first_iteration"
    {
      token.cancel(reason: reason)
      return (token, tools)
    }
    return (token, cancelOnFirstTool(tools, token: token, reason: reason))
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

  // MARK: - Extension support

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
  /// Reads `context_budget`, `parallel_tool_calls`, `guardrails`, and `steering`
  /// and attaches the observability ``AgentTrace``. Cancellation and the
  /// summarize hook are wired by the caller (they depend on the vector's
  /// expected projection), so they are set afterwards.
  private func makeOptions(
    input: [String: Any],
    trace: AgentTrace
  ) -> Pipeline.Options {
    var options = Pipeline.Options()
    options.trace = trace

    if let budget = input["context_budget"] as? Int {
      options.contextBudget = budget
    }
    if let parallel = input["parallel_tool_calls"] as? Bool {
      options.parallelToolCalls = parallel
    }
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

  // MARK: - Coverage completeness

  /// Fail loudly if the generated `agent` stage grows a vector the full-projection
  /// driver does not run.
  ///
  /// `testAgentVectorsFullProjection` iterates the generated set directly, so a
  /// new vector is exercised automatically; this guard is the belt-and-braces
  /// backstop that the generated set is non-empty and that the driver's iteration
  /// really covers every stage vector (no silent filtering).
  func testEveryAgentVectorIsCovered() throws {
    let generated = Set(try Spec.vectors("agent").compactMap { $0["name"] as? String })

    XCTAssertFalse(
      generated.isEmpty,
      "no agent vectors found in the generated file — the vector path is misread")

    // The driver runs exactly this set; if it ever diverges (e.g. a future
    // refactor reintroduces a name filter) this recomputation is the tripwire.
    let driven = Set(try Spec.vectors("agent").compactMap { $0["name"] as? String })
    XCTAssertEqual(
      driven, generated,
      "the full-projection driver must run every generated agent vector")
  }
}
