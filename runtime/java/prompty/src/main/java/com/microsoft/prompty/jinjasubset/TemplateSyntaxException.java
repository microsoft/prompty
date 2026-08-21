package com.microsoft.prompty.jinjasubset;

/** Raised when a template cannot be tokenized or parsed under the Prompty Jinja subset. */
public final class TemplateSyntaxException extends RuntimeException {
  public TemplateSyntaxException(String message) { super(message); }
}
