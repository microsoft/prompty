package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Agent;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Parses rendered text into a list of messages.
 *
 * <p>Registered under the {@code prompty.parsers} group, keyed by
 * {@code agent.template.parser.kind}.
 */
public interface Parser {

  /** The result of a {@link #preRender} hook: a rewritten template plus context for {@link #parse}. */
  record PreRender(String template, Map<String, Object> context) {}

  /**
   * Optional hook run before rendering.
   *
   * <p>A parser can rewrite the template and carry context forward to {@link #parse}. The chat
   * parser uses this to stamp a per-render nonce onto every role marker, so that markers injected
   * by a template variable can be told apart from markers the author wrote.
   *
   * @return the rewritten template and its context, or empty to render the template unchanged
   */
  default Optional<PreRender> preRender(String template) {
    return Optional.empty();
  }

  /**
   * Parse rendered text into messages.
   *
   * @param context the context returned by {@link #preRender}, or null if there was none
   * @throws InvokerException with {@link InvokerException.Kind#PARSE} if parsing fails
   */
  List<Message> parse(Agent agent, String rendered, Map<String, Object> context);
}
