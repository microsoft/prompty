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


/**
 * Marks the target model as a shorthand for another model, providing a scalar type and expansion description.
 */
extern dec shorthand(target: Model, `scalar`: Scalar, expansion: unknown, title?: string, description?: string);