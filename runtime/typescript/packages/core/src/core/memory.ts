import { MemoryEntry, MemoryStore } from "../model/index.js";

export interface ScoredMemory {
  entry: MemoryEntry;
  score: number;
  keywordMatches: number;
}

export interface MemoryPort {
  load(): MemoryStore;
  save(store: MemoryStore): void;
}

export function addMemory(store: MemoryStore, entry: MemoryEntry): void {
  store.entries.push(entry);
}

export function remember(
  store: MemoryStore,
  entry: MemoryEntry,
  maxEntries = 0,
): void {
  if (entry.category === "core") {
    store.entries = store.entries.filter(
      (existing) =>
        existing.category !== "core" || !tagsEqual(existing.tags, entry.tags),
    );
  }
  store.entries.push(entry);
  evictToCap(store, maxEntries);
}

export function evictToCap(store: MemoryStore, maxEntries: number): number {
  if (maxEntries <= 0) {
    return 0;
  }
  let evicted = 0;
  while (store.entries.length > maxEntries) {
    const archivalIndex = store.entries.findIndex(
      (entry) => entry.category === "archival",
    );
    store.entries.splice(archivalIndex >= 0 ? archivalIndex : 0, 1);
    evicted += 1;
  }
  return evicted;
}

export function updateMemory(
  store: MemoryStore,
  index: number,
  entry: MemoryEntry,
): void {
  requireIndex(store, index);
  store.entries[index] = entry;
}

export function updateContent(
  store: MemoryStore,
  index: number,
  content: string,
): void {
  requireIndex(store, index);
  store.entries[index]!.content = content;
}

export function removeMemory(store: MemoryStore, index: number): MemoryEntry {
  requireIndex(store, index);
  return store.entries.splice(index, 1)[0]!;
}

export function clearMemory(store: MemoryStore, category?: string): number {
  const before = store.entries.length;
  if (category === undefined || category === null || category === "") {
    store.entries = [];
  } else {
    store.entries = store.entries.filter(
      (entry) => entry.category !== category,
    );
  }
  return before - store.entries.length;
}

export function coreMemories(store: MemoryStore): MemoryEntry[] {
  return store.entries.filter((entry) => entry.category === "core");
}

export function recall(
  store: MemoryStore,
  query: string,
  limit = 0,
): ScoredMemory[] {
  const tokens = queryTokens(query);
  const hasQuery = tokens.length > 0;
  const scored: ScoredMemory[] = [];

  for (const entry of store.entries) {
    const { score, keywordMatches } = scoreEntry(entry, tokens);
    if (hasQuery && keywordMatches === 0) {
      continue;
    }
    scored.push({ entry, score, keywordMatches });
  }

  scored.sort((left, right) => right.score - left.score);
  return limit > 0 ? scored.slice(0, limit) : scored;
}

export function formatForSystemPrompt(store: MemoryStore): string {
  const core = coreMemories(store);
  if (core.length === 0) {
    return "";
  }
  return `## Memory\n${core.map((entry) => `- ${entry.content}\n`).join("")}`;
}

export function formatRecallResults(results: ScoredMemory[]): string {
  if (results.length === 0) {
    return "";
  }
  return results
    .map((result, index) => {
      let line = `${index + 1}. [${result.entry.category}] ${result.entry.content}\n`;
      if (result.entry.tags && result.entry.tags.length > 0) {
        line += `   tags: ${result.entry.tags.join(", ")}\n`;
      }
      return line;
    })
    .join("");
}

function requireIndex(store: MemoryStore, index: number): void {
  if (index < 0 || index >= store.entries.length) {
    throw new RangeError(
      `memory index ${index} out of bounds (len ${store.entries.length})`,
    );
  }
}

function tagsEqual(left?: string[], right?: string[]): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function queryTokens(query: string): string[] {
  const tokens: string[] = [];
  for (const raw of (query ?? "").split(/\s+/u)) {
    const trimmed = trimNonAlphanumeric(raw).toLowerCase();
    if (trimmed.length > 0 && !tokens.includes(trimmed)) {
      tokens.push(trimmed);
    }
  }
  return tokens;
}

function trimNonAlphanumeric(value: string): string {
  return value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function scoreEntry(
  entry: MemoryEntry,
  tokens: string[],
): { score: number; keywordMatches: number } {
  if (tokens.length === 0) {
    return { score: 0, keywordMatches: 0 };
  }
  const content = (entry.content ?? "").toLowerCase();
  const tags = (entry.tags ?? []).map((tag) => tag.toLowerCase());
  let score = 0;
  let keywordMatches = 0;

  for (const token of tokens) {
    const inContent = content.includes(token);
    const inTags = tags.some((tag) => tag.includes(token));
    if (inContent || inTags) {
      keywordMatches += 1;
    }
    if (inContent) {
      score += 2;
    }
    if (inTags) {
      score += 3;
    }
  }
  if (score > 0 && entry.category === "core") {
    score += 1;
  }
  return { score, keywordMatches };
}
