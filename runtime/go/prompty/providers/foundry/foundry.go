// Package foundry provides an HTTP-based Executor and Processor for Azure OpenAI
// / Microsoft Foundry endpoints. It reuses the OpenAI wire family (chat,
// embedding, image) but targets Azure's deployment-scoped URLs and auth. Register
// them under the "foundry" provider key with Register.
package foundry

import (
	"fmt"
	"os"
	"strings"

	prompty "prompty/model"
	"prompty/providers"
)

// DefaultAPIVersion is the Azure OpenAI api-version query parameter used for all
// requests.
const DefaultAPIVersion = "2024-12-01-preview"

// AccessTokenEnv is the environment variable consulted for an Entra ID bearer
// token when the connection carries no API key (Foundry connections).
const AccessTokenEnv = "AZURE_OPENAI_ACCESS_TOKEN"

// Executor calls Azure OpenAI / Foundry deployments over raw HTTP.
type Executor struct{}

// Processor normalizes raw Azure OpenAI responses into clean results.
type Processor struct{}

// Register wires the Foundry executor and processor into the provider registry
// under the "foundry" key.
func Register() {
	providers.RegisterExecutor("foundry", Executor{})
	providers.RegisterProcessor("foundry", Processor{})
}

// Execute builds the request body via the shared OpenAI wire pipeline, resolves
// the Azure connection, POSTs to the deployment-scoped endpoint, and returns the
// decoded JSON response.
func (Executor) Execute(agent prompty.Agent, messages []prompty.Message) (interface{}, error) {
	input := providers.BuildInput(agent, messages, "openai")
	body, err := prompty.BuildWireRequest(input)
	if err != nil {
		return nil, err
	}

	url, headers, err := requestTarget(agent)
	if err != nil {
		return nil, err
	}
	return providers.PostJSON(url, headers, body)
}

// ExecuteStream is not supported by the raw-HTTP Foundry executor.
func (Executor) ExecuteStream(agent prompty.Agent, messages []prompty.Message) (interface{}, error) {
	return nil, providers.ErrStreamingUnsupported
}

// FormatToolMessages formats a tool-call turn for the chat completions loop
// (identical to the OpenAI wire format).
func (Executor) FormatToolMessages(rawResponse interface{}, toolCalls []prompty.ToolCall, toolResults []string, textContent *string) ([]prompty.Message, error) {
	return providers.FormatChatToolMessages(toolCalls, toolResults, textContent), nil
}

// Process normalizes a raw Azure OpenAI response via the shared OpenAI
// processing pipeline.
func (Processor) Process(agent prompty.Agent, response interface{}) (interface{}, error) {
	return prompty.ProcessResponse("openai", providers.APIType(agent), response, providers.HasOutputs(agent))
}

// ProcessStream is not supported by the raw-HTTP Foundry processor.
func (Processor) ProcessStream(_ prompty.Agent, stream interface{}) (interface{}, error) {
	return nil, providers.ErrStreamingUnsupported
}

// requestTarget resolves the request URL and auth headers for the agent's Azure
// connection. API-key connections use the deployment-scoped URL with an api-key
// header; keyless (Foundry/Entra) connections use an AZURE_OPENAI_ACCESS_TOKEN
// bearer token against the OpenAI/v1 base URL.
func requestTarget(agent prompty.Agent) (url string, headers map[string]string, err error) {
	conn := providers.ResolveConnection(agent)
	endpoint := strings.TrimRight(conn.Endpoint, "/")
	if endpoint == "" {
		endpoint = strings.TrimRight(os.Getenv("AZURE_OPENAI_ENDPOINT"), "/")
	}
	if endpoint == "" {
		return "", nil, fmt.Errorf("foundry: endpoint is required (set model.connection.endpoint or AZURE_OPENAI_ENDPOINT)")
	}

	deployment := providers.ModelID(agent)
	if deployment == "" {
		return "", nil, fmt.Errorf("foundry: model id (deployment name) is required")
	}

	op := operationPath(providers.APIType(agent))

	apiKey := conn.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("AZURE_OPENAI_API_KEY")
	}
	if apiKey != "" {
		url = fmt.Sprintf("%s/openai/deployments/%s%s?api-version=%s", endpoint, deployment, op, DefaultAPIVersion)
		return url, map[string]string{"api-key": apiKey}, nil
	}

	if token := os.Getenv(AccessTokenEnv); token != "" {
		url = endpoint + "/openai/v1" + op
		return url, map[string]string{"Authorization": "Bearer " + token}, nil
	}

	return "", nil, fmt.Errorf("foundry: no credentials (set model.connection.apiKey, AZURE_OPENAI_API_KEY, or %s)", AccessTokenEnv)
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
