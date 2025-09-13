import "@prompty/emitter";
import "./core.tsp";
import "./model.tsp";
import "./inputs.tsp";
import "./outputs.tsp";
import "./tools.tsp";
import "./template.tsp";
import "./container.tsp";

namespace Prompty.Core {
  alias PromptyKind = "prompt" | "container";
  /**
   * The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
   * It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
   * The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
   * available tools, and template configurations for prompt rendering.
   *
   * These can be written in a markdown format or in a pure YAML format.
   *
   */
  @discriminator("kind")
  model Prompty {
    // Prompty metadata
    @doc("Kind represented by the document")
    kind: PromptyKind = "prompt";

    @doc("Unique identifier for the document")
    @sample(#{ id: "unique-agent-id" })
    id?: string = "";

    @doc("Document version")
    @sample(#{ version: "1.0.0" })
    version?: string = "";

    @doc("Human-readable name of the agent")
    @sample(#{ name: "basic-prompt" })
    name: string = "";

    @doc("Description of the agent's capabilities and purpose")
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

    // model execution
    @doc("Model configuration used for execution")
    @sample(#{
      `model`: #{
        id: "gpt-35-turbo",
        connection: #{
          provider: "azure",
          type: "chat",
          endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
        },
      },
    })
    @alternate(#{ `model`: "{value}" }, #{ `model`: #{ id: "{value}" } })
    `model`: Model | string;

    // Inputs and Outputs
    @doc("Input parameters that participate in template rendering")
    @sample(#{
      inputs: #[
        #{ name: "firstName", kind: "string", sample: "Jane" },
        #{ name: "lastName", kind: "string", sample: "Doe" },
        #{
          name: "question",
          kind: "string",
          sample: "What is the meaning of life?",
        }
      ],
    })
    @sample(#{
      inputs: #{
        firstName: #{ kind: "string", sample: "Jane" },
        lastName: #{ kind: "string", sample: "Doe" },
        question: #{ kind: "string", sample: "What is the meaning of life?" },
      },
    })
    inputs?: Inputs = #[];

    @doc("Expected output format and structure from the agent")
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
    outputs?: Outputs = #[];

    // tools
    @doc("Tools available to the agent for extended functionality")
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

    @doc("Connections available to the agent for accessing external services")
    @sample(#{
      connections: #{
        `my-connection`: #{
          kind: "key",
          endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
          key: "\${env:OPENAI_API_KEY}",
        },
      },
    })
    @sample(#{ connections: #[#{ name: "my-connection", kind: "named" }] })
    connections?: Connections = #[];

    // template values
    @doc("Template configuration for prompt rendering")
    @sample(#{ template: #{ format: "handlebars", parser: "prompty" } })
    template?: Template;

    @doc("Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)")
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

    @doc("Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)")
    additional_instructions?: string = "";
  }


  model PromptyContainer extends Prompty {
    @doc("Type of agent, e.g., 'prompt' or 'container'")
    kind: "container";

    @doc("Container definition including registry and scaling information")
    container: ContainerDefinition;

    @doc("Environment variables to set in the hosted agent container.")
    environment_variables?: EnvironmentVariables = #[];
  }
}
