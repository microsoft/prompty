import "@prompty/emitter";
import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents the output properties of an AI agent.
   * Each output property can be a simple kind, an array, or an object.
   */
  @discriminator("kind")
  model Output {
    @doc("The data kind of the output property")
    @sample(#{ kind: "string" })
    kind: SimpleTypes;

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
    kind: "array";

    @doc("The type of items contained in the array")
    @sample(#{ items: #{ kind: "string" } })
    items: Output | Named<
      Output,
      "Name of the output property",
      #{ name: "my-output-item" }
    >;
  }

  /**
   * Represents an object output property.
   * This extends the base Output model to represent a structured object.
   */
  model ObjectOutput extends Output {
    kind: "object";

    @doc("The properties contained in the object")
    @sample(#{
      properties: #{
        property1: #{ kind: "string" },
        property2: #{ kind: "number" },
      },
    })
    properties: Outputs;
  }

  alias Outputs = Record<Output> | Named<
    Output,
    "Name of the output property",
    #{ name: "my-output" }
  >[];
}
