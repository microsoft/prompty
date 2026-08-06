// Copyright (c) Microsoft. All rights reserved.

package prompty_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"prompty/model"
)

type propertyScalarCoercionVectorDocument struct {
	Vectors []propertyScalarCoercionVector `json:"vectors"`
}

type propertyScalarCoercionVector struct {
	Name      string                       `json:"name"`
	Operation string                       `json:"operation"`
	Cases     []propertyScalarCoercionCase `json:"cases"`
}

type propertyScalarCoercionCase struct {
	Name     string          `json:"name"`
	Input    json.RawMessage `json:"input"`
	Expected struct {
		Kind    string      `json:"kind"`
		Example interface{} `json:"example"`
	} `json:"expected"`
}

func TestAllPrimitivePropertyScalarsCoerceAtomically(t *testing.T) {
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"spec",
		"vectors",
		"model",
		"property_scalar_coercion_vectors.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read Property scalar coercion vectors: %v", err)
	}

	var document propertyScalarCoercionVectorDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("failed to parse Property scalar coercion vectors: %v", err)
	}
	if len(document.Vectors) != 1 {
		t.Fatalf("expected one atomic Property scalar coercion vector, got %d", len(document.Vectors))
	}
	vector := document.Vectors[0]
	if vector.Name != "all_primitive_property_scalars_coerce_atomically" || vector.Operation != "load" {
		t.Fatalf("unexpected Property scalar coercion vector %q operation %q", vector.Name, vector.Operation)
	}
	expectedNames := []string{"string", "integer", "float", "boolean"}
	if len(vector.Cases) != len(expectedNames) {
		t.Fatalf("expected all four primitive scalar cases, got %d", len(vector.Cases))
	}

	for index, scalarCase := range vector.Cases {
		if scalarCase.Name != expectedNames[index] {
			t.Fatalf("scalar case %d: expected %q, got %q", index, expectedNames[index], scalarCase.Name)
		}
		loaded, err := prompty.PropertyFromJSON(string(scalarCase.Input))
		if err != nil {
			t.Errorf("[%s] load failed: %v", scalarCase.Name, err)
			continue
		}
		property, ok := loaded.(prompty.Property)
		if !ok {
			t.Errorf("[%s] expected Property, got %T", scalarCase.Name, loaded)
			continue
		}
		if property.Kind != scalarCase.Expected.Kind {
			t.Errorf("[%s] expected kind %q, got %q", scalarCase.Name, scalarCase.Expected.Kind, property.Kind)
			continue
		}
		if property.Example == nil {
			t.Errorf("[%s] expected example, got nil", scalarCase.Name)
			continue
		}
		actualJSON, err := json.Marshal(*property.Example)
		if err != nil {
			t.Errorf("[%s] failed to encode actual example: %v", scalarCase.Name, err)
			continue
		}
		expectedJSON, err := json.Marshal(scalarCase.Expected.Example)
		if err != nil {
			t.Errorf("[%s] failed to encode expected example: %v", scalarCase.Name, err)
			continue
		}
		if string(actualJSON) != string(expectedJSON) {
			t.Errorf("[%s] expected example %s, got %s", scalarCase.Name, expectedJSON, actualJSON)
		}
	}
}
