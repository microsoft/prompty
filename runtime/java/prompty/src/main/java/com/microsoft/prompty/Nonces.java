package com.microsoft.prompty;

import com.microsoft.prompty.model.Property;
import com.microsoft.prompty.model.Prompty;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Nonce markers that stand in for rich inputs while a template renders.
 *
 * <p>A thread, image, file or audio input cannot survive being flattened into a template's output
 * string. Instead the renderer receives an unguessable marker in its place, and the pipeline
 * substitutes the real value back once parsing has produced structured messages.
 *
 * <p>The marker is unguessable on purpose. Because it is what the parser trusts when deciding which
 * role boundaries are genuine, a predictable marker would let untrusted input forge one.
 */
public final class Nonces {

  /** Input kinds whose values are replaced by a marker during rendering. */
  public static final Set<String> RICH_KINDS = Set.of("thread", "image", "file", "audio");

  /** The one rich kind that is expanded during parsing rather than during wire conversion. */
  public static final String THREAD_KIND = "thread";

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final String HEX = "0123456789abcdef";

  private Nonces() {}

  /**
   * Inputs rewritten for rendering, paired with the markers that were substituted in.
   *
   * @param nonces every marker, by property name
   * @param threadNonces the {@code thread} subset — the only kind expanded during parsing. Per spec
   *     §5.2, image, file and audio markers survive parsing and are resolved during wire conversion,
   *     so expanding them here would destroy them.
   */
  public record Prepared(
      Map<String, Object> inputs, Map<String, String> nonces, Map<String, String> threadNonces) {}

  /** Generate a marker of the form {@code __PROMPTY_THREAD_<8 hex>_<name>__}. */
  public static String generate(String name) {
    return "__PROMPTY_THREAD_" + hex(8) + "_" + name + "__";
  }

  /** Generate a lowercase hex string of {@code length} digits. */
  public static String hex(int length) {
    StringBuilder builder = new StringBuilder(length);
    for (int i = 0; i < length; i++) {
      builder.append(HEX.charAt(RANDOM.nextInt(16)));
    }
    return builder.toString();
  }

  /**
   * Replace every rich-kind input with a freshly generated marker.
   *
   * <p>A marker is injected for each declared rich input whether or not the caller supplied a value,
   * so the template always has something to render and the pipeline always has a marker to expand.
   *
   * @return the rewritten inputs and a property-name to marker mapping
   */
  public static Prepared prepareRenderInputs(Prompty agent, Map<String, Object> inputs) {
    Map<String, Object> modified = new LinkedHashMap<>(inputs == null ? Map.of() : inputs);
    Map<String, String> nonces = new LinkedHashMap<>();
    Map<String, String> threadNonces = new LinkedHashMap<>();

    List<Property> properties = agent == null ? null : agent.inputs;
    if (properties != null) {
      for (Property property : properties) {
        if (property == null || property.name == null || !RICH_KINDS.contains(property.kind)) {
          continue;
        }
        String nonce = generate(property.name);
        modified.put(property.name, nonce);
        nonces.put(property.name, nonce);
        if (THREAD_KIND.equals(property.kind)) {
          threadNonces.put(property.name, nonce);
        }
      }
    }

    return new Prepared(modified, nonces, threadNonces);
  }
}
