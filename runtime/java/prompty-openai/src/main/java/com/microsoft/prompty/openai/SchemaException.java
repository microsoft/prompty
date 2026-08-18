package com.microsoft.prompty.openai;

/**
 * Raised when a portable {@code Property} schema cannot be expressed in the JSON Schema subset
 * OpenAI accepts.
 *
 * <p>Failing here rather than at the API boundary keeps the error attributable: the prompt author
 * wrote a schema the provider will not take, and the message says which construct was at fault.
 */
public class SchemaException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  public SchemaException(String message) {
    super(message);
  }

  /** A union that declares neither branch list, or declares both. */
  public static SchemaException invalidUnion() {
    return new SchemaException(
        "UnionProperty must contain exactly one non-empty `oneOf` or `anyOf` array");
  }

  /** A union expressed as {@code oneOf}, which OpenAI does not support. */
  public static SchemaException unsupportedOneOf() {
    return new SchemaException(
        "OpenAI schemas do not support UnionProperty.oneOf; use the provider-supported anyOf"
            + " composition");
  }
}
