import Foundation

public enum Discovery {
  public static func enrich(_ base: ModelInfo, provider: String) -> ModelInfo {
    guard let entry = CapabilityDataset.shared.match(modelId: base.id, provider: provider) else {
      return base
    }

    var info = base
    if info.contextWindow == nil, let contextWindow = entry.contextWindow {
      info.contextWindow = contextWindow
    }
    if info.inputModalities == nil, let inputModalities = entry.inputModalities {
      info.inputModalities = inputModalities
    }
    if info.outputModalities == nil, let outputModalities = entry.outputModalities {
      info.outputModalities = outputModalities
    }
    return info
  }

  public static func mapModel(_ raw: Any?, provider: String) throws -> ModelInfo {
    guard let raw else {
      throw TypraRuntimeError.invalidObject(type: "ModelInfo")
    }
    return try mapModel(raw, provider: provider)
  }

  public static func mapModel(_ raw: Any, provider: String) throws -> ModelInfo {
    let data = try TypraRuntime.object(raw, typeName: "ModelInfo")
    var info = ModelInfo()
    info.additionalProperties = data

    switch provider {
    case "anthropic":
      info.id = string(data["id"]) ?? ""
      info.displayName = string(data["display_name"])
      info.ownedBy = "anthropic"
      info.contextWindow = int32(data["context_length"])
      info.inputModalities = stringArray(data["input_modalities"])
      info.outputModalities = stringArray(data["output_modalities"])
    case "foundry":
      mapFoundryModel(data, into: &info)
    default:
      info.id = string(data["id"]) ?? ""
      info.ownedBy = string(data["owned_by"])
    }

    return info
  }

  private static func mapFoundryModel(_ data: [String: Any], into info: inout ModelInfo) {
    if let properties = data["properties"] as? [String: Any] {
      let model = properties["model"] as? [String: Any]
      let capabilities = properties["capabilities"] as? [String: Any]
      info.id = string(data["name"]) ?? ""
      info.displayName = string(model?["name"])
      info.ownedBy = string(model?["publisher"])
      info.contextWindow = int32(model?["maxContextLength"])
      info.inputModalities = stringArray(capabilities?["supportedInputModalities"])
      info.outputModalities = stringArray(capabilities?["supportedOutputModalities"])
    } else if data["modelName"] != nil || string(data["type"]) == "ModelDeployment" {
      info.id = string(data["name"]) ?? ""
      info.displayName = string(data["modelName"])
      info.ownedBy = string(data["modelPublisher"])
      info.contextWindow = int32(data["maxContextLength"])
    } else {
      info.id = string(data["id"]) ?? ""
      info.ownedBy = string(data["owned_by"])
      info.contextWindow = int32(data["maxContextLength"])
    }
  }
}

public func enrich(_ base: ModelInfo, provider: String) -> ModelInfo {
  Discovery.enrich(base, provider: provider)
}

public func mapModel(_ raw: Any, provider: String) throws -> ModelInfo {
  try Discovery.mapModel(raw, provider: provider)
}

private struct CapabilityEntry {
  let prefix: String
  let contextWindow: Int32?
  let inputModalities: [String]?
  let outputModalities: [String]?

  init?(_ data: [String: Any]) {
    guard let prefix = string(data["prefix"]) else {
      return nil
    }
    self.prefix = prefix
    contextWindow = int32(data["contextWindow"])
    inputModalities = stringArray(data["inputModalities"])
    outputModalities = stringArray(data["outputModalities"])
  }
}

private struct CapabilityDataset {
  static let shared = CapabilityDataset.load()

  let providers: [String: [CapabilityEntry]]

  func match(modelId: String, provider: String) -> CapabilityEntry? {
    guard let entries = providers[provider] else {
      return nil
    }

    return entries
      .filter { isBoundaryPrefix($0.prefix, of: modelId) }
      .max { $0.prefix.count < $1.prefix.count }
  }

  private func isBoundaryPrefix(_ prefix: String, of modelId: String) -> Bool {
    if modelId == prefix {
      return true
    }
    guard modelId.hasPrefix(prefix), let boundary = modelId.dropFirst(prefix.count).unicodeScalars.first else {
      return false
    }
    return !CharacterSet.alphanumerics.contains(boundary)
  }

  private static func load() -> CapabilityDataset {
    guard
      let url = Bundle.module.url(forResource: "model_capabilities", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let providersObject = object["providers"] as? [String: Any]
    else {
      return CapabilityDataset(providers: [:])
    }

    var providers: [String: [CapabilityEntry]] = [:]
    for (name, rawEntries) in providersObject {
      guard let entryObjects = rawEntries as? [[String: Any]] else {
        continue
      }
      providers[name] = entryObjects.compactMap(CapabilityEntry.init)
    }
    return CapabilityDataset(providers: providers)
  }
}

private func string(_ value: Any?) -> String? {
  value as? String
}

private func int32(_ value: Any?) -> Int32? {
  if let value = value as? Int32 {
    return value
  }
  if let value = value as? Int {
    return Int32(exactly: value)
  }
  if let value = value as? Int64 {
    return Int32(exactly: value)
  }
  if let value = value as? NSNumber, !TypraRuntime.isBoolNumber(value) {
    return Int32(exactly: value.int64Value)
  }
  return nil
}

private func stringArray(_ value: Any?) -> [String]? {
  guard let array = value as? [Any] else {
    return nil
  }
  return array.compactMap { $0 as? String }
}
