import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/parse/parse_vectors.json — bound to Parser.parse.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const ParseVectors = """
  [
    {
      "name": "single_system",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nYou are helpful."
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "You are helpful."
              }
            ]
          }
        ]
      }
    },
    {
      "name": "system_user",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nYou are helpful.\\n\\nuser:\\nHello"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "You are helpful."
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
        ]
      }
    },
    {
      "name": "system_user_assistant",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nBe concise.\\n\\nuser:\\nHi\\n\\nassistant:\\nHello! How can I help?"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Be concise."
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hi"
              }
            ]
          },
          {
            "role": "assistant",
            "content": [
              {
                "kind": "text",
                "value": "Hello! How can I help?"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "multiline_content",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nLine one.\\nLine two.\\nLine three.\\n\\nuser:\\nQuestion"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Line one.\\nLine two.\\nLine three."
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Question"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "multiple_user_turns",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nHelper\\n\\nuser:\\nFirst question\\n\\nassistant:\\nFirst answer\\n\\nuser:\\nSecond question"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Helper"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "First question"
              }
            ]
          },
          {
            "role": "assistant",
            "content": [
              {
                "kind": "text",
                "value": "First answer"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Second question"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "no_role_marker_defaults_to_system",
      "stage": "parse",
      "input": {
        "rendered": "Just a plain message with no role marker"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Just a plain message with no role marker"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "content_trimmed",
      "stage": "parse",
      "input": {
        "rendered": "system:\\n  \\n  You are helpful.  \\n  \\n\\nuser:\\n  Hello  "
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "  \\n  You are helpful.  \\n  "
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "  Hello  "
              }
            ]
          }
        ]
      }
    },
    {
      "name": "empty_content",
      "stage": "parse",
      "input": {
        "rendered": "system:\\n\\nuser:\\nHello"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": ""
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
        ]
      }
    },
    {
      "name": "role_marker_at_line_start_only",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nThe user: said hello\\n\\nuser:\\nHi"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "The user: said hello"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hi"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "thread_nonce_expansion",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nYou are helpful.\\n\\n__PROMPTY_THREAD_abcd1234_conversation__\\n\\nuser:\\nHi",
        "thread_inputs": {
          "conversation": [
            {
              "role": "user",
              "content": [
                {
                  "kind": "text",
                  "value": "prev question"
                }
              ]
            },
            {
              "role": "assistant",
              "content": [
                {
                  "kind": "text",
                  "value": "prev answer"
                }
              ]
            }
          ]
        }
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "You are helpful."
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "prev question"
              }
            ]
          },
          {
            "role": "assistant",
            "content": [
              {
                "kind": "text",
                "value": "prev answer"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hi"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "markdown_in_content",
      "stage": "parse",
      "input": {
        "rendered": "system:\\n# Title\\n\\nSome **bold** text\\n\\n- item 1\\n- item 2\\n\\nuser:\\nHello"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "# Title\\n\\nSome **bold** text\\n\\n- item 1\\n- item 2"
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
        ]
      }
    },
    {
      "name": "consecutive_newlines_between_roles",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nHelper\\n\\n\\n\\nuser:\\nHi"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Helper"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hi"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "assistant_with_code_block",
      "stage": "parse",
      "input": {
        "rendered": "assistant:\\nHere is code:\\n```python\\nprint('hello')\\n```\\n\\nuser:\\nThanks"
      },
      "expected": {
        "messages": [
          {
            "role": "assistant",
            "content": [
              {
                "kind": "text",
                "value": "Here is code:\\n```python\\nprint('hello')\\n```"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Thanks"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "multiple_assistant_turns",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nYou are helpful.\\n\\nuser:\\nHi\\n\\nassistant:\\nHello!\\n\\nuser:\\nThanks\\n\\nassistant:\\nYou're welcome!"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "You are helpful."
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Hi"
              }
            ]
          },
          {
            "role": "assistant",
            "content": [
              {
                "kind": "text",
                "value": "Hello!"
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Thanks"
              }
            ]
          },
          {
            "role": "assistant",
            "content": [
              {
                "kind": "text",
                "value": "You're welcome!"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "role_marker_colon_in_content",
      "stage": "parse",
      "input": {
        "rendered": "system:\\nHere is a tip: always be kind.\\n\\nuser:\\nTime is 3:30pm"
      },
      "expected": {
        "messages": [
          {
            "role": "system",
            "content": [
              {
                "kind": "text",
                "value": "Here is a tip: always be kind."
              }
            ]
          },
          {
            "role": "user",
            "content": [
              {
                "kind": "text",
                "value": "Time is 3:30pm"
              }
            ]
          }
        ]
      }
    }
  ]
  """;
