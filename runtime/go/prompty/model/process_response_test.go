package prompty_test

import (
	"testing"

	prompty "prompty/model"
)

func TestOpenAIResponsesEmptyOutputTextFallsBackToMessageContent(t *testing.T) {
	response := map[string]interface{}{
		"object":      "response",
		"output_text": "",
		"output": []interface{}{
			map[string]interface{}{
				"type": "message",
				"content": []interface{}{
					map[string]interface{}{
						"type": "output_text",
						"text": "Nested text wins.",
					},
				},
			},
		},
	}

	result, err := prompty.ProcessResponse("openai", "responses", response, false)
	if err != nil {
		t.Fatalf("ProcessResponse failed: %v", err)
	}
	if result != "Nested text wins." {
		t.Fatalf("expected nested text fallback, got %#v", result)
	}
}
