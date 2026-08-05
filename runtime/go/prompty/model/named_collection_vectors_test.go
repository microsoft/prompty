// Copyright (c) Microsoft. All rights reserved.

package prompty_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"prompty/model"
)

type namedCollectionVectorDocument struct {
	Vectors []namedCollectionVector `json:"vectors"`
}

type namedCollectionVector struct {
	Name           string                 `json:"name"`
	Operation      string                 `json:"operation"`
	CollectionPath string                 `json:"collectionPath"`
	Input          map[string]interface{} `json:"input"`
	Expected       map[string]interface{} `json:"expected"`
}

func namedCollectionVectors(t *testing.T) []namedCollectionVector {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "spec", "vectors", "model", "named_collection_vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read named collection vectors: %v", err)
	}
	var document namedCollectionVectorDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("failed to parse named collection vectors: %v", err)
	}
	if len(document.Vectors) == 0 {
		t.Fatal("named collection vectors must contain a vectors array")
	}
	return document.Vectors
}

func cloneEntry(entry map[string]interface{}) map[string]interface{} {
	clone := make(map[string]interface{}, len(entry)+1)
	for key, value := range entry {
		clone[key] = value
	}
	return clone
}

// semanticEntries normalizes either named-collection wire form into a comparable
// list of entries carrying an explicit name, mirroring the Rust reference test.
func semanticEntries(t *testing.T, vectorName string, collection interface{}) []map[string]interface{} {
	t.Helper()
	switch typed := collection.(type) {
	case []interface{}:
		entries := make([]map[string]interface{}, 0, len(typed))
		for index, raw := range typed {
			entry, ok := raw.(map[string]interface{})
			if !ok {
				t.Fatalf("[%s] array-form entry %d must be an object, got %T", vectorName, index, raw)
			}
			clone := cloneEntry(entry)
			if _, present := clone["name"]; !present {
				clone["name"] = ""
			}
			entries = append(entries, clone)
		}
		return entries
	case map[string]interface{}:
		names := make([]string, 0, len(typed))
		for name := range typed {
			names = append(names, name)
		}
		sort.Strings(names)
		entries := make([]map[string]interface{}, 0, len(names))
		for _, name := range names {
			entry, ok := typed[name].(map[string]interface{})
			if !ok {
				t.Fatalf("[%s] object-form entry %q must be an object, got %T", vectorName, name, typed[name])
			}
			clone := cloneEntry(entry)
			clone["name"] = name
			entries = append(entries, clone)
		}
		return entries
	default:
		t.Fatalf("[%s] named collection must be an array or object, got %T", vectorName, collection)
		return nil
	}
}

// assertSubset requires every field declared by the vector to be present and
// equal on the actual entry. Fields the vector does not mention are ignored.
func assertSubset(t *testing.T, actual interface{}, expected interface{}, path string) {
	t.Helper()
	expectedObject, isObject := expected.(map[string]interface{})
	if !isObject {
		actualJSON, _ := json.Marshal(actual)
		expectedJSON, _ := json.Marshal(expected)
		if string(actualJSON) != string(expectedJSON) {
			t.Errorf("%s: expected %s, got %s", path, expectedJSON, actualJSON)
		}
		return
	}
	actualObject, ok := actual.(map[string]interface{})
	if !ok {
		t.Errorf("%s: expected an object, got %T", path, actual)
		return
	}
	for key, expectedValue := range expectedObject {
		actualValue, present := actualObject[key]
		if !present {
			t.Errorf("%s: missing field %q", path, key)
			continue
		}
		assertSubset(t, actualValue, expectedValue, fmt.Sprintf("%s.%s", path, key))
	}
}

func assertNamedCollection(t *testing.T, vectorName string, collection interface{}, expected map[string]interface{}) {
	t.Helper()

	expectedFormat, ok := expected["collectionFormat"].(string)
	if !ok {
		t.Fatalf("[%s] roundtrip vector must declare collectionFormat", vectorName)
	}
	actualFormat := "object"
	if _, isArray := collection.([]interface{}); isArray {
		actualFormat = "array"
	}
	if actualFormat != expectedFormat {
		t.Errorf("[%s] expected %s collection form, got %s", vectorName, expectedFormat, actualFormat)
		return
	}

	// wireEntries assert on the raw saved payload rather than the normalized
	// entries: each is {index, absentFields}, requiring that the entry at that
	// position never materializes a synthetic field such as an empty name.
	if wireEntries, present := expected["wireEntries"].([]interface{}); present {
		rawEntries, isArray := collection.([]interface{})
		if !isArray {
			t.Fatalf("[%s] wire entry assertions require array form", vectorName)
		}
		for _, rawAssertion := range wireEntries {
			assertion, isObject := rawAssertion.(map[string]interface{})
			if !isObject {
				t.Fatalf("[%s] wire entry assertion must be an object", vectorName)
			}
			indexFloat, isNumber := assertion["index"].(float64)
			if !isNumber {
				t.Fatalf("[%s] wire entry assertion must declare a numeric index", vectorName)
			}
			index := int(indexFloat)
			if index < 0 || index >= len(rawEntries) {
				t.Errorf("[%s] wire entry index %d out of range (%d entries)", vectorName, index, len(rawEntries))
				continue
			}
			entry, isEntryObject := rawEntries[index].(map[string]interface{})
			if !isEntryObject {
				t.Errorf("[%s] wire entry %d must be an object, got %T", vectorName, index, rawEntries[index])
				continue
			}
			absentFields, hasAbsent := assertion["absentFields"].([]interface{})
			if !hasAbsent {
				continue
			}
			for _, rawField := range absentFields {
				field, isString := rawField.(string)
				if !isString {
					t.Fatalf("[%s] wire entry absent field must be a string", vectorName)
				}
				if value, populated := entry[field]; populated {
					t.Errorf("[%s] wire entry %d unexpectedly materialized field %q as %v",
						vectorName, index, field, value)
				}
			}
		}
	}

	actualEntries := semanticEntries(t, vectorName, collection)
	expectedEntries, ok := expected["entries"].([]interface{})
	if !ok {
		t.Fatalf("[%s] roundtrip vector must declare entries", vectorName)
	}
	if len(actualEntries) != len(expectedEntries) {
		t.Errorf("[%s] named collection entry count changed: expected %d, got %d",
			vectorName, len(expectedEntries), len(actualEntries))
		return
	}

	if absentFields, present := expected["absentEntryFields"].([]interface{}); present {
		for _, entry := range actualEntries {
			for _, rawField := range absentFields {
				field, isString := rawField.(string)
				if !isString {
					t.Fatalf("[%s] absent entry field must be a string", vectorName)
				}
				if value, populated := entry[field]; populated {
					t.Errorf("[%s] entry %v unexpectedly populated field %q with %v",
						vectorName, entry["name"], field, value)
				}
			}
		}
	}

	if preserve, _ := expected["preserveOrder"].(bool); preserve {
		for index, expectedEntry := range expectedEntries {
			assertSubset(t, actualEntries[index], expectedEntry, fmt.Sprintf("%s.entries[%d]", vectorName, index))
		}
		return
	}

	actualByName := make(map[string]map[string]interface{}, len(actualEntries))
	for _, entry := range actualEntries {
		name, isString := entry["name"].(string)
		if !isString {
			t.Fatalf("[%s] semantic entry name must be a string", vectorName)
		}
		actualByName[name] = entry
	}
	for _, rawExpected := range expectedEntries {
		expectedEntry, isObject := rawExpected.(map[string]interface{})
		if !isObject {
			t.Fatalf("[%s] expected entry must be an object", vectorName)
		}
		name, isString := expectedEntry["name"].(string)
		if !isString {
			t.Fatalf("[%s] expected entry name must be a string", vectorName)
		}
		actualEntry, found := actualByName[name]
		if !found {
			t.Errorf("[%s] missing named entry %q", vectorName, name)
			continue
		}
		assertSubset(t, actualEntry, expectedEntry, fmt.Sprintf("%s.entries.%s", vectorName, name))
	}
}

// TestNamedCollectionRoundtripVectors ports the Rust reference suite so the
// named-collection load/save/reload contract is executed against the Go
// emitted models rather than merely assumed to hold.
func TestNamedCollectionRoundtripVectors(t *testing.T) {
	for _, vector := range namedCollectionVectors(t) {
		if vector.Operation != "load-save-reload" {
			continue
		}
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			loaded, err := prompty.LoadPrompty(vector.Input, prompty.NewLoadContext())
			if err != nil {
				t.Fatalf("[%s] valid collection failed to load: %v", vector.Name, err)
			}

			saved := loaded.Save(prompty.NewSaveContext())
			collection, present := saved[vector.CollectionPath]
			if !present {
				t.Fatalf("[%s] missing collection %q after save", vector.Name, vector.CollectionPath)
			}
			assertNamedCollection(t, vector.Name, collection, vector.Expected)

			reloaded, err := prompty.LoadPrompty(saved, prompty.NewLoadContext())
			if err != nil {
				t.Fatalf("[%s] saved collection failed to reload: %v", vector.Name, err)
			}
			resaved := reloaded.Save(prompty.NewSaveContext())
			reloadedCollection, present := resaved[vector.CollectionPath]
			if !present {
				t.Fatalf("[%s] reload lost collection %q", vector.Name, vector.CollectionPath)
			}
			assertNamedCollection(t, vector.Name, reloadedCollection, vector.Expected)
		})
	}
}

// TestNamedCollectionRejectionVectors covers the load-error half of the
// contract: array-valued entries in name-keyed object form must be rejected
// recursively rather than silently coerced.
func TestNamedCollectionRejectionVectors(t *testing.T) {
	for _, vector := range namedCollectionVectors(t) {
		if vector.Operation != "load-error" {
			continue
		}
		vector := vector
		t.Run(vector.Name, func(t *testing.T) {
			loaded, err := prompty.LoadPrompty(vector.Input, prompty.NewLoadContext())
			if err == nil {
				encoded, _ := json.Marshal(loaded)
				t.Fatalf("[%s] expected rejection at %v (category %v), but load succeeded: %s",
					vector.Name, vector.Expected["path"], vector.Expected["valueCategory"], encoded)
			}
		})
	}
}
