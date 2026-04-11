# prompty-foundry

Azure OpenAI / Foundry provider for [**prompty**](https://crates.io/crates/prompty) — adds executor and processor implementations for Azure-hosted OpenAI models.

## Usage

```rust
use prompty::{load, turn, register_defaults};

// Register built-in renderers/parsers + Azure/Foundry provider
register_defaults();
prompty_foundry::register();

let agent = load("chat.prompty").await?;
let result = turn(&agent, Some(&inputs), None).await?;
```

## Connection

Configure via `.prompty` frontmatter or environment variables:

```yaml
model:
  id: gpt-4o
  provider: foundry
  connection:
    kind: key
    endpoint: ${env:AZURE_OPENAI_ENDPOINT}
    apiKey: ${env:AZURE_OPENAI_API_KEY}
```

## Features

- `entra_id` — Enables Microsoft Entra ID (Azure AD) authentication via `azure_identity`

## License

MIT — see [LICENSE](LICENSE) for details.
