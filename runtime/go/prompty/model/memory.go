package prompty

import (
	"fmt"
	"strings"
	"unicode"
)

// ScoredMemory is a recalled memory paired with its deterministic lexical score.
type ScoredMemory struct {
	Entry          MemoryEntry
	Score          float64
	KeywordMatches int
}

// MemoryPort is host-owned persistence for a whole MemoryStore snapshot.
type MemoryPort interface {
	Load() MemoryStore
	Save(store MemoryStore)
}

// AddMemory appends a memory with no tier policy applied.
func AddMemory(store *MemoryStore, entry MemoryEntry) {
	store.Entries = append(store.Entries, entry)
}

// Remember inserts a memory applying core deduplication and cap eviction.
func Remember(store *MemoryStore, entry MemoryEntry, maxEntries int) {
	if entry.Category == MemoryCategoryCore {
		filtered := store.Entries[:0]
		for _, existing := range store.Entries {
			if existing.Category == MemoryCategoryCore && tagsEqual(existing.Tags, entry.Tags) {
				continue
			}
			filtered = append(filtered, existing)
		}
		store.Entries = filtered
	}
	store.Entries = append(store.Entries, entry)
	EvictToCap(store, maxEntries)
}

// EvictToCap evicts oldest archival memories first, then oldest remaining memories.
func EvictToCap(store *MemoryStore, maxEntries int) int {
	if maxEntries <= 0 {
		return 0
	}
	evicted := 0
	for len(store.Entries) > maxEntries {
		victim := 0
		for i, entry := range store.Entries {
			if entry.Category == MemoryCategoryArchival {
				victim = i
				break
			}
		}
		store.Entries = append(store.Entries[:victim], store.Entries[victim+1:]...)
		evicted++
	}
	return evicted
}

// UpdateMemory replaces the memory at index.
func UpdateMemory(store *MemoryStore, index int, entry MemoryEntry) error {
	if index < 0 || index >= len(store.Entries) {
		return fmt.Errorf("memory index %d out of bounds (len %d)", index, len(store.Entries))
	}
	store.Entries[index] = entry
	return nil
}

// UpdateContent replaces only the content at index.
func UpdateContent(store *MemoryStore, index int, content string) error {
	if index < 0 || index >= len(store.Entries) {
		return fmt.Errorf("memory index %d out of bounds (len %d)", index, len(store.Entries))
	}
	store.Entries[index].Content = content
	return nil
}

// RemoveMemory removes and returns the memory at index.
func RemoveMemory(store *MemoryStore, index int) (MemoryEntry, error) {
	if index < 0 || index >= len(store.Entries) {
		return MemoryEntry{}, fmt.Errorf("memory index %d out of bounds (len %d)", index, len(store.Entries))
	}
	entry := store.Entries[index]
	store.Entries = append(store.Entries[:index], store.Entries[index+1:]...)
	return entry, nil
}

// ClearMemory removes memories by category, or all memories when category is nil.
func ClearMemory(store *MemoryStore, category *MemoryCategory) int {
	before := len(store.Entries)
	if category == nil {
		store.Entries = nil
		return before
	}
	filtered := store.Entries[:0]
	for _, entry := range store.Entries {
		if entry.Category != *category {
			filtered = append(filtered, entry)
		}
	}
	store.Entries = filtered
	return before - len(store.Entries)
}

// CoreMemories returns core memories in insertion order.
func CoreMemories(store MemoryStore) []MemoryEntry {
	var core []MemoryEntry
	for _, entry := range store.Entries {
		if entry.Category == MemoryCategoryCore {
			core = append(core, entry)
		}
	}
	return core
}

// Recall returns deterministic lexical recall results.
func Recall(store MemoryStore, query string, limit int) []ScoredMemory {
	tokens := queryTokens(query)
	hasQuery := len(tokens) > 0
	scored := make([]ScoredMemory, 0, len(store.Entries))
	for _, entry := range store.Entries {
		score, matches := scoreEntry(entry, tokens)
		if hasQuery && matches == 0 {
			continue
		}
		scored = append(scored, ScoredMemory{Entry: entry, Score: score, KeywordMatches: matches})
	}
	stableSortByScore(scored)
	if limit > 0 && len(scored) > limit {
		return scored[:limit]
	}
	return scored
}

// FormatForSystemPrompt formats core memories for injection into a system prompt.
func FormatForSystemPrompt(store MemoryStore) string {
	core := CoreMemories(store)
	if len(core) == 0 {
		return ""
	}
	var out strings.Builder
	out.WriteString("## Memory\n")
	for _, entry := range core {
		out.WriteString("- ")
		out.WriteString(entry.Content)
		out.WriteByte('\n')
	}
	return out.String()
}

// FormatRecallResults formats a recall result set for presentation.
func FormatRecallResults(results []ScoredMemory) string {
	if len(results) == 0 {
		return ""
	}
	var out strings.Builder
	for i, result := range results {
		out.WriteString(fmt.Sprintf("%d. [%s] %s\n", i+1, result.Entry.Category, result.Entry.Content))
		if len(result.Entry.Tags) > 0 {
			out.WriteString("   tags: ")
			out.WriteString(strings.Join(result.Entry.Tags, ", "))
			out.WriteByte('\n')
		}
	}
	return out.String()
}

func tagsEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func queryTokens(query string) []string {
	tokens := []string{}
	seen := map[string]bool{}
	for _, raw := range strings.Fields(query) {
		token := strings.ToLower(trimNonAlphanumeric(raw))
		if token != "" && !seen[token] {
			seen[token] = true
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func trimNonAlphanumeric(value string) string {
	runes := []rune(value)
	start := 0
	end := len(runes)
	for start < end && !unicode.IsLetter(runes[start]) && !unicode.IsDigit(runes[start]) {
		start++
	}
	for end > start && !unicode.IsLetter(runes[end-1]) && !unicode.IsDigit(runes[end-1]) {
		end--
	}
	return string(runes[start:end])
}

func scoreEntry(entry MemoryEntry, tokens []string) (float64, int) {
	if len(tokens) == 0 {
		return 0, 0
	}
	content := strings.ToLower(entry.Content)
	tags := make([]string, len(entry.Tags))
	for i, tag := range entry.Tags {
		tags[i] = strings.ToLower(tag)
	}
	score := 0.0
	matches := 0
	for _, token := range tokens {
		inContent := strings.Contains(content, token)
		inTags := false
		for _, tag := range tags {
			if strings.Contains(tag, token) {
				inTags = true
				break
			}
		}
		if inContent || inTags {
			matches++
		}
		if inContent {
			score += 2
		}
		if inTags {
			score += 3
		}
	}
	if score > 0 && entry.Category == MemoryCategoryCore {
		score += 1
	}
	return score, matches
}

func stableSortByScore(values []ScoredMemory) {
	for i := 1; i < len(values); i++ {
		item := values[i]
		j := i - 1
		for j >= 0 && values[j].Score < item.Score {
			values[j+1] = values[j]
			j--
		}
		values[j+1] = item
	}
}
