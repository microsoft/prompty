import "../../dist/src/decorators.js";
using TypeSpec.Reflection;

/**
 * Adds a sample to the target model property.
 */
extern dec sample(target: ModelProperty, sample: valueof unknown);

/**
 * Adds an alternate sample to the target model property, with an expansion description.
 */
extern dec alternate(
  target: ModelProperty,
  `scalar`: Scalar,
  sample: valueof unknown,
  expansion: valueof unknown
);

/**
 * Marks the target model as abstract, preventing direct instantiation.
 */
extern dec abstract(target: Model);

/**
 * Marks the target model as a shorthand for another model, providing a scalar type and expansion description.
 */
extern dec shorthand(
  target: Model,
  `scalar`: Scalar,
  expansion: valueof unknown,
  title?: valueof string,
  description?: valueof string,
  example?: valueof unknown
);
