import Foundation

/// Shared renderer preparation.
import PromptyModel

public enum RenderCommon {

  /// Replace rich-kind inputs with nonce placeholders.
  ///
  /// Thread, image, file, and audio inputs are structured values that cannot be
  /// stringified into a template. Instead each is swapped for a unique marker
  /// that the preparation stage expands back into real content parts after
  /// parsing. Doing it this way keeps injected content out of the template
  /// engine entirely.
  public static func prepareRenderInputs(
    _ agent: Prompty,
    inputs: [String: Any]
  ) -> (inputs: [String: Any], nonces: [String: String]) {
    var prepared = inputs
    var nonces: [String: String] = [:]

    for property in agent.inputProperties
    where Defaults.richKinds.contains(property.kindName) {
      let name = property.name
      guard !name.isEmpty, prepared[name] != nil else { continue }
      let nonce = makeNonce(for: name)
      nonces[name] = nonce
      prepared[name] = nonce
    }

    return (prepared, nonces)
  }

  /// Build a `__PROMPTY_THREAD_<8 hex>_<name>__` placeholder.
  public static func makeNonce(for name: String) -> String {
    var hex = ""
    for _ in 0..<4 {
      hex += String(format: "%02x", UInt8.random(in: 0...255))
    }
    return "\(Defaults.threadNoncePrefix)\(hex)_\(name)__"
  }
}
