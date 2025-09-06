import "@prompty/emitter";
import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents the output properties of an AI agent.
   * Each output property can be a simple type, an array, or an object.
   */
  @discriminator("type")
  model Output {
    @doc("The data type of the output property")
    @sample(#{ type: "string" })
    type: SimpleTypes;

    @doc("A short description of the output property")
    @sample(#{ description: "A description of the output property" })
    description?: string = "";

    @doc("Whether the output property is required")
    @sample(#{ required: true })
    required?: boolean = true;
  }

  /**
   * Represents an array output property.
   * This extends the base Output model to represent an array of items.
   */
  model ArrayOutput extends Output {
    type: "array";

    @doc("The type of items contained in the array")
    @sample(#{ items: #{ type: "string" } })
    items: Output | Named<Output, "Name of the output property">;
  }

  /**
   * Represents an object output property.
   * This extends the base Output model to represent a structured object.
   */
  model ObjectOutput extends Output {
    type: "object";

    @doc("The properties contained in the object")
    @sample(#{ properties: #{ property1: #{ type: "string" }, property2: #{ type: "number" } } })
    properties: Outputs;
  }

  alias Outputs = Record<Output> | Named<Output, "Name of the output property">[];
}
