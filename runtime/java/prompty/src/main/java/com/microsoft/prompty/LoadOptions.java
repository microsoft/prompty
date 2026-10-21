package com.microsoft.prompty;

import java.nio.file.Path;
import java.util.List;

/**
 * Options controlling how a {@code .prompty} document is loaded.
 *
 * @param allowedFileRoots additional directories that {@code ${file:...}} references may read from.
 *     The prompt file's own directory is always allowed and need not be listed.
 * @param trustedEndpoints additional origins (e.g. {@code "https://my-proxy.contoso.com"} or
 *     {@code "https://*.contoso.com"}) that may receive ambient credentials when a file chooses the
 *     connection endpoint (spec §2.5.1). Built-in provider origins and the
 *     {@code PROMPTY_TRUSTED_ENDPOINTS} variable are always consulted; {@code "*"} trusts every
 *     endpoint.
 */
public record LoadOptions(List<Path> allowedFileRoots, List<String> trustedEndpoints) {

  private static final LoadOptions DEFAULT = new LoadOptions(List.of(), List.of());

  public LoadOptions {
    allowedFileRoots = List.copyOf(allowedFileRoots);
    trustedEndpoints = trustedEndpoints == null ? List.of() : List.copyOf(trustedEndpoints);
  }

  /** Options with additional {@code ${file:...}} roots and no extra trusted endpoints. */
  public LoadOptions(List<Path> allowedFileRoots) {
    this(allowedFileRoots, List.of());
  }

  /** Default options: {@code ${file:...}} is confined to the prompt's own directory tree. */
  public static LoadOptions defaults() {
    return DEFAULT;
  }

  /** Options allowing {@code ${file:...}} to additionally read from the given roots. */
  public static LoadOptions withAllowedFileRoots(Path... roots) {
    return new LoadOptions(List.of(roots));
  }

  /** Options trusting the given endpoint origins to receive ambient credentials. */
  public static LoadOptions withTrustedEndpoints(String... origins) {
    return new LoadOptions(List.of(), List.of(origins));
  }

  /** A copy of these options with {@code trustedEndpoints} replaced. */
  public LoadOptions trustingEndpoints(List<String> origins) {
    return new LoadOptions(allowedFileRoots, origins);
  }
}
