# Prompty

Prompty is an asset class and format for LLM prompts designed to enhance observability, understandability, and portability for developers.

## Quick Start

```csharp
using Prompty.Core;

// Load and run a .prompty file
var agent = PromptyLoader.Load("chat.prompty");
var messages = await Pipeline.PrepareAsync(agent, new Dictionary<string, object>
{
    ["question"] = "What is the meaning of life?"
});
```

## Packages

| Package | Description |
|---------|-------------|
| **Prompty.Core** | Core library — loader, pipeline, renderers, parsers, tracing |
| **Prompty.OpenAI** | OpenAI provider (chat, embedding, image, agent) |
| **Prompty.Foundry** | Microsoft Foundry / Azure OpenAI provider |
| **Prompty.Anthropic** | Anthropic Claude provider |

## Features

- **`.prompty` file format** — YAML frontmatter + markdown template body
- **Multiple template engines** — Jinja2 and Mustache support
- **Provider abstraction** — OpenAI, Azure/Foundry, Anthropic
- **Structured output** — `outputSchema` → `response_format` automatic conversion
- **Streaming** — `PromptyStream` wrapper with accumulation and tracing
- **Agent mode** — Automatic tool-call execution loop
- **Tracing** — 4-layer tracing system with `.tracy` file output
- **Spec compliance** — Passes [spec test vectors](https://github.com/microsoft/prompty/tree/main/spec/vectors)

## Documentation

Visit [prompty.ai](https://prompty.ai) for full documentation.

## License

MIT
