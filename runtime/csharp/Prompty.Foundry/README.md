# Prompty.Foundry

Microsoft Foundry (Azure OpenAI) provider for [Prompty](https://prompty.ai) —
executor and processor for Azure-hosted models with support for both
API key and Entra ID (managed identity) authentication.

> **Note:** `provider: azure` is a deprecated alias for `provider: foundry`.
> Both work, but new `.prompty` files should use `foundry`.

## Installation

```bash
dotnet add package Prompty.Core
dotnet add package Prompty.Foundry
```

## Quick Start

```csharp
using Prompty.Core;
using Prompty.Foundry;

// One-time setup — registers renderers, parser, and Foundry provider
// (also registers the legacy "azure" alias automatically)
new PromptyBuilder()
    .AddFoundry();

// Run a .prompty file
var result = await Pipeline.InvokeAsync("chat.prompty", new Dictionary<string, object>
{
    ["question"] = "Explain quantum computing in simple terms"
});
```

## `.prompty` Configuration

### API Key Authentication

```yaml
---
name: foundry-chat
model:
  id: gpt-4o-mini            # your deployment name
  provider: foundry
  apiType: chat
  connection:
    kind: key
    endpoint: ${env:AZURE_OPENAI_ENDPOINT}
    apiKey: ${env:AZURE_OPENAI_API_KEY}
  options:
    temperature: 0.7
---
system:
You are a helpful assistant.

user:
{{question}}
```

### Entra ID Authentication (Recommended for Production)

```yaml
---
name: foundry-entra
model:
  id: gpt-4o-mini
  provider: foundry
  connection:
    kind: foundry
    endpoint: ${env:AZURE_OPENAI_ENDPOINT}
---
system:
You are a helpful assistant.

user:
{{question}}
```

With `kind: foundry`, the executor uses `DefaultAzureCredential` from
`Azure.Identity`, which automatically resolves credentials from managed
identity, Azure CLI, Visual Studio, and other sources — no API keys needed.

## Authentication Methods

| `connection.kind` | Auth Method | When to Use |
|-------------------|-------------|-------------|
| `key` | API key + endpoint | Development, simple setups |
| `foundry` | `DefaultAzureCredential` (Entra ID) | Production, managed identity |
| `reference` | Pre-registered `AzureOpenAIClient` | Shared client across prompts |

### Connection Registry

```csharp
// Pre-register an authenticated client
var client = new AzureOpenAIClient(
    new Uri(endpoint),
    new DefaultAzureCredential());
ConnectionRegistry.Register("my-foundry", client);
```

```yaml
# Reference it in .prompty
model:
  connection:
    kind: reference
    name: my-foundry
```

## Supported API Types

| `apiType` | Description |
|-----------|-------------|
| `chat` (default) | Chat completions |
| `embedding` | Text embeddings |
| `image` | Image generation |
| `responses` | Responses API |

## Dependencies

- [`Azure.AI.OpenAI`](https://www.nuget.org/packages/Azure.AI.OpenAI) — Azure OpenAI SDK
- [`Azure.Identity`](https://www.nuget.org/packages/Azure.Identity) — Entra ID credential resolution

## Documentation

Visit [prompty.ai](https://prompty.ai) for full documentation.

## License

MIT
