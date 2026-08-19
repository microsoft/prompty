package com.microsoft.prompty;

import java.util.LinkedHashMap;
import java.util.Map;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.error.YAMLException;

/**
 * Splits a {@code .prompty} document into its YAML frontmatter and its markdown body.
 *
 * <p>Frontmatter is delimited by a line of {@code ---} or {@code +++}. Behaviour is matched to the
 * Rust runtime's {@code loader::frontmatter}:
 *
 * <ul>
 *   <li>Leading whitespace before the opening delimiter is allowed.
 *   <li>A document with no opening delimiter is entirely body, with empty frontmatter.
 *   <li>The closing delimiter must be a line that trims to {@code ---} or {@code +++}. Notably it
 *       need not match the opener — the Rust implementation ignores the opener when searching, and
 *       that leniency is reproduced here rather than tightened.
 *   <li>An opening delimiter with no closing match is an error.
 *   <li>Frontmatter that parses to anything other than a mapping is an error.
 * </ul>
 *
 * <p>The body is returned untrimmed; trimming is the loader's responsibility.
 */
public final class Frontmatter {

  private Frontmatter() {}

  /** The result of splitting a {@code .prompty} document. */
  public record Split(Map<String, Object> frontmatter, String body) {}

  /**
   * Split raw {@code .prompty} content into frontmatter and body.
   *
   * @throws LoadException if the delimiters are unbalanced or the frontmatter is not a YAML mapping
   */
  public static Split split(String raw) {
    String trimmed = stripLeading(raw);

    if (!trimmed.startsWith("---") && !trimmed.startsWith("+++")) {
      // No delimiter at the start, so the whole document is body.
      return new Split(new LinkedHashMap<>(), raw);
    }

    int firstNewline = trimmed.indexOf('\n', 3);
    if (firstNewline < 0) {
      // An opening delimiter with no newline after it: empty frontmatter, empty body.
      return new Split(new LinkedHashMap<>(), "");
    }
    int afterOpener = firstNewline + 1;

    String rest = trimmed.substring(afterOpener);
    int closePos = findClosingDelimiter(rest);
    if (closePos < 0) {
      throw LoadException.invalidFrontmatter("Opening delimiter without closing match");
    }

    String yaml = rest.substring(0, closePos);
    String afterClose = rest.substring(closePos);
    int closeNewline = afterClose.indexOf('\n');
    String body = closeNewline < 0 ? "" : afterClose.substring(closeNewline + 1);

    return new Split(parseYamlMapping(yaml), body);
  }

  /**
   * Index of the first line that trims to a closing delimiter, or {@code -1}.
   *
   * <p>Returns the offset of the start of that line.
   */
  private static int findClosingDelimiter(String text) {
    int pos = 0;
    int length = text.length();
    while (pos <= length) {
      int newline = text.indexOf('\n', pos);
      int lineEnd = newline < 0 ? length : newline;
      String line = text.substring(pos, lineEnd).trim();
      if (line.equals("---") || line.equals("+++")) {
        return pos;
      }
      if (newline < 0) {
        return -1;
      }
      pos = newline + 1;
    }
    return -1;
  }

  /** Parse a YAML mapping, returning an empty map for blank input. */
  static Map<String, Object> parseYamlMapping(String yaml) {
    String trimmed = yaml.trim();
    if (trimmed.isEmpty()) {
      return new LinkedHashMap<>();
    }

    Object parsed;
    try {
      parsed = newYaml().load(trimmed);
    } catch (YAMLException e) {
      throw LoadException.invalidFrontmatter(e.getMessage());
    }

    if (parsed == null) {
      return new LinkedHashMap<>();
    }
    if (!(parsed instanceof Map<?, ?> map)) {
      throw LoadException.invalidFrontmatter("Frontmatter must be a YAML mapping");
    }
    return stringKeyed(map);
  }

  /**
   * A SnakeYAML instance restricted to the safe constructor, so a {@code .prompty} document can
   * never name an arbitrary Java class to instantiate.
   */
  static Yaml newYaml() {
    LoaderOptions options = new LoaderOptions();
    options.setAllowDuplicateKeys(false);
    return new Yaml(new SafeConstructor(options));
  }

  /**
   * Re-key a parsed YAML map to {@code String} keys.
   *
   * <p>YAML permits non-string keys; the generated model layer is string-keyed throughout, so keys
   * are stringified rather than rejected.
   */
  @SuppressWarnings("unchecked")
  static Map<String, Object> stringKeyed(Map<?, ?> map) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : map.entrySet()) {
      String key = entry.getKey() == null ? "null" : String.valueOf(entry.getKey());
      Object value = entry.getValue();
      if (value instanceof Map<?, ?> nested) {
        result.put(key, stringKeyed(nested));
      } else if (value instanceof java.util.List<?> list) {
        result.put(key, stringKeyedList(list));
      } else {
        result.put(key, value);
      }
    }
    return result;
  }

  static java.util.List<Object> stringKeyedList(java.util.List<?> list) {
    java.util.List<Object> result = new java.util.ArrayList<>(list.size());
    for (Object item : list) {
      if (item instanceof Map<?, ?> nested) {
        result.add(stringKeyed(nested));
      } else if (item instanceof java.util.List<?> nestedList) {
        result.add(stringKeyedList(nestedList));
      } else {
        result.add(item);
      }
    }
    return result;
  }

  /** Strip leading whitespace, matching Rust's {@code str::trim_start}. */
  private static String stripLeading(String value) {
    int i = 0;
    while (i < value.length() && Character.isWhitespace(value.charAt(i))) {
      i++;
    }
    return value.substring(i);
  }
}
