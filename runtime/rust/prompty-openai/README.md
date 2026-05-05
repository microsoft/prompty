# prompty-openai

OpenAI provider for [**prompty**](https://crates.io/crates/prompty) — adds executor and processor implementations for the OpenAI Chat Completions, Embeddings, and Images APIs.

## Usage

```rust
use prompty::{load, turn, register_defaults};

// Register built-in renderers/parsers + OpenAI provider
register_defaults();
prompty_openai::register();

let agent = load("chat.prompty")?;
let result = turn(&agent, Some(&inputs), None).await?;
```

## Supported API Types

| `apiType` | API | Description |
|-----------|-----|-------------|
| `chat` | Chat Completions | Text generation and tool calling |
| `embedding` | Embeddings | Vector embeddings |
| `image` | Images | DALL-E image generation |

## Connection

Configure via `.prompty` frontmatter or environment variables:

```yaml
model:
  id: gpt-4o
  provider: openai
  connection:
    kind: key
    apiKey: ${env:OPENAI_API_KEY}
```

## License

MIT — see [LICENSE](LICENSE) for details.
