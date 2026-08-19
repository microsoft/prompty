import Foundation

/// Calls the Anthropic Messages API over HTTP.
///
/// The executor is deliberately thin: request bodies come from ``AnthropicWire``
/// so they stay identical to every other runtime, and responses are handed to
/// ``AnthropicProcessor`` unmodified. Anthropic exposes only a chat-style API,
/// so `embedding` and `image` prompts are rejected.
import Prompty

import PromptyModel

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

public struct AnthropicExecutor: Executor {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func execute(agent: Agent, messages: [Message]) async throws -> Any {
    let apiType = agent.apiTypeName
    guard apiType == "chat" || apiType == "agent" else {
      throw InvokerError.execution(
        "unsupported apiType '\(apiType)' for the anthropic provider — only 'chat' is supported")
    }

    let config = try AnthropicConfig.resolve(agent)
    let body = try AnthropicWire.chatArgs(agent, messages: messages)
    return try await send(config.request(body: body))
  }

  public func executeStream(agent: Agent, messages: [Message]) async throws -> Any {
    throw InvokerError.execution("anthropic streaming is not implemented")
  }

  public func formatToolMessages(
    rawResponse: Any, toolCalls: [ToolCall], toolResults: [String], textContent: String?
  ) throws -> [Message] {
    AnthropicWire.toolMessages(rawResponse: rawResponse, calls: toolCalls, results: toolResults)
  }

  // MARK: - Transport

  private func send(_ request: URLRequest) async throws -> [String: Any] {
    let (data, response) = try await session.data(for: request)

    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw InvokerError.execution("Anthropic request failed (\(http.statusCode)): \(body)")
    }

    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw InvokerError.execution("Anthropic response was not a JSON object")
    }
    return json
  }
}
