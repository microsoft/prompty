# Prompty.Core

Prompty is an asset class and format for LLM prompts designed to enhance
observability, understandability, and portability for developers. The
`.prompty` file format combines YAML frontmatter (model config, inputs,
tools) with a markdown body (your prompt template).

**Prompty.Core** is the foundation package — it loads `.prompty` files,
renders templates, parses messages, and orchestrates the execution pipeline.
Provider packages (OpenAI, Foundry, Anthropic) plug in via the invoker
registry.

## Installation

```bash
dotnet add package Prompty.Core
```

You'll also need at least one provider package:

```bash
dotnet add package Prompty.OpenAI      # OpenAI
dotnet add package Prompty.Foundry     # Azure OpenAI / Microsoft Foundry
dotnet add package Prompty.Anthropic   # Anthropic Claude
```

## Quick Start

**1. Create a `.prompty` file** (`chat.prompty`):

```yaml
---
name: basic-chat
model:
  id: gpt-4o-mini
  provider: openai
  connection:
    kind: key
    endpoint: https://api.openai.com/v1
    apiKey: ${env:OPENAI_API_KEY}
inputSchema:
  properties:
    - name: question
      kind: string
---
system:
You are a helpful assistant.

user:
{{question}}
```

**2. Load and run it in C#:**

```csharp
using Prompty.Core;
using Prompty.OpenAI;

// Register the provider
InvokerRegistry.RegisterExecutor("openai", new OpenAIExecutor());
InvokerRegistry.RegisterProcessor("openai", new OpenAIProcessor());

// Load, prepare messages, and execute
var agent = PromptyLoader.Load("chat.prompty");
var result = await Pipeline.InvokeAsync(agent, new Dictionary<string, object>
{
    ["question"] = "What is the meaning of life?"
});

Console.WriteLine(result);
```

## Packages

| Package | Description |
|---------|-------------|
| [**Prompty.Core**](https://www.nuget.org/packages/Prompty.Core) | Loader, pipeline, renderers, parsers, tracing |
| [**Prompty.OpenAI**](https://www.nuget.org/packages/Prompty.OpenAI) | OpenAI provider — chat, embedding, image, responses API |
| [**Prompty.Foundry**](https://www.nuget.org/packages/Prompty.Foundry) | Microsoft Foundry / Azure OpenAI — Entra ID + API key auth |
| [**Prompty.Anthropic**](https://www.nuget.org/packages/Prompty.Anthropic) | Anthropic Claude provider via Messages API |

## Features

- **`.prompty` file format** — YAML frontmatter + Jinja2/Mustache template body
- **Pipeline architecture** — Render → Parse → Execute → Process
- **Structured output** — `outputSchema` converts to `response_format` automatically
- **Streaming** — `PromptyStream` (`IAsyncEnumerable<object>`) with tracing
- **Agent mode** — Automatic tool-call loop with configurable max iterations
- **Tracing** — Pluggable backends: console, `.tracy` files, OpenTelemetry
- **Connection registry** — Pre-register SDK clients for reuse across prompts
- **Spec compliance** — Passes [Prompty spec test vectors](https://github.com/microsoft/prompty/tree/main/spec/vectors)

## Core API

### Loading

```csharp
// Sync
var agent = PromptyLoader.Load("chat.prompty");

// Async
var agent = await PromptyLoader.LoadAsync("chat.prompty");
```

### Pipeline

```csharp
// Full invoke (load → render → parse → execute → process)
var result = await Pipeline.InvokeAsync("chat.prompty", inputs);

// Step-by-step control
var validated = Pipeline.ValidateInputs(agent, inputs);
var rendered  = await Pipeline.RenderAsync(agent, validated);
var messages  = await Pipeline.ParseAsync(agent, rendered);
var response  = await Pipeline.ExecuteAsync(agent, messages);
var result    = await Pipeline.ProcessAsync(agent, response);

// Or use prepare + run
var messages = await Pipeline.PrepareAsync(agent, inputs);  // render + parse
var result   = await Pipeline.RunAsync(agent, messages);     // execute + process
```

### Agent Mode (Tool Calling)

```csharp
var tools = new Dictionary<string, Func<string, Task<string>>>
{
    ["get_weather"] = async (args) => "72°F and sunny"
};

var result = await Pipeline.InvokeAgentAsync(
    agent, inputs, tools, maxIterations: 10);
```

### Tracing

```csharp
// Register tracers before invoking
ConsoleTracer.Register();         // Print spans to console
PromptyTracer.Register();         // Write .tracy JSON files
OTelTracer.Register();            // OpenTelemetry spans

// Wrap custom code in a trace span
var result = await Trace.TraceAsync("my-operation", async () =>
{
    // your code here
    return value;
});
```

### Connection Registry

```csharp
// Pre-register an SDK client
ConnectionRegistry.Register("my-openai", openAIClient);

// Reference it in .prompty frontmatter:
// connection:
//   kind: reference
//   name: my-openai
```

## Documentation

Visit [prompty.ai](https://prompty.ai) for full documentation, guides, and the
[language specification](https://github.com/microsoft/prompty/tree/main/spec).

## License

MIT
