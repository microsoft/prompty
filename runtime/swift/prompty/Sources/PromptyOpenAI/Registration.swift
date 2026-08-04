import Foundation
import PromptyModel
import Prompty

/// Registers the OpenAI executor and processor.
///
/// Call once during host startup:
///
/// ```swift
/// import Prompty
/// import PromptyOpenAI
///
/// registerOpenAI()
/// ```
public func registerOpenAI(into registry: Registry = .shared) {
  registry.register(executor: OpenAIExecutor(), for: "openai")
  registry.register(processor: OpenAIProcessor(), for: "openai")
}
