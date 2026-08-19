import Foundation

/// Registers the Anthropic executor and processor.
///
/// Call once during host startup:
///
/// ```swift
/// import PromptyAnthropic
///
/// registerAnthropic()
/// ```
import Prompty

import PromptyModel

public func registerAnthropic(into registry: Registry = .shared) {
  registry.register(executor: AnthropicExecutor(), for: "anthropic")
  registry.register(processor: AnthropicProcessor(), for: "anthropic")
}
