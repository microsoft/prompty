import "agentschema-emitter";
import "./core.tsp";

namespace Prompty;

/**
 * Represents a single property.
 *
 * - This model defines the structure of properties that can be used in prompts,
 *   including their type, description, whether they are required, and other attributes.
 * - It allows for the definition of dynamic inputs that can be filled with data
 *   and processed to generate prompts for AI models.
 */
@discriminator("kind")
@shorthand(
  string,
  #{ kind: "string", example: "{value}" },
  "input",
  "Simple construction with just a kind of string"
)
@shorthand(
  integer,
  #{ kind: "integer", example: "{value}" },
  "input",
  "Simple construction with just a kind of integer",
  4
)
@shorthand(
  float32,
  #{ kind: "float", example: "{value}" },
  "input",
  "Simple construction with just a kind of float"
)
@shorthand(
  boolean,
  #{ kind: "boolean", example: "{value}" },
  "input",
  "Simple construction with just a kind of boolean"
)
model Property {
  @doc("The data type of the input property")
  @sample(#{ kind: "string" })
  kind: SimpleTypes;

  @doc("A short description of the input property")
  @sample(#{ description: "A description of the input property" })
  description?: string = "";

  @doc("Whether the property is required")
  @sample(#{ required: true })
  required?: boolean = false;

  @doc("The default value of the property - this represents the default value if none is provided")
  @sample(#{ default: "default value" })
  default?: unknown = null;

  @doc("Example value used for either initialization or tooling")
  @sample(#{ example: "example value" })
  example?: unknown = null;

  @doc("Allowed enumeration values for the property")
  @sample(#{ enumValues: #["value1", "value2", "value3"] })
  enumValues?: unknown[] = #[];
}

/**
 * Represents an array property.
 * This extends the base Property model to represent an array of items.
 */
model ArrayProperty extends Property {
  kind: "array";

  @doc("The type of items contained in the array")
  @sample(#{ items: #{ kind: "string" } })
  items: Property | Named<
    Property,
    "Name of the property",
    #{ name: "my-property" }
  >;
}

/**
 * Represents an object property.
 * This extends the base Property model to represent a structured object.
 */
model ObjectProperty extends Property {
  kind: "object";

  @doc("The properties contained in the object")
  @sample(#{
    properties: #{
      property1: #{ kind: "string" },
      property2: #{ kind: "number" },
    },
  })
  properties: Properties = #[];
}


alias Properties = Record<Property> | Named<
  Property,
  "Name of the property",
  #{ name: "my-input" }
>[]; // need to support input aliasing => | Record<string | numeric | boolean>;
