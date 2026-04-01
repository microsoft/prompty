# @prompty/foundry

Microsoft Foundry provider for Prompty — executor and processor for Azure AI Foundry (and Azure OpenAI).

## Installation

```bash
npm install @prompty/core @prompty/foundry openai @azure/identity
```

## Usage

Import `@prompty/foundry` to auto-register the `foundry` provider (and the legacy `azure` alias):

```typescript
import "@prompty/foundry";
import { run } from "@prompty/core";

const result = await run("./chat.prompty", {
  question: "What is Azure AI Foundry?",
});
```

## `.prompty` Configuration

### Azure AI Foundry

```prompty
---
name: foundry-prompt
model:
  id: gpt-4o-mini
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

### Azure OpenAI (Legacy)

The `azure` provider name is supported as a backward-compatible alias:

```prompty
model:
  provider: azure
  # ... same connection config
```

## Authentication

The Foundry provider supports:

- **API key** — via `connection.kind: key` with `apiKey`
- **Azure Identity** — falls back to `DefaultAzureCredential` when no API key is provided

## Supported API Types

| `apiType` | Description |
|-----------|-------------|
| `chat` (default) | Chat completions |
| `embedding` | Embeddings |
| `image` | Image generation |
| `responses` | Responses API |

## Exports

| Export | Description |
|--------|-------------|
| `FoundryExecutor` | Executor for Azure AI Foundry |
| `FoundryProcessor` | Processor for Foundry responses |
| `AzureExecutor` | Backward-compatible alias |
| `AzureProcessor` | Backward-compatible alias |

## License

MIT
