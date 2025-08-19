import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents a tool that can be used in prompts.
   */
  model Tool {
    @doc("The type identifier for the tool")
    type: string;

    @doc("A short description of the tool for metadata purposes")
    description?: string = "";
  }

  /**
   * Represents a parameter for a tool.
   */
  model Parameter {
    @doc("The data type of the tool parameter")
    type: SimpleTypes = "string";

    @doc("A short description of the property")
    description?: string = "";

    @doc("Whether the tool parameter is required")
    required?: boolean = true;

    @doc("Allowed enumeration values for the parameter")
    `enum`?: unknown[] = #[];
  }

  /**
   * Represents an object parameter for a tool.
   */
  model ObjectParameter extends Parameter {
    type: "object";

    @doc("The properties of the object parameter")
    properties: Parameters = #[];
  }

  /**
   * Represents an array parameter for a tool.
   */
  model ArrayParameter extends Parameter {
    type: "array";

    @doc("The type of items contained in the array")
    items: Parameter | Named<Parameter>;
  }

  alias Parameters = Record<Parameter> | Named<Parameter>[];

  /**
   * Represents a local function tool.
   */
  model FunctionTool extends Tool {
    @doc("The type identifier for function tools")
    type: "function";

    @doc("Parameters accepted by the function tool")
    parameters: Parameters = #[];
  }

  /**
   * Represents a tool that runs on a server
   * This tool type is designed for operations that require server-side execution
   * It may include features such as authentication, data storage, and long-running processes
   * This tool type is ideal for tasks that involve complex computations or access to secure resources
   * Server tools can be used to offload heavy processing from client applications
   */
  model ServerTool extends Tool {
    @doc("The type identifier for server tools")
    type: string;

    @doc("Configuration options for the server tool")
    options: Options = #{};
  }

  alias Tools = Record<Tool> | Named<Tool>[];
}
