/// Anthropic model discovery: map a raw `/v1/models` entry to `ModelInfo`.
///
/// Anthropic supplies capability fields directly (`context_length`,
/// `input_modalities`, `output_modalities`), so shared-dataset enrichment is
/// applied only as a fill-only-missing fallback. `ownedBy` is always
/// `"anthropic"`. This mirrors `runtime/rust/prompty-anthropic/src/models.rs`.
import Foundation
import Prompty
import PromptyModel

public enum AnthropicModels {

  /// Convert a raw Anthropic model object into an enriched `ModelInfo`.
  public static func modelInfo(fromWire raw: Any) -> ModelInfo {
    let object = raw as? [String: Any] ?? [:]
    var info = ModelInfo()
    info.id = object["id"] as? String ?? ""
    info.displayName = object["display_name"] as? String
    info.ownedBy = "anthropic"
    if let window = object["context_length"] as? NSNumber {
      info.contextWindow = window.int32Value
    }
    info.inputModalities = stringArray(object, "input_modalities")
    info.outputModalities = stringArray(object, "output_modalities")
    info.additionalProperties = object
    Discovery.enrich(provider: "anthropic", info: &info)
    return info
  }

  private static func stringArray(_ object: [String: Any], _ field: String) -> [String]? {
    guard let array = object[field] as? [Any] else { return nil }
    return array.compactMap { $0 as? String }
  }
}
