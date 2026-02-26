# Prompty — Python Runtime

Prompty is a markdown file format (`.prompty`) for LLM
prompts. The Python runtime loads, renders, parses, and
executes these files. It uses
[AgentSchema](https://microsoft.github.io/AgentSchema/)
as its type system — every `.prompty` file becomes a typed
`PromptAgent`.

## Installation

```bash
# Core + Jinja2 renderer + OpenAI provider
uv pip install prompty[jinja2,openai]

# Core + Azure OpenAI provider
uv pip install prompty[jinja2,azure]

# Everything (all renderers, providers, OpenTelemetry)
uv pip install prompty[all]

# Development (includes test/lint tools)
uv pip install -e ".[dev,all]"
```

### Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `agentschema` | ✅ | Type system (PromptAgent, etc.) |
| `pyyaml` | ✅ | YAML frontmatter parsing |
| `python-dotenv` | ✅ | `.env` file loading |
| `aiofiles` | ✅ | Async file I/O |
| `jinja2` | Optional | Jinja2 template rendering |
| `chevron` | Optional | Mustache template rendering |
| `openai` | Optional | OpenAI / Azure OpenAI |
| `azure-identity` | Optional | Azure AAD authentication |
| `opentelemetry-api` | Optional | OpenTelemetry tracing |

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

```python
import prompty

# One-shot: load + render + parse + execute + process
result = prompty.run(
    "greeting.prompty", inputs={"name": "Jane"}
)
print(result)

# Step-by-step
agent = prompty.load("greeting.prompty")
messages = prompty.prepare(
    agent, inputs={"name": "Jane"}
)
response = prompty.execute(agent, messages)
result = prompty.process(agent, response)
```

### 3. Async

```python
result = await prompty.run_async(
    "greeting.prompty", inputs={"name": "Jane"}
)
```

## API Reference

### Core Functions

| Function | What it does |
|----------|-------------|
| `load(path)` | Parse `.prompty` → `PromptAgent` |
| `prepare(agent, inputs)` | Render + parse → `list[Message]` |
| `execute(agent, msgs)` | Call LLM → raw response |
| `process(agent, resp)` | Extract content → clean result |
| `run(agent, inputs)` | All of the above in one call |
| `run_agent(agent, ...)` | Run with tool-call loop |
| `headless(api, ...)` | Create `PromptAgent` w/o a file |
| `validate_inputs(...)` | Check required inputs present |

All functions have `_async` variants (e.g.,
`load_async`, `run_async`, `run_agent_async`).

### Agent Mode (Tool Calling)

```python
def get_weather(location: str) -> str:
    return f"72°F and sunny in {location}"

result = prompty.run_agent(
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
prompty.register_connection("my-azure", client=client)

# Now run — executor resolves the client by name
result = prompty.run(
    "my-prompt.prompty", inputs={...}
)
```

### Structured Output

Define `outputSchema` in frontmatter to get
JSON-parsed results:

```yaml
outputSchema:
  properties:
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
response = prompty.execute(agent, messages)

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
result = prompty.run(
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

### Thread Separator

Everything before `![thread]` → `instructions`.
Everything after → `additionalInstructions`.

```text
system:
You are a helpful assistant.

![thread]

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

### Legacy Format Support

Prompty v1 `.prompty` files are automatically
migrated with deprecation warnings. Key changes:

- `model.configuration` → `model.connection`
- `model.parameters` → `model.options`
- `inputs` → `inputSchema.properties`
- `template: jinja2` → structured `template`
  with `format` and `parser`

## Testing

```bash
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
