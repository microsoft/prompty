package com.microsoft.prompty.renderers;

import com.hubspot.jinjava.Jinjava;
import com.hubspot.jinjava.JinjavaConfig;
import com.hubspot.jinjava.interpret.RenderResult;
import com.hubspot.jinjava.interpret.TemplateError;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.Renderer;
import com.microsoft.prompty.model.Agent;
import java.util.List;
import java.util.Map;

/**
 * Renders Jinja/Nunjucks templates.
 *
 * <p>Registered under both {@code nunjucks} — the canonical spec name — and {@code jinja2}, the
 * alias long-standing {@code .prompty} files use.
 *
 * <p>Two deliberate departures from typical web-template defaults: output is never HTML-escaped,
 * because a prompt is text sent to a model rather than markup sent to a browser; and an undefined
 * variable renders as the empty string rather than failing, so an optional input can simply be
 * omitted.
 */
public final class JinjaRenderer implements Renderer {

  private final Jinjava jinjava;

  public JinjaRenderer() {
    this.jinjava =
        new Jinjava(
            JinjavaConfig.newBuilder()
                .withFailOnUnknownTokens(false)
                .withNestedInterpretationEnabled(false)
                .build());
  }

  @Override
  public String render(Agent agent, String template, Map<String, Object> inputs) {
    RenderResult result;
    try {
      result = jinjava.renderForResult(template, inputs);
    } catch (RuntimeException e) {
      throw InvokerException.render("Template rendering failed: " + e.getMessage(), e);
    }

    List<TemplateError> errors = result.getErrors();
    if (errors != null) {
      for (TemplateError error : errors) {
        // An unknown variable is not an error here: the spec requires it to render as empty.
        // Anything else at fatal severity is a genuine template defect and must surface.
        if (error.getSeverity() == TemplateError.ErrorType.FATAL
            && error.getReason() != TemplateError.ErrorReason.UNKNOWN) {
          throw InvokerException.render("Template rendering failed: " + error.getMessage());
        }
      }
    }

    return result.getOutput();
  }
}
