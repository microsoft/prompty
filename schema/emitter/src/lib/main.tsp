import "../../dist/src/decorators.js";
using TypeSpec.Reflection;

/**
 * Adds a sample to the target model property.
 */
extern dec sample(target: ModelProperty, sample: valueof unknown);

/**
 * Marks the target model as abstract, preventing direct instantiation.
 */
extern dec abstract(target: Model);

/**
 * Marks the target model as having a scalar-to-object implicit conversion.
 * When a scalar value is encountered during deserialization, it is expanded
 * into a full object using the provided expansion template.
 */
extern dec coerce(
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
 * Declares a method stub on the target model. Method stubs are
 * stub-generated — the emitter produces the signature in the generated file
 * and a create-if-missing extension file where the body must be hand-written.
 * This enforces that every runtime implements the method (compile/test failure
 * if missing) while allowing language-idiomatic implementations.
 *
 * @example
 * ```typespec
 * @@method("text", "string", "Concatenate all TextPart values joined by newline")
 * ```
 */
extern dec method(
  target: Model,
  name: valueof string,
  returns: valueof string,
  description?: valueof string
);

/**
 * Maps a property's wire name for a specific target system. Used in provider
 * wire.tsp files via augment syntax (`@@`) to declare how core property names
 * map to provider-specific API parameter names.
 *
 * @example
 * ```typespec
 * @@knownAs(ModelOptions.maxOutputTokens, "max_completion_tokens")
 * ```
 */
extern dec knownAs(target: ModelProperty, name: valueof string);

/**
 * Declares a per-target required default value for a property. Used in provider
 * wire.tsp files via augment syntax (`@@`) when a provider requires a value that
 * the core schema treats as optional.
 *
 * @example
 * ```typespec
 * @@defaultFor(ModelOptions.maxOutputTokens, 4096)
 * ```
 */
extern dec defaultFor(target: ModelProperty, defaultValue: valueof unknown);

/**
 * Marks the target model as a protocol interface. Protocol interfaces define
 * the pipeline stage contracts (renderer, parser, executor, processor). The
 * emitter generates language-appropriate interface/trait/protocol definitions.
 */
extern dec protocol(target: Model);
