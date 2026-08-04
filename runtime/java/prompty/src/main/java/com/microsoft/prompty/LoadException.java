package com.microsoft.prompty;

/**
 * Raised when a {@code .prompty} document cannot be read, its frontmatter is malformed, or a
 * {@code ${env:...}} / {@code ${file:...}} reference cannot be resolved.
 *
 * <p>Mirrors the {@code LoadError} enum in the Rust runtime. The variant is carried on {@link #kind}
 * so callers can branch without string matching, while {@link #getMessage()} keeps the wording
 * aligned across runtimes.
 */
public class LoadException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  /** The class of load failure, mirroring the Rust {@code LoadError} variants. */
  public enum Kind {
    /** The prompt file could not be opened or read. */
    FILE_NOT_FOUND,
    /** The frontmatter was not a well-formed YAML mapping, or the delimiters were unbalanced. */
    INVALID_FRONTMATTER,
    /** A {@code ${env:VAR}} reference named an unset variable and declared no default. */
    ENV_VAR_NOT_SET,
    /** A {@code ${file:path}} reference could not be read, parsed, or escaped its allowed roots. */
    FILE_REFERENCE,
    /**
     * {@code template} was authored as a bare string. Prompty v2 requires an object carrying
     * {@code format} and {@code parser}.
     */
    INVALID_TEMPLATE,
    /** Any other load failure. */
    OTHER
  }

  private final Kind kind;

  public LoadException(Kind kind, String message) {
    super(message);
    this.kind = kind;
  }

  public LoadException(Kind kind, String message, Throwable cause) {
    super(message, cause);
    this.kind = kind;
  }

  public Kind kind() {
    return kind;
  }

  /*
   * Message wording is kept character-for-character in step with the Rust runtime's
   * `LoadError::Display`, so a diagnostic produced by either runtime reads identically and the
   * shared vector suite's error matching behaves the same for both.
   */

  public static LoadException fileNotFound(String path, String detail) {
    return new LoadException(Kind.FILE_NOT_FOUND, "File not found: " + path + ": " + detail);
  }

  public static LoadException invalidFrontmatter(String detail) {
    return new LoadException(Kind.INVALID_FRONTMATTER, "Invalid frontmatter: " + detail);
  }

  public static LoadException envVarNotSet(String varName, String key) {
    return new LoadException(
        Kind.ENV_VAR_NOT_SET,
        "Environment variable '" + varName + "' not set for key '" + key + "'");
  }

  public static LoadException fileReference(String path, String detail) {
    return new LoadException(Kind.FILE_REFERENCE, "File reference error: " + path + ": " + detail);
  }

  public static LoadException invalidTemplate(String detail) {
    return new LoadException(Kind.INVALID_TEMPLATE, "Invalid template format: " + detail);
  }

  public static LoadException other(String detail) {
    return new LoadException(Kind.OTHER, "Load error: " + detail);
  }
}
