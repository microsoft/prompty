import Foundation

/// Shared configuration for talking to the Anthropic Messages API.
import Prompty

import PromptyModel

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct AnthropicConfig {
  var apiURL: URL
  var apiKey: String
  var model: String

  /// Derive request configuration from a prompt's model and connection.
  ///
  /// The endpoint resolves from the connection, then `ANTHROPIC_BASE_URL`, then
  /// the public default. The API key is read from the connection when present,
  /// otherwise from `ANTHROPIC_API_KEY`.
  static func resolve(_ agent: Agent, resource: String = "messages") throws -> AnthropicConfig {
    let connection = agent.model?.connection
    var endpoint = ""
    var apiKey = ""

    if let connection {
      let fields = (try? connection.save()) ?? [:]
      if let value = fields["endpoint"] as? String, !value.isEmpty { endpoint = value }
      if let value = fields["apiKey"] as? String, !value.isEmpty { apiKey = value }
    }

    if endpoint.isEmpty {
      endpoint = ProcessInfo.processInfo.environment["ANTHROPIC_BASE_URL"] ?? ""
    }
    if endpoint.isEmpty { endpoint = "https://api.anthropic.com" }

    if apiKey.isEmpty {
      apiKey = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"] ?? ""
    }
    guard !apiKey.isEmpty else {
      throw InvokerError.execution(
        "no Anthropic API key — set model.connection.apiKey or the ANTHROPIC_API_KEY "
          + "environment variable")
    }

    let model = agent.modelId
    guard !model.isEmpty else {
      throw InvokerError.execution("no model id — set model.id in the prompt frontmatter")
    }

    let base = endpoint.hasSuffix("/") ? String(endpoint.dropLast()) : endpoint
    let full = base.hasSuffix("/v1") ? "\(base)/\(resource)" : "\(base)/v1/\(resource)"
    guard let url = URL(string: full) else {
      throw InvokerError.execution("invalid endpoint '\(endpoint)'")
    }

    return AnthropicConfig(apiURL: url, apiKey: apiKey, model: model)
  }

  /// Build a POST request carrying the Anthropic auth and version headers.
  func request(body: [String: Any]) throws -> URLRequest {
    var request = URLRequest(url: apiURL)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
    request.setValue(AnthropicWire.anthropicVersion, forHTTPHeaderField: "anthropic-version")

    guard let data = JSONSupport.toJSON(body).data(using: .utf8) else {
      throw InvokerError.execution("failed to encode request body")
    }
    request.httpBody = data
    return request
  }
}
