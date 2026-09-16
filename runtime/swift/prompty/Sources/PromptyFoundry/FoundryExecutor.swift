import Foundation

import Prompty

import PromptyModel

import PromptyOpenAI

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// Calls Azure OpenAI / Foundry OpenAI-compatible chat endpoints over HTTP.
///
/// Key-auth Azure OpenAI uses deployment-scoped `/openai/deployments/...`
/// URLs. Foundry project auth uses the project endpoint converted to the
/// OpenAI `/openai/v1` endpoint with a bearer token supplied by the host.
public struct FoundryExecutor: Executor {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func execute(agent: Agent, messages: [Message]) async throws -> Any {
    let config = try FoundryConfig.resolve(agent)
    let body = try OpenAIWire.chatArgs(agent, messages: messages)
    return try await send(config.request(body: body))
  }

  public func executeStream(agent: Agent, messages: [Message]) async throws -> Any {
    var body = try OpenAIWire.chatArgs(agent, messages: messages)
    OpenAIWire.enableStreaming(&body, apiType: agent.apiTypeName)
    let config = try FoundryConfig.resolve(agent)
    let request = try config.request(body: body)
    let session = self.session

    let stream: RawChunkStream = AsyncThrowingStream { continuation in
      Task {
        do {
          for try await line in try await FoundrySSE.lines(for: request, session: session) {
            guard let event = FoundrySSE.payload(of: line) else { continue }
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

  public func formatToolMessages(
    rawResponse _: Any, toolCalls: [ToolCall], toolResults: [String], textContent: String?
  ) throws -> [Message] {
    var messages = OpenAIWire.toolMessages(toolCalls, results: toolResults)
    if let text = textContent, !text.isEmpty, !messages.isEmpty {
      messages[0].parts = [.textPart(TextPart(value: text))]
    }
    return messages
  }

  private func send(_ request: URLRequest) async throws -> [String: Any] {
    let (data, response) = try await session.data(for: request)

    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw InvokerError.execution("Foundry request failed (\(http.statusCode)): \(body)")
    }

    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw InvokerError.execution("Foundry response was not a JSON object")
    }
    return json
  }
}

struct FoundryConfig {
  var url: URL
  var apiKey: String?
  var bearerToken: String?

  static func resolve(_ agent: Agent) throws -> FoundryConfig {
    let model = agent.modelId
    guard !model.isEmpty else {
      throw InvokerError.execution("no deployment id — set model.id in the prompt frontmatter")
    }

    guard let connection = agent.model?.connection else {
      throw InvokerError.execution("Foundry requires model.connection")
    }

    switch connection {
    case .apiKeyConnection(let connection):
      let apiKey = nonEmpty(connection.apiKey)
        ?? nonEmpty(ProcessInfo.processInfo.environment["AZURE_OPENAI_API_KEY"])
      let base = nonEmpty(connection.endpoint)
        ?? nonEmpty(ProcessInfo.processInfo.environment["AZURE_OPENAI_ENDPOINT"])
      guard let apiKey else {
        throw InvokerError.execution(
          "no Azure OpenAI API key — set model.connection.apiKey or AZURE_OPENAI_API_KEY")
      }
      guard let base else {
        throw InvokerError.execution(
          "no Azure OpenAI endpoint — set model.connection.endpoint or AZURE_OPENAI_ENDPOINT")
      }
      return FoundryConfig(
        url: try azureDeploymentURL(endpoint: base, deployment: model),
        apiKey: apiKey,
        bearerToken: nil
      )

    case .foundryConnection(let connection):
      let bearer = nonEmpty(ProcessInfo.processInfo.environment["AZURE_OPENAI_ACCESS_TOKEN"])
        ?? nonEmpty(ProcessInfo.processInfo.environment["AZURE_INFERENCE_CREDENTIAL"])
      guard let bearer else {
        throw InvokerError.execution(
          "no Foundry bearer token — set AZURE_OPENAI_ACCESS_TOKEN or AZURE_INFERENCE_CREDENTIAL")
      }
      guard let projectEndpoint = nonEmpty(connection.endpoint)
        ?? nonEmpty(ProcessInfo.processInfo.environment["FOUNDRY_PROJECT_ENDPOINT"])
      else {
        throw InvokerError.execution(
          "no Foundry project endpoint — set model.connection.endpoint or FOUNDRY_PROJECT_ENDPOINT")
      }
      return FoundryConfig(
        url: try foundryChatURL(projectEndpoint: projectEndpoint, deployment: model),
        apiKey: nil,
        bearerToken: bearer
      )

    default:
      let fields = (try? connection.save()) ?? [:]
      let kind = fields["kind"] as? String ?? "unknown"
      throw InvokerError.execution("unsupported Foundry connection kind '\(kind)'")
    }
  }

  func request(body: [String: Any]) throws -> URLRequest {
    var body = body
    if apiKey != nil {
      body.removeValue(forKey: "model")
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let apiKey {
      request.setValue(apiKey, forHTTPHeaderField: "api-key")
    }
    if let bearerToken {
      request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
    }

    guard let data = JSONSupport.toJSON(body).data(using: .utf8) else {
      throw InvokerError.execution("failed to encode request body")
    }
    request.httpBody = data
    return request
  }

  private static func nonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func azureDeploymentURL(endpoint: String, deployment: String) throws -> URL {
    let base = endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard
      let escaped = deployment.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
      let url = URL(
        string: "\(base)/openai/deployments/\(escaped)/chat/completions?api-version=2024-12-01-preview")
    else {
      throw InvokerError.execution("invalid Azure OpenAI endpoint '\(endpoint)'")
    }
    return url
  }

  private static func foundryChatURL(projectEndpoint: String, deployment: String) throws -> URL {
    let base = try foundryOpenAIBaseURL(projectEndpoint)
    guard let url = URL(string: "\(base)/chat/completions?api-version=v1")
    else {
      throw InvokerError.execution("invalid Foundry deployment '\(deployment)'")
    }
    return url
  }

  private static func foundryOpenAIBaseURL(_ projectEndpoint: String) throws -> String {
    guard var components = URLComponents(string: projectEndpoint) else {
      throw InvokerError.execution("invalid Foundry endpoint '\(projectEndpoint)'")
    }
    if components.host?.hasSuffix(".services.ai.azure.com") == true {
      components.host = components.host?.replacingOccurrences(
        of: ".services.ai.azure.com",
        with: ".openai.azure.com")
    }
    components.path = "/openai/v1"
    components.query = nil
    components.fragment = nil
    guard let url = components.url else {
      throw InvokerError.execution("invalid Foundry endpoint '\(projectEndpoint)'")
    }
    return url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }
}

enum FoundrySSE {
  static func lines(for request: URLRequest, session: URLSession) async throws
    -> AsyncThrowingStream<String, Error>
  {
    #if canImport(FoundationNetworking)
      let (data, response) = try await session.data(for: request)
      try validate(response, data: data)
      let text = String(data: data, encoding: .utf8) ?? ""
      return AsyncThrowingStream { continuation in
        for line in text.split(whereSeparator: \.isNewline) {
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

  static func payload(of line: String) -> String? {
    guard line.hasPrefix("data:") else { return nil }
    return String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
  }

  private static func validate(_ response: URLResponse, data: Data) throws {
    guard let http = response as? HTTPURLResponse else { return }
    if !(200..<300).contains(http.statusCode) {
      let body = String(data: data, encoding: .utf8) ?? ""
      throw InvokerError.execution("Foundry stream failed (\(http.statusCode)): \(body)")
    }
  }
}
