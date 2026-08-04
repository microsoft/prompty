package com.microsoft.prompty;

import com.microsoft.prompty.model.Prompty;
import java.util.Map;

/**
 * Renders a template string against a set of inputs.
 *
 * <p>Registered under the {@code prompty.renderers} group, keyed by
 * {@code agent.template.format.kind}.
 */
public interface Renderer {

  /**
   * Render {@code template} with {@code inputs}.
   *
   * @param agent the agent being rendered, for renderers that consult its declarations
   * @param template the template text, normally the agent's instructions
   * @param inputs input values by name
   * @return the rendered text
   * @throws InvokerException with {@link InvokerException.Kind#RENDER} if rendering fails
   */
  String render(Prompty agent, String template, Map<String, Object> inputs);
}
