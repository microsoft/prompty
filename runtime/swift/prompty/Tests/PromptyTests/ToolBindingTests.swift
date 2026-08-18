import Foundation

import PromptyModel

import XCTest

/// Tool binding conformance — the *executable* half of the bindings contract.
///
/// Bindings are two coupled rules, and testing either alone proves nothing:
///
///   §2.9.1.1  bound parameters are **stripped** from the schema sent to the model
///   §2.9.1.2  bound parameters are **injected** into the arguments before the tool runs
///   §2.9.1.3  an injected value **overrides** whatever the model produced
///
/// Strip-without-inject silently drops an argument: the model never sees the
/// parameter, so it never supplies one, and the tool is invoked short. These
/// tests pin both halves together, and pin the load side against both declared
/// binding shapes, so a regression in either surfaces here rather than at a
/// provider call.
///
/// The injection cases mirror `spec/vectors/agent/agent_vectors.json`
/// (`bindings_injected`) and the reference implementation in
/// `runtime/rust/prompty/src/tool_dispatch.rs::resolve_bindings`.
@testable import Prompty

final class ToolBindingTests: XCTestCase {

  // MARK: - Fixtures

  /// The canonical `bindings_injected` tool: one bound parameter (`unit`) fed
  /// from a parent input (`preferred_unit`), one free parameter (`city`).
  private func weatherAgent(
    bindings: Any = ["unit": ["input": "preferred_unit"]]
  ) throws -> Agent {
    try Agent.load([
      "kind": "prompt",
      "name": "weather",
      "model": ["id": "gpt-4o-mini", "apiType": "chat"],
      "tools": [
        [
          "name": "get_weather",
          "kind": "function",
          "description": "Get the current weather for a city",
          "parameters": [
            ["name": "city", "kind": "string", "required": true],
            ["name": "unit", "kind": "string", "required": false],
          ],
          "bindings": bindings,
        ]
      ],
      "instructions": "user:\nWhat is the weather?",
    ])
  }

  private func tool(_ agent: Agent) throws -> Tool {
    let tool = try XCTUnwrap(agent.tools?.first)
    return tool
  }

  // MARK: - Load: both declared shapes

  /// Map form — the key supplies the binding name. This is the shape used by
  /// `spec/fixtures/tools_function.prompty` and the `bindings_injected` vector.
  func testBindingsLoadFromMapForm() throws {
    let agent = try weatherAgent(bindings: ["unit": ["input": "preferred_unit"]])
    let bindings = try tool(agent).bindings

    XCTAssertEqual(bindings.count, 1)
    XCTAssertEqual(bindings.first?.name, "unit")
    XCTAssertEqual(bindings.first?.input, "preferred_unit")
  }

  /// List form — the name is already inline. Must normalize identically.
  func testBindingsLoadFromListForm() throws {
    let agent = try weatherAgent(bindings: [["name": "unit", "input": "preferred_unit"]])
    let bindings = try tool(agent).bindings

    XCTAssertEqual(bindings.count, 1)
    XCTAssertEqual(bindings.first?.name, "unit")
    XCTAssertEqual(bindings.first?.input, "preferred_unit")
  }

  /// Map form with a bare scalar value coerces the scalar into `input`, so the
  /// shorthand `unit: preferred_unit` means the same as `unit: {input: ...}`.
  func testBindingsLoadFromMapFormScalarShorthand() throws {
    let agent = try weatherAgent(bindings: ["unit": "preferred_unit"])
    let bindings = try tool(agent).bindings

    XCTAssertEqual(bindings.count, 1)
    XCTAssertEqual(bindings.first?.name, "unit")
    XCTAssertEqual(bindings.first?.input, "preferred_unit")
  }

  /// Both declared shapes must survive a save/reload cycle unchanged — that is
  /// what makes them interchangeable rather than merely both-accepted.
  func testBindingsSurviveSaveAndReload() throws {
    for declared in [
      ["unit": ["input": "preferred_unit"]] as Any,
      [["name": "unit", "input": "preferred_unit"]] as Any,
      ["unit": "preferred_unit"] as Any,
    ] {
      let agent = try weatherAgent(bindings: declared)
      let reloaded = try Agent.load(try agent.save())
      let bindings = try tool(reloaded).bindings

      XCTAssertEqual(bindings.count, 1, "declared as \(declared)")
      XCTAssertEqual(bindings.first?.name, "unit", "declared as \(declared)")
      XCTAssertEqual(bindings.first?.input, "preferred_unit", "declared as \(declared)")
    }
  }

  // MARK: - Strip half (§2.9.1.1)

  /// A bound parameter must not reach the model. `boundParameterNames` is what
  /// wire conversion filters on, so it is the seam worth pinning.
  func testBoundParametersAreReportedForStripping() throws {
    let agent = try weatherAgent()
    XCTAssertEqual(try tool(agent).boundParameterNames, ["unit"])
  }

  // MARK: - Inject half (§2.9.1.2)

  /// The vector case: the model omits the bound parameter, and injection
  /// supplies it from the parent inputs.
  func testInjectsBoundValueOmittedByModel() throws {
    let agent = try weatherAgent()

    let merged = Pipeline.applyBindings(
      agent,
      toolName: "get_weather",
      arguments: ["city": "Paris"],
      inputs: ["preferred_unit": "celsius"]
    )

    XCTAssertEqual(merged["city"] as? String, "Paris")
    XCTAssertEqual(merged["unit"] as? String, "celsius")
  }

  /// §2.9.1.3 — a binding is authoritative. A model that guesses a value for a
  /// bound parameter must not be able to override the bound one.
  func testBindingOverridesModelSuppliedValue() throws {
    let agent = try weatherAgent()

    let merged = Pipeline.applyBindings(
      agent,
      toolName: "get_weather",
      arguments: ["city": "Paris", "unit": "fahrenheit"],
      inputs: ["preferred_unit": "celsius"]
    )

    XCTAssertEqual(merged["unit"] as? String, "celsius")
  }

  /// Bindings carry whatever the input holds, not just strings — a bound
  /// parameter is a value pipe, so non-string inputs must pass through intact.
  func testInjectsNonStringInputValues() throws {
    for (value, check) in [
      (42 as Any, { (v: Any?) in (v as? Int) == 42 }),
      (1.5 as Any, { (v: Any?) in (v as? Double) == 1.5 }),
      (true as Any, { (v: Any?) in (v as? Bool) == true }),
      (["a", "b"] as Any, { (v: Any?) in (v as? [String]) == ["a", "b"] }),
    ] {
      let agent = try weatherAgent()
      let merged = Pipeline.applyBindings(
        agent,
        toolName: "get_weather",
        arguments: [:],
        inputs: ["preferred_unit": value]
      )
      XCTAssertTrue(check(merged["unit"]), "binding dropped or coerced \(value)")
    }
  }

  /// An absent input is skipped rather than injected as null, so a partially
  /// supplied input set degrades to the model's own arguments.
  func testMissingInputIsSkipped() throws {
    let agent = try weatherAgent()

    let merged = Pipeline.applyBindings(
      agent,
      toolName: "get_weather",
      arguments: ["city": "Paris"],
      inputs: [:]
    )

    XCTAssertEqual(merged as? [String: String], ["city": "Paris"])
    XCTAssertNil(merged["unit"])
  }

  /// Multiple bindings all resolve independently.
  func testMultipleBindingsAllInject() throws {
    let agent = try weatherAgent(bindings: [
      "unit": ["input": "preferred_unit"],
      "locale": ["input": "user_locale"],
    ])

    let merged = Pipeline.applyBindings(
      agent,
      toolName: "get_weather",
      arguments: ["city": "Paris"],
      inputs: ["preferred_unit": "celsius", "user_locale": "fr-FR"]
    )

    XCTAssertEqual(merged["unit"] as? String, "celsius")
    XCTAssertEqual(merged["locale"] as? String, "fr-FR")
  }

  // MARK: - Pass-through cases

  /// Injection is called on every tool call, so an unbound tool must be cheap
  /// and lossless rather than an error.
  func testToolWithoutBindingsPassesThrough() throws {
    let agent = try weatherAgent(bindings: [] as [Any])

    let merged = Pipeline.applyBindings(
      agent,
      toolName: "get_weather",
      arguments: ["city": "Paris"],
      inputs: ["preferred_unit": "celsius"]
    )

    XCTAssertEqual(merged as? [String: String], ["city": "Paris"])
  }

  /// A tool call naming a tool the prompt never declared passes through, so a
  /// host dispatching mixed local and prompt-declared tools is unaffected.
  func testUnknownToolPassesThrough() throws {
    let agent = try weatherAgent()

    let merged = Pipeline.applyBindings(
      agent,
      toolName: "not_declared",
      arguments: ["city": "Paris"],
      inputs: ["preferred_unit": "celsius"]
    )

    XCTAssertEqual(merged as? [String: String], ["city": "Paris"])
  }

  /// A prompt with no tools at all passes through.
  func testAgentWithoutToolsPassesThrough() throws {
    let agent = try Agent.load([
      "kind": "prompt", "name": "bare", "model": ["id": "gpt-4o-mini"],
      "instructions": "user:\nhi",
    ])

    let merged = Pipeline.applyBindings(
      agent, toolName: "get_weather", arguments: ["city": "Paris"], inputs: ["x": "y"])

    XCTAssertEqual(merged as? [String: String], ["city": "Paris"])
  }

  // MARK: - ToolCall convenience

  /// The host-facing entry point decodes the provider's JSON argument string
  /// and applies bindings in one step.
  func testBoundArgumentsDecodesToolCallJSON() throws {
    let agent = try weatherAgent()
    let call = ToolCall(id: "call_1", name: "get_weather", arguments: "{\"city\":\"Paris\"}")

    let merged = Pipeline.boundArguments(agent, call: call, inputs: ["preferred_unit": "celsius"])

    XCTAssertEqual(merged["city"] as? String, "Paris")
    XCTAssertEqual(merged["unit"] as? String, "celsius")
  }

  /// The free-function surface mirrors the namespaced one.
  func testTopLevelBoundArgumentsMatchesPipeline() throws {
    let agent = try weatherAgent()
    let call = ToolCall(id: "call_1", name: "get_weather", arguments: "{\"city\":\"Paris\"}")

    let merged = boundArguments(agent, call: call, inputs: ["preferred_unit": "celsius"])

    XCTAssertEqual(merged["unit"] as? String, "celsius")
  }

  // MARK: - Shared vector

  /// Execute the canonical `bindings_injected` case from
  /// `spec/vectors/agent/agent_vectors.json` rather than restating it.
  ///
  /// This is the cross-runtime contract Rust already runs. Driving the real
  /// vector means a change to the shared expectation reaches Swift instead of
  /// silently diverging from a hand-copied duplicate.
  func testSharedBindingsInjectedVector() throws {
    let vectors = try Spec.vectors("agent")
    let vector = try XCTUnwrap(
      vectors.first { $0["name"] as? String == "bindings_injected" },
      "bindings_injected vector missing from agent_vectors.json")

    let input = try XCTUnwrap(vector["input"] as? [String: Any])
    let tools = try XCTUnwrap(input["tools"] as? [[String: Any]])
    let parentInputs = try XCTUnwrap(input["parent_inputs"] as? [String: Any])

    // Build a prompt carrying the vector's own tool declarations.
    let agent = try Agent.load([
      "kind": "prompt",
      "name": "bindings-vector",
      "model": ["id": "gpt-4o-mini", "apiType": "chat"],
      "tools": tools,
      "instructions": "user:\nWhat is the weather?",
    ])

    let sequence = try XCTUnwrap(vector["sequence"] as? [[String: Any]])
    var assertions = 0

    for turn in sequence {
      guard let calls = turn["expected_tool_calls"] as? [[String: Any]],
        let expectedArgs = turn["expected_execution_args"] as? [String: Any]
      else { continue }

      for call in calls {
        let name = try XCTUnwrap(call["name"] as? String)
        // The vector records the arguments the LLM produced; execution args are
        // what the tool must actually receive.
        let llmArgs = call["arguments"] as? [String: Any] ?? [:]
        let expected = try XCTUnwrap(expectedArgs[name] as? [String: Any])

        let merged = Pipeline.applyBindings(
          agent, toolName: name, arguments: llmArgs, inputs: parentInputs)

        XCTAssertTrue(
          Spec.equal(merged, expected),
          "\(name) execution args: got \(Spec.describe(merged)), expected \(Spec.describe(expected))"
        )
        assertions += 1
      }
    }

    XCTAssertGreaterThan(assertions, 0, "vector produced no execution-args assertions")
  }

  // MARK: - The recorded call is never rewritten

  /// A bound value must not travel back to the model.
  ///
  /// Bindings hide a parameter on purpose — the spec's own example binds an
  /// environment-supplied user id. Injecting into the *recorded* call would put
  /// that value into the assistant tool-call history replayed on the next
  /// round, handing the model exactly what the binding withheld.
  func testRecordedToolCallIsNotRewritten() throws {
    let agent = try weatherAgent()
    let raw: Any = [["id": "call_1", "name": "get_weather", "arguments": "{\"city\":\"Paris\"}"]]

    let calls = Pipeline.toolCalls(in: raw)
    _ = Pipeline.boundArguments(agent, call: calls[0], inputs: ["preferred_unit": "celsius"])

    XCTAssertEqual(calls[0].arguments, "{\"city\":\"Paris\"}")
    XCTAssertNil(calls[0].argumentValues["unit"])
  }

  /// A provider payload that is not an argument object is passed through rather
  /// than replaced by one containing only the bound values.
  ///
  /// The security property under test is that no *fabricated* object reaches
  /// the tool: injecting into a payload that was never an argument object would
  /// hand the handler a dictionary whose only contents are the bound values,
  /// which is the opposite of "the tool receives what the model asked for, plus
  /// the binding".
  ///
  /// Note a known divergence from the Rust reference: `dispatch_tool`
  /// (`tool_dispatch.rs` ~L293-309) returns an error string to the model for
  /// malformed JSON and preserves valid non-object payloads verbatim. Swift's
  /// ``ToolCall/argumentValues`` flattens every non-object to `[:]`, which
  /// predates bindings and is the host-dispatch contract the runtime already
  /// exposes. Bindings deliberately do not change it — they only decline to
  /// inject. Tightening `argumentValues` is tracked separately.
  func testNonObjectArgumentsAreNotReplaced() throws {
    let agent = try weatherAgent()

    for payload in ["[1,2,3]", "\"just a string\"", "42", "{not json"] {
      let call = ToolCall(id: "call_1", name: "get_weather", arguments: payload)
      let merged = Pipeline.boundArguments(agent, call: call, inputs: ["preferred_unit": "celsius"])

      XCTAssertNil(merged["unit"], "bindings were injected into non-object payload \(payload)")
      // Identical to the un-bound decode: bindings changed nothing at all.
      XCTAssertEqual(
        merged.count, call.argumentValues.count,
        "payload \(payload) was rewritten rather than passed through")
      XCTAssertTrue(
        merged.isEmpty,
        "payload \(payload) produced a fabricated argument object: \(merged)")
    }
  }

  /// An empty payload is the no-argument call, which is precisely when every
  /// parameter a tool needs may be a bound one.
  func testEmptyArgumentsStillReceiveBindings() throws {
    let agent = try weatherAgent()

    for payload in ["", "   ", "{}"] {
      let call = ToolCall(id: "call_1", name: "get_weather", arguments: payload)
      let merged = Pipeline.boundArguments(agent, call: call, inputs: ["preferred_unit": "celsius"])

      XCTAssertEqual(merged["unit"] as? String, "celsius", "payload \(payload)")
    }
  }

  /// An unnamed binding strips nothing, so it must also inject nothing —
  /// otherwise a parameter would vanish from the schema and never come back.
  func testUnnamedBindingNeitherStripsNorInjects() throws {
    let agent = try weatherAgent(bindings: [["input": "preferred_unit"]])

    XCTAssertTrue(try tool(agent).boundParameterNames.isEmpty)

    let merged = Pipeline.applyBindings(
      agent, toolName: "get_weather", arguments: ["city": "Paris"],
      inputs: ["preferred_unit": "celsius"])
    XCTAssertEqual(merged as? [String: String], ["city": "Paris"])
  }

  // MARK: - End to end

  /// The whole contract on the shipped fixture: the fixture declares map-form
  /// bindings, the bound parameter is withheld from the model, and the value
  /// the model never saw is restored from the prompt's own inputs.
  func testFixtureStripsThenInjects() throws {
    let path = Spec.fixtures.appendingPathComponent("tools_function.prompty").path
    let agent = try Loader.load(path: path)
    let tool = try XCTUnwrap(agent.tools?.first)

    // Declared as a map in the fixture, loaded as a named binding.
    XCTAssertEqual(tool.bindings.map(\.name), ["unit"])
    XCTAssertEqual(tool.bindings.map(\.input), ["preferred_unit"])

    // Stripped from what the model is shown...
    XCTAssertEqual(tool.boundParameterNames, ["unit"])

    // ...and restored before the tool runs.
    let merged = Pipeline.applyBindings(
      agent,
      toolName: "get_weather",
      arguments: ["location": "Paris"],
      inputs: ["preferred_unit": "celsius"]
    )
    XCTAssertEqual(merged["unit"] as? String, "celsius")
  }
}
