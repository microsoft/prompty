import "@typra/emitter";

using Prompty;
using Prompty.Operations.Pipeline;
namespace Prompty.Conformance.Vectors;

// Behavior vectors for the Renderer.render callable seam, migrated from
// spec/vectors/render/render_vectors.json. Each vector binds to the CURRENT
// render(agent, template, inputs): string signature:
//   - input.agent is an empty Agent (#{}) because these cases exercise pure
//     template+inputs rendering and do not read agent configuration.
//   - provider carries the template engine (dispatch selector), using Typra's
//     first-class vector provider field rather than an operation parameter.
//   - expected is the bare rendered string (the op returns string, not a wrapper).
// EXCLUDED: the 'thread_nonce_injection' case asserts a regex nonce_pattern,
// which value-equality vectors cannot express; it remains in the JSON catalog.
const RenderVectors = #[
  #{
    name: "simple_substitution",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "Hello {{name}}!",
      inputs: #{ name: "World" },
    },
    expected: "Hello World!",
  },
  #{
    name: "multiple_variables",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{first}} {{last}} is {{age}}",
      inputs: #{ first: "Jane", last: "Doe", age: 30 },
    },
    expected: "Jane Doe is 30",
  },
  #{
    name: "conditional_block",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{% if premium %}Welcome VIP!{% else %}Hello!{% endif %}",
      inputs: #{ premium: true },
    },
    expected: "Welcome VIP!",
  },
  #{
    name: "conditional_false",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{% if premium %}Welcome VIP!{% else %}Hello!{% endif %}",
      inputs: #{ premium: false },
    },
    expected: "Hello!",
  },
  #{
    name: "for_loop",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "Items: {% for item in items %}{{item}} {% endfor %}",
      inputs: #{ items: #["a", "b", "c"] },
    },
    expected: "Items: a b c ",
  },
  #{
    name: "nested_object",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{user.name}} ({{user.email}})",
      inputs: #{ user: #{ name: "Jane", email: "jane@test.com" } },
    },
    expected: "Jane (jane@test.com)",
  },
  #{
    name: "mustache_simple",
    stage: "callable",
    provider: "mustache",
    input: #{
      agent: #{},
      template: "Hello {{name}}!",
      inputs: #{ name: "World" },
    },
    expected: "Hello World!",
  },
  #{
    name: "mustache_section",
    stage: "callable",
    provider: "mustache",
    input: #{
      agent: #{},
      template: "{{#show}}Visible{{/show}}",
      inputs: #{ show: true },
    },
    expected: "Visible",
  },
  #{
    name: "mustache_inverted",
    stage: "callable",
    provider: "mustache",
    input: #{
      agent: #{},
      template: "{{^show}}Hidden{{/show}}",
      inputs: #{ show: false },
    },
    expected: "Hidden",
  },
  #{
    name: "missing_variable_renders_empty",
    stage: "callable",
    provider: "jinja2",
    input: #{ agent: #{}, template: "Hello {{name}}!", inputs: #{} },
    expected: "Hello !",
  },
  #{
    name: "html_not_escaped",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{content}}",
      inputs: #{ content: "<b>bold</b>" },
    },
    expected: "<b>bold</b>",
  },
  #{
    name: "whitespace_preserved",
    stage: "callable",
    provider: "jinja2",
    input: #{ agent: #{}, template: "line1\n  line2\n    line3", inputs: #{} },
    expected: "line1\n  line2\n    line3",
  },
  #{
    name: "role_markers_preserved",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "system:\nYou are helpful.\n\nuser:\n{{question}}",
      inputs: #{ question: "Hello" },
    },
    expected: "system:\nYou are helpful.\n\nuser:\nHello",
  },
  #{
    name: "filter_basic",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{name|upper}}",
      inputs: #{ name: "hello" },
    },
    expected: "HELLO",
  },
  #{
    name: "default_filter",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{name|default(\"stranger\")}}",
      inputs: #{},
    },
    expected: "stranger",
  },
  #{
    name: "jinja2_comment",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "Hello{# this is a comment #} World",
      inputs: #{},
    },
    expected: "Hello World",
  },
  #{
    name: "filter_upper",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{ name | upper }}",
      inputs: #{ name: "hello" },
    },
    expected: "HELLO",
  },
  #{
    name: "filter_lower",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{ name | lower }}",
      inputs: #{ name: "HELLO" },
    },
    expected: "hello",
  },
  #{
    name: "filter_trim",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{ name | trim }}",
      inputs: #{ name: "  hello  " },
    },
    expected: "hello",
  },
  #{
    name: "filter_join",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{ items | join(', ') }}",
      inputs: #{ items: #["a", "b", "c"] },
    },
    expected: "a, b, c",
  },
  #{
    name: "filter_length",
    stage: "callable",
    provider: "jinja2",
    input: #{
      agent: #{},
      template: "{{ items | length }}",
      inputs: #{ items: #[1, 2, 3, 4, 5] },
    },
    expected: "5",
  },
  #{
    name: "mustache_loop",
    stage: "callable",
    provider: "mustache",
    input: #{
      agent: #{},
      template: "{{#items}}{{.}} {{/items}}",
      inputs: #{ items: #["a", "b", "c"] },
    },
    expected: "a b c ",
  }
];
