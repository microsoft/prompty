import "@prompty/emitter";
import "./core.tsp";
import "./model.tsp";
import "./inputs.tsp";
import "./outputs.tsp";
import "./tools.tsp";
import "./template.tsp";
import "./container.tsp";

namespace Prompty.Core {
  alias PromptyKind = "container" | "manifest" | "prompt" | string;
  /**
   * The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
   * It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
   * The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
   * available tools, and template configurations for prompt rendering.
   *
   * These can be written in a markdown format or in a pure YAML format.
   *
   */
  @abstract
  @discriminator("kind")
  model PromptyBase {
    // Prompty metadata
    @doc("Kind represented by the document")
    kind?: PromptyKind = "*";

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

    // template values
    @doc("Template configuration for prompt rendering")
    @sample(#{ template: #{ format: "mustache", parser: "prompty" } })
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
    additionalInstructions?: string = "";
  }

  /**
   * The following is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
   * It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
   * The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
   * available tools, and template configurations for prompt rendering.
   *
   * These can be written in a markdown format or in a pure YAML format.
   *
   */
  model Prompty extends PromptyBase {
    @doc("Type of agent, e.g., 'prompt'")
    @sample(#{ kind: "prompt" })
    kind: "prompt";

    // model execution
    @doc("Model configuration used for execution")
    @sample(#{
      `model`: #{
        id: "gpt-35-turbo",
        connection: #{
          kind: "key",
          endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
          key: "{your-api-key}",
        },
      },
    })
    `model`: Model | string;
  }

  /**
   * The following represents a manifest that can be used to create agents dynamically.
   * It includes a list of models that the publisher of the manifest has tested and
   * has confidence will work with an instantiated prompt agent.
   * The manifest also includes parameters that can be used to configure the agent's behavior.
   * These parameters include values that can be used as publisher parameters that can
   * be used to describe additional variables that have been tested and are known to work.
   *
   * Variables described here are then used to project into a prompt agent that can be executed.
   * Once parameters are provided, these can be referenced in the manifest using the following notation:
   *
   * `${param:MyParameter}`
   *
   * This allows for dynamic configuration of the agent based on the provided parameters.
   * (This notation is used elsewhere, but only the `param` scope is supported here)
   *
   */
  model PromptyManifest extends PromptyBase {
    @doc("Type of agent, e.g., 'manifest'")
    @sample(#{ kind: "manifest" })
    kind: "manifest";

    @doc("List of models that the agent can utilize")
    @sample(#{
      models: #[#{ id: "gpt-35-turbo" }, #{ id: "gpt-4o" }, "custom-model-id"],
    })
    models: Model[];

    @doc("Parameters for configuring the agent's behavior and execution")
    @sample(#{ parameters: #{ temperature: 0.7, maxTokens: 1000 } })
    parameters: Parameters = #{};
  }

  alias Protocols = "responses" | "activity" | "a2a" | string;
  model PromptyContainer extends PromptyBase {
    @doc("Type of agent, e.g., 'container'")
    @sample(#{ kind: "container" })
    kind: "container";

    @doc("Protocol used by the containerized agent")
    @sample(#{ protocol: "responses" })
    protocol: Protocols = "responses";

    @doc("Container definition including registry and scaling information")
    @sample(#{
      container: #{
        image: "my-container-image",
        registry: #{ kind: "acr", subscription: "my-subscription-id" },
      },
    })
    container: ContainerDefinition;

    @doc("Environment variables to set in the hosted agent container.")
    @sample(#{ environmentVariables: #{ MY_ENV_VAR: "my-value" } })
    environmentVariables?: EnvironmentVariables = #[];
  }
}
