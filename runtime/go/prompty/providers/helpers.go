// Shared helpers for the built-in HTTP providers: canonical wire-input
// construction, connection resolution, JSON transport, and tool-message
// formatting. These are consumed by the openai, anthropic, and foundry
// sub-packages so the provider-specific files stay thin.

package providers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"

	prompty "prompty/model"
)

// ErrStreamingUnsupported is returned by ExecuteStream / ProcessStream for the
// raw-HTTP providers, which do not implement streaming.
var ErrStreamingUnsupported = errors.New("streaming is not supported by this provider")

// DefaultHTTPClient is the shared client used by all providers. Callers may
// replace it (e.g. in tests) before invoking an executor.
var DefaultHTTPClient = &http.Client{}

// BuildInput assembles the canonical wire-input map consumed by
// model.BuildWireRequest from an Agent and its rendered messages. wireProvider
// selects the wire family ("openai" or "anthropic"); Foundry/Azure use "openai".
func BuildInput(agent prompty.Agent, messages []prompty.Message, wireProvider string) map[string]interface{} {
	input := map[string]interface{}{
		"provider": wireProvider,
		"messages": messagesToWire(messages),
	}
	if saved := modelToMap(agent.Model); saved != nil {
		if v, ok := saved["id"]; ok {
			input["model_id"] = v
		}
		if v, ok := saved["apiType"]; ok {
			input["apiType"] = v
		}
		if v, ok := saved["options"]; ok {
			input["options"] = v
		}
	}
	if len(agent.Tools) > 0 {
		input["tools"] = saveSlice(agent.Tools)
	}
	if len(agent.Outputs) > 0 {
		input["outputs"] = saveSlice(agent.Outputs)
	}
	return input
}

// APIType returns the agent's declared API type, defaulting to "chat".
func APIType(agent prompty.Agent) string {
	if saved := modelToMap(agent.Model); saved != nil {
		if v, ok := saved["apiType"].(string); ok && v != "" {
			return v
		}
	}
	return "chat"
}

// HasOutputs reports whether the agent declared structured outputs.
func HasOutputs(agent prompty.Agent) bool {
	return len(agent.Outputs) > 0
}

// ModelID returns the coerce-union model's id (e.g. the deployment name),
// or "" when absent. Read through the saved map since Model|string lowers to
// interface{}.
func ModelID(agent prompty.Agent) string {
	if saved := modelToMap(agent.Model); saved != nil {
		if v, ok := saved["id"].(string); ok {
			return v
		}
	}
	return ""
}

// messagesToWire converts rendered messages into the canonical wire shape:
// [{role, content: [{kind, value, mediaType?}], metadata?}]. Media parts map
// their Source field to "value" (the key the wire builders consume).
func messagesToWire(messages []prompty.Message) []interface{} {
	out := make([]interface{}, 0, len(messages))
	for _, msg := range messages {
		content := make([]interface{}, 0, len(msg.Parts))
		for _, p := range msg.Parts {
			content = append(content, partToWire(p))
		}
		m := map[string]interface{}{"role": string(msg.Role), "content": content}
		if len(msg.Metadata) > 0 {
			m["metadata"] = msg.Metadata
		}
		out = append(out, m)
	}
	return out
}

func partToWire(p interface{}) map[string]interface{} {
	switch tp := p.(type) {
	case prompty.TextPart:
		return map[string]interface{}{"kind": tp.Kind, "value": tp.Value}
	case *prompty.TextPart:
		if tp == nil {
			return map[string]interface{}{}
		}
		return map[string]interface{}{"kind": tp.Kind, "value": tp.Value}
	case prompty.ImagePart:
		return mediaToWire(tp.Kind, tp.Source, tp.MediaType)
	case *prompty.ImagePart:
		if tp == nil {
			return map[string]interface{}{}
		}
		return mediaToWire(tp.Kind, tp.Source, tp.MediaType)
	case prompty.AudioPart:
		return mediaToWire(tp.Kind, tp.Source, tp.MediaType)
	case *prompty.AudioPart:
		if tp == nil {
			return map[string]interface{}{}
		}
		return mediaToWire(tp.Kind, tp.Source, tp.MediaType)
	case prompty.FilePart:
		return mediaToWire(tp.Kind, tp.Source, tp.MediaType)
	case *prompty.FilePart:
		if tp == nil {
			return map[string]interface{}{}
		}
		return mediaToWire(tp.Kind, tp.Source, tp.MediaType)
	case map[string]interface{}:
		return tp
	default:
		return map[string]interface{}{}
	}
}

func mediaToWire(kind, source string, mediaType *string) map[string]interface{} {
	m := map[string]interface{}{"kind": kind, "value": source}
	if mediaType != nil {
		m["mediaType"] = *mediaType
	}
	return m
}

// saveSlice serializes a slice of typed model values (tools, outputs) into their
// canonical map form for the wire builders.
func saveSlice(items []interface{}) []interface{} {
	out := make([]interface{}, 0, len(items))
	for _, it := range items {
		if s, ok := it.(interface {
			Save(*prompty.SaveContext) map[string]interface{}
		}); ok {
			out = append(out, s.Save(prompty.NewSaveContext()))
		} else if m, ok := it.(map[string]interface{}); ok {
			out = append(out, m)
		}
	}
	return out
}

// ConnectionInfo is the resolved connection detail a provider needs to build a
// request URL and authenticate.
type ConnectionInfo struct {
	Kind     string
	Endpoint string
	APIKey   string
	Name     string
}

// ResolveConnection extracts connection details from an agent's model. It
// handles typed connection structs (via their Save method) and raw maps. The
// returned info is best-effort; providers validate the fields they require.
func ResolveConnection(agent prompty.Agent) ConnectionInfo {
	info := ConnectionInfo{}
	saved := modelToMap(agent.Model)
	if saved == nil {
		return info
	}
	m := connectionToMap(saved["connection"])
	if m == nil {
		return info
	}
	info.Kind, _ = m["kind"].(string)
	info.Endpoint, _ = m["endpoint"].(string)
	info.APIKey, _ = m["apiKey"].(string)
	if info.APIKey == "" {
		// apiKey is @sensitive("save"), so it is intentionally omitted from the
		// Save() map read above; recover it from the live loaded connection struct.
		info.APIKey = connectionAPIKey(agent.Model)
	}
	info.Name, _ = m["name"].(string)
	return info
}

// connectionAPIKey recovers the apiKey from the live loaded connection struct.
// The apiKey field is @sensitive("save"): the generated Save() correctly omits it,
// so it must be read from the loaded model rather than a Save() round-trip. The
// Model|string union lowers to interface{} and resolves to one of several
// provider-specific model structs (Model, OpenAIModel, AzureModel, CustomModel),
// each carrying a `Connection interface{}` field, so the field is read reflectively.
func connectionAPIKey(model interface{}) string {
	v := reflect.ValueOf(model)
	if v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return ""
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return ""
	}
	field := v.FieldByName("Connection")
	if !field.IsValid() || !field.CanInterface() {
		return ""
	}
	switch c := field.Interface().(type) {
	case prompty.ApiKeyConnection:
		return c.ApiKey
	case *prompty.ApiKeyConnection:
		if c != nil {
			return c.ApiKey
		}
	}
	return ""
}

func connectionToMap(conn interface{}) map[string]interface{} {
	if conn == nil {
		return nil
	}
	if m, ok := conn.(map[string]interface{}); ok {
		return m
	}
	if s, ok := conn.(interface {
		Save(*prompty.SaveContext) map[string]interface{}
	}); ok {
		return s.Save(prompty.NewSaveContext())
	}
	return nil
}

// modelToMap returns the coerce-union Model value as its canonical Save() map,
// or nil when absent. The Model|string coerce union lowers to interface{}, so
// model fields (id, apiType, options, connection) are read through the saved map
// rather than as struct fields.
func modelToMap(model interface{}) map[string]interface{} {
	if model == nil {
		return nil
	}
	if m, ok := model.(map[string]interface{}); ok {
		return m
	}
	// Coerce shorthand: `model: gpt-4o` lowers the Model|string union to a bare
	// string that IS the model id.
	if s, ok := model.(string); ok {
		if s == "" {
			return nil
		}
		return map[string]interface{}{"id": s}
	}
	if s, ok := model.(interface {
		Save(*prompty.SaveContext) map[string]interface{}
	}); ok {
		return s.Save(prompty.NewSaveContext())
	}
	return nil
}

// PostJSON marshals body, POSTs it to url with the given headers, and decodes
// the JSON response into a map. Non-2xx responses return an error that includes
// the response body.
func PostJSON(url string, headers map[string]string, body map[string]interface{}) (map[string]interface{}, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request body: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := DefaultHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request failed: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("provider returned status %d: %s", resp.StatusCode, string(data))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("decode response body: %w", err)
	}
	return result, nil
}

// FormatChatToolMessages builds the follow-up conversation turn for the OpenAI /
// Azure chat-completions tool-calling loop: one assistant message carrying the
// tool_calls metadata, followed by one tool message per result. Mirrors the C#
// OpenAIExecutor.FormatToolMessages chat path.
func FormatChatToolMessages(toolCalls []prompty.ToolCall, toolResults []string, textContent *string) []prompty.Message {
	messages := make([]prompty.Message, 0, len(toolCalls)+1)

	var assistantParts []interface{}
	if textContent != nil && *textContent != "" {
		assistantParts = []interface{}{prompty.TextPart{Kind: "text", Value: *textContent}}
	}
	callsCopy := make([]prompty.ToolCall, len(toolCalls))
	copy(callsCopy, toolCalls)
	messages = append(messages, prompty.Message{
		Role:     prompty.Role("assistant"),
		Parts:    assistantParts,
		Metadata: map[string]interface{}{"tool_calls": callsCopy},
	})

	for i, tc := range toolCalls {
		result := ""
		if i < len(toolResults) {
			result = toolResults[i]
		}
		messages = append(messages, prompty.Message{
			Role:  prompty.Role("tool"),
			Parts: []interface{}{prompty.TextPart{Kind: "text", Value: result}},
			Metadata: map[string]interface{}{
				"tool_call_id": tc.Id,
				"name":         tc.Name,
			},
		})
	}
	return messages
}
