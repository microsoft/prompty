import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/process/stream_failure_vectors.json —
// bound to Processor.processStream. Authored as a JSON-STRING vector set (Typra
// 0.7.0+ affordance): a triple-quoted constant Typra parses into vector entries, so
// raw provider stream-event payloads with keyword keys are first-class. @vector
// inputs are opaque (unknown), JSON-compared conformance evidence emitted into the
// cross-runtime vectors.json.
//
// These classify a provider's ordered stream events into canonical StreamChunk
// items plus the streaming *reconciliation* contract every runtime must agree on:
// determinate (terminal, never commits) vs indeterminate (transport, preserves
// partial text and requires reconciliation) failures, and whether a completion was
// committed. Promoted from a standalone json + hand-written per-runtime runners so
// every runtime is held to the same streaming-failure semantics.
const StreamFailureVectors = """
  [
    {
      "name": "stream_refusal_is_determinate",
      "description": "A model refusal is a determinate terminal failure and never commits a completion",
      "stage": "processStream",
      "input": {
        "provider": "openai",
        "events": [
          {
            "kind": "provider",
            "value": {
              "choices": [
                {
                  "delta": {
                    "refusal": "I cannot help with that"
                  }
                }
              ]
            }
          }
        ]
      },
      "expected": {
        "chunks": [
          {
            "kind": "failure",
            "failure": {
              "outcome": "determinate",
              "message": "Model refused: I cannot help with that"
            }
          }
        ],
        "partialText": "",
        "requiresReconciliation": false,
        "completionCommitted": false
      }
    },
    {
      "name": "partial_text_then_indeterminate_failure",
      "description": "A post-open transport failure preserves partial text, requires reconciliation, and never commits a completion",
      "stage": "processStream",
      "input": {
        "provider": "openai",
        "events": [
          {
            "kind": "provider",
            "value": {
              "choices": [
                {
                  "delta": {
                    "content": "partial"
                  }
                }
              ]
            }
          },
          {
            "kind": "transportError",
            "message": "SSE stream error: connection reset"
          }
        ]
      },
      "expected": {
        "chunks": [
          {
            "kind": "text",
            "value": "partial"
          },
          {
            "kind": "failure",
            "failure": {
              "outcome": "indeterminate",
              "message": "SSE stream error: connection reset"
            }
          }
        ],
        "partialText": "partial",
        "requiresReconciliation": true,
        "completionCommitted": false
      }
    }
  ]
  """;
