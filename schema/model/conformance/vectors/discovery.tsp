import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/discovery/discovery_vectors.json — bound to ModelMapper.mapModel.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const DiscoveryVectors = """
  [
    {
      "name": "openai_model_basic",
      "stage": "discovery",
      "provider": "openai",
      "shape": "model",
      "input": {
        "id": "o3-mini",
        "object": "model",
        "created": 1715367049,
        "owned_by": "system"
      },
      "expected": {
        "id": "o3-mini",
        "ownedBy": "system",
        "additionalProperties": {
          "id": "o3-mini",
          "object": "model",
          "created": 1715367049,
          "owned_by": "system"
        }
      }
    },
    {
      "name": "openai_model_finetune_no_owner",
      "stage": "discovery",
      "provider": "openai",
      "shape": "model",
      "input": {
        "id": "ft:custom-model:acme::xyz"
      },
      "expected": {
        "id": "ft:custom-model:acme::xyz",
        "additionalProperties": {
          "id": "ft:custom-model:acme::xyz"
        }
      }
    },
    {
      "name": "anthropic_model_full",
      "stage": "discovery",
      "provider": "anthropic",
      "shape": "model",
      "input": {
        "id": "claude-sonnet-4-20250514",
        "display_name": "Claude Sonnet 4",
        "context_length": 200000,
        "input_modalities": [
          "text",
          "image"
        ],
        "output_modalities": [
          "text"
        ],
        "type": "model"
      },
      "expected": {
        "id": "claude-sonnet-4-20250514",
        "displayName": "Claude Sonnet 4",
        "ownedBy": "anthropic",
        "contextWindow": 200000,
        "inputModalities": [
          "text",
          "image"
        ],
        "outputModalities": [
          "text"
        ],
        "additionalProperties": {
          "id": "claude-sonnet-4-20250514",
          "display_name": "Claude Sonnet 4",
          "context_length": 200000,
          "input_modalities": [
            "text",
            "image"
          ],
          "output_modalities": [
            "text"
          ],
          "type": "model"
        }
      }
    },
    {
      "name": "anthropic_model_minimal",
      "stage": "discovery",
      "provider": "anthropic",
      "shape": "model",
      "input": {
        "id": "claude-3-haiku-20240307",
        "type": "model"
      },
      "expected": {
        "id": "claude-3-haiku-20240307",
        "ownedBy": "anthropic",
        "additionalProperties": {
          "id": "claude-3-haiku-20240307",
          "type": "model"
        }
      }
    },
    {
      "name": "foundry_deployment_flat_v1",
      "stage": "discovery",
      "provider": "foundry",
      "shape": "deployment",
      "input": {
        "name": "gpt-4o",
        "type": "ModelDeployment",
        "modelName": "gpt-4o",
        "modelVersion": "2024-08-06",
        "modelPublisher": "OpenAI",
        "capabilities": {
          "chatCompletion": "true"
        },
        "sku": {
          "name": "GlobalStandard",
          "capacity": 50
        }
      },
      "expected": {
        "id": "gpt-4o",
        "displayName": "gpt-4o",
        "ownedBy": "OpenAI",
        "additionalProperties": {
          "name": "gpt-4o",
          "type": "ModelDeployment",
          "modelName": "gpt-4o",
          "modelVersion": "2024-08-06",
          "modelPublisher": "OpenAI",
          "capabilities": {
            "chatCompletion": "true"
          },
          "sku": {
            "name": "GlobalStandard",
            "capacity": 50
          }
        }
      }
    },
    {
      "name": "foundry_deployment_nested_arm",
      "stage": "discovery",
      "provider": "foundry",
      "shape": "deployment",
      "input": {
        "name": "my-gpt4",
        "properties": {
          "model": {
            "name": "gpt-4",
            "publisher": "OpenAI",
            "maxContextLength": 8192
          },
          "capabilities": {
            "supportedInputModalities": [
              "text"
            ],
            "supportedOutputModalities": [
              "text"
            ]
          }
        }
      },
      "expected": {
        "id": "my-gpt4",
        "displayName": "gpt-4",
        "ownedBy": "OpenAI",
        "contextWindow": 8192,
        "inputModalities": [
          "text"
        ],
        "outputModalities": [
          "text"
        ],
        "additionalProperties": {
          "name": "my-gpt4",
          "properties": {
            "model": {
              "name": "gpt-4",
              "publisher": "OpenAI",
              "maxContextLength": 8192
            },
            "capabilities": {
              "supportedInputModalities": [
                "text"
              ],
              "supportedOutputModalities": [
                "text"
              ]
            }
          }
        }
      }
    },
    {
      "name": "foundry_catalog_model",
      "stage": "discovery",
      "provider": "foundry",
      "shape": "catalog",
      "input": {
        "id": "gpt-4",
        "owned_by": "openai",
        "maxContextLength": 8192,
        "status": "succeeded"
      },
      "expected": {
        "id": "gpt-4",
        "ownedBy": "openai",
        "contextWindow": 8192,
        "additionalProperties": {
          "id": "gpt-4",
          "owned_by": "openai",
          "maxContextLength": 8192,
          "status": "succeeded"
        }
      }
    }
  ]
  """;
