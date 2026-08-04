// Copyright (c) Microsoft. All rights reserved.

package prompty_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"prompty/model"
)

type connectionRoundtripVectorDocument struct {
	Vectors []connectionRoundtripVector `json:"vectors"`
}

type connectionRoundtripVector struct {
	Name      string                 `json:"name"`
	Operation string                 `json:"operation"`
	Input     map[string]interface{} `json:"input"`
	Expected  map[string]interface{} `json:"expected"`
}

func TestConnectionRoundtripVectorsPreserveExactDiscriminatorAndPayload(t *testing.T) {
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"spec",
		"vectors",
		"model",
		"connection_roundtrip_vectors.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read Connection roundtrip vectors: %v", err)
	}

	var document connectionRoundtripVectorDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("failed to parse Connection roundtrip vectors: %v", err)
	}

	for _, vector := range document.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			if vector.Operation != "load-save-reload" {
				t.Fatalf("unsupported vector operation %q", vector.Operation)
			}

			loaded, err := prompty.LoadConnection(vector.Input, prompty.NewLoadContext())
			if err != nil {
				t.Fatalf("load failed: %v", err)
			}

			saved := saveConnection(t, loaded)
			if saved["kind"] != vector.Expected["kind"] {
				t.Fatalf("save changed discriminator: expected %v, got %v", vector.Expected["kind"], saved["kind"])
			}
			if !reflect.DeepEqual(saved, vector.Expected) {
				t.Fatalf("save changed Connection payload:\nexpected: %#v\nactual:   %#v", vector.Expected, saved)
			}

			reloaded, err := prompty.LoadConnection(saved, prompty.NewLoadContext())
			if err != nil {
				t.Fatalf("reload failed: %v", err)
			}
			resaved := saveConnection(t, reloaded)
			if !reflect.DeepEqual(resaved, vector.Expected) {
				t.Fatalf("reload changed Connection payload:\nexpected: %#v\nactual:   %#v", vector.Expected, resaved)
			}
		})
	}
}

func saveConnection(t *testing.T, connection interface{}) map[string]interface{} {
	t.Helper()

	method := reflect.ValueOf(connection).MethodByName("Save")
	if !method.IsValid() {
		t.Fatalf("loaded Connection type %T does not expose Save", connection)
	}
	results := method.Call([]reflect.Value{reflect.ValueOf(prompty.NewSaveContext())})
	if len(results) != 1 {
		t.Fatalf("loaded Connection type %T returned %d Save results", connection, len(results))
	}
	saved, ok := results[0].Interface().(map[string]interface{})
	if !ok {
		t.Fatalf("loaded Connection type %T returned unexpected Save result %T", connection, results[0].Interface())
	}
	return saved
}
