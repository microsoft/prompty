// Copyright (c) Microsoft. All rights reserved.

package prompty_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"prompty/model"
)

type functionToolLoadVector struct {
	Name     string `json:"name"`
	Expected struct {
		Tools []struct {
			Bindings map[string]struct {
				Input string `json:"input"`
			} `json:"bindings"`
		} `json:"tools"`
	} `json:"expected"`
}

func TestFunctionToolBindingsLoadVector(t *testing.T) {
	repositoryRoot := filepath.Join("..", "..", "..", "..")
	vectorsRaw, err := os.ReadFile(filepath.Join(repositoryRoot, "spec", "vectors", "load", "load_vectors.json"))
	if err != nil {
		t.Fatalf("failed to read load vectors: %v", err)
	}

	var vectors []functionToolLoadVector
	if err := json.Unmarshal(vectorsRaw, &vectors); err != nil {
		t.Fatalf("failed to parse load vectors: %v", err)
	}

	var expectedBindings map[string]struct {
		Input string `json:"input"`
	}
	for _, vector := range vectors {
		if vector.Name == "tools_function_load" {
			if len(vector.Expected.Tools) != 1 {
				t.Fatalf("tools_function_load expected one tool, got %d", len(vector.Expected.Tools))
			}
			expectedBindings = vector.Expected.Tools[0].Bindings
			break
		}
	}
	if expectedBindings == nil {
		t.Fatal("tools_function_load vector is missing expected bindings")
	}

	fixtureRaw, err := os.ReadFile(filepath.Join(repositoryRoot, "spec", "fixtures", "tools_function.prompty"))
	if err != nil {
		t.Fatalf("failed to read tools_function.prompty: %v", err)
	}
	sections := strings.SplitN(string(fixtureRaw), "---", 3)
	if len(sections) != 3 {
		t.Fatal("tools_function.prompty must contain YAML frontmatter")
	}

	var frontmatter struct {
		Tools []map[string]interface{} `yaml:"tools"`
	}
	if err := yaml.Unmarshal([]byte(sections[1]), &frontmatter); err != nil {
		t.Fatalf("failed to parse tools_function.prompty frontmatter: %v", err)
	}
	if len(frontmatter.Tools) != 1 {
		t.Fatalf("tools_function.prompty contains %d tools, expected one", len(frontmatter.Tools))
	}

	tool, err := prompty.LoadFunctionTool(frontmatter.Tools[0], prompty.NewLoadContext())
	if err != nil {
		t.Fatalf("failed to load FunctionTool: %v", err)
	}
	for name, expected := range expectedBindings {
		var actual *prompty.Binding
		for index := range tool.Bindings {
			if tool.Bindings[index].Name == name {
				actual = &tool.Bindings[index]
				break
			}
		}
		if actual == nil {
			t.Fatalf("missing binding %q", name)
		}
		if actual.Input != expected.Input {
			t.Fatalf("binding %q input: expected %q, got %q", name, expected.Input, actual.Input)
		}
	}
	if len(tool.Bindings) != len(expectedBindings) {
		t.Fatalf("expected %d bindings, got %d", len(expectedBindings), len(tool.Bindings))
	}
}
