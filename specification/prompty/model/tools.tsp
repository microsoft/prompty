import "./core.tsp";

namespace Prompty.Core {
  model Tool {
    @doc("The type identifier for the tool")
    type: string;

    @doc("A short description of the tool for metadata purposes")
    description?: string = "";

    @resolve("Input", Named<Value>)
    @doc("Hard coded values that the tool can use for execution")
    inputs?: Record<Value> | Named<Value>[] = #[];
  }

  model Value {
    @doc("Hardcoded value for the tool to use")
    value: unknown;

    @doc("A short description of the value for metadata purposes")
    description?: string = "";
  }

  model FunctionToolParameter {
    @doc("The data type of the tool parameter")
    type: SimpleTypes = "string";

    @doc("A short description of the property")
    description?: string = "";

    @doc("Whether the tool parameter is required")
    required?: boolean = true;

    @doc("Allowed enumeration values for the parameter")
    `enum`?: unknown[] = #[];
  }

  model FunctionTool extends Tool {
    @doc("The type identifier for function tools")
    type: "function";

    @resolve("FunctionToolParameter", Named<FunctionToolParameter>)
    @doc("Parameters accepted by the function tool")
    parameters: Record<FunctionToolParameter> | Named<FunctionToolParameter>[] = #[
    ];
  }

  model ServerTool extends Tool {
    @doc("The type identifier for server tools")
    type: string;

    @doc("Configuration options for the server tool")
    options: Options = #{};
  }

  alias Tools = Record<Tool> | Named<Tool>[];
}
