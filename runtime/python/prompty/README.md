# Prompty — Python Runtime

[![PyPI](https://img.shields.io/pypi/v/prompty)](https://pypi.org/project/prompty/)
[![Python 3.11+](https://img.shields.io/pypi/pyversions/prompty)](https://pypi.org/project/prompty/)

Prompty is a markdown file format (`.prompty`) for LLM
prompts. The Python runtime loads, renders, parses, and
executes these files. Every `.prompty` file becomes a typed
`Prompty` object.

## Installation

```bash
# Core + Jinja2 renderer + OpenAI provider
pip install prompty[jinja2,openai]

# Core + Microsoft Foundry provider
pip install prompty[jinja2,foundry]

# Core + Anthropic provider
pip install prompty[jinja2,anthropic]

# Everything (all renderers, providers, OpenTelemetry)
pip install prompty[all]
```

### Extras

| Extra | Packages | What it enables |
|-------|----------|-----------------|
| `[openai]` | `openai` | OpenAI provider |
| `[foundry]` | `openai`, `azure-identity` | Microsoft Foundry provider |
| `[anthropic]` | `anthropic` | Anthropic provider |
| `[jinja2]` | `jinja2` | Jinja2 template rendering |
| `[mustache]` | `chevron` | Mustache template rendering |
| `[otel]` | `opentelemetry-api` | OpenTelemetry tracing |
| `[all]` | All of the above | Everything |

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
inputs:
  - name: name
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

```python
import prompty

# One-shot: load + prepare + run
result = prompty.execute(
    "greeting.prompty", inputs={"name": "Jane"}
)
print(result)

# Step-by-step
agent = prompty.load("greeting.prompty")
messages = prompty.prepare(
    agent, inputs={"name": "Jane"}
)
result = prompty.run(agent, messages)
```

### 3. Async

```python
result = await prompty.execute_async(
    "greeting.prompty", inputs={"name": "Jane"}
)
```

## API Reference

### Core Functions

| Function | What it does |
|----------|-------------|
| `load(path)` | Parse `.prompty` → `Prompty` |
| `render(agent, inputs)` | Template → rendered string |
| `parse(agent, rendered)` | Rendered string → `list[Message]` |
| `prepare(agent, inputs)` | Render + parse + threads → `list[Message]` |
| `run(agent, msgs)` | Executor + process → clean result |
| `process(agent, resp)` | Extract content → clean result |
| `execute(prompt, inputs)` | Full pipeline: load + prepare + run |
| `execute_agent(prompt, ...)` | Full pipeline with tool-call loop |
| `headless(api, ...)` | Create `Prompty` w/o a file |
| `validate_inputs(...)` | Check required inputs present |

All functions have `_async` variants (e.g.,
`execute_async`, `run_async`, `execute_agent_async`).

### Agent Mode (Tool Calling)

```python
def get_weather(location: str) -> str:
    return f"72°F and sunny in {location}"

result = prompty.execute_agent(
    "my-agent.prompty",
    inputs={"question": "Weather in Seattle?"},
    tools={"get_weather": get_weather},
    max_iterations=10,  # default
)
```

The agent loop: calls the LLM, if it returns
`tool_calls`, executes the matching functions, sends
results back, repeats until the model returns a normal
response or `max_iterations` is exceeded.

Error handling:

- **Bad JSON** in tool arguments → error sent back
  to model for self-correction
- **Tool exception** → error string sent back to model
- **Missing tool** → error message sent back (no crash)
- **Max iterations** → `ValueError` raised

### Connection Registry

For pre-configured SDK clients or token-based auth:

```yaml
# .prompty file — reference a named connection
model:
  id: gpt-4o
  provider: foundry
  connection:
    kind: reference
    name: my-foundry
```

```python
from openai import AzureOpenAI
from azure.identity import (
    DefaultAzureCredential,
    get_bearer_token_provider,
)

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    azure_ad_token_provider=get_bearer_token_provider(
        DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
    ),
)
prompty.register_connection("my-foundry", client=client)

# Now run — executor resolves the client by name
result = prompty.execute(
    "my-prompt.prompty", inputs={...}
)
```

### Structured Output

Define `outputs` in frontmatter to get
JSON-parsed results:

```yaml
outputs:
  - name: city
    kind: string
    description: The city name
  - name: temperature
    kind: integer
    description: Temperature in Fahrenheit
```

The executor sends this as OpenAI's `response_format`
with `json_schema`, and the processor automatically
JSON-parses the result.

### Streaming

```python
agent = prompty.load("chat.prompty")
messages = prompty.prepare(
    agent, inputs={"question": "Tell me a story"}
)

# Set stream option
agent.model.options.additionalProperties = {
    "stream": True,
}
response = prompty.run(agent, messages, raw=True)

# response is a PromptyStream — iterate for chunks
for chunk in prompty.process(agent, response):
    print(chunk, end="", flush=True)
```

Streaming handles tool call deltas (accumulated
across chunks), refusal detection, and empty
heartbeat chunks.

### Tracing

```python
from prompty import Tracer, PromptyTracer, trace

# Register a tracer
Tracer.add("console", prompty.console_tracer)
Tracer.add(
    "json", PromptyTracer("./traces").tracer
)

# All pipeline functions automatically emit traces
result = prompty.execute(
    "my-prompt.prompty", inputs={...}
)

# Custom functions
@trace
def my_function():
    ...
```

OpenTelemetry integration:

```python
from prompty.tracing.otel import otel_tracer
Tracer.add("otel", otel_tracer())
```

## `.prompty` File Format

### Structure

```text
---
# YAML frontmatter (Prompty schema)
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
inputs:
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

The caller passes a list of messages as the thread
input value.

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

### Legacy Format Support

Prompty v1 `.prompty` files are automatically
migrated with deprecation warnings. Key changes:

- `model.configuration` → `model.connection`
- `model.parameters` → `model.options`
- `inputs` (dict format) → `inputs` (list of Property)
- `inputSchema` → `inputs`
- `outputSchema` → `outputs`
- `template: jinja2` → structured `template`
  with `format` and `parser`

## Development

```bash
# Install for development
uv pip install -e ".[dev,all]"

# Unit tests (excludes integration by default)
uv run pytest tests/ -q

# Lint
uv run ruff check .
uv run ruff format --check .

# Integration tests (requires API keys in .env)
uv run pytest tests/integration/ -v -o "addopts="
```

## License

See [LICENSE](../../../LICENSE) in the repository root.
