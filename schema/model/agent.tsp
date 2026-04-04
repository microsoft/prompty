import "agentschema-emitter";
import "@typespec/json-schema";
import "./core.tsp";
import "./model.tsp";
import "./properties.tsp";
import "./tools.tsp";
import "./template.tsp";

using TypeSpec.JsonSchema;

namespace Prompty;

/**
 * A Prompty is a markdown file format for LLM prompts. The frontmatter defines
 * structured metadata including model configuration, input/output schemas, tools,
 * and template settings. The markdown body becomes the instructions.
 *
 * This is the single root type for the Prompty schema — there is no abstract base
 * class or kind discriminator. A .prompty file always produces a Prompty instance.
 */
@extension("additionalProperties", false)
model Prompty {
  // Identity & metadata
  @doc("Human-readable name of the prompt")
  @sample(#{ name: "basic-prompt" })
  name: string = "";

  @doc("Display name for UI purposes")
  @sample(#{ displayName: "Basic Prompt" })
  displayName?: string = "";

  @doc("Description of the prompt's purpose")
  @sample(#{
    description: "A basic prompt that uses the GPT-3 chat API to answer questions",
  })
  description?: string = "";

  @doc("Additional metadata including authors, tags, and other arbitrary properties")
  @sample(#{
    metadata: #{
      authors: #["sethjuarez", "jietong"],
      tags: #["example", "prompt"],
    },
  })
  metadata?: Record<unknown> = #{};

  // Inputs and Outputs
  @doc("Input parameters that participate in template rendering")
  @sample(#{
    inputs: #[
      #{ name: "firstName", kind: "string", default: "Jane" },
      #{ name: "lastName", kind: "string", default: "Doe" },
      #{
        name: "question",
        kind: "string",
        default: "What is the meaning of life?",
      }
    ],
  })
  @sample(#{
    inputs: #{
      firstName: #{ kind: "string", default: "Jane" },
      lastName: #{ kind: "string", default: "Doe" },
      question: #{ kind: "string", default: "What is the meaning of life?" },
    },
  })
  inputs?: Properties;

  @doc("Expected output format and structure")
  @sample(#{
    outputs: #[
      #{
        name: "answer",
        kind: "string",
        description: "The answer to the user's question.",
      }
    ],
  })
  @sample(#{
    outputs: #{
      answer: #{
        kind: "string",
        description: "The answer to the user's question.",
      },
    },
  })
  outputs?: Properties;

  // Model execution
  @doc("AI model configuration")
  @sample(#{
    `model`: #{
      id: "gpt-35-turbo",
      connection: #{
        kind: "key",
        endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
        apiKey: "{your-api-key}",
      },
    },
  })
  `model`: Model | string;

  // Tools
  @doc("Tools available for extended functionality")
  @sample(#{
    tools: #{
      getCurrentWeather: #{
        kind: "function",
        description: "Get the current weather in a given location",
        parameters: #{
          location: #{
            kind: "string",
            description: "The city and state, e.g. San Francisco, CA",
          },
          unit: #{
            kind: "string",
            description: "The unit of temperature, e.g. Celsius or Fahrenheit",
          },
        },
      },
    },
  })
  @sample(#{
    tools: #[
      #{
        name: "getCurrentWeather",
        kind: "function",
        description: "Get the current weather in a given location",
        parameters: #{
          location: #{
            kind: "string",
            description: "The city and state, e.g. San Francisco, CA",
          },
          unit: #{
            kind: "string",
            description: "The unit of temperature, e.g. Celsius or Fahrenheit",
          },
        },
      }
    ],
  })
  tools?: Tools = #[];

  // Template
  @doc("Template configuration for prompt rendering")
  @sample(#{ template: #{ format: "mustache", parser: "prompty" } })
  template?: Template;

  // Instructions
  @doc("Clear directions on what the prompt should do. In .prompty files, this comes from the markdown body.")
  @sample(#{
    instructions: """
      system:
      You are an AI assistant who helps people find information.
      As the assistant, you answer questions briefly, succinctly,
      and in a personable manner using markdown and even add some 
      personal flair with appropriate emojis.
      
      # Customer
      You are helping {{firstName}} {{lastName}} to find answers to 
      their questions. Use their name to address them in your responses.
      user:
      {{question}}
      """,
  })
  instructions?: string = "";
}
