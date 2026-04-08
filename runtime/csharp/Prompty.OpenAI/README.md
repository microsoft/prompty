# Prompty.OpenAI

OpenAI provider for [Prompty](https://prompty.ai) — executor and processor
for OpenAI chat completions, embeddings, image generation, and the
Responses API.

## Installation

```bash
dotnet add package Prompty.Core
dotnet add package Prompty.OpenAI
```

## Quick Start

```csharp
using Prompty.Core;
using Prompty.OpenAI;

// Register the OpenAI provider
InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());

// Run a .prompty file (provider: openai in frontmatter)
var result = await Pipeline.InvokeAsync("chat.prompty", new Dictionary<string, object>
{
    ["question"] = "Explain quantum computing in simple terms"
});

Console.WriteLine(result);
```

## `.prompty` Configuration

```yaml
---
name: openai-chat
model:
  id: gpt-4o-mini
  provider: openai
  apiType: chat          # chat (default) | embedding | image | responses
  connection:
    kind: key
    endpoint: https://api.openai.com/v1
    apiKey: ${env:OPENAI_API_KEY}
  options:
    temperature: 0.7
    maxOutputTokens: 1000
---
system:
You are a helpful assistant.

user:
{{question}}
```

## Supported API Types

| `apiType` | SDK Method | Use Case |
|-----------|-----------|----------|
| `chat` (default) | `ChatClient.CompleteChatAsync` | Chat completions |
| `embedding` | `EmbeddingClient.GenerateEmbeddingsAsync` | Text embeddings |
| `image` | `ImageClient.GenerateImagesAsync` | DALL-E image generation |
| `responses` | `OpenAIResponseClient.CreateResponseAsync` | Responses API |

## Authentication

### API Key

```yaml
model:
  connection:
    kind: key
    endpoint: https://api.openai.com/v1
    apiKey: ${env:OPENAI_API_KEY}
```

### Connection Registry (pre-registered client)

```csharp
// Register an OpenAI client at startup
var client = new OpenAIClient("sk-...");
ConnectionRegistry.Register("my-openai", client);
```

```yaml
# Reference it in .prompty
model:
  connection:
    kind: reference
    name: my-openai
```

## Structured Output

Define `outputSchema` in your `.prompty` frontmatter and the executor
automatically converts it to OpenAI's `response_format` parameter:

```yaml
outputSchema:
  properties:
    - name: answer
      kind: string
    - name: confidence
      kind: float
```

## Agent Mode (Tool Calling)

```csharp
var tools = new Dictionary<string, Func<string, Task<string>>>
{
    ["get_weather"] = async (args) => "72°F and sunny in Seattle"
};

var result = await Pipeline.InvokeAgentAsync(
    agent, inputs, tools, maxIterations: 10);
```

## Documentation

Visit [prompty.ai](https://prompty.ai) for full documentation.

## License

MIT
