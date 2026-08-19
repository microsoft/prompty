/// Shared model-discovery enrichment.
///
/// Provider `/models` endpoints disagree about how much they report: Anthropic
/// and Foundry return capability fields directly, while OpenAI returns only
/// ids. To keep discovery results consistent across providers *and* across
/// runtimes, every Prompty runtime embeds the same `model_capabilities.json`
/// snapshot and applies one shared rule — provider-supplied fields always win;
/// the dataset only fills fields the provider left empty (fill-only-missing),
/// matching model ids by longest prefix at a token boundary.
///
/// This mirrors the Rust reference in `runtime/rust/prompty/src/discovery.rs`.
/// The dataset is vendored (not emitted from TypeSpec) because it is volatile
/// provider data; a drift-guard test keeps the vendored copy byte-identical to
/// the canonical `spec/data/model_capabilities.json`.
import Foundation
import PromptyModel

public enum Discovery {

  /// Capability fields the dataset can fill. A `nil` array means "not in the
  /// dataset"; a present-but-empty array (e.g. embeddings) is an intentional
  /// value that still counts as a fill.
  struct Capabilities {
    var contextWindow: Int32?
    var inputModalities: [String]?
    var outputModalities: [String]?
  }

  /// Provider -> entries, each sorted longest-prefix-first so the first match
  /// wins.
  private static let table: [String: [(prefix: String, caps: Capabilities)]] = loadTable()

  /// Enrich `info` in place using the dataset entry for `provider` whose prefix
  /// matches `info.id`. Only fields that are currently `nil` are written.
  public static func enrich(provider: String, info: inout ModelInfo) {
    guard let caps = lookup(provider: provider, id: info.id) else { return }
    if info.contextWindow == nil, let value = caps.contextWindow {
      info.contextWindow = value
    }
    if info.inputModalities == nil, let value = caps.inputModalities {
      info.inputModalities = value
    }
    if info.outputModalities == nil, let value = caps.outputModalities {
      info.outputModalities = value
    }
  }

  /// Find the longest-prefix dataset entry for `id` within `provider`.
  static func lookup(provider: String, id: String) -> Capabilities? {
    guard let entries = table[provider] else { return nil }
    return entries.first { matches(id: id, prefix: $0.prefix) }?.caps
  }

  /// A prefix matches when `id` starts with it and the following character (if
  /// any) is a token boundary — non-alphanumeric. So `gpt-4` matches
  /// `gpt-4-0613` but not `gpt-45`.
  private static func matches(id: String, prefix: String) -> Bool {
    guard id.hasPrefix(prefix) else { return false }
    let next = id.index(id.startIndex, offsetBy: prefix.count)
    if next == id.endIndex { return true }
    return !id[next].isLetter && !id[next].isNumber
  }

  private static func loadTable() -> [String: [(prefix: String, caps: Capabilities)]] {
    guard let url = Bundle.module.url(forResource: "model_capabilities", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let providers = root["providers"] as? [String: Any]
    else {
      return [:]
    }

    var result: [String: [(prefix: String, caps: Capabilities)]] = [:]
    for (provider, rawEntries) in providers {
      guard let entries = rawEntries as? [[String: Any]] else { continue }
      var parsed: [(prefix: String, caps: Capabilities)] = []
      for entry in entries {
        guard let prefix = entry["prefix"] as? String else { continue }
        var caps = Capabilities()
        if let window = entry["contextWindow"] as? NSNumber {
          caps.contextWindow = window.int32Value
        }
        if let modalities = entry["inputModalities"] as? [Any] {
          caps.inputModalities = modalities.compactMap { $0 as? String }
        }
        if let modalities = entry["outputModalities"] as? [Any] {
          caps.outputModalities = modalities.compactMap { $0 as? String }
        }
        parsed.append((prefix: prefix, caps: caps))
      }
      parsed.sort { $0.prefix.count > $1.prefix.count }
      result[provider] = parsed
    }
    return result
  }
}
