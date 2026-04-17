import "prompty-emitter";
import "../core/core.tsp";
import "./main.tsp";
import "../core/properties.tsp";

namespace Prompty;

/**
 * Represents a binding between an input property and a tool parameter.
 */
@coerce(string, #{ input: "{value}" })
model Binding {
  @doc("The input property that will be bound to the tool parameter argument")
  @sample(#{ input: "input-variable" })
  input: string;
}

alias Bindings = Record<Binding> | Named<
  Binding,
  "Name of the binding",
  #{ name: "my-tool" }
>[];

union ToolTypes {
  functionType: "function",
  mcpType: "mcp",
  openapiType: "openapi",
  promptyType: "prompty",
  string,
}

/**
 * Represents a tool that can be used in prompts.
 */
@abstract
@discriminator("kind")
model Tool {
  @doc("The kind identifier for the tool")
  @sample(#{ kind: "function" })
  kind: ToolTypes;

  @doc("A short description of the tool for metadata purposes")
  @sample(#{ description: "A description of the tool" })
  description?: string = "";

  @doc("Tool argument bindings to input properties")
  @sample(#{ bindings: #{ input: "value" } })
  bindings?: Bindings = #[];
}

/**
 * Represents a local function tool.
 */
model FunctionTool extends Tool {
  @doc("The kind identifier for function tools")
  @sample(#{ kind: "function" })
  kind: "function";

  @doc("Parameters accepted by the function tool")
  @sample(#{
    parameters: #[
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
    parameters: #{
      firstName: #{ kind: "string", default: "Jane" },
      lastName: #{ kind: "string", default: "Doe" },
      question: #{ kind: "string", default: "What is the meaning of life?" },
    },
  })
  parameters: Properties;

  @doc("Indicates whether the function tool enforces strict validation on its parameters")
  @sample(#{ strict: true })
  strict?: boolean = true;
}

/**
 * Represents a generic server tool that runs on a server
 * This tool kind is designed for operations that require server-side execution
 * It may include features such as authentication, data storage, and long-running processes
 * This tool kind is ideal for tasks that involve complex computations or access to secure resources
 * Server tools can be used to offload heavy processing from client applications
 */
model CustomTool extends Tool {
  @doc("The kind identifier for server tools. This is a wildcard and can represent any server tool type not explicitly defined.")
  kind: "*";

  @doc("Connection configuration for the server tool")
  @sample(#{ connection: #{ kind: "reference" } })
  connection: Connection;

  @doc("Configuration options for the server tool")
  @sample(#{ options: #{ timeout: 30, retries: 3 } })
  options: Record<unknown> = #{};
}

alias Tools = Record<Tool> | Named<
  Tool,
  "Name of the tool. If a function tool, this is the function name, otherwise it is the type",
  #{ name: "my-tool" }
>[];

// ============================================================================
// Tool dispatch types — used during agent loop tool execution
// ============================================================================

/**
 * Context passed to tool handlers during agent loop execution. Provides
 * access to the agent configuration, current conversation state, and
 * arbitrary metadata for tool implementations that need broader context.
 */
model ToolContext {
  @doc("The current conversation messages at the point of tool invocation")
  messages: Message[];

  @doc("Optional metadata for tool-specific context (e.g., user session info)")
  @sample(#{ metadata: #{ userId: "user-123" } })
  metadata?: Record<unknown>;
}

/**
 * The result of dispatching a single tool call. Pairs the tool call
 * identifier with the tool's name and result for correlation in the
 * agent loop's message assembly.
 */
model ToolDispatchResult {
  @doc("The tool call ID from the LLM response, used to correlate results")
  @sample(#{ toolCallId: "call_abc123" })
  toolCallId: string;

  @doc("The name of the tool that was called")
  @sample(#{ name: "get_weather" })
  name: string;

  @doc("The result produced by the tool handler")
  @sample(#{
    result: #{ parts: #[#{ kind: "text", value: "72°F and sunny" }] },
  })
  result: ToolResult;
}
