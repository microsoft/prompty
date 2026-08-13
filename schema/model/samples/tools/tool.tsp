// Named sample constants for tools/tool.tsp.
// Auto-extracted from inline @sample decorators.

namespace Prompty;

const BindingInputSample = #{ input: "input-variable" };

const ToolKindSample = #{ kind: "function" };

const ToolDescriptionSample = #{ description: "A description of the tool" };

const ToolBindingsSample = #{ bindings: #{ input: "value" } };

const FunctionToolKindSample = #{ kind: "function" };

const FunctionToolParametersSample = #{
  parameters: #[
    #{ name: "firstName", kind: "string", default: "Jane" },
    #{ name: "lastName", kind: "string", default: "Doe" },
    #{
      name: "question",
      kind: "string",
      default: "What is the meaning of life?",
    }
  ],
};

const FunctionToolParametersSample2 = #{
  parameters: #{
    firstName: #{ kind: "string", default: "Jane" },
    lastName: #{ kind: "string", default: "Doe" },
    question: #{ kind: "string", default: "What is the meaning of life?" },
  },
};

const FunctionToolStrictSample = #{ strict: true };

const CustomToolConnectionSample = #{ connection: #{ kind: "reference" } };

const CustomToolOptionsSample = #{ options: #{ timeout: 30, retries: 3 } };
