import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Behavior vectors migrated from spec/vectors/render/render_vectors.json — bound to Renderer.render.
// Authored as a JSON-STRING vector set (Typra 0.7.0+ affordance): a triple-quoted
// constant Typra parses into vector entries, so raw provider/agent payloads with
// keyword keys (e.g. "model") are first-class. @vector inputs are opaque (unknown),
// JSON-compared conformance evidence emitted into the cross-runtime vectors.json.
const RenderVectors = """
  [
    {
      "name": "simple_substitution",
      "description": "Basic Jinja2 variable substitution with a single variable",
      "stage": "render",
      "input": {
        "template": "Hello {{name}}!",
        "engine": "jinja2",
        "inputs": {
          "name": "World"
        }
      },
      "expected": {
        "rendered": "Hello World!"
      }
    },
    {
      "name": "multiple_variables",
      "description": "Multiple Jinja2 variables of different types including an integer",
      "stage": "render",
      "input": {
        "template": "{{first}} {{last}} is {{age}}",
        "engine": "jinja2",
        "inputs": {
          "first": "Jane",
          "last": "Doe",
          "age": 30
        }
      },
      "expected": {
        "rendered": "Jane Doe is 30"
      }
    },
    {
      "name": "conditional_block",
      "description": "Jinja2 if/else block where condition is true",
      "stage": "render",
      "input": {
        "template": "{% if premium %}Welcome VIP!{% else %}Hello!{% endif %}",
        "engine": "jinja2",
        "inputs": {
          "premium": true
        }
      },
      "expected": {
        "rendered": "Welcome VIP!"
      }
    },
    {
      "name": "conditional_false",
      "description": "Jinja2 if/else block where condition is false",
      "stage": "render",
      "input": {
        "template": "{% if premium %}Welcome VIP!{% else %}Hello!{% endif %}",
        "engine": "jinja2",
        "inputs": {
          "premium": false
        }
      },
      "expected": {
        "rendered": "Hello!"
      }
    },
    {
      "name": "for_loop",
      "description": "Jinja2 for loop iterating over a list of items",
      "stage": "render",
      "input": {
        "template": "Items: {% for item in items %}{{item}} {% endfor %}",
        "engine": "jinja2",
        "inputs": {
          "items": [
            "a",
            "b",
            "c"
          ]
        }
      },
      "expected": {
        "rendered": "Items: a b c "
      }
    },
    {
      "name": "nested_object",
      "description": "Jinja2 dot notation access into a nested object",
      "stage": "render",
      "input": {
        "template": "{{user.name}} ({{user.email}})",
        "engine": "jinja2",
        "inputs": {
          "user": {
            "name": "Jane",
            "email": "jane@test.com"
          }
        }
      },
      "expected": {
        "rendered": "Jane (jane@test.com)"
      }
    },
    {
      "name": "mustache_simple",
      "description": "Basic Mustache variable substitution",
      "stage": "render",
      "input": {
        "template": "Hello {{name}}!",
        "engine": "mustache",
        "inputs": {
          "name": "World"
        }
      },
      "expected": {
        "rendered": "Hello World!"
      }
    },
    {
      "name": "mustache_section",
      "description": "Mustache truthy section renders its content",
      "stage": "render",
      "input": {
        "template": "{{#show}}Visible{{/show}}",
        "engine": "mustache",
        "inputs": {
          "show": true
        }
      },
      "expected": {
        "rendered": "Visible"
      }
    },
    {
      "name": "mustache_inverted",
      "description": "Mustache inverted section renders when value is falsy",
      "stage": "render",
      "input": {
        "template": "{{^show}}Hidden{{/show}}",
        "engine": "mustache",
        "inputs": {
          "show": false
        }
      },
      "expected": {
        "rendered": "Hidden"
      }
    },
    {
      "name": "thread_nonce_injection",
      "description": "Thread-kind input is replaced with a nonce marker instead of being rendered directly",
      "stage": "render",
      "input": {
        "template": "system:\\nYou are helpful.\\n\\n{{conversation}}\\n\\nuser:\\n{{question}}",
        "engine": "jinja2",
        "inputs": {
          "question": "Hi",
          "conversation": {
            "_kind": "thread",
            "messages": [
              {
                "role": "user",
                "content": "previous question"
              },
              {
                "role": "assistant",
                "content": "previous answer"
              }
            ]
          }
        }
      },
      "expected": {
        "nonce_pattern": "^system:\\nYou are helpful\\\\.\\n\\n__PROMPTY_THREAD_[a-f0-9]{8}_conversation__\\n\\nuser:\\nHi$"
      }
    },
    {
      "name": "missing_variable_renders_empty",
      "description": "Undefined Jinja2 variable renders as empty string with default Undefined config",
      "stage": "render",
      "input": {
        "template": "Hello {{name}}!",
        "engine": "jinja2",
        "inputs": {}
      },
      "expected": {
        "rendered": "Hello !"
      }
    },
    {
      "name": "html_not_escaped",
      "description": "HTML content is NOT escaped — prompty templates are not HTML templates",
      "stage": "render",
      "input": {
        "template": "{{content}}",
        "engine": "jinja2",
        "inputs": {
          "content": "<b>bold</b>"
        }
      },
      "expected": {
        "rendered": "<b>bold</b>"
      }
    },
    {
      "name": "whitespace_preserved",
      "description": "Whitespace including indentation and newlines is exactly preserved",
      "stage": "render",
      "input": {
        "template": "line1\\n  line2\\n    line3",
        "engine": "jinja2",
        "inputs": {}
      },
      "expected": {
        "rendered": "line1\\n  line2\\n    line3"
      }
    },
    {
      "name": "role_markers_preserved",
      "description": "Role markers (system:/user:) are passed through by the renderer — parsing is the parser's job",
      "stage": "render",
      "input": {
        "template": "system:\\nYou are helpful.\\n\\nuser:\\n{{question}}",
        "engine": "jinja2",
        "inputs": {
          "question": "Hello"
        }
      },
      "expected": {
        "rendered": "system:\\nYou are helpful.\\n\\nuser:\\nHello"
      }
    },
    {
      "name": "filter_basic",
      "description": "Jinja2 built-in filter (upper) works in prompty templates",
      "stage": "render",
      "input": {
        "template": "{{name|upper}}",
        "engine": "jinja2",
        "inputs": {
          "name": "hello"
        }
      },
      "expected": {
        "rendered": "HELLO"
      }
    },
    {
      "name": "default_filter",
      "description": "Jinja2 default filter provides fallback for missing variables",
      "stage": "render",
      "input": {
        "template": "{{name|default(\\"stranger\\")}}",
        "engine": "jinja2",
        "inputs": {}
      },
      "expected": {
        "rendered": "stranger"
      }
    },
    {
      "name": "jinja2_comment",
      "description": "Jinja2 comments are stripped from output",
      "stage": "render",
      "input": {
        "template": "Hello{# this is a comment #} World",
        "engine": "jinja2",
        "inputs": {}
      },
      "expected": {
        "rendered": "Hello World"
      }
    },
    {
      "name": "filter_upper",
      "description": "Jinja2 upper filter converts to uppercase",
      "stage": "render",
      "input": {
        "template": "{{ name | upper }}",
        "engine": "jinja2",
        "inputs": {
          "name": "hello"
        }
      },
      "expected": {
        "rendered": "HELLO"
      }
    },
    {
      "name": "filter_lower",
      "description": "Jinja2 lower filter converts to lowercase",
      "stage": "render",
      "input": {
        "template": "{{ name | lower }}",
        "engine": "jinja2",
        "inputs": {
          "name": "HELLO"
        }
      },
      "expected": {
        "rendered": "hello"
      }
    },
    {
      "name": "filter_trim",
      "description": "Jinja2 trim filter removes surrounding whitespace",
      "stage": "render",
      "input": {
        "template": "{{ name | trim }}",
        "engine": "jinja2",
        "inputs": {
          "name": "  hello  "
        }
      },
      "expected": {
        "rendered": "hello"
      }
    },
    {
      "name": "filter_join",
      "description": "Jinja2 join filter joins a list with separator",
      "stage": "render",
      "input": {
        "template": "{{ items | join(', ') }}",
        "engine": "jinja2",
        "inputs": {
          "items": [
            "a",
            "b",
            "c"
          ]
        }
      },
      "expected": {
        "rendered": "a, b, c"
      }
    },
    {
      "name": "filter_length",
      "description": "Jinja2 length filter returns collection size",
      "stage": "render",
      "input": {
        "template": "{{ items | length }}",
        "engine": "jinja2",
        "inputs": {
          "items": [
            1,
            2,
            3,
            4,
            5
          ]
        }
      },
      "expected": {
        "rendered": "5"
      }
    },
    {
      "name": "mustache_loop",
      "description": "Mustache section iterates over list items",
      "stage": "render",
      "input": {
        "template": "{{#items}}{{.}} {{/items}}",
        "engine": "mustache",
        "inputs": {
          "items": [
            "a",
            "b",
            "c"
          ]
        }
      },
      "expected": {
        "rendered": "a b c "
      }
    }
  ]
  """;
