import Foundation

import Prompty

/// Registers the Azure OpenAI / Foundry executor and processor.
public func registerFoundry(into registry: Registry = .shared) {
  let executor = FoundryExecutor()
  let processor = FoundryProcessor()
  registry.register(executor: executor, for: "foundry")
  registry.register(processor: processor, for: "foundry")
  registry.register(executor: executor, for: "azure")
  registry.register(processor: processor, for: "azure")
}
