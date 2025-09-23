import "@prompty/emitter";
import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents a single input property for a prompt.
   * * This model defines the structure of input properties that can be used in prompts,
   *   including their type, description, whether they are required, and other attributes.
   * * It allows for the definition of dynamic inputs that can be filled with data
   *  and processed to generate prompts for AI models.
   */
  @discriminator("kind")
  @shorthand(
    string,
    #{ kind: "string", sample: "{value}" },
    "input",
    "Simple construction with just a kind of string"
  )
  @shorthand(
    integer,
    #{ kind: "integer", sample: "{value}" },
    "input",
    "Simple construction with just a kind of integer"
  )
  @shorthand(
    float32,
    #{ kind: "float", sample: "{value}" },
    "input",
    "Simple construction with just a kind of float"
  )
  @shorthand(
    boolean,
    #{ kind: "boolean", sample: "{value}" },
    "input",
    "Simple construction with just a kind of boolean"
  )
  model Input {
    @doc("The data type of the input property")
    @sample(#{ kind: "string" })
    kind: SimpleTypes;

    @doc("A short description of the input property")
    @sample(#{ description: "A description of the input property" })
    description?: string = "";

    @doc("Whether the input property is required")
    @sample(#{ required: true })
    required?: boolean = false;

    @doc("Whether the input property can emit structural text when parsing output")
    @sample(#{ strict: true })
    strict?: boolean = false;

    @doc("The default value of the input - this represents the default value if none is provided")
    @sample(#{ default: "default value" })
    default?: unknown = null;

    @doc("A sample value of the input for examples and tooling")
    @sample(#{ sample: "sample value" })
    sample?: unknown = null;
  }

  /**
   * Represents an array output property.
   * This extends the base Output model to represent an array of items.
   */
  model ArrayInput extends Input {
    kind: "array";

    @doc("The type of items contained in the array")
    @sample(#{ items: #{ kind: "string" } })
    items: Input | Named<
      Input,
      "Name of the input property",
      #{ name: "my-input-item" }
    >;
  }

  /**
   * Represents an object output property.
   * This extends the base Output model to represent a structured object.
   */
  model ObjectInput extends Input {
    kind: "object";

    @doc("The properties contained in the object")
    @sample(#{
      properties: #{
        property1: #{ kind: "string" },
        property2: #{ kind: "number" },
      },
    })
    properties: Inputs;
  }

  alias Inputs = Record<Input> | Named<
    Input,
    "Name of the input property",
    #{ name: "my-input" }
  >[]; // need to support input aliasing => | Record<string | numeric | boolean>;
}
