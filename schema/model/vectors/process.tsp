import "@typra/emitter";

namespace Prompty;

// Behavior vectors for the Processor.process callable seam, migrated from
// spec/vectors/process/process_vectors.json.
//
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance, branch
// sethjuarez/vector-keyword-key-input @ db3c188): a triple-quoted constant
// Typra parses into entries, bypassing the #{} object-literal grammar. This
// is REQUIRED here because both the populated agent.model field AND the raw
// provider wire response carry a "model" key, which TypeSpec forbids as a
// bare object-value-literal key. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence, so raw wire payloads are first-class.
//
// Shape (bound to process(agent, response): unknown):
//   - input.agent.model.{provider,apiType}: where the runtime processor reads
//     dispatch info; input.agent.outputs present iff the source has_outputs=true
//     (triggers structured/JSON-parsed extraction).
//   - input.response: the raw provider wire object (contains a "model" key).
//   - expected: the BARE extracted result (string | tool-call list | parsed
//     object | vector), matching what process_response returns (the hand-written
//     Rust test in prompty-openai/tests/process_vectors.rs compares against
//     expected.result, i.e. this same bare value).
//   - provider + targetApi carried as first-class vector dispatch selectors.
//
// NOTE: the authoritative wire-form catalog stays at
// spec/vectors/process/process_vectors.json (read directly by the Rust
// conformance test); this file mirrors it as canonical model-form evidence in
// the generated vectors.json for cross-runtime oracles.
const ProcessVectors = """
[
  {
    "name": "chat_text_content",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "chatcmpl-abc123",
        "object": "chat.completion",
        "created": 1700000000,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "Hello!",
              "refusal": null
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 10,
          "completion_tokens": 2,
          "total_tokens": 12
        }
      }
    },
    "expected": "Hello!"
  },
  {
    "name": "chat_tool_calls",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "chatcmpl-tool1",
        "object": "chat.completion",
        "created": 1700000001,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": null,
              "tool_calls": [
                {
                  "id": "call_1",
                  "type": "function",
                  "function": {
                    "name": "get_weather",
                    "arguments": "{\\"city\\":\\"Paris\\"}"
                  }
                }
              ],
              "refusal": null
            },
            "finish_reason": "tool_calls"
          }
        ],
        "usage": {
          "prompt_tokens": 25,
          "completion_tokens": 15,
          "total_tokens": 40
        }
      }
    },
    "expected": [
      {
        "id": "call_1",
        "name": "get_weather",
        "arguments": "{\\"city\\":\\"Paris\\"}"
      }
    ]
  },
  {
    "name": "chat_multiple_tool_calls",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "chatcmpl-tool2",
        "object": "chat.completion",
        "created": 1700000002,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": null,
              "tool_calls": [
                {
                  "id": "call_a",
                  "type": "function",
                  "function": {
                    "name": "get_weather",
                    "arguments": "{\\"city\\":\\"Paris\\"}"
                  }
                },
                {
                  "id": "call_b",
                  "type": "function",
                  "function": {
                    "name": "get_time",
                    "arguments": "{\\"timezone\\":\\"Europe/Paris\\"}"
                  }
                }
              ],
              "refusal": null
            },
            "finish_reason": "tool_calls"
          }
        ],
        "usage": {
          "prompt_tokens": 30,
          "completion_tokens": 28,
          "total_tokens": 58
        }
      }
    },
    "expected": [
      {
        "id": "call_a",
        "name": "get_weather",
        "arguments": "{\\"city\\":\\"Paris\\"}"
      },
      {
        "id": "call_b",
        "name": "get_time",
        "arguments": "{\\"timezone\\":\\"Europe/Paris\\"}"
      }
    ]
  },
  {
    "name": "chat_structured_output",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        },
        "outputs": [
          {
            "name": "result",
            "kind": "string"
          }
        ]
      },
      "response": {
        "id": "chatcmpl-struct1",
        "object": "chat.completion",
        "created": 1700000003,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "{\\"city\\":\\"Paris\\",\\"temp\\":72}",
              "refusal": null
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 20,
          "completion_tokens": 12,
          "total_tokens": 32
        }
      }
    },
    "expected": {
      "city": "Paris",
      "temp": 72
    }
  },
  {
    "name": "chat_structured_invalid_json",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        },
        "outputs": [
          {
            "name": "result",
            "kind": "string"
          }
        ]
      },
      "response": {
        "id": "chatcmpl-struct2",
        "object": "chat.completion",
        "created": 1700000004,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "not valid json",
              "refusal": null
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 20,
          "completion_tokens": 5,
          "total_tokens": 25
        }
      }
    },
    "expected": "not valid json"
  },
  {
    "name": "chat_refusal",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "chatcmpl-refusal1",
        "object": "chat.completion",
        "created": 1700000005,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": null,
              "refusal": "I cannot help with that"
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 15,
          "completion_tokens": 8,
          "total_tokens": 23
        }
      }
    },
    "expected": "I cannot help with that"
  },
  {
    "name": "chat_null_content",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "chatcmpl-null1",
        "object": "chat.completion",
        "created": 1700000006,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": null,
              "refusal": null
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 10,
          "completion_tokens": 0,
          "total_tokens": 10
        }
      }
    },
    "expected": ""
  },
  {
    "name": "embedding_single",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "embedding",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "embedding"
        }
      },
      "response": {
        "object": "list",
        "data": [
          {
            "object": "embedding",
            "index": 0,
            "embedding": [
              0.1,
              0.2,
              0.3
            ]
          }
        ],
        "model": "text-embedding-3-small",
        "usage": {
          "prompt_tokens": 5,
          "total_tokens": 5
        }
      }
    },
    "expected": [
      0.1,
      0.2,
      0.3
    ]
  },
  {
    "name": "embedding_batch",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "embedding",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "embedding"
        }
      },
      "response": {
        "object": "list",
        "data": [
          {
            "object": "embedding",
            "index": 0,
            "embedding": [
              0.1,
              0.2
            ]
          },
          {
            "object": "embedding",
            "index": 1,
            "embedding": [
              0.3,
              0.4
            ]
          },
          {
            "object": "embedding",
            "index": 2,
            "embedding": [
              0.5,
              0.6
            ]
          }
        ],
        "model": "text-embedding-3-small",
        "usage": {
          "prompt_tokens": 15,
          "total_tokens": 15
        }
      }
    },
    "expected": [
      [
        0.1,
        0.2
      ],
      [
        0.3,
        0.4
      ],
      [
        0.5,
        0.6
      ]
    ]
  },
  {
    "name": "image_url",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "image",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "image"
        }
      },
      "response": {
        "created": 1700000010,
        "data": [
          {
            "url": "https://img.example.com/generated.png",
            "revised_prompt": null
          }
        ]
      }
    },
    "expected": "https://img.example.com/generated.png"
  },
  {
    "name": "image_b64",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "image",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "image"
        }
      },
      "response": {
        "created": 1700000011,
        "data": [
          {
            "b64_json": "base64data",
            "url": null,
            "revised_prompt": null
          }
        ]
      }
    },
    "expected": "base64data"
  },
  {
    "name": "image_revised_prompt",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "image",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "image"
        }
      },
      "response": {
        "created": 1700000012,
        "data": [
          {
            "url": "https://img.example.com/cat.png",
            "revised_prompt": "A cute cat sitting on a windowsill in warm sunlight"
          }
        ]
      }
    },
    "expected": "https://img.example.com/cat.png"
  },
  {
    "name": "responses_text",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "responses",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "responses"
        }
      },
      "response": {
        "id": "resp_abc123",
        "object": "response",
        "created_at": 1700000020,
        "model": "gpt-4o-mini",
        "status": "completed",
        "output": [
          {
            "type": "message",
            "id": "msg_001",
            "status": "completed",
            "role": "assistant",
            "content": [
              {
                "type": "output_text",
                "text": "Hello!",
                "annotations": []
              }
            ]
          }
        ],
        "output_text": "Hello!",
        "usage": {
          "input_tokens": 10,
          "output_tokens": 2,
          "total_tokens": 12
        }
      }
    },
    "expected": "Hello!"
  },
  {
    "name": "responses_tool_calls",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "responses",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "responses"
        }
      },
      "response": {
        "id": "resp_tool1",
        "object": "response",
        "created_at": 1700000021,
        "model": "gpt-4o-mini",
        "status": "completed",
        "output": [
          {
            "type": "function_call",
            "id": "fc_001",
            "call_id": "call_1",
            "name": "get_weather",
            "arguments": "{\\"city\\":\\"Paris\\"}",
            "status": "completed"
          }
        ],
        "output_text": "",
        "usage": {
          "input_tokens": 25,
          "output_tokens": 18,
          "total_tokens": 43
        }
      }
    },
    "expected": [
      {
        "id": "call_1",
        "name": "get_weather",
        "arguments": "{\\"city\\":\\"Paris\\"}"
      }
    ]
  },
  {
    "name": "responses_structured",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "responses",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "responses"
        },
        "outputs": [
          {
            "name": "result",
            "kind": "string"
          }
        ]
      },
      "response": {
        "id": "resp_struct1",
        "object": "response",
        "created_at": 1700000022,
        "model": "gpt-4o-mini",
        "status": "completed",
        "output": [
          {
            "type": "message",
            "id": "msg_002",
            "status": "completed",
            "role": "assistant",
            "content": [
              {
                "type": "output_text",
                "text": "{\\"city\\":\\"Paris\\"}",
                "annotations": []
              }
            ]
          }
        ],
        "output_text": "{\\"city\\":\\"Paris\\"}",
        "usage": {
          "input_tokens": 20,
          "output_tokens": 8,
          "total_tokens": 28
        }
      }
    },
    "expected": {
      "city": "Paris"
    }
  },
  {
    "name": "anthropic_text",
    "stage": "callable",
    "provider": "anthropic",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "anthropic",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-4-20250514",
        "content": [
          {
            "type": "text",
            "text": "Hello!"
          }
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {
          "input_tokens": 10,
          "output_tokens": 3
        }
      }
    },
    "expected": "Hello!"
  },
  {
    "name": "anthropic_tool_use",
    "stage": "callable",
    "provider": "anthropic",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "anthropic",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "msg_02YGEUEKHgBBDzvnquwWpZMN",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-4-20250514",
        "content": [
          {
            "type": "tool_use",
            "id": "toolu_1",
            "name": "get_weather",
            "input": {
              "city": "Paris"
            }
          }
        ],
        "stop_reason": "tool_use",
        "stop_sequence": null,
        "usage": {
          "input_tokens": 25,
          "output_tokens": 20
        }
      }
    },
    "expected": [
      {
        "id": "toolu_1",
        "name": "get_weather",
        "arguments": "{\\"city\\":\\"Paris\\"}"
      }
    ]
  },
  {
    "name": "anthropic_multiple_text_blocks",
    "stage": "callable",
    "provider": "anthropic",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "anthropic",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "msg_03ZHFVFLIiCCEzvnrwxXqaNO",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-4-20250514",
        "content": [
          {
            "type": "text",
            "text": "Here is the answer:"
          },
          {
            "type": "text",
            "text": " The weather in Paris is sunny."
          }
        ],
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {
          "input_tokens": 15,
          "output_tokens": 12
        }
      }
    },
    "expected": "Here is the answer: The weather in Paris is sunny."
  },
  {
    "name": "chat_empty_content",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "chat"
        }
      },
      "response": {
        "id": "chatcmpl-empty",
        "object": "chat.completion",
        "created": 1700000000,
        "model": "gpt-4o-mini",
        "choices": [
          {
            "index": 0,
            "message": {
              "role": "assistant",
              "content": "",
              "refusal": null
            },
            "finish_reason": "stop"
          }
        ],
        "usage": {
          "prompt_tokens": 5,
          "completion_tokens": 0,
          "total_tokens": 5
        }
      }
    },
    "expected": ""
  },
  {
    "name": "anthropic_structured_output",
    "stage": "callable",
    "provider": "anthropic",
    "targetApi": "chat",
    "input": {
      "agent": {
        "model": {
          "provider": "anthropic",
          "apiType": "chat"
        },
        "outputs": [
          {
            "name": "result",
            "kind": "string"
          }
        ]
      },
      "response": {
        "id": "msg-struct",
        "type": "message",
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "{\\"city\\": \\"Paris\\", \\"temp\\": 22}"
          }
        ],
        "model": "claude-sonnet-4-20250514",
        "stop_reason": "end_turn",
        "stop_sequence": null,
        "usage": {
          "input_tokens": 20,
          "output_tokens": 10
        }
      }
    },
    "expected": {
      "city": "Paris",
      "temp": 22
    }
  },
  {
    "name": "responses_empty_output",
    "stage": "callable",
    "provider": "openai",
    "targetApi": "responses",
    "input": {
      "agent": {
        "model": {
          "provider": "openai",
          "apiType": "responses"
        }
      },
      "response": {
        "id": "resp-empty",
        "object": "response",
        "status": "completed",
        "output": [],
        "output_text": "",
        "model": "gpt-4o"
      }
    },
    "expected": ""
  }
]
""";
