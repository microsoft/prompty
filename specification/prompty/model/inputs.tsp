import "@prompty/emitter";
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
  model Input {
    @doc("The data type of the input property")
    @sample(#{ type: "string" })
    type: SimpleTypes;

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

  alias Inputs = Record<Input> | Named<Input, "Name of the input property">[];
}
