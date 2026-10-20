import Foundation
import PromptyModel
import XCTest

@testable import Prompty

/// Endpoint trust (spec §2.5.1): ambient credentials only go to host-approved destinations.
final class EndpointTrustTests: XCTestCase {

  private var directory: URL!
  private var savedEnv: [String: String?] = [:]

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("prompty_trust_\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    setEnv(EndpointTrust.trustedEndpointsEnv, nil)
  }

  override func tearDownWithError() throws {
    for (key, value) in savedEnv { Env.set(key, value) }
    savedEnv = [:]
    try? FileManager.default.removeItem(at: directory)
  }

  private func setEnv(_ key: String, _ value: String?) {
    if !savedEnv.keys.contains(key) {
      savedEnv.updateValue(ProcessInfo.processInfo.environment[key], forKey: key)
    }
    Env.set(key, value)
  }

  @discardableResult
  private func write(_ connection: String, name: String = "t.prompty") throws -> String {
    let path = directory.appendingPathComponent(name)
    try "---\nname: t\nmodel:\n  id: gpt-4\n  connection:\n\(connection)\n---\nHello\n"
      .write(to: path, atomically: true, encoding: .utf8)
    return path.path
  }

  private func assertUntrusted(
    _ body: @autoclosure () throws -> Agent, contains fragment: String = "not trusted",
    file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertThrowsError(try body(), file: file, line: line) { error in
      guard case .untrustedEndpoint(let message) = error as? LoadError else {
        return XCTFail("expected LoadError.untrustedEndpoint, got \(error)", file: file, line: line)
      }
      XCTAssertTrue(message.contains(fragment), "'\(message)' lacks '\(fragment)'", file: file, line: line)
    }
  }

  private func endpoint(_ agent: Agent) -> String? {
    switch agent.model?.connection {
    case .apiKeyConnection(let c): return c.endpoint
    case .foundryConnection(let c): return c.endpoint
    default: return nil
    }
  }

  // MARK: - isTrusted

  func testBuiltinTrusted() {
    for url in [
      "https://api.openai.com/v1",
      "https://API.OpenAI.com:443",
      "https://myres.openai.azure.com/",
      "https://a.b.services.ai.azure.com/api/projects/p",
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    ] {
      XCTAssertTrue(EndpointTrust.isTrusted(url), url)
    }
  }

  func testUntrusted() {
    for url in [
      "http://api.openai.com",
      "https://api.openai.com:8443",
      "https://openai.azure.com",
      "https://api.openai.com.evil.com",
      "https://evilopenai.azure.com",
      "https://api.openai.com@evil.com",
      "http://localhost:11434",
      "not a url",
      "ftp://api.openai.com",
      "",
    ] {
      XCTAssertFalse(EndpointTrust.isTrusted(url), url)
    }
  }

  func testHostOptionAndWildcard() {
    XCTAssertTrue(EndpointTrust.isTrusted("http://localhost:11434/v1", trustedEndpoints: ["http://LOCALHOST:11434"]))
    XCTAssertTrue(EndpointTrust.isTrusted("https://x.contoso.com", trustedEndpoints: ["https://*.contoso.com"]))
    XCTAssertFalse(EndpointTrust.isTrusted("https://contoso.com", trustedEndpoints: ["https://*.contoso.com"]))
  }

  func testEnvListAndStar() {
    setEnv(EndpointTrust.trustedEndpointsEnv, " https://a.example.com , http://localhost:8080")
    XCTAssertTrue(EndpointTrust.isTrusted("http://localhost:8080/x"))
    XCTAssertFalse(EndpointTrust.isTrusted("http://localhost:8081"))
    setEnv(EndpointTrust.trustedEndpointsEnv, "*")
    XCTAssertTrue(EndpointTrust.isTrusted("http://anything.example"))
  }

  // MARK: - Loader enforcement

  func testAmbientLiteralEndpointRejected() throws {
    let path = try write("    kind: foundry\n    endpoint: http://127.0.0.1:9999")
    assertUntrusted(try Loader.load(path: path), contains: "127.0.0.1")
  }

  func testEnvKeyLiteralEndpointRejected() throws {
    setEnv("SOME_KEY", "secret")
    let path = try write("    kind: key\n    endpoint: https://evil.example.com\n    apiKey: ${env:SOME_KEY}")
    assertUntrusted(try Loader.load(path: path))
  }

  func testOAuthTokenUrlChecked() throws {
    setEnv("SECRET", "s")
    let path = try write(
      "    kind: oauth\n    endpoint: https://myres.openai.azure.com\n    clientId: c\n"
        + "    clientSecret: ${env:SECRET}\n    tokenUrl: https://evil.example.com/token")
    assertUntrusted(try Loader.load(path: path), contains: "tokenUrl")
  }

  func testMismatchedCredentialFieldRejected() throws {
    let foundry = try write("    kind: foundry\n    endpoint: https://evil.example.com\n    apiKey: junk")
    assertUntrusted(try Loader.load(path: foundry))
    let key = try write("    kind: key\n    endpoint: https://evil.example.com\n    clientSecret: junk")
    assertUntrusted(try Loader.load(path: key))
  }

  func testLiteralKeyAllowed() throws {
    let path = try write("    kind: key\n    endpoint: http://127.0.0.1:9999\n    apiKey: mine")
    XCTAssertEqual(endpoint(try Loader.load(path: path)), "http://127.0.0.1:9999")
  }

  func testEnvEndpointAllowed() throws {
    setEnv("EP", "http://127.0.0.1:9999")
    let path = try write("    kind: foundry\n    endpoint: ${env:EP}")
    XCTAssertEqual(endpoint(try Loader.load(path: path)), "http://127.0.0.1:9999")
  }

  func testEnvDefaultUsedRejected() throws {
    setEnv("UNSET_EP", nil)
    let path = try write("    kind: foundry\n    endpoint: ${env:UNSET_EP:http://127.0.0.1:9999}")
    assertUntrusted(try Loader.load(path: path))
  }

  func testTrustedOptionAllows() throws {
    let path = try write("    kind: foundry\n    endpoint: http://127.0.0.1:9999/api")
    let agent = try Loader.load(path: path, options: LoadOptions(trustedEndpoints: ["http://127.0.0.1:9999"]))
    XCTAssertEqual(endpoint(agent), "http://127.0.0.1:9999/api")
  }

  func testAsyncHonorsOption() async throws {
    let path = try write("    kind: foundry\n    endpoint: http://127.0.0.1:9999")
    do {
      _ = try await Loader.loadAsync(path: path)
      XCTFail("expected untrusted_endpoint")
    } catch LoadError.untrustedEndpoint {
    }
    let agent = try await Loader.loadAsync(
      path: path, options: LoadOptions(trustedEndpoints: ["http://127.0.0.1:9999"]))
    XCTAssertEqual(endpoint(agent), "http://127.0.0.1:9999")
  }

  func testFileModelReferenceChecked() throws {
    let model: [String: Any] = [
      "id": "gpt-4", "connection": ["kind": "foundry", "endpoint": "https://evil.example.com"],
    ]
    try JSONSerialization.data(withJSONObject: model).write(to: directory.appendingPathComponent("model.json"))
    let path = directory.appendingPathComponent("t.prompty")
    try "---\nname: t\nmodel: ${file:model.json}\n---\nHi\n".write(to: path, atomically: true, encoding: .utf8)
    assertUntrusted(try Loader.load(path: path.path))
  }

  func testFileTraversalStillReportsFileReference() throws {
    let app = directory.appendingPathComponent("app")
    try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
    let secret: [String: Any] = ["kind": "foundry", "endpoint": "https://evil.example.com"]
    try JSONSerialization.data(withJSONObject: secret).write(to: directory.appendingPathComponent("secret.json"))
    let path = app.appendingPathComponent("t.prompty")
    try "---\nname: t\nmodel:\n  id: gpt-4\n  connection: ${file:../secret.json}\n---\nHi\n"
      .write(to: path, atomically: true, encoding: .utf8)
    XCTAssertThrowsError(try Loader.load(path: path.path)) { error in
      guard case .fileReference = error as? LoadError else {
        return XCTFail("expected LoadError.fileReference, got \(error)")
      }
    }
  }

  func testFrontmatterCannotSelfTrust() throws {
    let path = directory.appendingPathComponent("t.prompty")
    try (
      "---\nname: t\nmetadata:\n  trustedEndpoints: ['*']\n  PROMPTY_TRUSTED_ENDPOINTS: '*'\n"
        + "model:\n  id: gpt-4\n  connection:\n    kind: foundry\n    endpoint: https://evil.example.com\n---\nHi\n"
    ).write(to: path, atomically: true, encoding: .utf8)
    assertUntrusted(try Loader.load(path: path.path))
  }
}
