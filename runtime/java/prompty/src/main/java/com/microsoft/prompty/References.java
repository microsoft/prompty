package com.microsoft.prompty;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.yaml.snakeyaml.error.YAMLException;

/**
 * Resolution of {@code ${protocol:value}} references in loaded frontmatter.
 *
 * <p>Two protocols are recognised:
 *
 * <ul>
 *   <li>{@code ${env:VAR}} and {@code ${env:VAR:default}} — an environment variable, with an
 *       optional literal default used when the variable is unset. The default is everything after
 *       the first colon, so it may itself contain colons.
 *   <li>{@code ${file:path}} — the contents of a file resolved relative to the prompt's directory.
 *       {@code .json}, {@code .yaml} and {@code .yml} are parsed into structured values; anything
 *       else is inlined as raw text.
 * </ul>
 *
 * <p>Any other protocol is left untouched, so unrelated {@code ${...}} syntax in a template survives
 * loading.
 *
 * <h2>File sandboxing</h2>
 *
 * <p>A {@code ${file:...}} target must resolve inside the prompt's own directory or one of the
 * explicitly allowed roots from {@link LoadOptions}. This is enforced after canonicalisation, so
 * {@code ../} traversal and symlinks cannot escape.
 *
 * <h2>A deliberate quirk</h2>
 *
 * <p>{@link #resolveReferences} descends into nested maps and lists, but it only resolves strings
 * that are <em>map values</em> — a bare string sitting directly in a list is left alone. That
 * matches the Rust runtime exactly, and the runtimes are kept identical here rather than
 * independently "fixed", because the wire behaviour is observable.
 */
public final class References {

  private References() {}

  /**
   * Recursively resolve references in place, throwing on an unresolvable one.
   *
   * @param value the frontmatter tree; maps and lists are walked, other values are left alone
   * @param agentDir the prompt file's directory, always an allowed {@code ${file:}} root
   * @param allowedFileRoots additional directories {@code ${file:}} may read from
   */
  public static void resolveReferences(Object value, Path agentDir, List<Path> allowedFileRoots) {
    if (value instanceof Map<?, ?> rawMap) {
      @SuppressWarnings("unchecked")
      Map<String, Object> map = (Map<String, Object>) rawMap;
      for (String key : new ArrayList<>(map.keySet())) {
        Object item = map.get(key);
        if (item instanceof String s) {
          Optional<Object> resolved = tryResolveString(s, key, agentDir, allowedFileRoots, true);
          if (resolved.isPresent()) {
            map.put(key, resolved.get());
          }
        } else if (item != null) {
          resolveReferences(item, agentDir, allowedFileRoots);
        }
      }
    } else if (value instanceof List<?> rawList) {
      @SuppressWarnings("unchecked")
      List<Object> list = (List<Object>) rawList;
      for (int i = 0; i < list.size(); i++) {
        Object item = list.get(i);
        if (item instanceof String s) {
          // Spec §4.2 resolves every string value, not only the ones that happen to sit directly
          // under a key. A list of file references is a perfectly ordinary thing to write.
          Optional<Object> resolved =
              tryResolveString(s, "[" + i + "]", agentDir, allowedFileRoots, true);
          if (resolved.isPresent()) {
            list.set(i, resolved.get());
          }
        } else if (item != null) {
          resolveReferences(item, agentDir, allowedFileRoots);
        }
      }
    }
  }

  /**
   * Resolve a single string reference, swallowing failures.
   *
   * <p>Used as the model layer's {@code preProcess} hook, where the tree has normally already been
   * resolved by {@link #resolveReferences} and a second, throwing pass would be redundant.
   *
   * @return the resolved value, or empty if the string was not a resolvable reference
   */
  public static Optional<Object> resolveSingleRef(
      String value, Path agentDir, List<Path> allowedFileRoots) {
    return tryResolveString(value, "<preProcess>", agentDir, allowedFileRoots, false);
  }

  private static Optional<Object> tryResolveString(
      String value, String key, Path agentDir, List<Path> allowedFileRoots, boolean throwOnError) {
    if (!value.startsWith("${") || !value.endsWith("}")) {
      return Optional.empty();
    }

    String inner = value.substring(2, value.length() - 1);
    int colon = inner.indexOf(':');
    if (colon < 0) {
      return Optional.empty();
    }

    String protocol = inner.substring(0, colon).toLowerCase(Locale.ROOT);
    String rest = inner.substring(colon + 1);

    try {
      return switch (protocol) {
        case "env" -> resolveEnv(rest, key);
        case "file" -> resolveFile(rest, agentDir, allowedFileRoots, key);
        // Unknown protocol — leave the string as authored.
        default -> Optional.empty();
      };
    } catch (LoadException e) {
      if (throwOnError) {
        throw e;
      }
      return Optional.empty();
    }
  }

  private static Optional<Object> resolveEnv(String spec, String key) {
    int colon = spec.indexOf(':');
    String varName = colon < 0 ? spec : spec.substring(0, colon);
    String defaultValue = colon < 0 ? null : spec.substring(colon + 1);

    Optional<String> actual = Environment.lookup(varName);
    if (actual.isPresent()) {
      return Optional.of(actual.get());
    }
    if (defaultValue != null) {
      return Optional.of(defaultValue);
    }
    throw LoadException.envVarNotSet(varName, key);
  }

  private static Optional<Object> resolveFile(
      String relativePath, Path agentDir, List<Path> allowedFileRoots, String key) {
    Path requested = Path.of(relativePath);
    Path full = requested.isAbsolute() ? requested : agentDir.resolve(requested);

    Path canonical = canonicalize(full);

    List<Path> roots = new ArrayList<>(allowedFileRoots.size() + 1);
    roots.add(canonicalize(agentDir));
    for (Path root : allowedFileRoots) {
      roots.add(canonicalize(root));
    }

    boolean allowed = roots.stream().anyMatch(canonical::startsWith);
    if (!allowed) {
      throw LoadException.fileReference(
          canonical.toString(),
          "File reference '"
              + relativePath
              + "' for key '"
              + key
              + "' resolves outside allowed roots");
    }

    String content;
    try {
      content = Files.readString(canonical, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw LoadException.fileReference(canonical.toString(), e.toString());
    }

    String extension = extensionOf(canonical);
    return switch (extension) {
      case "json" -> Optional.of(parseStructured(content, canonical, "Invalid JSON"));
      case "yaml", "yml" -> Optional.of(parseStructured(content, canonical, "Invalid YAML"));
      default -> Optional.of(content);
    };
  }

  /**
   * Parse JSON or YAML content.
   *
   * <p>YAML is a superset of JSON, so SnakeYAML covers both; only the failure wording differs, which
   * keeps diagnostics aligned with the other runtimes.
   */
  private static Object parseStructured(String content, Path path, String errorPrefix) {
    Object parsed;
    try {
      parsed = Frontmatter.newYaml().load(content);
    } catch (YAMLException e) {
      throw LoadException.fileReference(path.toString(), errorPrefix + ": " + e.getMessage());
    }
    if (parsed instanceof Map<?, ?> map) {
      return Frontmatter.stringKeyed(map);
    }
    if (parsed instanceof List<?> list) {
      return Frontmatter.stringKeyedList(list);
    }
    return parsed;
  }

  private static Path canonicalize(Path path) {
    try {
      return path.toRealPath();
    } catch (IOException e) {
      throw LoadException.fileReference(path.toString(), e.toString());
    }
  }

  private static String extensionOf(Path path) {
    String name = path.getFileName().toString();
    int dot = name.lastIndexOf('.');
    return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
  }
}
