import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents the output properties of an AI agent.
   * Each output property can be a simple type, an array, or an object.
   */
  model Output {
    @doc("The data type of the output property")
    type: SimpleTypes = "string";

    @doc("A short description of the output property")
    description?: string = "";

    @doc("Whether the output property is required")
    required?: boolean = true;
  }

  model ArrayOutput extends Output {
    type: "array";

    @doc("The type of items contained in the array")
    items: Output | Named<Output>;
  }

  model ObjectOutput extends Output {
    type: "object";

    @doc("The properties contained in the object")
    properties: Outputs;
  }

  alias Outputs = Record<Output> | Named<Output>[];
}
