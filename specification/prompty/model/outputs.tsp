import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents the output properties of an AI agent.
   * Each output property can be a simple type, an array, or an object.
   */
  model OutputProperty {
    @doc("The data type of the output property")
    type: SimpleTypes = "string";

    @doc("A short description of the output property")
    description?: string = "";

    @doc("Whether the output property is required")
    required?: boolean = true;
  }

  model ArrayOutput extends OutputProperty {
    type: "array";

    @doc("The type of items contained in the array")
    items: OutputProperty | Named<OutputProperty>;
  }

  model ObjectOutput extends OutputProperty {
    type: "object";

    @doc("The properties contained in the object")
    properties: Outputs;
  }

  alias Outputs = Record<OutputProperty> | Named<OutputProperty>[];
}
