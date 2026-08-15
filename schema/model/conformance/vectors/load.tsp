import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/load/load_vectors.json — bound to Loader.load.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const LoadVectors = """
  [
    {
      "name": "basic_load",
      "stage": "load",
      "input": {
        "fixture": "basic.prompty",
        "env": {
          "OPENAI_ENDPOINT": "https://test.openai.com",
          "OPENAI_API_KEY": "sk-test123"
        }
      },
      "expected": {
        "kind": "prompt",
        "name": "basic-prompt",
        "description": "A basic prompt for testing",
        "metadata": {
          "authors": [
            "testauthor"
          ]
        },
        "model": {
          "id": "gpt-4",
          "provider": "openai",
          "apiType": "chat",
          "connection": {
            "kind": "key",
            "endpoint": "https://test.openai.com",
            "apiKey": "sk-test123"
          },
          "options": {
            "temperature": 0.7,
            "maxOutputTokens": 1000
          }
        },
        "inputs": [
          {
            "name": "firstName",
            "kind": "string",
            "default": "Jane"
          },
          {
            "name": "lastName",
            "kind": "string",
            "default": "Doe"
          },
          {
            "name": "question",
            "kind": "string",
            "default": "What is the meaning of life?"
          }
        ],
        "template": {
          "format": {
            "kind": "jinja2"
          },
          "parser": {
            "kind": "prompty"
          }
        },
        "instructions": "system:\\nYou are an AI assistant who helps people find information.\\n\\n# Customer\\nYou are helping {{firstName}} {{lastName}} to find answers to their questions.\\n\\nuser:\\n{{question}}"
      }
    },
    {
      "name": "minimal_load",
      "stage": "load",
      "input": {
        "fixture": "minimal.prompty"
      },
      "expected": {
        "kind": "prompt",
        "name": "minimal",
        "model": {
          "id": "gpt-4"
        },
        "instructions": "system:\\nHello world.",
        "inputs": null,
        "outputs": null,
        "tools": null
      }
    },
    {
      "name": "model_shorthand",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "test",
          "model": "gpt-4o"
        }
      },
      "expected": {
        "kind": "prompt",
        "name": "test",
        "model": {
          "id": "gpt-4o"
        }
      }
    },
    {
      "name": "env_resolution",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "env-test",
          "model": {
            "id": "gpt-4",
            "connection": {
              "kind": "key",
              "endpoint": "\${env:MY_VAR}"
            }
          }
        },
        "env": {
          "MY_VAR": "hello"
        }
      },
      "expected": {
        "model": {
          "connection": {
            "kind": "key",
            "endpoint": "hello"
          }
        }
      }
    },
    {
      "name": "env_default",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "env-default-test",
          "model": {
            "id": "gpt-4",
            "connection": {
              "kind": "key",
              "endpoint": "\${env:MISSING_VAR:fallback_value}"
            }
          }
        },
        "env": {}
      },
      "expected": {
        "model": {
          "connection": {
            "kind": "key",
            "endpoint": "fallback_value"
          }
        }
      }
    },
    {
      "name": "env_missing_error",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "env-error-test",
          "model": {
            "id": "gpt-4",
            "connection": {
              "kind": "key",
              "endpoint": "\${env:NONEXISTENT}"
            }
          }
        },
        "env": {}
      },
      "expected": {
        "error": "Environment variable 'NONEXISTENT' not set"
      }
    },
    {
      "name": "file_resolution",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "file-ref-test",
          "model": {
            "id": "gpt-4",
            "connection": "\${file:shared_connection.json}"
          }
        },
        "env": {
          "OPENAI_API_KEY": "shared-key"
        },
        "files": {
          "shared_connection.json": {
            "kind": "key",
            "endpoint": "https://shared.example.com",
            "apiKey": "shared-key"
          }
        }
      },
      "expected": {
        "model": {
          "connection": {
            "kind": "key",
            "endpoint": "https://shared.example.com",
            "apiKey": "shared-key"
          }
        }
      }
    },
    {
      "name": "tools_function_load",
      "stage": "load",
      "input": {
        "fixture": "tools_function.prompty"
      },
      "expected": {
        "kind": "prompt",
        "name": "function-tools",
        "model": {
          "id": "gpt-4",
          "apiType": "chat"
        },
        "tools": [
          {
            "name": "get_weather",
            "kind": "function",
            "description": "Get the current weather in a given location",
            "strict": true,
            "parameters": [
              {
                "name": "location",
                "kind": "string",
                "description": "The city and state, e.g. San Francisco, CA"
              },
              {
                "name": "unit",
                "kind": "string",
                "description": "Temperature unit",
                "enumValues": [
                  "celsius",
                  "fahrenheit"
                ]
              }
            ],
            "bindings": {
              "unit": {
                "input": "preferred_unit"
              }
            }
          }
        ],
        "inputs": [
          {
            "name": "question",
            "kind": "string",
            "default": "What's the weather in Paris?"
          },
          {
            "name": "preferred_unit",
            "kind": "string",
            "default": "celsius"
          }
        ],
        "instructions": "system:\\nYou are a helpful assistant with access to tools.\\n\\nuser:\\n{{question}}"
      }
    },
    {
      "name": "embedding_load",
      "stage": "load",
      "input": {
        "fixture": "embedding.prompty",
        "env": {
          "OPENAI_ENDPOINT": "https://test.openai.com",
          "OPENAI_API_KEY": "sk-test123"
        }
      },
      "expected": {
        "kind": "prompt",
        "name": "embedding",
        "model": {
          "id": "text-embedding-3-small",
          "provider": "openai",
          "apiType": "embedding",
          "connection": {
            "kind": "key",
            "endpoint": "https://test.openai.com",
            "apiKey": "sk-test123"
          }
        },
        "inputs": [
          {
            "name": "text",
            "kind": "string",
            "default": "Hello world"
          }
        ],
        "instructions": "{{text}}"
      }
    },
    {
      "name": "instructions_from_body",
      "stage": "load",
      "input": {
        "fixture": "basic.prompty",
        "env": {
          "OPENAI_ENDPOINT": "https://test.openai.com",
          "OPENAI_API_KEY": "sk-test123"
        }
      },
      "expected": {
        "instructions": "system:\\nYou are an AI assistant who helps people find information.\\n\\n# Customer\\nYou are helping {{firstName}} {{lastName}} to find answers to their questions.\\n\\nuser:\\n{{question}}"
      }
    },
    {
      "name": "kind_always_prompt",
      "stage": "load",
      "input": {
        "fixture": "minimal.prompty"
      },
      "expected": {
        "kind": "prompt"
      }
    },
    {
      "name": "missing_file_error",
      "stage": "load",
      "input": {
        "fixture": "nonexistent.prompty"
      },
      "expected": {
        "error": "FileNotFoundError"
      }
    },
    {
      "name": "invalid_frontmatter_error",
      "stage": "load",
      "input": {
        "frontmatter_raw": "---\\nname: [invalid\\n---\\nHello"
      },
      "expected": {
        "error": "invalid frontmatter"
      }
    },
    {
      "name": "input_validation_required",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "required-input-test",
          "model": "gpt-4",
          "inputs": [
            {
              "name": "city",
              "kind": "string",
              "required": true
            }
          ]
        },
        "inputs": {}
      },
      "expected": {
        "error": "Missing required input",
        "error_field": "city"
      }
    },
    {
      "name": "input_validation_default_fill",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "default-fill-test",
          "model": "gpt-4",
          "inputs": [
            {
              "name": "name",
              "kind": "string",
              "default": "world"
            }
          ]
        },
        "inputs": {}
      },
      "expected": {
        "validated_inputs": {
          "name": "world"
        }
      }
    },
    {
      "name": "input_validation_optional_omit",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "optional-omit-test",
          "model": "gpt-4",
          "inputs": [
            {
              "name": "nickname",
              "kind": "string",
              "required": false
            }
          ]
        },
        "inputs": {}
      },
      "expected": {
        "validated_inputs": {}
      }
    },
    {
      "name": "input_validation_example_not_used",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "example-not-used-test",
          "model": "gpt-4",
          "inputs": [
            {
              "name": "topic",
              "kind": "string",
              "required": false,
              "example": "sample"
            }
          ]
        },
        "inputs": {}
      },
      "expected": {
        "validated_inputs": {}
      }
    },
    {
      "name": "tools_mcp_load",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "mcp-test",
          "model": "gpt-4",
          "tools": [
            {
              "name": "filesystem",
              "kind": "mcp",
              "serverName": "fs-server",
              "connection": {
                "kind": "reference",
                "name": "my-mcp"
              }
            }
          ]
        }
      },
      "expected": {
        "tools": [
          {
            "name": "filesystem",
            "kind": "mcp",
            "serverName": "fs-server"
          }
        ]
      }
    },
    {
      "name": "tools_openapi_load",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "openapi-test",
          "model": "gpt-4",
          "tools": [
            {
              "name": "weather_api",
              "kind": "openapi",
              "specification": "./weather.json",
              "connection": {
                "kind": "key",
                "endpoint": "https://api.weather.com"
              }
            }
          ]
        }
      },
      "expected": {
        "tools": [
          {
            "name": "weather_api",
            "kind": "openapi",
            "specification": "./weather.json"
          }
        ]
      }
    },
    {
      "name": "tools_prompty_load",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "prompty-tool-test",
          "model": "gpt-4",
          "tools": [
            {
              "name": "helper",
              "kind": "prompty",
              "path": "./helper.prompty"
            }
          ]
        }
      },
      "expected": {
        "tools": [
          {
            "name": "helper",
            "kind": "prompty",
            "path": "./helper.prompty"
          }
        ]
      }
    },
    {
      "name": "tools_custom_load",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "custom-tool-test",
          "model": "gpt-4",
          "tools": [
            {
              "name": "my_tool",
              "kind": "my_provider",
              "connection": {
                "kind": "key",
                "endpoint": "https://custom.example.com"
              }
            }
          ]
        }
      },
      "expected": {
        "tools": [
          {
            "name": "my_tool",
            "kind": "my_provider"
          }
        ]
      }
    },
    {
      "name": "template_string_invalid",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "shorthand-test",
          "model": {
            "id": "gpt-4"
          },
          "template": "jinja2"
        }
      },
      "expected": {
        "error": "Invalid template format"
      }
    },
    {
      "name": "input_scalar_shorthand",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "scalar-test",
          "model": "gpt-4",
          "inputs": [
            {
              "name": "topic",
              "kind": "string",
              "default": "science"
            },
            {
              "name": "count",
              "kind": "integer",
              "default": 5
            }
          ]
        }
      },
      "expected": {
        "inputs": [
          {
            "name": "topic",
            "kind": "string",
            "default": "science"
          },
          {
            "name": "count",
            "kind": "integer",
            "default": 5
          }
        ]
      }
    },
    {
      "name": "empty_frontmatter_body_only",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "empty-fm"
        }
      },
      "expected": {
        "kind": "prompt",
        "name": "empty-fm",
        "model": null,
        "inputs": null,
        "tools": null
      }
    },
    {
      "name": "connection_types_load",
      "stage": "load",
      "input": {
        "frontmatter": {
          "name": "connection-test",
          "model": {
            "id": "gpt-4",
            "connection": {
              "kind": "anonymous",
              "endpoint": "https://localhost:8080"
            }
          }
        }
      },
      "expected": {
        "model": {
          "id": "gpt-4",
          "connection": {
            "kind": "anonymous",
            "endpoint": "https://localhost:8080"
          }
        }
      }
    }
  ]
  """;
