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

/**
 * Declares a factory method on the target model. Factory methods are fully
 * generated — the emitter produces both signature and body. The `sets` parameter
 * specifies which fields to assign and their values. The optional `params`
 * parameter specifies method parameters (name → type string).
 *
 * @example
 * ```typespec
 * @@factory("allow", #{ allowed: true })
 * @@factory("deny", #{ allowed: false }, #{ reason: "string" })
 * ```
 */
extern dec factory(
  target: Model,
  name: valueof string,
  sets: valueof unknown,
  params?: valueof unknown
);

/**
 * Declares a helper method stub on the target model. Helper methods are
 * stub-generated — the emitter produces the signature in the generated file
 * and a create-if-missing extension file where the body must be hand-written.
 * This enforces that every runtime implements the helper (compile/test failure
 * if missing) while allowing language-idiomatic implementations.
 *
 * @example
 * ```typespec
 * @@helper("text", "string", "Concatenate all TextPart values joined by newline")
 * ```
 */
extern dec helper(
  target: Model,
  name: valueof string,
  returns: valueof string,
  description?: valueof string
);
