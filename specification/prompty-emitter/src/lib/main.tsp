import "../../dist/src/decorators.js";
using TypeSpec.Reflection;

/**
 * Adds a sample to the target model property.
 */
extern dec sample(target: ModelProperty, sample: unknown);

/**
 * Adds an alternate sample to the target model property, with an expansion description.
 */
extern dec alternate(target: ModelProperty, `scalar`: Scalar, sample: unknown, expansion: unknown);

/**
 * Marks the target model as abstract, preventing direct instantiation.
 */
extern dec abstract(target: Model);