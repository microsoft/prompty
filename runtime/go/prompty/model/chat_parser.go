// Hand-written pipeline layer: chat parsing + thread expansion.
//
// Splits rendered text with role markers (system:, user:, assistant:,
// developer:, tool:) into structured messages, coercing role-marker attributes
// into typed metadata, and expands thread nonce markers emitted by the renderer
// into spliced conversation history. Mirrors the C# PromptyChatParser and
// Pipeline.ExpandThreadMarkers reference implementation.

package prompty

import (
	"regexp"
	"strconv"
	"strings"
)

var roleMarkerRegex = regexp.MustCompile(`(?m)^(system|user|assistant|developer|tool)(\[.*?\])?:\s*$`)
var threadNonceRegex = regexp.MustCompile(`__PROMPTY_THREAD_[a-f0-9]{8}_(\w+)__`)
var attrsRegex = regexp.MustCompile(`(\w+)\s*=\s*"?([^",\]]+)"?`)

// ParseMessages parses rendered text with role markers into a list of messages.
// Content with no role marker at all becomes a single system message.
func ParseMessages(rendered string) []Message {
	messages := []Message{}
	lines := strings.Split(rendered, "\n")

	currentRole := ""
	haveRole := false
	var currentContent []string
	var currentAttrs map[string]interface{}

	for _, line := range lines {
		if m := roleMarkerRegex.FindStringSubmatch(line); m != nil {
			if haveRole {
				messages = append(messages, createMessage(currentRole, currentContent, currentAttrs))
			}
			currentRole = m[1]
			haveRole = true
			currentAttrs = parseAttributes(m[2])
			currentContent = []string{}
		} else {
			currentContent = append(currentContent, line)
		}
	}

	if haveRole {
		messages = append(messages, createMessage(currentRole, currentContent, currentAttrs))
	} else if len(currentContent) > 0 {
		text := strings.TrimSpace(strings.Join(currentContent, "\n"))
		if text != "" {
			messages = append(messages, Message{
				Role:  RoleSystem,
				Parts: []interface{}{TextPart{Kind: "text", Value: text}},
			})
		}
	}

	return messages
}

func createMessage(role string, contentLines []string, attrs map[string]interface{}) Message {
	text := strings.Join(contentLines, "\n")
	// Trim leading/trailing blank lines but preserve internal whitespace.
	text = strings.Trim(text, "\r\n")

	msg := Message{
		Role:  Role(role),
		Parts: []interface{}{TextPart{Kind: "text", Value: text}},
	}
	if len(attrs) > 0 {
		msg.Metadata = attrs
	}
	return msg
}

func parseAttributes(attrGroup string) map[string]interface{} {
	if attrGroup == "" {
		return nil
	}
	inner := strings.TrimSuffix(strings.TrimPrefix(attrGroup, "["), "]")
	if strings.TrimSpace(inner) == "" {
		return nil
	}
	attrs := map[string]interface{}{}
	for _, m := range attrsRegex.FindAllStringSubmatch(inner, -1) {
		attrs[m[1]] = coerceAttrValue(m[2])
	}
	if len(attrs) == 0 {
		return nil
	}
	return attrs
}

// coerceAttrValue coerces an unquoted attribute value to bool/int/float, with a
// string fallback, so markers like user[id=7] produce typed metadata.
func coerceAttrValue(raw string) interface{} {
	value := strings.TrimSpace(raw)
	if strings.EqualFold(value, "true") {
		return true
	}
	if strings.EqualFold(value, "false") {
		return false
	}
	if i, err := strconv.Atoi(value); err == nil {
		return i
	}
	if f, err := strconv.ParseFloat(value, 64); err == nil {
		return f
	}
	return value
}

// messageText concatenates the text of a message's text parts.
func messageText(msg Message) string {
	var b strings.Builder
	for _, p := range msg.Parts {
		switch tp := p.(type) {
		case TextPart:
			b.WriteString(tp.Value)
		case *TextPart:
			if tp != nil {
				b.WriteString(tp.Value)
			}
		case map[string]interface{}:
			if v, ok := tp["value"].(string); ok {
				b.WriteString(v)
			}
		}
	}
	return b.String()
}

func copyMetadata(src map[string]interface{}) map[string]interface{} {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]interface{}, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

// ExpandThreadMarkers replaces thread nonce markers in messages with the
// conversation history supplied in threadInputs, splicing history at the marker
// position and preserving any surrounding text as its own message.
func ExpandThreadMarkers(messages []Message, threadInputs map[string][]Message) []Message {
	result := []Message{}
	for _, msg := range messages {
		text := messageText(msg)
		loc := threadNonceRegex.FindStringSubmatchIndex(text)
		if loc == nil {
			result = append(result, msg)
			continue
		}
		inputName := text[loc[2]:loc[3]]
		threadMessages, ok := threadInputs[inputName]
		if !ok {
			result = append(result, msg)
			continue
		}

		before := strings.TrimRight(text[:loc[0]], " \t\r\n")
		after := strings.TrimLeft(text[loc[1]:], " \t\r\n")

		if strings.TrimSpace(before) != "" {
			result = append(result, Message{
				Role:     msg.Role,
				Parts:    []interface{}{TextPart{Kind: "text", Value: before}},
				Metadata: copyMetadata(msg.Metadata),
			})
		}
		result = append(result, threadMessages...)
		if strings.TrimSpace(after) != "" {
			result = append(result, Message{
				Role:     msg.Role,
				Parts:    []interface{}{TextPart{Kind: "text", Value: after}},
				Metadata: copyMetadata(msg.Metadata),
			})
		}
	}
	return result
}
