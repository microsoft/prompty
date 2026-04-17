// Hand-written helper methods for generated model types.
// Implements the MessageHelpers and ToolResultHelpers interfaces
// declared by the TypeSpec emitter.

package prompty

import "strings"

// Text concatenates all TextPart values in the message, joined by newline.
func (m *Message) Text() string {
	var texts []string
	for _, part := range m.Parts {
		if tp, ok := part.(TextPart); ok {
			texts = append(texts, tp.Value)
		} else if ptr, ok := part.(*TextPart); ok {
			texts = append(texts, ptr.Value)
		}
	}
	return strings.Join(texts, "\n")
}

// Text concatenates all TextPart values in the tool result, joined by newline.
func (tr *ToolResult) Text() string {
	var texts []string
	for _, part := range tr.Parts {
		if tp, ok := part.(TextPart); ok {
			texts = append(texts, tp.Value)
		} else if ptr, ok := part.(*TextPart); ok {
			texts = append(texts, ptr.Value)
		}
	}
	return strings.Join(texts, "\n")
}
