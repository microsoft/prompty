import "./core.tsp";

namespace Prompty.Core {
  @discriminator("type")
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
    items: OutputProperty | Named<OutputProperty>
  }

  model ObjectOutput extends OutputProperty {
    type: "object";

    @doc("The properties contained in the object")
    properties: Record<OutputProperty> | Named<OutputProperty>[];
  }

  union Outputs {
    @doc("Simple output property with a specific type")
    output: Record<OutputProperty> | Named<OutputProperty>[],

    @doc("Array output containing multiple items of a specific type")
    array: Record<ArrayOutput> | Named<ArrayOutput>[],

    @doc("Object output containing multiple named properties")
    object: Record<ObjectOutput> | Named<ObjectOutput>[],
  }
}
