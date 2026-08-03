package prompty

import (
	"encoding/json"
	"testing"
)

func TestUnionPropertyPreservesInheritedFieldsOnRoundTrip(t *testing.T) {
	input := `{
		"name":"rowVisual",
		"kind":"union",
		"description":"A nullable visual setting",
		"required":true,
		"nullable":true,
		"enumValues":["thin","thick"],
		"anyOf":[{"kind":"string"},{"kind":"integer"}]
	}`

	property, err := UnionPropertyFromJSON(input)
	if err != nil {
		t.Fatalf("UnionPropertyFromJSON() error = %v", err)
	}
	if property.Name != "rowVisual" || property.Kind != "union" {
		t.Fatalf("inherited name and kind were not loaded: %#v", property)
	}
	if property.Description == nil || *property.Description != "A nullable visual setting" {
		t.Fatalf("inherited description was not loaded: %#v", property.Description)
	}
	if property.Required == nil || !*property.Required || property.Nullable == nil || !*property.Nullable {
		t.Fatalf("inherited required/nullable flags were not loaded: %#v", property)
	}
	if len(property.EnumValues) != 2 || len(property.AnyOf) != 2 || property.OneOf != nil {
		t.Fatalf("unexpected union composition or inherited enum values: %#v", property)
	}

	output, err := property.ToJSON()
	if err != nil {
		t.Fatalf("ToJSON() error = %v", err)
	}
	var roundTripped map[string]interface{}
	if err := json.Unmarshal([]byte(output), &roundTripped); err != nil {
		t.Fatalf("round-trip JSON is invalid: %v", err)
	}
	for _, field := range []string{"name", "kind", "description", "required", "nullable", "enumValues", "anyOf"} {
		if _, ok := roundTripped[field]; !ok {
			t.Errorf("round-trip JSON lost inherited or union field %q: %s", field, output)
		}
	}
}
