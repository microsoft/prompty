// Copyright (c) Microsoft. All rights reserved.

package prompty_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"prompty/model"
)

type contentPartDiscriminatorVectorDocument struct {
	Vectors []contentPartDiscriminatorVector `json:"vectors"`
}

type contentPartDiscriminatorVector struct {
	Name      string                 `json:"name"`
	Operation string                 `json:"operation"`
	Input     map[string]interface{} `json:"input"`
	Expected  map[string]interface{} `json:"expected"`
}

func TestContentPartDiscriminatorVectorsEnforceClosedCaseSensitiveKinds(t *testing.T) {
	path := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"spec",
		"vectors",
		"model",
		"content_part_discriminator_vectors.json",
	)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read ContentPart discriminator vectors: %v", err)
	}

	var document contentPartDiscriminatorVectorDocument
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatalf("failed to parse ContentPart discriminator vectors: %v", err)
	}

	for _, vector := range document.Vectors {
		t.Run(vector.Name, func(t *testing.T) {
			loaded, err := prompty.LoadContentPart(vector.Input, prompty.NewLoadContext())

			switch vector.Operation {
			case "load":
				if err != nil {
					t.Fatalf("known ContentPart failed to load: %v", err)
				}
				saved := saveContentPart(t, loaded)
				if !reflect.DeepEqual(saved, vector.Expected) {
					t.Fatalf("load/save changed ContentPart payload:\nexpected: %#v\nactual:   %#v", vector.Expected, saved)
				}
			case "load-error":
				if err == nil {
					t.Fatalf("closed ContentPart accepted unknown discriminator %v", vector.Input["kind"])
				}
				diagnostic := err.Error()
				discriminator := vector.Expected["discriminator"].(string)
				value := vector.Expected["value"].(string)
				if !strings.Contains(diagnostic, discriminator) {
					t.Fatalf("error did not identify discriminator %q: %s", discriminator, diagnostic)
				}
				if !strings.Contains(diagnostic, value) {
					t.Fatalf("error did not preserve discriminator value %q: %s", value, diagnostic)
				}
			default:
				t.Fatalf("unsupported vector operation %q", vector.Operation)
			}
		})
	}
}

func saveContentPart(t *testing.T, contentPart interface{}) map[string]interface{} {
	t.Helper()

	method := reflect.ValueOf(contentPart).MethodByName("Save")
	if !method.IsValid() {
		t.Fatalf("loaded ContentPart type %T does not expose Save", contentPart)
	}
	results := method.Call([]reflect.Value{reflect.ValueOf(prompty.NewSaveContext())})
	if len(results) != 1 {
		t.Fatalf("loaded ContentPart type %T returned %d Save results", contentPart, len(results))
	}
	saved, ok := results[0].Interface().(map[string]interface{})
	if !ok {
		t.Fatalf("loaded ContentPart type %T returned unexpected Save result %T", contentPart, results[0].Interface())
	}
	return saved
}
