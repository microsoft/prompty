# @prompty/core

Prompty core runtime — load, render, parse, and trace `.prompty` files in TypeScript/JavaScript.

## Installation

```bash
npm install @prompty/core
```

You'll also need a **provider package** for your LLM:

```bash
# OpenAI
npm install @prompty/openai

# Azure AI Foundry
npm install @prompty/foundry

# Anthropic
npm install @prompty/anthropic
```

## Quick Start

```typescript
import "@prompty/openai"; // registers the OpenAI provider
import { load, run } from "@prompty/core";

// Load and run a .prompty file
const result = await run("./my-prompt.prompty", {
  question: "What is the capital of France?",
});
console.log(result);
```

## Step-by-Step Usage

```typescript
import "@prompty/openai";
import { load, prepare, execute, process } from "@prompty/core";

// 1. Load — parse .prompty file into a typed Prompty object
const agent = await load("./chat.prompty");

// 2. Prepare — render template + parse into messages
const messages = await prepare(agent, { name: "Alice" });

// 3. Execute — call the LLM
const response = await execute(agent, messages);

// 4. Process — extract the result
const result = await process(agent, response);
```

## What's a `.prompty` file?

A Markdown file with YAML frontmatter that defines an LLM prompt:

```prompty
---
name: greeting
model:
  id: gpt-4o-mini
  provider: openai
  connection:
    kind: key
    endpoint: ${env:OPENAI_BASE_URL}
    apiKey: ${env:OPENAI_API_KEY}
---
system:
You are a helpful assistant.

user:
Hello, my name is {{name}}. {{question}}
```

## Tracing

```typescript
import { Tracer, PromptyTracer } from "@prompty/core";

// Write .tracy JSON files to .runs/
const tracer = new PromptyTracer({ outputDir: ".runs" });
Tracer.add("prompty", tracer.factory);

const result = await run("./chat.prompty", { question: "Hi" });
console.log("Trace:", tracer.lastTracePath);
```

## Key Exports

| Export | Description |
|--------|-------------|
| `load` | Parse a `.prompty` file → `Prompty` object |
| `prepare` | Render template + parse → `Message[]` |
| `execute` | Call the LLM provider |
| `process` | Extract result from LLM response |
| `run` | All-in-one: load → prepare → execute → process |
| `executeAgent` | Agent loop with tool calling |
| `Tracer` / `PromptyTracer` | Observability and tracing |
| `registerExecutor` / `registerProcessor` | Register custom providers |
| `registerConnection` | Register named connections |
| `Message`, `ContentPart`, `PromptyStream` | Core types |

## License

MIT
