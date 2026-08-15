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
