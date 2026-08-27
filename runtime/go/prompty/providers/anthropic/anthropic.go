// Package anthropic provides an HTTP-based Executor and Processor for the
// Anthropic Messages API. Register them under the "anthropic" provider key with
// Register.
package anthropic

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	prompty "prompty/model"
	"prompty/providers"
)

// DefaultEndpoint is the Anthropic API base URL used when the connection does
// not specify one.
const DefaultEndpoint = "https://api.anthropic.com"

// APIVersion is the anthropic-version header value sent with every request.
const APIVersion = "2023-06-01"

// Executor calls the Anthropic Messages API over raw HTTP.
type Executor struct{}

// Processor normalizes raw Anthropic responses into clean results.
type Processor struct{}

// Register wires the Anthropic executor and processor into the provider
// registry under the "anthropic" key.
func Register() {
	providers.RegisterExecutor("anthropic", Executor{})
	providers.RegisterProcessor("anthropic", Processor{})
}

// Execute builds the Anthropic request body via the shared wire pipeline,
// resolves the connection, POSTs to /v1/messages, and returns the decoded JSON
// response.
func (Executor) Execute(agent prompty.Agent, messages []prompty.Message) (interface{}, error) {
	input := providers.BuildInput(agent, messages, "anthropic")
	body, err := prompty.BuildWireRequest(input)
	if err != nil {
		return nil, err
	}

	endpoint, apiKey, err := connectionInfo(agent)
	if err != nil {
		return nil, err
	}

	url := endpoint + "/v1/messages"
	headers := map[string]string{
		"x-api-key":         apiKey,
		"anthropic-version": APIVersion,
	}
	return providers.PostJSON(url, headers, body)
}

// ExecuteStream is not supported by the raw-HTTP Anthropic executor.
func (Executor) ExecuteStream(agent prompty.Agent, messages []prompty.Message) (interface{}, error) {
	return nil, providers.ErrStreamingUnsupported
}

// FormatToolMessages formats a tool-call turn for the Anthropic Messages API:
// an assistant message that preserves all content blocks (text + tool_use),
// followed by a single user message batching the tool_result blocks. Mirrors the
// C# AnthropicExecutor.FormatToolMessages reference.
func (Executor) FormatToolMessages(rawResponse interface{}, toolCalls []prompty.ToolCall, toolResults []string, textContent *string) ([]prompty.Message, error) {
	// Assistant message with all content blocks.
	rawContent := make([]interface{}, 0, len(toolCalls)+1)
	var assistantParts []interface{}
	if textContent != nil && *textContent != "" {
		rawContent = append(rawContent, map[string]interface{}{"type": "text", "text": *textContent})
		assistantParts = []interface{}{prompty.TextPart{Kind: "text", Value: *textContent}}
	}
	for _, tc := range toolCalls {
		var parsedInput interface{}
		if tc.Arguments != "" {
			_ = json.Unmarshal([]byte(tc.Arguments), &parsedInput)
		}
		rawContent = append(rawContent, map[string]interface{}{
			"type":  "tool_use",
			"id":    tc.Id,
			"name":  tc.Name,
			"input": parsedInput,
		})
	}

	messages := make([]prompty.Message, 0, 2)
	messages = append(messages, prompty.Message{
		Role:     prompty.Role("assistant"),
		Parts:    assistantParts,
		Metadata: map[string]interface{}{"content": rawContent},
	})

	// Single user message batching tool_result blocks.
	toolResultBlocks := make([]interface{}, 0, len(toolCalls))
	resultParts := make([]interface{}, 0, len(toolCalls))
	for i, tc := range toolCalls {
		result := ""
		if i < len(toolResults) {
			result = toolResults[i]
		}
		toolResultBlocks = append(toolResultBlocks, map[string]interface{}{
			"type":        "tool_result",
			"tool_use_id": tc.Id,
			"content":     result,
		})
		resultParts = append(resultParts, prompty.TextPart{Kind: "text", Value: result})
	}
	messages = append(messages, prompty.Message{
		Role:     prompty.Role("user"),
		Parts:    resultParts,
		Metadata: map[string]interface{}{"tool_results": toolResultBlocks},
	})

	return messages, nil
}

// Process normalizes a raw Anthropic response via the shared processing
// pipeline.
func (Processor) Process(agent prompty.Agent, response interface{}) (interface{}, error) {
	return prompty.ProcessResponse("anthropic", providers.APIType(agent), response, providers.HasOutputs(agent))
}

// ProcessStream is not supported by the raw-HTTP Anthropic processor.
func (Processor) ProcessStream(_ prompty.Agent, stream interface{}) (interface{}, error) {
	return nil, providers.ErrStreamingUnsupported
}

// connectionInfo resolves the endpoint and API key, falling back to the
// ANTHROPIC_API_KEY environment variable when the connection omits a key.
func connectionInfo(agent prompty.Agent) (endpoint, apiKey string, err error) {
	conn := providers.ResolveConnection(agent)
	if conn.Kind == "reference" {
		return "", "", fmt.Errorf("anthropic: reference connections are not supported by the raw HTTP executor; use a key connection with apiKey")
	}
	endpoint = strings.TrimRight(conn.Endpoint, "/")
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	apiKey = conn.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
	}
	if apiKey == "" {
		return "", "", fmt.Errorf("anthropic: API key is required (set model.connection.apiKey or ANTHROPIC_API_KEY)")
	}
	return endpoint, apiKey, nil
}
