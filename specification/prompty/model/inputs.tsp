import "./core.tsp";

namespace Prompty.Core {
  /**
   * Represents a single input property for a prompt.
   * * This model defines the structure of input properties that can be used in prompts,
   *   including their type, description, whether they are required, and other attributes.
   * * It allows for the definition of dynamic inputs that can be filled with data
   *  and processed to generate prompts for AI models.
   * * Example:
   * ```yaml
   * inputs:
   *   property1: string
   *   property2: number
   *   property3: boolean
   * ```
   */
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
