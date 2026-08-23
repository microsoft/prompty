// Package openai provides an HTTP-based Executor and Processor for the OpenAI
// Chat Completions, Responses, Embeddings, and Images APIs. Register them under
// the "openai" provider key with Register.
package openai

import (
	"fmt"
	"os"
	"strings"

	prompty "prompty/model"
	"prompty/providers"
)

// DefaultEndpoint is the OpenAI API base URL used when the connection does not
// specify one.
const DefaultEndpoint = "https://api.openai.com/v1"

// Executor calls the OpenAI REST APIs over raw HTTP.
type Executor struct{}

// Processor normalizes raw OpenAI responses into clean results.
type Processor struct{}

// Register wires the OpenAI executor and processor into the provider registry
// under the "openai" key.
func Register() {
	providers.RegisterExecutor("openai", Executor{})
	providers.RegisterProcessor("openai", Processor{})
}

// Execute builds the request body via the shared wire pipeline, resolves the
// connection, POSTs to the appropriate OpenAI endpoint, and returns the decoded
// JSON response.
func (Executor) Execute(agent prompty.Agent, messages []prompty.Message) (interface{}, error) {
	input := providers.BuildInput(agent, messages, "openai")
	body, err := prompty.BuildWireRequest(input)
	if err != nil {
		return nil, err
	}

	endpoint, apiKey, err := connectionInfo(agent)
	if err != nil {
		return nil, err
	}

	url := endpoint + operationPath(providers.APIType(agent))
	headers := map[string]string{"Authorization": "Bearer " + apiKey}
	return providers.PostJSON(url, headers, body)
}

// ExecuteStream is not supported by the raw-HTTP OpenAI executor.
func (Executor) ExecuteStream(agent prompty.Agent, messages []prompty.Message) (interface{}, error) {
	return nil, providers.ErrStreamingUnsupported
}

// FormatToolMessages formats a tool-call turn for the chat completions loop.
func (Executor) FormatToolMessages(rawResponse interface{}, toolCalls []prompty.ToolCall, toolResults []string, textContent *string) ([]prompty.Message, error) {
	return providers.FormatChatToolMessages(toolCalls, toolResults, textContent), nil
}

// Process normalizes a raw OpenAI response via the shared processing pipeline.
func (Processor) Process(agent prompty.Agent, response interface{}) (interface{}, error) {
	return prompty.ProcessResponse("openai", providers.APIType(agent), response, providers.HasOutputs(agent))
}

// ProcessStream is not supported by the raw-HTTP OpenAI processor.
func (Processor) ProcessStream(stream interface{}) (interface{}, error) {
	return nil, providers.ErrStreamingUnsupported
}

// connectionInfo resolves the endpoint and API key, falling back to the
// OPENAI_API_KEY environment variable when the connection omits a key.
func connectionInfo(agent prompty.Agent) (endpoint, apiKey string, err error) {
	conn := providers.ResolveConnection(agent)
	endpoint = strings.TrimRight(conn.Endpoint, "/")
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	apiKey = conn.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_API_KEY")
	}
	if apiKey == "" {
		return "", "", fmt.Errorf("openai: API key is required (set model.connection.apiKey or OPENAI_API_KEY)")
	}
	return endpoint, apiKey, nil
}

func operationPath(apiType string) string {
	switch apiType {
	case "embedding":
		return "/embeddings"
	case "image":
		return "/images/generations"
	case "responses":
		return "/responses"
	default: // chat, agent
		return "/chat/completions"
	}
}
