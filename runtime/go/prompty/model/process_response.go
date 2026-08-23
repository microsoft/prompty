// Hand-written pipeline layer: response processing.
//
// Converts a raw provider response (OpenAI chat/responses/embedding/image or
// Anthropic messages) into a normalized result: a string for text, a list of
// tool-call descriptors for tool use, a parsed object for structured output, or
// embedding vectors. Mirrors the C# OpenAIProcessor / AnthropicProcessor
// reference implementations.

package prompty

import (
	"encoding/json"
	"strings"
)

// ProcessResponse normalizes a raw provider response. hasOutputs indicates the
// prompt declared structured outputs, so text content should be JSON-parsed.
func ProcessResponse(provider, apiType string, response any, hasOutputs bool) (any, error) {
	resp, _ := response.(map[string]interface{})
	switch provider {
	case "anthropic":
		return processAnthropicResponse(resp, hasOutputs), nil
	default: // openai
		switch apiType {
		case "responses":
			return processOpenAIResponses(resp, hasOutputs), nil
		case "embedding":
			return processOpenAIEmbedding(resp), nil
		case "image":
			return processOpenAIImage(resp), nil
		default: // chat, agent
			return processOpenAIChat(resp, hasOutputs), nil
		}
	}
}

// maybeParseStructured JSON-parses content when structured outputs are declared,
// falling back to the raw string when parsing fails.
func maybeParseStructured(content string, hasOutputs bool) any {
	if !hasOutputs {
		return content
	}
	var parsed any
	if err := json.Unmarshal([]byte(content), &parsed); err == nil {
		return parsed
	}
	return content
}

func processOpenAIChat(resp map[string]interface{}, hasOutputs bool) any {
	choices, _ := resp["choices"].([]interface{})
	if len(choices) == 0 {
		return ""
	}
	choice, _ := choices[0].(map[string]interface{})
	message, _ := choice["message"].(map[string]interface{})

	if tcs, ok := message["tool_calls"].([]interface{}); ok && len(tcs) > 0 {
		return extractOpenAIToolCalls(tcs)
	}

	content := message["content"]
	if content == nil {
		if refusal, ok := message["refusal"].(string); ok && refusal != "" {
			return refusal
		}
		return ""
	}
	contentStr, _ := content.(string)
	return maybeParseStructured(contentStr, hasOutputs)
}

func extractOpenAIToolCalls(tcs []interface{}) []interface{} {
	out := make([]interface{}, 0, len(tcs))
	for _, item := range tcs {
		tc, _ := item.(map[string]interface{})
		fn, _ := tc["function"].(map[string]interface{})
		out = append(out, map[string]interface{}{
			"id":        tc["id"],
			"name":      fn["name"],
			"arguments": fn["arguments"],
		})
	}
	return out
}

func processOpenAIResponses(resp map[string]interface{}, hasOutputs bool) any {
	output, _ := resp["output"].([]interface{})
	toolCalls := []interface{}{}
	for _, item := range output {
		it, _ := item.(map[string]interface{})
		if it["type"] == "function_call" {
			toolCalls = append(toolCalls, map[string]interface{}{
				"id":        it["call_id"],
				"name":      it["name"],
				"arguments": it["arguments"],
			})
		}
	}
	if len(toolCalls) > 0 {
		return toolCalls
	}
	outputText, _ := resp["output_text"].(string)
	return maybeParseStructured(outputText, hasOutputs)
}

func processOpenAIEmbedding(resp map[string]interface{}) any {
	data, _ := resp["data"].([]interface{})
	if len(data) == 1 {
		d, _ := data[0].(map[string]interface{})
		return d["embedding"]
	}
	out := make([]interface{}, 0, len(data))
	for _, item := range data {
		d, _ := item.(map[string]interface{})
		out = append(out, d["embedding"])
	}
	return out
}

func processOpenAIImage(resp map[string]interface{}) any {
	data, _ := resp["data"].([]interface{})
	if len(data) == 0 {
		return ""
	}
	d, _ := data[0].(map[string]interface{})
	if url, ok := d["url"].(string); ok && url != "" {
		return url
	}
	if b64, ok := d["b64_json"].(string); ok && b64 != "" {
		return b64
	}
	return ""
}

func processAnthropicResponse(resp map[string]interface{}, hasOutputs bool) any {
	content, _ := resp["content"].([]interface{})
	toolCalls := []interface{}{}
	var text strings.Builder
	for _, item := range content {
		block, _ := item.(map[string]interface{})
		switch block["type"] {
		case "tool_use":
			args, _ := json.Marshal(block["input"])
			toolCalls = append(toolCalls, map[string]interface{}{
				"id":        block["id"],
				"name":      block["name"],
				"arguments": string(args),
			})
		case "text":
			if t, ok := block["text"].(string); ok {
				text.WriteString(t)
			}
		}
	}
	if len(toolCalls) > 0 {
		return toolCalls
	}
	return maybeParseStructured(text.String(), hasOutputs)
}
