import Foundation

import Prompty

import PromptyModel

import PromptyOpenAI

/// Processes Azure OpenAI / Foundry responses using OpenAI-compatible semantics.
public struct FoundryProcessor: Processor {
  public init() {}

  public func process(agent: Agent, response: Any) async throws -> Any {
    try OpenAIProcessor.processResponse(agent, response: response)
  }

  public func processStream(agent: Agent, stream: Any) async throws -> Any {
    try await OpenAIProcessor().processStream(agent: agent, stream: stream)
  }
}
