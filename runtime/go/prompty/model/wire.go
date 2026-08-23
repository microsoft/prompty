// Hand-written pipeline layer: provider wire-format request building.
//
// Maps canonical agent inputs (provider, apiType, model, messages, tools,
// options, outputs) into a provider-specific request body — OpenAI chat /
// responses / embedding / image, and Anthropic messages. Mirrors the C#
// WireFormat + AnthropicExecutor reference builders.

package prompty

import (
	"fmt"
	"strings"
)

// BuildWireRequest maps canonical inputs into a provider-specific request body.
// The input map carries: provider, apiType, model_id, messages, tools, options,
// outputs.
func BuildWireRequest(input map[string]interface{}) (map[string]interface{}, error) {
	provider, _ := input["provider"].(string)
	apiType, _ := input["apiType"].(string)
	if apiType == "" {
		apiType = "chat"
	}
	modelID, _ := input["model_id"].(string)
	messages := wireMapSlice(input["messages"])
	tools := wireMapSlice(input["tools"])
	outputs := wireMapSlice(input["outputs"])
	options, _ := input["options"].(map[string]interface{})

	if provider == "anthropic" {
		return buildAnthropicWire(modelID, messages, tools, options), nil
	}
	switch apiType {
	case "chat":
		return buildOpenAIChatWire(modelID, messages, tools, options, outputs), nil
	case "responses":
		return buildOpenAIResponsesWire(modelID, messages, tools, outputs), nil
	case "embedding":
		return buildOpenAIEmbeddingWire(modelID, messages), nil
	case "image":
		return buildOpenAIImageWire(modelID, messages), nil
	}
	return nil, fmt.Errorf("unsupported apiType %q for wire request", apiType)
}

// -----------------------------------------------------------------------------
// OpenAI chat completions
// -----------------------------------------------------------------------------

func buildOpenAIChatWire(modelID string, messages, tools []map[string]interface{}, options map[string]interface{}, outputs []map[string]interface{}) map[string]interface{} {
	body := map[string]interface{}{"model": modelID}
	applyOpenAIOptions(body, options)

	msgs := make([]interface{}, 0, len(messages))
	for _, m := range messages {
		role, _ := m["role"].(string)
		parts := wireMapSlice(m["content"])
		msgs = append(msgs, map[string]interface{}{"role": role, "content": openAIChatContent(parts)})
	}
	body["messages"] = msgs

	if wireTools := openAIChatTools(tools); wireTools != nil {
		body["tools"] = wireTools
	}
	if len(outputs) > 0 {
		body["response_format"] = map[string]interface{}{
			"type": "json_schema",
			"json_schema": map[string]interface{}{
				"name":   "structured_output",
				"strict": true,
				"schema": buildOutputSchema(outputs),
			},
		}
	}
	return body
}

// openAIChatContent collapses a single text part to a plain string, otherwise
// builds an array of typed content blocks.
func openAIChatContent(parts []map[string]interface{}) interface{} {
	if len(parts) == 1 && parts[0]["kind"] == "text" {
		return parts[0]["value"]
	}
	arr := make([]interface{}, 0, len(parts))
	for _, p := range parts {
		switch p["kind"] {
		case "text":
			arr = append(arr, map[string]interface{}{"type": "text", "text": p["value"]})
		case "image":
			arr = append(arr, map[string]interface{}{
				"type":      "image_url",
				"image_url": map[string]interface{}{"url": p["value"]},
			})
		case "audio":
			arr = append(arr, map[string]interface{}{
				"type": "input_audio",
				"input_audio": map[string]interface{}{
					"data":   p["value"],
					"format": audioFormat(p["mediaType"]),
				},
			})
		}
	}
	return arr
}

func openAIChatTools(tools []map[string]interface{}) []interface{} {
	if len(tools) == 0 {
		return nil
	}
	out := make([]interface{}, 0, len(tools))
	for _, t := range tools {
		fn := map[string]interface{}{"name": t["name"]}
		if d, ok := t["description"]; ok {
			fn["description"] = d
		}
		strict, _ := t["strict"].(bool)
		bindings, _ := t["bindings"].(map[string]interface{})
		fn["parameters"] = buildToolParamsSchema(wireMapSlice(t["parameters"]), strict, bindings)
		if strict {
			fn["strict"] = true
		}
		out = append(out, map[string]interface{}{"type": "function", "function": fn})
	}
	return out
}

// -----------------------------------------------------------------------------
// OpenAI responses API
// -----------------------------------------------------------------------------

func buildOpenAIResponsesWire(modelID string, messages, tools []map[string]interface{}, outputs []map[string]interface{}) map[string]interface{} {
	body := map[string]interface{}{"model": modelID}

	var systemTexts []string
	input := make([]interface{}, 0, len(messages))
	for _, m := range messages {
		role, _ := m["role"].(string)
		parts := wireMapSlice(m["content"])
		if role == "system" || role == "developer" {
			systemTexts = append(systemTexts, partsText(parts))
			continue
		}
		input = append(input, map[string]interface{}{"role": role, "content": openAIChatContent(parts)})
	}
	if len(systemTexts) > 0 {
		body["instructions"] = strings.Join(systemTexts, "\n")
	}
	body["input"] = input

	if wireTools := openAIResponsesTools(tools); wireTools != nil {
		body["tools"] = wireTools
	}
	if len(outputs) > 0 {
		body["text"] = map[string]interface{}{
			"format": map[string]interface{}{
				"type":   "json_schema",
				"name":   "structured_output",
				"schema": buildOutputSchema(outputs),
				"strict": true,
			},
		}
	}
	return body
}

func openAIResponsesTools(tools []map[string]interface{}) []interface{} {
	if len(tools) == 0 {
		return nil
	}
	out := make([]interface{}, 0, len(tools))
	for _, t := range tools {
		tool := map[string]interface{}{"type": "function", "name": t["name"]}
		if d, ok := t["description"]; ok {
			tool["description"] = d
		}
		strict, _ := t["strict"].(bool)
		bindings, _ := t["bindings"].(map[string]interface{})
		tool["parameters"] = buildToolParamsSchema(wireMapSlice(t["parameters"]), strict, bindings)
		if strict {
			tool["strict"] = true
		}
		out = append(out, tool)
	}
	return out
}

// -----------------------------------------------------------------------------
// OpenAI embedding + image
// -----------------------------------------------------------------------------

func buildOpenAIEmbeddingWire(modelID string, messages []map[string]interface{}) map[string]interface{} {
	texts := make([]string, 0, len(messages))
	for _, m := range messages {
		texts = append(texts, partsText(wireMapSlice(m["content"])))
	}
	var input interface{}
	if len(texts) == 1 {
		input = texts[0]
	} else {
		arr := make([]interface{}, 0, len(texts))
		for _, t := range texts {
			arr = append(arr, t)
		}
		input = arr
	}
	return map[string]interface{}{"model": modelID, "input": input}
}

func buildOpenAIImageWire(modelID string, messages []map[string]interface{}) map[string]interface{} {
	prompt := ""
	if len(messages) > 0 {
		prompt = partsText(wireMapSlice(messages[len(messages)-1]["content"]))
	}
	return map[string]interface{}{"model": modelID, "prompt": prompt}
}

// -----------------------------------------------------------------------------
// Anthropic messages
// -----------------------------------------------------------------------------

func buildAnthropicWire(modelID string, messages, tools []map[string]interface{}, options map[string]interface{}) map[string]interface{} {
	body := map[string]interface{}{"model": modelID}

	var systemTexts []string
	msgs := make([]interface{}, 0, len(messages))
	for _, m := range messages {
		role, _ := m["role"].(string)
		parts := wireMapSlice(m["content"])
		if role == "system" || role == "developer" {
			systemTexts = append(systemTexts, partsText(parts))
			continue
		}
		msgs = append(msgs, map[string]interface{}{"role": role, "content": anthropicContent(parts)})
	}
	if len(systemTexts) > 0 {
		body["system"] = strings.Join(systemTexts, "\n")
	}
	body["messages"] = msgs

	if wireTools := anthropicTools(tools); wireTools != nil {
		body["tools"] = wireTools
	}

	if options != nil {
		if opts, err := LoadModelOptions(options, NewLoadContext()); err == nil {
			for k, v := range opts.ToWire("anthropic") {
				body[k] = v
			}
		}
	}
	// Anthropic requires max_tokens; default when not supplied.
	if _, ok := body["max_tokens"]; !ok {
		body["max_tokens"] = 4096
	}
	return body
}

func anthropicContent(parts []map[string]interface{}) []interface{} {
	arr := make([]interface{}, 0, len(parts))
	for _, p := range parts {
		switch p["kind"] {
		case "text":
			arr = append(arr, map[string]interface{}{"type": "text", "text": p["value"]})
		case "image":
			arr = append(arr, map[string]interface{}{
				"type": "image",
				"source": map[string]interface{}{
					"type":       "base64",
					"media_type": p["mediaType"],
					"data":       p["value"],
				},
			})
		}
	}
	return arr
}

func anthropicTools(tools []map[string]interface{}) []interface{} {
	if len(tools) == 0 {
		return nil
	}
	out := make([]interface{}, 0, len(tools))
	for _, t := range tools {
		tool := map[string]interface{}{"name": t["name"]}
		if d, ok := t["description"]; ok {
			tool["description"] = d
		}
		bindings, _ := t["bindings"].(map[string]interface{})
		tool["input_schema"] = buildToolParamsSchema(wireMapSlice(t["parameters"]), false, bindings)
		out = append(out, tool)
	}
	return out
}

// -----------------------------------------------------------------------------
// JSON Schema builders
// -----------------------------------------------------------------------------

// buildToolParamsSchema builds a function-tool parameter schema. Parameters with
// a binding are stripped (host-supplied). required lists only required params.
// additionalProperties:false is emitted only in strict mode.
func buildToolParamsSchema(params []map[string]interface{}, strict bool, bindings map[string]interface{}) map[string]interface{} {
	props := map[string]interface{}{}
	required := []interface{}{}
	for _, p := range params {
		name, _ := p["name"].(string)
		if bindings != nil {
			if _, bound := bindings[name]; bound {
				continue
			}
		}
		props[name] = toolProp(p)
		if req, _ := p["required"].(bool); req {
			required = append(required, name)
		}
	}
	schema := map[string]interface{}{"type": "object", "properties": props}
	if len(required) > 0 {
		schema["required"] = required
	}
	if strict {
		schema["additionalProperties"] = false
	}
	return schema
}

func toolProp(p map[string]interface{}) map[string]interface{} {
	kind, _ := p["kind"].(string)
	schema := map[string]interface{}{"type": jsonSchemaType(kind)}
	if kind == "array" {
		if items, ok := p["items"].(map[string]interface{}); ok {
			ik, _ := items["kind"].(string)
			schema["items"] = map[string]interface{}{"type": jsonSchemaType(ik)}
		}
	}
	return schema
}

// buildOutputSchema builds a strict structured-output object schema: every
// property is required, optional (not required:true) properties become nullable,
// and additionalProperties:false is always set.
func buildOutputSchema(outputs []map[string]interface{}) map[string]interface{} {
	props := map[string]interface{}{}
	required := []interface{}{}
	for _, o := range outputs {
		name, _ := o["name"].(string)
		props[name] = outputProp(o)
		required = append(required, name)
	}
	return map[string]interface{}{
		"type":                 "object",
		"properties":           props,
		"required":             required,
		"additionalProperties": false,
	}
}

func outputProp(p map[string]interface{}) map[string]interface{} {
	kind, _ := p["kind"].(string)
	required, _ := p["required"].(bool)
	schema := map[string]interface{}{}
	switch kind {
	case "object":
		nested := wireMapSlice(p["properties"])
		nestedProps := map[string]interface{}{}
		nestedReq := []interface{}{}
		for _, np := range nested {
			n, _ := np["name"].(string)
			nestedProps[n] = outputProp(np)
			nestedReq = append(nestedReq, n)
		}
		schema["type"] = nullableType("object", required)
		schema["properties"] = nestedProps
		schema["required"] = nestedReq
		schema["additionalProperties"] = false
	case "array":
		schema["type"] = nullableType("array", required)
		if items, ok := p["items"].(map[string]interface{}); ok {
			ik, _ := items["kind"].(string)
			schema["items"] = map[string]interface{}{"type": jsonSchemaType(ik)}
		}
	default:
		schema["type"] = nullableType(jsonSchemaType(kind), required)
	}
	return schema
}

// nullableType returns the bare type when required, otherwise a [type, "null"]
// union (OpenAI strict-mode nullability for optional fields).
func nullableType(t string, required bool) interface{} {
	if required {
		return t
	}
	return []interface{}{t, "null"}
}

func jsonSchemaType(kind string) string {
	switch kind {
	case "string":
		return "string"
	case "integer":
		return "integer"
	case "float":
		return "number"
	case "boolean":
		return "boolean"
	case "array":
		return "array"
	case "object":
		return "object"
	default:
		return "string"
	}
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

func applyOpenAIOptions(body, options map[string]interface{}) {
	if len(options) == 0 {
		return
	}
	opts, err := LoadModelOptions(options, NewLoadContext())
	if err != nil {
		return
	}
	for k, v := range opts.ToWire("openai") {
		body[k] = v
	}
	// additionalProperties are spread directly into the request body.
	for k, v := range opts.AdditionalProperties {
		body[k] = v
	}
}

func audioFormat(mediaType interface{}) string {
	s, _ := mediaType.(string)
	s = strings.TrimPrefix(s, "audio/")
	if s == "mpeg" {
		return "mp3"
	}
	return s
}

func partsText(parts []map[string]interface{}) string {
	var b strings.Builder
	for _, p := range parts {
		if p["kind"] == "text" {
			if v, ok := p["value"].(string); ok {
				b.WriteString(v)
			}
		}
	}
	return b.String()
}

func wireMapSlice(v interface{}) []map[string]interface{} {
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}
