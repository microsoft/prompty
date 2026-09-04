import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// The first prompty "service drill" -- a conformance vector that crosses the
// REAL Executor->Processor transport seam. Bound to LiveChatConformance.complete.
//
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance) so the domain
// request may carry keyword keys (e.g. "model") and nested ref objects. Two keys
// are intentionally NON-STANDARD and prove the emitter's unknown-key passthrough:
//
//   * "exchange" -- the drill's transport/cassette/plane contract. The runner
//     does NOT resolve it (it only resolves "input"); the consumer-owned adapter
//     reads context.vector["exchange"] and resolves the nested $env base-url ref
//     and $json cassette ref ITSELF via context.resolveInput.
//
// "requires" is deliberately OMITTED. The runner's requirement guard is
// all-or-nothing (an unavailable token skips the WHOLE vector), which cannot
// express "defer the live plane but still assert replay". So the drill vector
// carries no requirement token; the adapter self-gates the live plane on
// base-url + api-key presence and ALWAYS asserts the replay plane.
const DrillVectors = """
  [
    {
      "name": "openai_chat_drill",
      "stage": "drill",
      "provider": "openai",
      "input": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "apiKey": { "$env": "OPENAI_API_KEY" },
        "endpoint": { "$env": "OPENAI_BASE_URL" },
        "messages": [
          { "role": "user", "content": "Say hello in exactly one word." }
        ],
        "options": {
          "temperature": 0,
          "maxOutputTokens": 16
        }
      },
      "exchange": {
        "transport": {
          "baseUrl": { "$env": "OPENAI_BASE_URL" }
        },
        "cassette": { "$json": "cassettes/openai_chat_drill.json" },
        "planes": ["transport", "wire", "semantic"]
      },
      "expected": {
        "role": "assistant",
        "contentNonEmpty": true,
        "finishReasonInEnum": true
      }
    }
  ]
  """;
