# Prompty.Anthropic

Anthropic Claude provider for [Prompty](https://prompty.ai) — executor and
processor for Claude models via the Anthropic Messages API. Uses direct HTTP
(no SDK dependency) for a lightweight footprint.

## Installation

```bash
dotnet add package Prompty.Core
dotnet add package Prompty.Anthropic
```

## Quick Start

```csharp
using Prompty.Core;
using Prompty.Anthropic;

// One-time setup — registers renderers, parser, and Anthropic provider
new PromptyBuilder()
    .AddAnthropic();

// Run a .prompty file
var result = await Pipeline.InvokeAsync("chat.prompty", new Dictionary<string, object>
{
    ["question"] = "Explain quantum computing in simple terms"
});

Console.WriteLine(result);
```

## `.prompty` Configuration

```yaml
---
name: claude-chat
model:
  id: claude-sonnet-4-20250514
  provider: anthropic
  apiType: chat
  connection:
    kind: key
    endpoint: https://api.anthropic.com
    apiKey: ${env:ANTHROPIC_API_KEY}
  options:
    temperature: 0.7
    maxOutputTokens: 1024
---
system:
You are a helpful assistant.

user:
{{question}}
```

## Supported Models

Any model available through the Anthropic Messages API:

- `claude-sonnet-4-20250514`
- `claude-3-5-sonnet-20241022`
- `claude-3-haiku-20240307`
- `claude-3-opus-20240229`

## Features

| Feature | Supported |
|---------|-----------|
| Chat completions | ✅ |
| Streaming (SSE) | ✅ |
| Tool calling | ✅ |
| Agent mode (tool loop) | ✅ |
| Structured output | ✅ |
| Image inputs (base64) | ✅ |
| System prompts | ✅ (extracted per Anthropic convention) |

## Authentication

### API Key

```yaml
model:
  connection:
    kind: key
    endpoint: https://api.anthropic.com    # optional, this is the default
    apiKey: ${env:ANTHROPIC_API_KEY}
```

## Agent Mode (Tool Calling)

Anthropic's tool calling follows the same pattern as other providers:

```csharp
var tools = new Dictionary<string, Func<string, Task<string>>>
{
    ["get_weather"] = async (args) => "72°F and sunny"
};

var result = await Pipeline.TurnAsync(
    agent, inputs, tools, maxIterations: 10);
```

## Architecture Notes

This package uses **direct HTTP** via `HttpClient` rather than an Anthropic SDK.
This means:
- Zero external package dependencies (only `Prompty.Core`)
- Full control over the Messages API wire format
- Lightweight — no SDK overhead

## Documentation

Visit [prompty.ai](https://prompty.ai) for full documentation.

## License

MIT
