import "prompty-emitter";
import "./errors.tsp";

namespace Prompty;

/**
 * The result of validating inputs against a Prompty's inputs.
 * Returned by `validate_inputs` (§12.2) to indicate whether all
 * required inputs are present and satisfy their constraints.
 */
model ValidationResult {
  @doc("Whether all inputs passed validation")
  @sample(#{ valid: true })
  valid: boolean;

  @doc("List of validation errors (empty when valid is true)")
  @sample(#{ errors: #[] })
  errors: ValidationError[];
}
