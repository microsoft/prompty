import "../../dist/src/decorators.js";
using TypeSpec.Reflection;

/**
 * Adds a sample to the target model property.
 */
extern dec sample(target: ModelProperty, sample: unknown);

/**
 * Adds an alternate sample to the target model property, with an expansion description.
 */
extern dec alternate(target: ModelProperty, sample: unknown, expansion: unknown);


/**
 * Adds allowed values to the target model string property.
 */
extern dec allowed(target: ModelProperty, values: string[]);