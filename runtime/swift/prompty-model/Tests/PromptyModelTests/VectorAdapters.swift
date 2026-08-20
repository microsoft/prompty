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
    [
      "LoadConformance.load": "Not yet wired (deferred). The Swift loader is synchronous and wireable; scheduled for a follow-up increment.",
      "Renderer.render": "Not yet wired (deferred). The Swift pipeline API is async, but is bridgeable to the synchronous conformance harness via a DispatchSemaphore + Task; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
      "Parser.parse": "Not yet wired (deferred). The Swift pipeline API is async, but is bridgeable to the synchronous conformance harness via a DispatchSemaphore + Task; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
      "WireConformance.toRequest": "Not yet wired (deferred). The Swift pipeline API is async, but is bridgeable to the synchronous conformance harness via a DispatchSemaphore + Task; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
      "Processor.process": "Not yet wired (deferred). The Swift pipeline API is async, but is bridgeable to the synchronous conformance harness via a DispatchSemaphore + Task; scheduled for a follow-up increment. Not wired here to avoid reimplementing runtime logic in the adapter.",
      "TurnConformance.replay": "Not yet wired (deferred). The async turn runner is bridgeable via a semaphore; scheduled for a follow-up increment.",
      "TurnConformance.run": "The run vectors assert an agent-loop accounting/observability contract (iteration counting = LLM-call count, total_messages including the final assistant message, exact event schemas) not yet matched by the runtime. Same honest gap as the Python reference.",
      "TurnConformance.runTurn": "Requires the not-yet-implemented snapshot/portability turn engine. Same gap as the Python reference."
    ]
  }

  static func doubles() -> Any? {
    [:] as [String: Any]
  }
}
