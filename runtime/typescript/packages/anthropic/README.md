# @prompty/anthropic

Anthropic provider for Prompty — executor and processor for the Anthropic Messages API.

## Installation

```bash
npm install @prompty/core @prompty/anthropic @anthropic-ai/sdk
```

## Usage

Import `@prompty/anthropic` to auto-register the `anthropic` provider, then use `@prompty/core` as normal:

```typescript
import "@prompty/anthropic";
import { run } from "@prompty/core";

const result = await run("./chat.prompty", {
  question: "What is quantum computing?",
});
```

## `.prompty` Configuration

Set `provider: anthropic` in your `.prompty` file:

```prompty
---
name: my-prompt
model:
  id: claude-sonnet-4-20250514
  provider: anthropic
  apiType: chat
  connection:
    kind: key
    apiKey: ${env:ANTHROPIC_API_KEY}
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
| `chat` (default) | Messages via `client.messages.create()` |

## Streaming

Enable streaming via `additionalProperties`:

```prompty
model:
  options:
    additionalProperties:
      stream: true
```

Returns a `PromptyStream` that can be iterated asynchronously.

## Structured Output

Anthropic supports structured output via `outputs` in the `.prompty` frontmatter. The executor converts this to a JSON tool-use pattern, and the processor automatically parses the result.

## Exports

| Export | Description |
|--------|-------------|
| `AnthropicExecutor` | Executor implementation for Anthropic |
| `AnthropicProcessor` | Processor for Anthropic responses |
| `processResponse` | Shared response processing helper |
| `messageToWire` | Convert `Message` → Anthropic wire format |
| `buildChatArgs` | Build messages API arguments |
| `toolsToWire` | Convert tools → Anthropic tool format |
| `outputSchemaToWire` | Convert output schema → Anthropic tool format |

## License

MIT
