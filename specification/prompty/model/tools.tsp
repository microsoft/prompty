import "./core.tsp";

namespace Prompty.Core {
  model Value {
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

  model FunctionTool {
    @doc("The type identifier for function tools")
    type: "function";

    @doc("A short description of the tool for metadata purposes")
    description?: string = "";

    @doc("Hard coded values that the tool can use for execution")
    inputs?: Record<Value> | Named<Value>[] = #{};

    @doc("Parameters accepted by the function tool")
    parameters: Record<FunctionToolParameter> | Named<FunctionToolParameter>[] = #[
    ];
  }

  model ServerTool {
    @doc("The type identifier for server tools")
    type: string;

    @doc("A short description of the tool for metadata purposes")
    description?: string = "";

    @doc("Hard coded values that the server tool can use for execution")
    inputs?: Record<Value> | Named<Value>[] = #{};

    @doc("Configuration options for the server tool")
    options: Record<unknown> = #{};
  }

  alias Tools =
    | Record<FunctionTool>
    | Named<FunctionTool>[]
    | Record<ServerTool>
    | Named<ServerTool>[];
}
