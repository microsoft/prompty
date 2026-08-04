import Foundation

import Prompty

import PromptyModel

/// Calls the OpenAI API over HTTP.
///
/// The executor is deliberately thin: request bodies come from ``OpenAIWire``
/// so they stay identical to every other Prompty runtime, and responses are
/// handed to ``OpenAIProcessor`` unmodified.
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// Minimal server-sent-events reader.
public struct OpenAIExecutor: Executor {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  // MARK: - Execute

  public func execute(agent: Prompty, messages: [Message]) async throws -> Any {
    let config = try OpenAIConfig.resolve(agent)
    let (path, body) = try OpenAIExecutor.request(agent, messages: messages)
    return try await send(config.request(path: path, body: body))
  }

  /// Build the endpoint path and request body for a prompt's API type.
  public static func request(_ agent: Prompty, messages: [Message]) throws -> (
    path: String, body: [String: Any]
  ) {
    switch agent.apiTypeName {
    case "chat", "agent":
      return ("chat/completions", try OpenAIWire.chatArgs(agent, messages: messages))
    case "responses":
      return ("responses", try OpenAIWire.responsesArgs(agent, messages: messages))
    case "embedding":
      return ("embeddings", OpenAIWire.embeddingArgs(agent, messages: messages))
    case "image":
      return ("images/generations", OpenAIWire.imageArgs(agent, messages: messages))
    case let other:
      throw InvokerError.execution("unsupported apiType '\(other)' for the openai provider")
    }
  }

  // MARK: - Stream

  /// Stream raw provider chunks.
  ///
  /// Returns a ``RawChunkStream``; decoding into `StreamChunk` values is the
  /// processor's job, matching every other Prompty runtime.
  public func executeStream(agent: Prompty, messages: [Message]) async throws -> Any {
    let config = try OpenAIConfig.resolve(agent)
    var (path, body) = try OpenAIExecutor.request(agent, messages: messages)
    OpenAIWire.enableStreaming(&body, apiType: agent.apiTypeName)
    let request = try config.request(path: path, body: body)
    let session = self.session

    let stream: RawChunkStream = AsyncThrowingStream { continuation in
      Task {
        do {
          for try await line in try await SSE.lines(for: request, session: session) {
            guard let event = SSE.payload(of: line) else { continue }
            if event == "[DONE]" { break }
            guard let json = JSONSupport.parse(json: event) as? [String: Any] else { continue }
            continuation.yield(json)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
    }
    return stream
  }

  // MARK: - Tool turns

  public func formatToolMessages(
    rawResponse: Any, toolCalls: [ToolCall], toolResults: [String], textContent: String?
  ) throws -> [Message] {
    var messages = OpenAIWire.toolMessages(toolCalls, results: toolResults)
    if let text = textContent, !text.isEmpty, !messages.isEmpty {
      messages[0].parts = [.textPart(TextPart(value: text))]
    }
    return messages
  }

  // MARK: - Transport

  private func send(_ request: URLRequest) async throws -> [String: Any] {
    let (data, response) = try await session.data(for: request)

    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw InvokerError.execution("OpenAI request failed (\(http.statusCode)): \(body)")
    }

    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw InvokerError.execution("OpenAI response was not a JSON object")
    }
    return json
  }
}
enum SSE {
  /// Stream response lines, using the platform's native byte stream when it is
  /// available and falling back to a buffered read otherwise.
  static func lines(for request: URLRequest, session: URLSession) async throws
    -> AsyncThrowingStream<String, Error>
  {
    #if canImport(FoundationNetworking)
      let (data, response) = try await session.data(for: request)
      try validate(response, data: data)
      let text = String(data: data, encoding: .utf8) ?? ""
      return AsyncThrowingStream { continuation in
        for line in Lines.split(text) {
          continuation.yield(String(line))
        }
        continuation.finish()
      }
    #else
      let (bytes, response) = try await session.bytes(for: request)
      try validate(response, data: Data())
      return AsyncThrowingStream { continuation in
        Task {
          do {
            for try await line in bytes.lines {
              continuation.yield(line)
            }
            continuation.finish()
          } catch {
            continuation.finish(throwing: error)
          }
        }
      }
    #endif
  }

  /// The JSON payload of an SSE `data:` line, or `nil` for other lines.
  static func payload(of line: String) -> String? {
    guard line.hasPrefix("data:") else { return nil }
    let value = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
    return value.isEmpty ? nil : value
  }

  private static func validate(_ response: URLResponse, data: Data) throws {
    guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else {
      return
    }
    let body = String(data: data, encoding: .utf8) ?? ""
    throw InvokerError.execution("OpenAI stream failed (\(http.statusCode)): \(body)")
  }
}
