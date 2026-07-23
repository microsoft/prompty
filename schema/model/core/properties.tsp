import "@typra/emitter";
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
@coerce(
  string,
  #{ kind: "string", example: "{value}" },
  "input",
  "Simple construction with just a kind of string"
)
@coerce(
  integer,
  #{ kind: "integer", example: "{value}" },
  "input",
  "Simple construction with just a kind of integer",
  4
)
@coerce(
  float32,
  #{ kind: "float", example: "{value}" },
  "input",
  "Simple construction with just a kind of float"
)
@coerce(
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

  @doc("Whether the property also accepts a JSON null value")
  @sample(#{ nullable: true })
  nullable?: boolean = false;

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

/**
 * Represents a JSON Schema union property.
 *
 * Use `oneOf` when exactly one branch must match, or `anyOf` when one or more
 * branches may match. Exactly one composition field MUST be provided with at
 * least one branch; `oneOf` and `anyOf` MUST NOT both be populated. The
 * alternatives are full Prompty properties so unions remain portable across
 * generated runtimes.
 */
model UnionProperty extends Property {
  kind: "union";

  @doc("Alternative property schemas where exactly one branch must match")
  @minItems(1)
  oneOf?: Property[] = #[];

  @doc("Alternative property schemas where one or more branches may match")
  @sample(#{ anyOf: #[#{ kind: "string" }, #{ kind: "boolean" }] })
  @minItems(1)
  anyOf?: Property[] = #[];
}

alias Properties = Record<Property> | Named<
  Property,
  "Name of the property",
  #{ name: "my-input" }
>[]; // need to support input aliasing => | Record<string | numeric | boolean>;
