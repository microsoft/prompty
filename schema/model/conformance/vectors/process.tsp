import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/process/process_vectors.json — bound to Processor.process.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const ProcessVectors = """
  [
    {
      "name": "chat_text_content",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": "Hello!"
      }
    },
    {
      "name": "chat_tool_calls",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": [
          {
            "id": "call_1",
            "name": "get_weather",
            "arguments": "{\\"city\\":\\"Paris\\"}"
          }
        ]
      }
    },
    {
      "name": "chat_multiple_tool_calls",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": [
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
      }
    },
    {
      "name": "chat_structured_output",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": true
      },
      "expected": {
        "result": {
          "city": "Paris",
          "temp": 72
        }
      }
    },
    {
      "name": "chat_structured_invalid_json",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": true
      },
      "expected": {
        "result": "not valid json"
      }
    },
    {
      "name": "chat_refusal",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": "I cannot help with that"
      }
    },
    {
      "name": "chat_null_content",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": ""
      }
    },
    {
      "name": "embedding_single",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "embedding",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": [
          0.1,
          0.2,
          0.3
        ]
      }
    },
    {
      "name": "embedding_batch",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "embedding",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": [
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
      }
    },
    {
      "name": "image_url",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "image",
        "response": {
          "created": 1700000010,
          "data": [
            {
              "url": "https://img.example.com/generated.png",
              "revised_prompt": null
            }
          ]
        },
        "has_outputs": false
      },
      "expected": {
        "result": "https://img.example.com/generated.png"
      }
    },
    {
      "name": "image_b64",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "image",
        "response": {
          "created": 1700000011,
          "data": [
            {
              "b64_json": "base64data",
              "url": null,
              "revised_prompt": null
            }
          ]
        },
        "has_outputs": false
      },
      "expected": {
        "result": "base64data"
      }
    },
    {
      "name": "image_revised_prompt",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "image",
        "response": {
          "created": 1700000012,
          "data": [
            {
              "url": "https://img.example.com/cat.png",
              "revised_prompt": "A cute cat sitting on a windowsill in warm sunlight"
            }
          ]
        },
        "has_outputs": false
      },
      "expected": {
        "result": "https://img.example.com/cat.png"
      }
    },
    {
      "name": "responses_text",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "responses",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": "Hello!"
      }
    },
    {
      "name": "responses_tool_calls",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "responses",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": [
          {
            "id": "call_1",
            "name": "get_weather",
            "arguments": "{\\"city\\":\\"Paris\\"}"
          }
        ]
      }
    },
    {
      "name": "responses_structured",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "responses",
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
        },
        "has_outputs": true
      },
      "expected": {
        "result": {
          "city": "Paris"
        }
      }
    },
    {
      "name": "anthropic_text",
      "stage": "process",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": "Hello!"
      }
    },
    {
      "name": "anthropic_tool_use",
      "stage": "process",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": [
          {
            "id": "toolu_1",
            "name": "get_weather",
            "arguments": "{\\"city\\":\\"Paris\\"}"
          }
        ]
      }
    },
    {
      "name": "anthropic_multiple_text_blocks",
      "stage": "process",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": "Here is the answer: The weather in Paris is sunny."
      }
    },
    {
      "name": "chat_empty_content",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "chat",
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
        },
        "has_outputs": false
      },
      "expected": {
        "result": ""
      }
    },
    {
      "name": "anthropic_structured_output",
      "stage": "process",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
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
        },
        "has_outputs": true
      },
      "expected": {
        "result": {
          "city": "Paris",
          "temp": 22
        }
      }
    },
    {
      "name": "responses_empty_output",
      "stage": "process",
      "input": {
        "provider": "openai",
        "apiType": "responses",
        "response": {
          "id": "resp-empty",
          "object": "response",
          "status": "completed",
          "output": [],
          "output_text": "",
          "model": "gpt-4o"
        },
        "has_outputs": false
      },
      "expected": {
        "result": ""
      }
    }
  ]
  """;
