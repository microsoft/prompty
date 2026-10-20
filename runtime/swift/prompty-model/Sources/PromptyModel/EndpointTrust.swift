import Foundation

/// Endpoint trust — keep ambient credentials on host-approved destinations (spec §2.5.1).
///
/// A `.prompty` file is untrusted input. When its connection carries no
/// file-supplied credential, executors fall back to ambient credentials
/// (Azure identity tokens, `*_API_KEY` env vars). This decides whether the
/// file-chosen destination may receive them.
public enum EndpointTrust {
  /// Comma-separated list of extra trusted origins supplied by the host environment.
  public static let trustedEndpointsEnv = "PROMPTY_TRUSTED_ENDPOINTS"

  /// First-party provider origins trusted without host configuration.
  public static let builtinTrustedEndpoints: [String] = [
    "https://api.openai.com",
    "https://api.anthropic.com",
    "https://*.openai.azure.com",
    "https://*.services.ai.azure.com",
    "https://*.cognitiveservices.azure.com",
    "https://login.microsoftonline.com",
  ]

  private static let defaultPorts: [String: Int] = ["http": 80, "https": 443]
  private static let credentialKeys: [String: String] = ["key": "apiKey", "oauth": "clientSecret"]
  private static let destinationKeys = ["endpoint", "tokenUrl"]

  /// Return `true` if `url`'s origin matches a built-in, host, or env trusted origin.
  public static func isTrusted(_ url: String, trustedEndpoints: [String] = []) -> Bool {
    let entries = trustedEntries(trustedEndpoints)
    if entries.contains("*") { return true }
    guard let target = origin(url) else { return false }
    for entry in entries {
      guard let allowed = origin(entry), allowed.scheme == target.scheme, allowed.port == target.port else {
        continue
      }
      if allowed.host.hasPrefix("*.") {
        if target.host.hasSuffix(String(allowed.host.dropFirst())) { return true }
      } else if allowed.host == target.host {
        return true
      }
    }
    return false
  }

  /// Throw `untrusted_endpoint` if ambient credentials could reach a file-chosen, untrusted destination.
  ///
  /// `connection` is the RAW (unresolved) `model.connection` mapping.
  public static func checkConnection(_ connection: Any?, trustedEndpoints: [String] = []) throws {
    guard let connection = connection as? [String: Any] else { return }
    if connection["kind"] as? String == "reference" { return }
    if fileSuppliedCredential(connection) { return }
    for key in destinationKeys {
      guard let destination = fileControlledDestination(connection[key]),
        !isTrusted(destination, trustedEndpoints: trustedEndpoints)
      else { continue }
      throw PromptyLoadError(
        kind: "untrusted_endpoint",
        message: "Connection \(key) '\(destination)' is not trusted to receive ambient credentials. "
          + "Set the \(key) via ${env:VAR}, add its origin to trustedEndpoints or "
          + "\(trustedEndpointsEnv), or use 'kind: reference'.")
    }
  }

  /// Return the unresolved `model.connection`, following whole-value `${file:}` references.
  ///
  /// `resolveFile` receives the reference path and returns the loaded content, or
  /// `nil` when the file does not exist (resolution reports that later).
  public static func rawConnection(
    _ data: [String: Any], resolveFile: (String) throws -> Any?
  ) rethrows -> Any? {
    func follow(_ value: Any?) throws -> Any? {
      if let string = value as? String, isReference(string) {
        let inner = String(string.dropFirst(2).dropLast())
        if let colon = inner.firstIndex(of: ":"), inner[..<colon].lowercased() == "file" {
          return try resolveFile(String(inner[inner.index(after: colon)...]))
        }
      }
      return value
    }
    guard let model = try follow(data["model"]) as? [String: Any] else { return nil }
    return try follow(model["connection"])
  }

  // MARK: - Internals

  static func environmentValue(_ name: String) -> String? {
    if promptyEnvironmentOverrides.keys.contains(name) {
      return promptyEnvironmentOverrides[name] ?? nil
    }
    return ProcessInfo.processInfo.environment[name]
  }

  private static func trustedEntries(_ trustedEndpoints: [String]) -> [String] {
    var entries = builtinTrustedEndpoints + trustedEndpoints
    entries.append(
      contentsOf: (environmentValue(trustedEndpointsEnv) ?? "").split(separator: ",", omittingEmptySubsequences: false)
        .map(String.init))
    return entries.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  }

  private static func isReference(_ value: String) -> Bool {
    value.hasPrefix("${") && value.hasSuffix("}")
  }

  private static func fileSuppliedCredential(_ connection: [String: Any]) -> Bool {
    // Only the credential field the declared kind actually consumes counts; any other kind is ambient.
    guard let kind = connection["kind"] as? String, let key = credentialKeys[kind],
      let value = connection[key] as? String
    else { return false }
    return !value.isEmpty && !isReference(value)
  }

  /// Return the effective destination if the file chose it, else `nil`.
  private static func fileControlledDestination(_ value: Any?) -> String? {
    guard let value, !(value is NSNull) else { return nil }
    guard let string = value as? String else { return "\(value)" }
    if isReference(string) {
      let inner = String(string.dropFirst(2).dropLast())
      let parts = inner.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
      if parts[0].lowercased() == "env" {
        let rest = parts.count > 1 ? String(parts[1]) : ""
        let pieces = rest.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let name = String(pieces[0])
        if environmentValue(name) != nil { return nil }
        let fallback = pieces.count > 1 ? String(pieces[1]) : ""
        return fallback.isEmpty ? nil : fallback
      }
    }
    return string
  }

  struct Origin: Equatable {
    let scheme: String
    let host: String
    let port: Int
  }

  /// Return `(scheme, host, port)` for an absolute http(s) URL, else `nil`.
  ///
  /// Mirrors Python's `urllib.parse.urlsplit` so every runtime classifies the same strings alike.
  static func origin(_ url: String) -> Origin? {
    let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = String(String.UnicodeScalarView(trimmed.unicodeScalars.filter { !"\t\r\n".unicodeScalars.contains($0) }))
    guard let colon = text.firstIndex(of: ":") else { return nil }
    let rawScheme = text[..<colon]
    guard let first = rawScheme.first, first.isASCII, first.isLetter,
      rawScheme.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "+-.".contains($0)) })
    else { return nil }
    let scheme = rawScheme.lowercased()
    guard let defaultPort = defaultPorts[scheme] else { return nil }

    let rest = text[text.index(after: colon)...]
    guard rest.hasPrefix("//") else { return nil }
    let afterSlashes = rest.dropFirst(2)
    let netloc = afterSlashes.prefix { $0 != "/" && $0 != "?" && $0 != "#" }

    var hostinfo = Substring(netloc)
    if let at = netloc.lastIndex(of: "@") {
      hostinfo = netloc[netloc.index(after: at)...]
    }
    let hostname: Substring
    var portText: Substring
    if let open = hostinfo.firstIndex(of: "[") {
      let bracketed = hostinfo[hostinfo.index(after: open)...]
      if let close = bracketed.firstIndex(of: "]") {
        hostname = bracketed[..<close]
        let tail = bracketed[bracketed.index(after: close)...]
        portText = tail.firstIndex(of: ":").map { tail[tail.index(after: $0)...] } ?? ""
      } else {
        hostname = bracketed
        portText = ""
      }
    } else if let portColon = hostinfo.firstIndex(of: ":") {
      hostname = hostinfo[..<portColon]
      portText = hostinfo[hostinfo.index(after: portColon)...]
    } else {
      hostname = hostinfo
      portText = ""
    }

    var port = defaultPort
    if !portText.isEmpty {
      guard portText.allSatisfy({ $0.isASCII && $0.isNumber }), let parsed = Int(portText), parsed <= 65535 else {
        return nil
      }
      port = parsed
    }
    let host = hostname.lowercased()
    guard !host.isEmpty else { return nil }
    return Origin(scheme: scheme, host: host, port: port)
  }
}
