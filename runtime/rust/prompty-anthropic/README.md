# prompty-anthropic

Anthropic Claude provider for [**prompty**](https://crates.io/crates/prompty) — adds executor and processor implementations for the Claude Messages API.

## Usage

```rust
use prompty::{load, turn, register_defaults};

// Register built-in renderers/parsers + Anthropic provider
register_defaults();
prompty_anthropic::register();

let agent = load("chat.prompty").await?;
let result = turn(&agent, Some(&inputs), None).await?;
```

## Connection

Configure via `.prompty` frontmatter or environment variables:

```yaml
model:
  id: claude-sonnet-4-20250514
  provider: anthropic
  connection:
    kind: key
    apiKey: ${env:ANTHROPIC_API_KEY}
```

## License

MIT — see [LICENSE](LICENSE) for details.
