package prompty_test

import (
	"testing"

	"prompty/model"
)

func TestUnionPropertyPreservesInheritedFields(t *testing.T) {
	required, nullable := true, true
	input := map[string]interface{}{
		"name":        "choice",
		"kind":        "union",
		"description": "A nullable choice",
		"required":    required,
		"nullable":    nullable,
		"default":     "fallback",
		"example":     "example",
		"enumValues":  []interface{}{"a", "b"},
		"anyOf":       []interface{}{map[string]interface{}{"kind": "string"}},
	}

	union, err := prompty.LoadUnionProperty(input, prompty.NewLoadContext())
	if err != nil {
		t.Fatalf("LoadUnionProperty returned an error: %v", err)
	}
	if union.Name != "choice" || union.Description == nil || *union.Description != "A nullable choice" {
		t.Fatalf("inherited fields were not loaded: %#v", union)
	}
	if union.Required == nil || !*union.Required || union.Nullable == nil || !*union.Nullable {
		t.Fatalf("inherited required/nullable fields were not loaded: %#v", union)
	}

	saved := union.Save(prompty.NewSaveContext())
	for _, key := range []string{"name", "description", "required", "nullable", "default", "example", "enumValues"} {
		if _, ok := saved[key]; !ok {
			t.Errorf("Save dropped inherited field %q", key)
		}
	}
}

func TestUnionPropertyRejectsEmptyAndContradictoryCompositions(t *testing.T) {
	for _, input := range []map[string]interface{}{
		{},
		{"kind": "union"},
		{
			"kind":  "union",
			"oneOf": []interface{}{map[string]interface{}{"kind": "string"}},
			"anyOf": []interface{}{map[string]interface{}{"kind": "integer"}},
		},
	} {
		if _, err := prompty.LoadUnionProperty(input, prompty.NewLoadContext()); err == nil {
			t.Errorf("expected invalid UnionProperty %#v to be rejected", input)
		}
	}
}
