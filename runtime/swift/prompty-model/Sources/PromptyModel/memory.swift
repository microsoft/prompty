import Foundation

public struct ScoredMemory {
  public var entry: MemoryEntry
  public var score: Double
  public var keywordMatches: Int

  public init(entry: MemoryEntry, score: Double, keywordMatches: Int) {
    self.entry = entry
    self.score = score
    self.keywordMatches = keywordMatches
  }
}

public protocol MemoryPort {
  func load() -> MemoryStore
  func save(_ store: MemoryStore)
}

public func addMemory(_ store: inout MemoryStore, _ entry: MemoryEntry) {
  store.entries.append(entry)
}

public func remember(_ store: inout MemoryStore, _ entry: MemoryEntry, maxEntries: Int = 0) {
  if entry.category == .core {
    store.entries.removeAll { existing in
      existing.category == .core && tagsEqual(existing.tags, entry.tags)
    }
  }
  store.entries.append(entry)
  _ = evictToCap(&store, maxEntries: maxEntries)
}

public func evictToCap(_ store: inout MemoryStore, maxEntries: Int) -> Int {
  if maxEntries <= 0 { return 0 }
  var evicted = 0
  while store.entries.count > maxEntries {
    let victim = store.entries.firstIndex { $0.category == .archival } ?? 0
    store.entries.remove(at: victim)
    evicted += 1
  }
  return evicted
}

public func updateMemory(_ store: inout MemoryStore, index: Int, entry: MemoryEntry) throws {
  try requireIndex(store, index)
  store.entries[index] = entry
}

public func updateContent(_ store: inout MemoryStore, index: Int, content: String) throws {
  try requireIndex(store, index)
  store.entries[index].content = content
}

public func removeMemory(_ store: inout MemoryStore, index: Int) throws -> MemoryEntry {
  try requireIndex(store, index)
  return store.entries.remove(at: index)
}

public func clearMemory(_ store: inout MemoryStore, category: MemoryCategory? = nil) -> Int {
  let before = store.entries.count
  if let category {
    store.entries.removeAll { $0.category == category }
  } else {
    store.entries.removeAll()
  }
  return before - store.entries.count
}

public func coreMemories(_ store: MemoryStore) -> [MemoryEntry] {
  store.entries.filter { $0.category == .core }
}

public func recall(_ store: MemoryStore, query: String, limit: Int = 0) -> [ScoredMemory] {
  let tokens = queryTokens(query)
  let hasQuery = !tokens.isEmpty
  var scored: [ScoredMemory] = []

  for entry in store.entries {
    let result = scoreEntry(entry, tokens: tokens)
    if hasQuery && result.keywordMatches == 0 { continue }
    scored.append(ScoredMemory(entry: entry, score: result.score, keywordMatches: result.keywordMatches))
  }

  scored = scored.enumerated()
    .sorted { left, right in
      if left.element.score == right.element.score { return left.offset < right.offset }
      return left.element.score > right.element.score
    }
    .map(\.element)
  if limit > 0 && scored.count > limit {
    return Array(scored.prefix(limit))
  }
  return scored
}

public func formatForSystemPrompt(_ store: MemoryStore) -> String {
  let core = coreMemories(store)
  if core.isEmpty { return "" }
  return "## Memory\n" + core.map { "- \($0.content)\n" }.joined()
}

public func formatRecallResults(_ results: [ScoredMemory]) -> String {
  if results.isEmpty { return "" }
  return results.enumerated().map { index, result in
    var line = "\(index + 1). [\(result.entry.category.rawValue)] \(result.entry.content)\n"
    if let tags = result.entry.tags, !tags.isEmpty {
      line += "   tags: \(tags.joined(separator: ", "))\n"
    }
    return line
  }.joined()
}

private func requireIndex(_ store: MemoryStore, _ index: Int) throws {
  if index < 0 || index >= store.entries.count {
    throw MemoryError.indexOutOfRange("memory index \(index) out of bounds (len \(store.entries.count))")
  }
}

public enum MemoryError: Error {
  case indexOutOfRange(String)
}

private func tagsEqual(_ left: [String]?, _ right: [String]?) -> Bool {
  (left ?? []) == (right ?? [])
}

private func queryTokens(_ query: String) -> [String] {
  var tokens: [String] = []
  for raw in query.split(whereSeparator: { $0.isWhitespace }) {
    let token = trimNonAlphanumeric(String(raw)).lowercased()
    if !token.isEmpty && !tokens.contains(token) {
      tokens.append(token)
    }
  }
  return tokens
}

private func trimNonAlphanumeric(_ value: String) -> String {
  var scalars = value.unicodeScalars[...]
  while let first = scalars.first, !CharacterSet.alphanumerics.contains(first) {
    scalars.removeFirst()
  }
  while let last = scalars.last, !CharacterSet.alphanumerics.contains(last) {
    scalars.removeLast()
  }
  return String(String.UnicodeScalarView(scalars))
}

private func scoreEntry(_ entry: MemoryEntry, tokens: [String]) -> (score: Double, keywordMatches: Int) {
  if tokens.isEmpty { return (0, 0) }
  let content = entry.content.lowercased()
  let tags = (entry.tags ?? []).map { $0.lowercased() }
  var score = 0.0
  var keywordMatches = 0

  for token in tokens {
    let inContent = content.contains(token)
    let inTags = tags.contains { $0.contains(token) }
    if inContent || inTags {
      keywordMatches += 1
    }
    if inContent {
      score += 2
    }
    if inTags {
      score += 3
    }
  }
  if score > 0 && entry.category == .core {
    score += 1
  }
  return (score, keywordMatches)
}
