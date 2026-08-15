import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/wire/wire_vectors.json — bound to WireMapper.toRequest.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const WireVectors = """
  [
    {
      "name": "chat_simple",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Be helpful"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "system",
              "content": "Be helpful"
            },
            {
              "role": "user",
              "content": "Hello"
            }
          ]
        }
      }
    },
    {
      "name": "chat_with_options",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "temperature": 0.5,
          "maxOutputTokens": 100,
          "topP": 0.9,
          "frequencyPenalty": 0.1,
          "presencePenalty": 0.2,
          "seed": 42,
          "stopSequences": [
            "END"
          ]
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Hello"
            }
          ],
          "temperature": 0.5,
          "max_completion_tokens": 100,
          "top_p": 0.9,
          "frequency_penalty": 0.1,
          "presence_penalty": 0.2,
          "seed": 42,
          "stop": [
            "END"
          ]
        }
      }
    },
    {
      "name": "chat_single_text_optimized",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "What is 2+2?"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "What is 2+2?"
            }
          ]
        }
      }
    },
    {
      "name": "chat_multipart_content",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Describe this image"
              },
              {
                "kind": "image",
                "value": "https://img.png"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Describe this image"
                },
                {
                  "type": "image_url",
                  "image_url": {
                    "url": "https://img.png"
                  }
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "chat_audio_part",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "audio",
                "value": "base64data",
                "mediaType": "audio/wav"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "input_audio",
                  "input_audio": {
                    "data": "base64data",
                    "format": "wav"
                  }
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "chat_audio_mp3",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "audio",
                "value": "base64data",
                "mediaType": "audio/mpeg"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "input_audio",
                  "input_audio": {
                    "data": "base64data",
                    "format": "mp3"
                  }
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "tools_function_wire",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "What is the weather?"
              }
            ]
          }
        ],
        "tools": [
          {
            "kind": "function",
            "name": "get_weather",
            "description": "Get weather",
            "parameters": [
              {
                "name": "city",
                "kind": "string",
                "required": true
              }
            ]
          }
        ],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "What is the weather?"
            }
          ],
          "tools": [
            {
              "type": "function",
              "function": {
                "name": "get_weather",
                "description": "Get weather",
                "parameters": {
                  "type": "object",
                  "properties": {
                    "city": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "city"
                  ]
                }
              }
            }
          ]
        }
      }
    },
    {
      "name": "tools_strict_mode",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Get the weather"
              }
            ]
          }
        ],
        "tools": [
          {
            "kind": "function",
            "name": "get_weather",
            "description": "Get weather",
            "strict": true,
            "parameters": [
              {
                "name": "city",
                "kind": "string",
                "required": true
              }
            ]
          }
        ],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Get the weather"
            }
          ],
          "tools": [
            {
              "type": "function",
              "function": {
                "name": "get_weather",
                "description": "Get weather",
                "strict": true,
                "parameters": {
                  "type": "object",
                  "properties": {
                    "city": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "city"
                  ],
                  "additionalProperties": false
                }
              }
            }
          ]
        }
      }
    },
    {
      "name": "tools_bindings_stripped",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Get the weather"
              }
            ]
          }
        ],
        "tools": [
          {
            "kind": "function",
            "name": "get_weather",
            "description": "Get weather",
            "parameters": [
              {
                "name": "location",
                "kind": "string",
                "required": true
              },
              {
                "name": "unit",
                "kind": "string",
                "required": true
              }
            ],
            "bindings": {
              "unit": {
                "input": "preferred_unit"
              }
            }
          }
        ],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Get the weather"
            }
          ],
          "tools": [
            {
              "type": "function",
              "function": {
                "name": "get_weather",
                "description": "Get weather",
                "parameters": {
                  "type": "object",
                  "properties": {
                    "location": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "location"
                  ]
                }
              }
            }
          ]
        }
      }
    },
    {
      "name": "tools_null_when_empty",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Hello"
            }
          ]
        }
      }
    },
    {
      "name": "structured_output",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "What is the weather in Paris?"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": [
          {
            "name": "city",
            "kind": "string",
            "required": true
          },
          {
            "name": "temp",
            "kind": "integer",
            "required": true
          }
        ]
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "What is the weather in Paris?"
            }
          ],
          "response_format": {
            "type": "json_schema",
            "json_schema": {
              "name": "structured_output",
              "strict": true,
              "schema": {
                "type": "object",
                "properties": {
                  "city": {
                    "type": "string"
                  },
                  "temp": {
                    "type": "integer"
                  }
                },
                "required": [
                  "city",
                  "temp"
                ],
                "additionalProperties": false
              }
            }
          }
        }
      }
    },
    {
      "name": "kind_to_json_type_mapping",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Test"
              }
            ]
          }
        ],
        "tools": [
          {
            "kind": "function",
            "name": "test_types",
            "description": "Tests all type mappings",
            "parameters": [
              {
                "name": "a_string",
                "kind": "string"
              },
              {
                "name": "an_integer",
                "kind": "integer"
              },
              {
                "name": "a_float",
                "kind": "float"
              },
              {
                "name": "a_boolean",
                "kind": "boolean"
              },
              {
                "name": "an_array",
                "kind": "array",
                "items": {
                  "kind": "string"
                }
              },
              {
                "name": "an_object",
                "kind": "object"
              }
            ]
          }
        ],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Test"
            }
          ],
          "tools": [
            {
              "type": "function",
              "function": {
                "name": "test_types",
                "description": "Tests all type mappings",
                "parameters": {
                  "type": "object",
                  "properties": {
                    "a_string": {
                      "type": "string"
                    },
                    "an_integer": {
                      "type": "integer"
                    },
                    "a_float": {
                      "type": "number"
                    },
                    "a_boolean": {
                      "type": "boolean"
                    },
                    "an_array": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "an_object": {
                      "type": "object"
                    }
                  }
                }
              }
            }
          ]
        }
      }
    },
    {
      "name": "embedding_wire",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "embedding",
      "input": {
        "provider": "openai",
        "apiType": "embedding",
        "model_id": "text-embedding-3-small",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello world"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "text-embedding-3-small",
          "input": "Hello world"
        }
      }
    },
    {
      "name": "image_wire",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "image",
      "input": {
        "provider": "openai",
        "apiType": "image",
        "model_id": "dall-e-3",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "A cat"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "dall-e-3",
          "prompt": "A cat"
        }
      }
    },
    {
      "name": "options_max_completion_tokens",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "maxOutputTokens": 500
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Hello"
            }
          ],
          "max_completion_tokens": 500
        }
      }
    },
    {
      "name": "options_stop_sequences",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "stopSequences": [
            ".",
            "!"
          ]
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Hello"
            }
          ],
          "stop": [
            ".",
            "!"
          ]
        }
      }
    },
    {
      "name": "options_additional_properties",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "additionalProperties": {
            "logprobs": true
          }
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4",
          "messages": [
            {
              "role": "user",
              "content": "Hello"
            }
          ],
          "logprobs": true
        }
      }
    },
    {
      "name": "anthropic_system_separate",
      "stage": "wire",
      "provider": "anthropic",
      "targetApi": "chat",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
        "model_id": "claude-3",
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Be helpful"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "maxOutputTokens": 4096
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "claude-3",
          "system": "Be helpful",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Hello"
                }
              ]
            }
          ],
          "max_tokens": 4096
        }
      }
    },
    {
      "name": "anthropic_max_tokens_required",
      "stage": "wire",
      "provider": "anthropic",
      "targetApi": "chat",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
        "model_id": "claude-3",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "claude-3",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Hello"
                }
              ]
            }
          ],
          "max_tokens": 4096
        }
      }
    },
    {
      "name": "anthropic_image_format",
      "stage": "wire",
      "provider": "anthropic",
      "targetApi": "chat",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
        "model_id": "claude-3",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Describe this image"
              },
              {
                "kind": "image",
                "value": "base64data",
                "mediaType": "image/png"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "maxOutputTokens": 4096
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "claude-3",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Describe this image"
                },
                {
                  "type": "image",
                  "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "base64data"
                  }
                }
              ]
            }
          ],
          "max_tokens": 4096
        }
      }
    },
    {
      "name": "chat_image_part",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4o",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "What's in this image?"
              },
              {
                "kind": "image",
                "value": "https://example.com/photo.jpg"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4o",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "What's in this image?"
                },
                {
                  "type": "image_url",
                  "image_url": {
                    "url": "https://example.com/photo.jpg"
                  }
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "chat_image_base64",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "chat",
      "input": {
        "provider": "openai",
        "apiType": "chat",
        "model_id": "gpt-4o",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Describe this"
              },
              {
                "kind": "image",
                "value": "data:image/png;base64,iVBOR..."
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4o",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Describe this"
                },
                {
                  "type": "image_url",
                  "image_url": {
                    "url": "data:image/png;base64,iVBOR..."
                  }
                }
              ]
            }
          ]
        }
      }
    },
    {
      "name": "responses_simple",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "responses",
      "input": {
        "provider": "openai",
        "apiType": "responses",
        "model_id": "gpt-4o",
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Be helpful"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hello"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4o",
          "instructions": "Be helpful",
          "input": [
            {
              "role": "user",
              "content": "Hello"
            }
          ]
        }
      }
    },
    {
      "name": "responses_with_tools",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "responses",
      "input": {
        "provider": "openai",
        "apiType": "responses",
        "model_id": "gpt-4o",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Weather?"
              }
            ]
          }
        ],
        "tools": [
          {
            "name": "get_weather",
            "kind": "function",
            "description": "Get weather",
            "parameters": [
              {
                "name": "city",
                "kind": "string",
                "required": true
              }
            ]
          }
        ],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "gpt-4o",
          "input": [
            {
              "role": "user",
              "content": "Weather?"
            }
          ],
          "tools": [
            {
              "type": "function",
              "name": "get_weather",
              "description": "Get weather",
              "parameters": {
                "type": "object",
                "properties": {
                  "city": {
                    "type": "string"
                  }
                },
                "required": [
                  "city"
                ]
              }
            }
          ]
        }
      }
    },
    {
      "name": "anthropic_tool_wire",
      "stage": "wire",
      "provider": "anthropic",
      "targetApi": "chat",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
        "model_id": "claude-sonnet-4-20250514",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Weather?"
              }
            ]
          }
        ],
        "tools": [
          {
            "name": "get_weather",
            "kind": "function",
            "description": "Get weather",
            "parameters": [
              {
                "name": "city",
                "kind": "string",
                "required": true
              }
            ]
          }
        ],
        "options": {},
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "claude-sonnet-4-20250514",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Weather?"
                }
              ]
            }
          ],
          "tools": [
            {
              "name": "get_weather",
              "description": "Get weather",
              "input_schema": {
                "type": "object",
                "properties": {
                  "city": {
                    "type": "string"
                  }
                },
                "required": [
                  "city"
                ]
              }
            }
          ],
          "max_tokens": 4096
        }
      }
    },
    {
      "name": "anthropic_options",
      "stage": "wire",
      "provider": "anthropic",
      "targetApi": "chat",
      "input": {
        "provider": "anthropic",
        "apiType": "chat",
        "model_id": "claude-sonnet-4-20250514",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hi"
              }
            ]
          }
        ],
        "tools": [],
        "options": {
          "temperature": 0.5,
          "topP": 0.9,
          "topK": 40,
          "maxOutputTokens": 2000,
          "stopSequences": [
            "END"
          ]
        },
        "outputs": []
      },
      "expected": {
        "request_body": {
          "model": "claude-sonnet-4-20250514",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Hi"
                }
              ]
            }
          ],
          "temperature": 0.5,
          "top_p": 0.9,
          "top_k": 40,
          "max_tokens": 2000,
          "stop_sequences": [
            "END"
          ]
        }
      }
    },
    {
      "name": "responses_structured_output",
      "stage": "wire",
      "provider": "openai",
      "targetApi": "responses",
      "input": {
        "provider": "openai",
        "apiType": "responses",
        "model_id": "gpt-4o",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Give me data"
              }
            ]
          }
        ],
        "tools": [],
        "options": {},
        "outputs": [
          {
            "name": "city",
            "kind": "string"
          },
          {
            "name": "temp",
            "kind": "integer"
          }
        ]
      },
      "expected": {
        "request_body": {
          "model": "gpt-4o",
          "input": [
            {
              "role": "user",
              "content": "Give me data"
            }
          ],
          "text": {
            "format": {
              "type": "json_schema",
              "name": "structured_output",
              "schema": {
                "type": "object",
                "properties": {
                  "city": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "temp": {
                    "type": [
                      "integer",
                      "null"
                    ]
                  }
                },
                "required": [
                  "city",
                  "temp"
                ],
                "additionalProperties": false
              },
              "strict": true
            }
          }
        }
      }
    }
  ]
  """;
