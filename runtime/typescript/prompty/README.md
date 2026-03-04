# Prompty — TypeScript Runtime

Prompty is a markdown file format (`.prompty`) for LLM
prompts. The TypeScript runtime loads, renders, parses, and
executes these files. It uses
[AgentSchema](https://microsoft.github.io/AgentSchema/)
as its type system — every `.prompty` file becomes a typed
`PromptAgent`.

## Installation

```bash
npm install prompty
```

### Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `agentschema` | ✅ | Type system (PromptAgent, etc.) |
| `gray-matter` | ✅ | YAML frontmatter parsing |
| `dotenv` | ✅ | `.env` file loading |
| `nunjucks` | ✅ | Jinja2-compatible templates |
| `mustache` | ✅ | Mustache templates |
| `openai` | ✅ | OpenAI / Azure OpenAI |

## Quick Start

### 1. Write a `.prompty` File

```prompty
---
name: greeting
model:
  id: gpt-4o-mini
  provider: openai
  connection:
    kind: key
    apiKey: ${env:OPENAI_API_KEY}
inputSchema:
  properties:
    name:
      kind: string
      default: World
template:
  format:
    kind: jinja2
  parser:
    kind: prompty
---
system:
You are a friendly assistant.

user:
Say hello to {{name}}.
```

### 2. Run It

```typescript
import { execute, load, prepare, run } from "prompty";

// One-shot: load + prepare + run
const result = await execute(
  "greeting.prompty", { name: "Jane" }
);
console.log(result);

// Step-by-step
const agent = load("greeting.prompty");
const messages = await prepare(agent, { name: "Jane" });
const output = await run(agent, messages);
```

All functions are async-first — no sync variants needed
in Node.js.

## API Reference

### Core Functions

| Function | What it does |
|----------|-------------|
| `load(path)` | Parse `.prompty` → `PromptAgent` |
| `render(agent, inputs)` | Template → rendered string |
| `parse(agent, rendered)` | Rendered string → `Message[]` |
| `prepare(agent, inputs)` | Render + parse + threads → `Message[]` |
| `run(agent, msgs)` | Executor + process → clean result |
| `process(agent, resp)` | Extract content → clean result |
| `execute(prompt, inputs)` | Full pipeline: load + prepare + run |
| `executeAgent(prompt, ...)` | Full pipeline with tool-call loop |
| `validateInputs(...)` | Check required inputs present |

### Agent Mode (Tool Calling)

```typescript
import { executeAgent } from "prompty";

function getWeather(args: { location: string }): string {
  return `72°F and sunny in ${args.location}`;
}

const result = await executeAgent(
  "my-agent.prompty",
  { question: "Weather in Seattle?" },
  {
    tools: { get_weather: getWeather },
    maxIterations: 10,  // default
  },
);
```

The agent loop: calls the LLM, if it returns
`tool_calls`, executes the matching functions, sends
results back, repeats until the model returns a normal
response or `maxIterations` is exceeded.

Error handling:

- **Bad JSON** in tool arguments → error sent back
  to model for self-correction
- **Tool exception** → error string sent back to model
- **Missing tool** → error message sent back (no crash)
- **Max iterations** → `Error` thrown

### Connection Registry

For Azure AAD or pre-configured SDK clients:

```yaml
# .prompty file — reference a named connection
model:
  id: gpt-4o
  provider: azure
  connection:
    kind: reference
    name: my-azure
```

```typescript
import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { registerConnection, execute } from "prompty";

const credential = new DefaultAzureCredential();
const client = new AzureOpenAI({
  azureADTokenProvider: getBearerTokenProvider(
    credential, "https://cognitiveservices.azure.com/.default"
  ),
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiVersion: "2024-06-01",
});

registerConnection("my-azure", client);

const result = await execute("my-prompt.prompty", { /* inputs */ });
```

### Tracing

```typescript
import { Tracer, trace, consoleTracer } from "prompty";

// Register a tracer backend
Tracer.add("console", consoleTracer);

// All pipeline functions automatically emit traces
const result = await execute("my-prompt.prompty", { /* inputs */ });

// Wrap custom functions with tracing
const myFunction = trace(async (x: number) => {
  // ... your logic
  return x * 2;
}, "myFunction");
```

### Registry (Plugins)

Register custom renderers, parsers, executors, and
processors:

```typescript
import {
  registerRenderer,
  registerParser,
  registerExecutor,
  registerProcessor,
} from "prompty";

// Built-ins are auto-registered at import time:
// - nunjucks / jinja2 (alias) / mustache renderers
// - prompty parser
// - openai / azure executors + processors
```

## `.prompty` File Format

### Structure

```text
---
# YAML frontmatter (AgentSchema properties)
---
# Markdown body (becomes `instructions`)
# Uses role markers and template syntax
```

### Role Markers

```text
system:
You are a helpful assistant.

user:
{{question}}

assistant:
I'd be happy to help.
```

### Thread Inputs

Conversation history is passed via a `kind: thread`
input property:

```yaml
inputSchema:
  properties:
    - name: conversation
      kind: thread
```

Place `{{conversation}}` in the template where
thread messages should be injected:

```text
system:
You are a helpful assistant.
{{conversation}}
user:
{{question}}
```

### Variable References

| Syntax | Purpose |
|--------|---------|
| `${env:VAR}` | Env variable (required) |
| `${env:VAR:default}` | Env variable with fallback |
| `${file:path.json}` | Load file content |

### Connection Kinds

| Kind | When to use |
|------|-------------|
| `key` | API key auth (self-contained) |
| `reference` | Pre-registered SDK client |
| `anonymous` | Endpoint only, no credentials |

## Architecture

```
execute(prompt, inputs)              → top-level orchestrator
  ├── prepare(agent, inputs)         → template → wire format
  │     ├── render(agent, inputs)    → rendered string (Renderer)
  │     └── parse(agent, rendered)   → Message[] (Parser)
  └── run(agent, messages)           → LLM call → clean result
        ├── Executor.execute(...)    → raw LLM response
        └── process(agent, response) → clean result (Processor)
```

Each leaf step is independently traced. Bring your own
Renderer, Parser, Executor, or Processor via the registry.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build (ESM + CJS + DTS)
npm run build

# Type check
npx tsc --noEmit
```

## License

See [LICENSE](../../../LICENSE) in the repository root.
