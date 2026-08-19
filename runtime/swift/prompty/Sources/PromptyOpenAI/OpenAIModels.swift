/// OpenAI model discovery: map a raw `/v1/models` entry to `ModelInfo`.
///
/// OpenAI reports only `id` and `owned_by`, so the mapped result is enriched
/// from the shared capability dataset (`Discovery.enrich`). The full raw entry
/// is preserved under `additionalProperties`.
import Foundation
import Prompty
import PromptyModel

public enum OpenAIModels {

  /// Convert a raw OpenAI model object into an enriched `ModelInfo`.
  public static func modelInfo(fromWire raw: Any) -> ModelInfo {
    let object = raw as? [String: Any] ?? [:]
    var info = ModelInfo()
    info.id = object["id"] as? String ?? ""
    info.ownedBy = object["owned_by"] as? String
    info.additionalProperties = object
    Discovery.enrich(provider: "openai", info: &info)
    return info
  }
}
