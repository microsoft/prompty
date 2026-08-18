import Foundation

import Prompty

import PromptyModel

/// Shared configuration for talking to an OpenAI-compatible endpoint.
#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif
struct OpenAIConfig {
  var baseURL: URL
  var apiKey: String
  var model: String
  var extraHeaders: [String: String]

  /// Derive request configuration from a prompt's model and connection.
  ///
  /// The API key is read from the connection when present, otherwise from
  /// `OPENAI_API_KEY`. Populating the environment is the host's job — the
  /// runtime never reads `.env` files itself.
  static func resolve(_ agent: Prompty) throws -> OpenAIConfig {
    let connection = agent.model.connection
    var endpoint = "https://api.openai.com/v1"
    var apiKey = ""
    var headers: [String: String] = [:]

    if let connection {
      let fields = connectionFields(connection)
      if let value = fields["endpoint"] as? String, !value.isEmpty { endpoint = value }
      if let value = fields["apiKey"] as? String, !value.isEmpty { apiKey = value }
      if let value = fields["headers"] as? [String: Any] {
        for (key, header) in value { headers[key] = JSONSupport.stringify(header) }
      }
    }

    if apiKey.isEmpty {
      apiKey = ProcessInfo.processInfo.environment["OPENAI_API_KEY"] ?? ""
    }
    guard !apiKey.isEmpty else {
      throw InvokerError.execution(
        "no OpenAI API key — set model.connection.apiKey or the OPENAI_API_KEY environment variable"
      )
    }

    let model = agent.model.id
    guard !model.isEmpty else {
      throw InvokerError.execution("no model id — set model.id in the prompt frontmatter")
    }

    guard let url = URL(string: endpoint.hasSuffix("/") ? String(endpoint.dropLast()) : endpoint)
    else {
      throw InvokerError.execution("invalid endpoint '\(endpoint)'")
    }

    return OpenAIConfig(baseURL: url, apiKey: apiKey, model: model, extraHeaders: headers)
  }

  /// Flatten a connection into its raw fields.
  static func connectionFields(_ connection: Connection) -> [String: Any] {
    (try? connection.save()) ?? [:]
  }

  /// Build a request against a path under the configured base URL.
  func request(path: String, body: [String: Any]) throws -> URLRequest {
    var request = URLRequest(url: baseURL.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    for (key, value) in extraHeaders {
      request.setValue(value, forHTTPHeaderField: key)
    }

    guard let data = JSONSupport.toJSON(body).data(using: .utf8) else {
      throw InvokerError.execution("failed to encode request body")
    }
    request.httpBody = data
    return request
  }
}
