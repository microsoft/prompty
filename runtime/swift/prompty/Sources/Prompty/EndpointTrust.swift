import Foundation
import PromptyModel

/// Loader-side wiring for endpoint trust (spec §2.5.1).
///
/// The classification and origin matching live in `PromptyModel.EndpointTrust`;
/// this extracts the RAW `model.connection` (following whole-value `${file:}`
/// references for `model` and `model.connection` with the same containment as
/// reference resolution) and maps a rejection onto `LoadError.untrustedEndpoint`.
enum EndpointTrustCheck {

  static func check(
    _ data: [String: Any], agentDirectory: URL, allowedRoots: [URL], trustedEndpoints: [String]
  ) throws {
    let connection = try EndpointTrust.rawConnection(data) { reference -> Any? in
      let target = URL(fileURLWithPath: reference, relativeTo: agentDirectory)
        .standardizedFileURL.resolvingSymlinksInPath()
      // A missing file is reported by reference resolution, after this check.
      guard FileManager.default.fileExists(atPath: target.path) else { return nil }
      return try References.resolveString(
        "${file:\(reference)}", key: "model", agentDirectory: agentDirectory, allowedRoots: allowedRoots)
    }
    do {
      try EndpointTrust.checkConnection(connection, trustedEndpoints: trustedEndpoints)
    } catch let error as PromptyLoadError {
      throw LoadError.untrustedEndpoint(error.message)
    }
  }
}
