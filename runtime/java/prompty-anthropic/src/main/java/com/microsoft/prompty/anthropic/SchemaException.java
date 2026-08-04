package com.microsoft.prompty.anthropic;

/**
 * Raised when a portable {@code Property} schema cannot be expressed as an Anthropic tool or output
 * schema.
 *
 * <p>Failing at conversion rather than at the API boundary keeps the error attributable: the prompt
 * author wrote a schema the provider will not take, and the message says which construct was at
 * fault.
 */
public class SchemaException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  public SchemaException(String message) {
    super(message);
  }
}
