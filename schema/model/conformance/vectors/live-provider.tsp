import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Opt-in live provider vectors. These are deliberately small structural smoke
// probes: deterministic wire vectors own request shape; these live vectors own
// whether today's provider accepts the runtime's request and returns a minimally
// valid response. Each vector declares the credential/capability it needs in
// `requires`, so uncredentialed environments skip before any network call.
const LiveProviderVectors = """
    [
      {
        "name": "openai_chat_accepts_wire",
        "description": "OpenAI accepts the runtime's canonical chat wire shape and returns non-empty assistant content.",
        "stage": "live-provider",
        "provider": "openai",
        "targetApi": "chat",
        "requires": ["provider:openai"],
        "input": {
          "provider": "openai",
          "apiType": "chat",
          "model": "gpt-4o-mini",
          "messages": [
            {
              "role": "user",
              "content": "Reply with exactly one word: pong."
            }
          ],
          "options": {
            "temperature": 0,
            "maxOutputTokens": 16
          }
        },
        "expected": {
          "accepted": true,
          "contentNonEmpty": true
        },
        "operation": "invoke"
      },
      {
        "name": "anthropic_chat_accepts_wire",
        "description": "Anthropic accepts the runtime's canonical chat wire shape and returns non-empty assistant content.",
        "stage": "live-provider",
        "provider": "anthropic",
        "targetApi": "chat",
        "requires": ["provider:anthropic"],
        "input": {
          "provider": "anthropic",
          "apiType": "chat",
          "model": "claude-sonnet-4-5-20250929",
          "messages": [
            {
              "role": "user",
              "content": "Reply with exactly one word: pong."
            }
          ],
          "options": {
            "temperature": 0,
            "maxOutputTokens": 32
          }
        },
        "expected": {
          "accepted": true,
          "contentNonEmpty": true
        },
        "operation": "invoke"
      },
      {
        "name": "foundry_azure_key_chat_accepts_wire",
        "description": "Azure OpenAI / Foundry key-auth deployment accepts the runtime's canonical chat wire shape.",
        "stage": "live-provider",
        "provider": "foundry",
        "targetApi": "chat",
        "requires": ["provider:foundry-key"],
        "input": {
          "provider": "foundry",
          "apiType": "chat",
          "model": {"$env": "AZURE_OPENAI_CHAT_DEPLOYMENT"},
          "endpoint": {"$env": "AZURE_OPENAI_ENDPOINT"},
          "apiKey": {"$env": "AZURE_OPENAI_API_KEY"},
          "messages": [
            {
              "role": "user",
              "content": "Reply with exactly one word: pong."
            }
          ],
          "options": {
            "temperature": 0,
            "maxOutputTokens": 16
          }
        },
        "expected": {
          "accepted": true,
          "contentNonEmpty": true
        },
        "operation": "invoke"
      },
      {
        "name": "foundry_entra_chat_accepts_wire",
        "description": "Foundry project Entra-auth deployment accepts the runtime's canonical chat wire shape.",
        "stage": "live-provider",
        "provider": "foundry",
        "targetApi": "chat",
        "requires": ["provider:foundry-entra"],
        "input": {
          "provider": "foundry",
          "apiType": "chat",
          "model": {"$env": "FOUNDRY_MODEL"},
          "endpoint": {"$env": "FOUNDRY_PROJECT_ENDPOINT"},
          "messages": [
            {
              "role": "user",
              "content": "Reply with exactly one word: pong."
            }
          ],
          "options": {
            "temperature": 0,
            "maxOutputTokens": 16
          }
        },
        "expected": {
          "accepted": true,
          "contentNonEmpty": true
        },
        "operation": "invoke"
      }
    ]
  """;
