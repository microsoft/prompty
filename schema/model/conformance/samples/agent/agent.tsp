// Named sample constants for agent/agent.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const PromptyNameSample = #{ name: "basic-prompt" };

const PromptyDisplayNameSample = #{ displayName: "Basic Prompt" };

const PromptyDescriptionSample = #{
  description: "A basic prompt that uses the GPT-3 chat API to answer questions",
};

const PromptyMetadataSample = #{
  metadata: #{
    authors: #["sethjuarez", "jietong"],
    tags: #["example", "prompt"],
  },
};

const PromptyInputsSample = #{
  inputs: #[
    #{ name: "firstName", kind: "string", default: "Jane" },
    #{ name: "lastName", kind: "string", default: "Doe" },
    #{
      name: "question",
      kind: "string",
      default: "What is the meaning of life?",
    }
  ],
};

const PromptyInputsSample2 = #{
  inputs: #{
    firstName: #{ kind: "string", default: "Jane" },
    lastName: #{ kind: "string", default: "Doe" },
    question: #{ kind: "string", default: "What is the meaning of life?" },
  },
};

const PromptyOutputsSample = #{
  outputs: #[
    #{
      name: "answer",
      kind: "string",
      description: "The answer to the user's question.",
    }
  ],
};

const PromptyOutputsSample2 = #{
  outputs: #{
    answer: #{
      kind: "string",
      description: "The answer to the user's question.",
    },
  },
};

const PromptyIdSample = #{
  `model`: #{
    id: "gpt-35-turbo",
    connection: #{
      kind: "key",
      endpoint: "https://{your-custom-endpoint}.openai.azure.com/",
      apiKey: "{your-api-key}",
    },
  },
};

const PromptyToolsSample = #{
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
};

const PromptyToolsSample2 = #{
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
};

const PromptyTemplateSample = #{
  template: #{ format: "mustache", parser: "prompty" },
};

const PromptyInstructionsSample = #{
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
};
