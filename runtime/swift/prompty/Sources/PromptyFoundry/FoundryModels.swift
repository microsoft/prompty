/// Foundry/Azure model discovery: map raw catalog and deployment entries to
/// `ModelInfo`.
///
/// Foundry project connections list *deployments* (the invokable ids), while
/// Azure OpenAI key connections list the lower-level *model catalog*. Both raw
/// shapes map into the provider-neutral `ModelInfo` contract, then are enriched
/// from the shared dataset (a no-op today — the dataset has no foundry entries).
/// This mirrors `runtime/rust/prompty-foundry/src/models.rs`.
import Foundation
import Prompty
import PromptyModel

public enum FoundryModels {

  /// Map one Azure OpenAI model-catalog entry into `ModelInfo`.
  public static func modelInfo(fromCatalog raw: Any) -> ModelInfo {
    let object = raw as? [String: Any] ?? [:]
    var info = ModelInfo()
    info.id = object["id"] as? String ?? ""
    info.ownedBy = object["owned_by"] as? String
    if let window = int32(object, ["maxContextLength"]) {
      info.contextWindow = window
    }
    info.additionalProperties = object
    Discovery.enrich(provider: "foundry", info: &info)
    return info
  }

  /// Map one Foundry deployment entry into `ModelInfo`. Handles both the flat
  /// data-plane shape (`modelName`, `modelPublisher`, top-level `capabilities`)
  /// and the nested ARM management-plane shape (`properties.model`).
  public static func modelInfo(fromDeployment raw: Any) -> ModelInfo {
    let object = raw as? [String: Any] ?? [:]
    let properties = object["properties"] as? [String: Any] ?? [:]
    let model = properties["model"] as? [String: Any] ?? [:]
    let capabilities =
      (properties["capabilities"] as? [String: Any])
      ?? (model["capabilities"] as? [String: Any])
      ?? (object["capabilities"] as? [String: Any])
      ?? [:]

    var info = ModelInfo()
    info.id = object["name"] as? String ?? ""
    info.displayName = (object["modelName"] as? String) ?? (model["name"] as? String)
    info.ownedBy =
      (object["modelPublisher"] as? String) ?? (model["publisher"] as? String) ?? "azure"
    info.contextWindow =
      int32(capabilities, ["maxContextLength", "contextWindow", "context_length"])
      ?? int32(model, ["maxContextLength"])
      ?? int32(object, ["maxContextLength"])
    info.inputModalities = stringVec(
      capabilities, ["inputModalities", "input_modalities", "supportedInputModalities"])
    info.outputModalities = stringVec(
      capabilities, ["outputModalities", "output_modalities", "supportedOutputModalities"])
    info.additionalProperties = object
    Discovery.enrich(provider: "foundry", info: &info)
    return info
  }

  /// Read the first key that holds an integer, accepting numeric strings too.
  private static func int32(_ object: [String: Any], _ keys: [String]) -> Int32? {
    for key in keys {
      guard let value = object[key] else { continue }
      if let number = value as? NSNumber { return number.int32Value }
      if let text = value as? String, let parsed = Int32(text) { return parsed }
    }
    return nil
  }

  /// Read the first key that holds a string list, accepting a comma-separated
  /// string too.
  private static func stringVec(_ object: [String: Any], _ keys: [String]) -> [String]? {
    for key in keys {
      guard let value = object[key] else { continue }
      if let array = value as? [Any] {
        return array.compactMap { $0 as? String }
      }
      if let text = value as? String {
        return text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
          .filter { !$0.isEmpty }
      }
    }
    return nil
  }
}
