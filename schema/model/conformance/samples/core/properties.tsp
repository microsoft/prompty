// Named sample constants for core/properties.tsp.
// Auto-extracted from inline @sample decorators.

using Prompty.Contracts.Core;
namespace Prompty.Conformance.Samples;

const PropertyKindSample = #{ kind: "string" };

const PropertyDescriptionSample = #{
  description: "A description of the input property",
};

const PropertyRequiredSample = #{ required: true };

const PropertyNullableSample = #{ nullable: true };

const PropertyDefaultSample = #{ default: "default value" };

const PropertyExampleSample = #{ example: "example value" };

const PropertyEnumValuesSample = #{
  enumValues: #["value1", "value2", "value3"],
};

const toItemsSample = #{ items: #{ kind: "string" } };

const toPropertiesSample = #{
  properties: #{
    property1: #{ kind: "string" },
    property2: #{ kind: "number" },
  },
};

const UnionPropertyAnyOfSample = #{
  anyOf: #[#{ kind: "string" }, #{ kind: "boolean" }],
};
