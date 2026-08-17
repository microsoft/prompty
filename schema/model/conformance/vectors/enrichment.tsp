import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/discovery/enrichment_vectors.json — bound to ModelMapper.enrich.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const EnrichmentVectors = """
  [
    {
      "name": "openai_enrich_gpt4o",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "gpt-4o"
      },
      "expected": {
        "id": "gpt-4o",
        "contextWindow": 128000,
        "inputModalities": [
          "text",
          "image"
        ],
        "outputModalities": [
          "text"
        ]
      }
    },
    {
      "name": "openai_enrich_gpt4o_mini_longest_prefix",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "gpt-4o-mini-2024-07-18"
      },
      "expected": {
        "id": "gpt-4o-mini-2024-07-18",
        "contextWindow": 128000,
        "inputModalities": [
          "text",
          "image"
        ],
        "outputModalities": [
          "text"
        ]
      }
    },
    {
      "name": "openai_enrich_embedding_empty_output_modalities",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "text-embedding-3-small"
      },
      "expected": {
        "id": "text-embedding-3-small",
        "contextWindow": 8191,
        "inputModalities": [
          "text"
        ],
        "outputModalities": []
      }
    },
    {
      "name": "openai_enrich_dalle3_no_context_window",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "dall-e-3"
      },
      "expected": {
        "id": "dall-e-3",
        "inputModalities": [
          "text"
        ],
        "outputModalities": [
          "image"
        ]
      }
    },
    {
      "name": "openai_enrich_provider_context_window_wins",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "gpt-4o",
        "contextWindow": 999
      },
      "expected": {
        "id": "gpt-4o",
        "contextWindow": 999,
        "inputModalities": [
          "text",
          "image"
        ],
        "outputModalities": [
          "text"
        ]
      }
    },
    {
      "name": "openai_enrich_unknown_id_is_noop",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "ft:custom-model:acme::xyz"
      },
      "expected": {
        "id": "ft:custom-model:acme::xyz"
      }
    },
    {
      "name": "openai_enrich_provider_empty_modalities_win",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "gpt-4o",
        "inputModalities": []
      },
      "expected": {
        "id": "gpt-4o",
        "contextWindow": 128000,
        "inputModalities": [],
        "outputModalities": [
          "text"
        ]
      }
    },
    {
      "name": "openai_enrich_prefix_requires_token_boundary",
      "stage": "enrichment",
      "provider": "openai",
      "input": {
        "id": "gpt-45-future"
      },
      "expected": {
        "id": "gpt-45-future"
      }
    },
    {
      "name": "anthropic_enrich_no_dataset_entry_is_noop",
      "stage": "enrichment",
      "provider": "anthropic",
      "input": {
        "id": "claude-sonnet-4-20250514",
        "contextWindow": 200000,
        "inputModalities": [
          "text",
          "image"
        ],
        "outputModalities": [
          "text"
        ]
      },
      "expected": {
        "id": "claude-sonnet-4-20250514",
        "contextWindow": 200000,
        "inputModalities": [
          "text",
          "image"
        ],
        "outputModalities": [
          "text"
        ]
      }
    }
  ]
  """;
