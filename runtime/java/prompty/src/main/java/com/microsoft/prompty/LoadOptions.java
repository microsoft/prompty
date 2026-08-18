package com.microsoft.prompty;

import java.nio.file.Path;
import java.util.List;

/**
 * Options controlling how a {@code .prompty} document is loaded.
 *
 * @param allowedFileRoots additional directories that {@code ${file:...}} references may read from.
 *     The prompt file's own directory is always allowed and need not be listed.
 */
public record LoadOptions(List<Path> allowedFileRoots) {

  private static final LoadOptions DEFAULT = new LoadOptions(List.of());

  public LoadOptions {
    allowedFileRoots = List.copyOf(allowedFileRoots);
  }

  /** Default options: {@code ${file:...}} is confined to the prompt's own directory tree. */
  public static LoadOptions defaults() {
    return DEFAULT;
  }

  /** Options allowing {@code ${file:...}} to additionally read from the given roots. */
  public static LoadOptions withAllowedFileRoots(Path... roots) {
    return new LoadOptions(List.of(roots));
  }
}
