package com.microsoft.prompty;

import com.microsoft.prompty.model.LoadContext;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Loads {@code .prompty} documents into typed {@link com.microsoft.prompty.model.Agent} values.
 *
 * <p>The pipeline is fixed by spec §4.3 and matched to the Rust runtime:
 *
 * <ol>
 *   <li>Read the file and normalise {@code \r\n} to {@code \n}.
 *   <li>Split YAML frontmatter from the markdown body.
 *   <li>Trim trailing newlines from the body and, if anything remains, set it as
 *       {@code instructions}.
 *   <li>Normalise authored shorthands — dictionary-form inputs and outputs whose value is a bare
 *       scalar become full properties.
 *   <li>Inject {@code kind: "prompt"}; a {@code .prompty} document always describes a prompt agent.
 *   <li>Resolve {@code ${env:...}} and {@code ${file:...}} references.
 *   <li>Hand the resulting map to the generated model's {@code load}.
 *   <li>Record the source path in {@code metadata.__source_path}.
 * </ol>
 *
 * <p>Per the spec the runtime never auto-loads a {@code .env} file. Populating the environment is
 * the application's job, which keeps loading deterministic and keeps secrets out of the library's
 * control flow.
 */
public final class Loader {

  /** Metadata key recording the absolute path a prompt was loaded from. */
  public static final String SOURCE_PATH_KEY = "__source_path";

  private Loader() {}

  /** Load a {@code .prompty} file using default options. */
  public static com.microsoft.prompty.model.Agent load(Path path) {
    return load(path, LoadOptions.defaults());
  }

  /** Load a {@code .prompty} file using default options. */
  public static com.microsoft.prompty.model.Agent load(String path) {
    return load(Path.of(path), LoadOptions.defaults());
  }

  /**
   * Load a {@code .prompty} file.
   *
   * @throws LoadException if the file cannot be read, the frontmatter is malformed, or a reference
   *     cannot be resolved
   */
  public static com.microsoft.prompty.model.Agent load(Path path, LoadOptions options) {
    Path resolved;
    try {
      resolved = path.toRealPath();
    } catch (IOException e) {
      throw LoadException.fileNotFound(path.toString(), e.toString());
    }

    String raw;
    try {
      raw = Files.readString(resolved, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw LoadException.fileNotFound(resolved.toString(), e.toString());
    }

    return buildAgent(raw.replace("\r\n", "\n"), resolved, options);
  }

  /**
   * Load from raw {@code .prompty} content, resolving {@code ${file:...}} relative to the given base
   * path.
   *
   * <p>{@code basePath} names the document's notional location — its parent directory becomes the
   * reference root — and need not exist as a file.
   */
  public static com.microsoft.prompty.model.Agent loadFromString(String raw, Path basePath) {
    return loadFromString(raw, basePath, LoadOptions.defaults());
  }

  /** Load from raw {@code .prompty} content with explicit options. */
  public static com.microsoft.prompty.model.Agent loadFromString(
      String raw, Path basePath, LoadOptions options) {
    return buildAgent(raw.replace("\r\n", "\n"), basePath, options);
  }

  // -------------------------------------------------------------------------

  private static com.microsoft.prompty.model.Agent buildAgent(
      String raw, Path filePath, LoadOptions options) {
    Frontmatter.Split split = Frontmatter.split(raw);
    Map<String, Object> data = split.frontmatter();

    // Editors habitually append trailing newlines; strip them, but keep leading and internal
    // whitespace, which is meaningful inside instructions.
    String body = trimTrailingNewlines(split.body());
    if (!body.isEmpty()) {
      data.put("instructions", body);
    }

    rejectStringTemplate(data);
    expandScalarShorthand(data, "inputs");
    expandScalarShorthand(data, "outputs");

    data.put("kind", "prompt");

    Path agentDir = filePath.getParent() == null ? Path.of(".") : filePath.getParent();
    References.resolveReferences(data, agentDir, options.allowedFileRoots());

    LoadContext context = makeLoadContext(agentDir, options.allowedFileRoots());
    com.microsoft.prompty.model.Agent agent =
        com.microsoft.prompty.model.Agent.load(data, context);

    if (agent.metadata == null) {
      agent.metadata = new LinkedHashMap<>();
    }
    agent.metadata.put(SOURCE_PATH_KEY, filePath.toString());
    return agent;
  }

  /**
   * A {@code LoadContext} whose {@code preProcess} resolves references as the model tree is walked.
   *
   * <p>The whole tree is resolved up front, so this mostly re-checks already-resolved values. It is
   * still wired in because the model layer is the documented seam for reference expansion, and a
   * value reachable only through the model's own recursion would otherwise be missed.
   */
  private static LoadContext makeLoadContext(Path agentDir, List<Path> allowedFileRoots) {
    return new LoadContext(
        value -> {
          if (value instanceof Map<?, ?> rawMap) {
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) rawMap;
            for (Map.Entry<String, Object> entry : map.entrySet()) {
              if (entry.getValue() instanceof String s) {
                References.resolveSingleRef(s, agentDir, allowedFileRoots)
                    .ifPresent(entry::setValue);
              }
            }
          }
          return value;
        },
        null);
  }

  /**
   * Reject {@code template: "jinja2"}.
   *
   * <p>Prompty v1 allowed a bare string; v2 requires {@code {format: {...}, parser: {...}}}. Failing
   * loudly here rather than silently upgrading keeps the two shapes from quietly coexisting, and
   * matches the shared {@code template_string_invalid} vector.
   */
  private static void rejectStringTemplate(Map<String, Object> data) {
    if (data.get("template") instanceof String) {
      throw LoadException.invalidTemplate(
          "template must be an object with 'format' and 'parser', not a bare string");
    }
  }

  /**
   * Expand dictionary-form scalar shorthand into full property objects (spec §4.3 step 6d).
   *
   * <p>{@code inputs: {topic: science}} becomes
   * {@code inputs: {topic: {kind: "string", default: "science"}}}. Only the dictionary form is
   * eligible: in list form a bare scalar has no name to attach it to.
   *
   * <p>This runs in the loader rather than the model layer because kind inference is a loading
   * concern — the model layer's own shorthand handling reads a scalar as an {@code example}, which
   * is the right reading for a hand-constructed model but the wrong one for authored frontmatter.
   */
  private static void expandScalarShorthand(Map<String, Object> data, String key) {
    if (!(data.get(key) instanceof Map<?, ?> rawMap)) {
      return;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> map = (Map<String, Object>) rawMap;
    for (Map.Entry<String, Object> entry : map.entrySet()) {
      Object value = entry.getValue();
      if (value instanceof Map<?, ?>) {
        continue;
      }
      Map<String, Object> property = new LinkedHashMap<>();
      property.put("kind", inferKind(value));
      property.put("default", value);
      entry.setValue(property);
    }
  }

  /**
   * Infer a property kind from a scalar (spec §2.7).
   *
   * <p>{@code null} has no representable kind, so it falls back to {@code "string"} rather than
   * inventing one.
   */
  static String inferKind(Object value) {
    if (value instanceof Boolean) {
      return "boolean";
    }
    if (value instanceof Integer || value instanceof Long || value instanceof Short
        || value instanceof Byte || value instanceof java.math.BigInteger) {
      return "integer";
    }
    if (value instanceof Float || value instanceof Double
        || value instanceof java.math.BigDecimal) {
      return "float";
    }
    if (value instanceof List<?>) {
      return "array";
    }
    if (value instanceof Map<?, ?>) {
      return "object";
    }
    return "string";
  }

  private static String trimTrailingNewlines(String value) {
    int end = value.length();
    while (end > 0) {
      char c = value.charAt(end - 1);
      if (c == '\n' || c == '\r') {
        end--;
      } else {
        break;
      }
    }
    return value.substring(0, end);
  }

  /** Convenience accessor for the source path recorded at load time, if any. */
  public static String sourcePath(com.microsoft.prompty.model.Agent agent) {
    if (agent.metadata == null) {
      return null;
    }
    Object value = agent.metadata.get(SOURCE_PATH_KEY);
    return value instanceof String s ? s : null;
  }

  /** Inputs declared by an agent, or an empty list when none are declared. */
  public static List<com.microsoft.prompty.model.Property> inputsOf(
      com.microsoft.prompty.model.Agent agent) {
    return agent.inputs == null ? new ArrayList<>() : agent.inputs;
  }
}
