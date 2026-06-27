import "@typra/emitter";

namespace Prompty;

/**
 * Raised when no invoker implementation is registered for a given component
 * and key. For example, if no renderer is registered for the key "jinja2",
 * an InvokerError is raised.
 */
model InvokerError {
  @doc("Human-readable error message")
  @sample(#{ message: "No renderer registered for key: jinja2" })
  message: string;

  @doc("The pipeline component type that was being looked up (e.g., 'renderer', 'parser', 'executor', 'processor')")
  @sample(#{ component: "renderer" })
  component: string;

  @doc("The registration key that was not found")
  @sample(#{ key: "jinja2" })
  key: string;
}

/**
 * Raised when input validation fails. Each ValidationError describes a
 * single property that did not satisfy its constraint.
 */
model ValidationError {
  @doc("Human-readable error message")
  @sample(#{ message: "Missing required input: firstName" })
  message: string;

  @doc("The name of the property that failed validation")
  @sample(#{ property: "firstName" })
  property: string;

  @doc("The constraint that was violated (e.g., 'required', 'type')")
  @sample(#{ constraint: "required" })
  constraint: string;
}

/**
 * Raised when a referenced file cannot be found. This applies to both
 * .prompty files and ${file:path} references in frontmatter.
 */
model FileNotFoundError {
  @doc("Human-readable error message")
  @sample(#{ message: "Prompty file not found: ./chat.prompty" })
  message: string;

  @doc("The file path that could not be resolved")
  @sample(#{ path: "./chat.prompty" })
  path: string;
}
