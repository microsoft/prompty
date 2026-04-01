# @prompty/openai

OpenAI provider for Prompty — executor and processor for the OpenAI API.

## Installation

```bash
npm install @prompty/core @prompty/openai openai
```

## Usage

Import `@prompty/openai` to auto-register the `openai` provider, then use `@prompty/core` as normal:

```typescript
import "@prompty/openai";
import { run } from "@prompty/core";

const result = await run("./chat.prompty", {
  question: "What is quantum computing?",
});
```

## `.prompty` Configuration

Set `provider: openai` in your `.prompty` file:

```prompty
---
name: my-prompt
model:
  id: gpt-4o-mini
  provider: openai
  apiType: chat
  connection:
    kind: key
    endpoint: ${env:OPENAI_BASE_URL}
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

| `apiType` | Description |
|-----------|-------------|
| `chat` (default) | Chat completions via `client.chat.completions.create()` |
| `embedding` | Embeddings via `client.embeddings.create()` |
| `image` | Image generation via `client.images.generate()` |
| `responses` | Responses API via `client.responses.create()` |

## Streaming

Enable streaming via `additionalProperties`:

```prompty
model:
  options:
    additionalProperties:
      stream: true
```

Returns a `PromptyStream` that can be iterated asynchronously.

## Exports

| Export | Description |
|--------|-------------|
| `OpenAIExecutor` | Executor implementation for OpenAI |
| `OpenAIProcessor` | Processor for OpenAI responses |
| `processResponse` | Shared response processing helper |
| `messageToWire` | Convert `Message` → OpenAI wire format |
| `buildChatArgs` | Build chat completion arguments |
| `buildEmbeddingArgs` | Build embedding arguments |
| `buildImageArgs` | Build image generation arguments |
| `buildResponsesArgs` | Build Responses API arguments |

## License

MIT
