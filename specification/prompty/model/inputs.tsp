import "./core.tsp";

namespace Prompty.Core {
  model InputProperty {
    @doc("The data type of the input property")
    type: SimpleTypes = "string";

    @doc("A short description of the input property")
    description?: string = "";

    @doc("Whether the input property is required")
    required?: boolean = false;

    @doc("Whether the input property can emit structural text when parsing output")
    strict?: boolean = false;

    @doc("The default value of the input")
    default?: unknown = null;

    @doc("A sample value of the input for examples and tooling")
    sample?: unknown = null;
  }

  alias Inputs = Record<InputProperty> | Named<InputProperty>[];
}
