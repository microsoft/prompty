import Foundation
@testable import PromptyModel

enum VectorAdapters {
  static func adapters() -> [String: VectorAdapter] {
    [
      "DiscoveryConformance.enrich": VectorAdapter { input, context in
        let provider = context.provider ?? ""
        guard let input else {
          throw VectorError("Missing input")
        }
        let base = try ModelInfo.load(input)
        return try Discovery.enrich(base, provider: provider).save()
      },
      "DiscoveryConformance.mapModel": VectorAdapter { input, context in
        let provider = context.provider ?? ""
        return try Discovery.mapModel(input, provider: provider).save()
      }
    ]
  }

  static func waivers() -> [String: String] {
    // This generated conformance harness runs in the `PromptyModel` test target,
    // which depends only on `PromptyModel`. The load/render/parse pipeline lives
    // in the `Prompty` SDK package and the wire/process layers live in the
    // provider packages (`PromptyOpenAI`/`PromptyAnthropic`/`PromptyFoundry`),
    // all of which depend on `PromptyModel`. Importing them here would be a
    // circular package dependency, so those operations cannot be driven from
    // this harness. They are exercised against the same generated `vectors.json`
    // by the SDK/provider-level runners in `prompty/Tests/PromptyTests`. These
    // waivers therefore record a package-layering boundary, not an unwired gap.
    let sdkPipeline =
      "Implemented in the `Prompty` SDK package (`Loader`, `Pipeline`, "
      + "`Jinja2Renderer`/`MustacheRenderer`, `PromptyChatParser`), which depends on "
      + "`PromptyModel`. This conformance harness runs in the `PromptyModel` test "
      + "target and cannot import `Prompty` without a circular package dependency, so "
      + "this operation is driven against the same generated `vectors.json` by the "
      + "SDK-level runners in `prompty/Tests/PromptyTests` "
      + "(`LoadVectorTests`, `RenderVectorTests`, `ParseVectorTests`)."
    let providerLayer =
      "Implemented in the provider packages (`PromptyOpenAI`/`PromptyAnthropic`/"
      + "`PromptyFoundry`), which depend on `PromptyModel`. Unreachable from the "
      + "model-only conformance harness (importing a provider here would be a circular "
      + "dependency), so it is driven against the same generated `vectors.json` by the "
      + "provider-level runners in `prompty/Tests/PromptyTests` "
      + "(`WireVectorTests`, `ProcessVectorTests`, `AnthropicWireVectorTests`, "
      + "`AnthropicProcessVectorTests`)."
    return [
      "LoadConformance.load": sdkPipeline,
      "Renderer.render": sdkPipeline,
      "Parser.parse": sdkPipeline,
      "WireConformance.toRequest": providerLayer,
      "Processor.process": providerLayer,
      "TurnConformance.replay":
        "The async turn/replay runner lives in the `Prompty` SDK package and is "
        + "unreachable from this model-only harness. Driven against the generated "
        + "`replay` vectors by `ReplayVectorTests` in `prompty/Tests/PromptyTests`.",
      "TurnConformance.run":
        "The run vectors assert an agent-loop accounting/observability contract "
        + "(iteration counting = LLM-call count, total_messages including the final "
        + "assistant message, exact event schemas) not yet matched by the runtime. "
        + "Same honest gap as the Python reference.",
      "TurnConformance.runTurn":
        "Requires the not-yet-implemented snapshot/portability turn engine. Same gap "
        + "as the Python reference.",
    ]
  }

  static func doubles() -> Any? {
    [:] as [String: Any]
  }
}
