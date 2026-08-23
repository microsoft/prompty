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
	if agent.Model != nil {
		saved := agent.Model.Save(prompty.NewSaveContext())
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
	if agent.Model != nil && agent.Model.ApiType != nil {
		return string(*agent.Model.ApiType)
	}
	return "chat"
}

// HasOutputs reports whether the agent declared structured outputs.
func HasOutputs(agent prompty.Agent) bool {
	return len(agent.Outputs) > 0
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
	if agent.Model == nil || agent.Model.Connection == nil {
		return info
	}
	m := connectionToMap(agent.Model.Connection)
	if m == nil {
		return info
	}
	info.Kind, _ = m["kind"].(string)
	info.Endpoint, _ = m["endpoint"].(string)
	info.APIKey, _ = m["apiKey"].(string)
	info.Name, _ = m["name"].(string)
	return info
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
