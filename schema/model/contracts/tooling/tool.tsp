import "@typra/emitter";
import "../core/core.tsp";
import "../core/properties.tsp";
import "../connectivity/connection.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Connectivity;
using Prompty.Contracts.Core;
namespace Prompty.Contracts.Tooling;

/**
 * Represents a binding between an input property and a tool parameter.
 */
@coerce(string, #{ input: "{value}" })
model Binding {
  @doc("The input property that will be bound to the tool parameter argument")
  @sample(BindingInputSample)
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
  @sample(ToolKindSample)
  kind: ToolTypes;

  @doc("A short description of the tool for metadata purposes")
  @sample(ToolDescriptionSample)
  description?: string = "";

  @doc("Tool argument bindings to input properties")
  @sample(ToolBindingsSample)
  bindings?: Bindings;
}

/**
 * Represents a local function tool.
 */
model FunctionTool extends Tool {
  @doc("The kind identifier for function tools")
  @sample(FunctionToolKindSample)
  kind: "function";

  @doc("Parameters accepted by the function tool")
  @sample(FunctionToolParametersSample)
  @sample(FunctionToolParametersSample2)
  parameters: Properties;

  @doc("Indicates whether the function tool enforces strict validation on its parameters")
  @sample(FunctionToolStrictSample)
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
  @sample(CustomToolConnectionSample)
  connection: Connection;

  @doc("Configuration options for the server tool")
  @sample(CustomToolOptionsSample)
  options: Record<unknown>;
}

alias Tools = Record<Tool> | Named<
  Tool,
  "Name of the tool. If a function tool, this is the function name, otherwise it is the type",
  #{ name: "my-tool" }
>[];
