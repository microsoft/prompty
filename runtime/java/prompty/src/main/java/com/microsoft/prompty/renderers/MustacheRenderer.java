package com.microsoft.prompty.renderers;

import com.github.mustachejava.DefaultMustacheFactory;
import com.github.mustachejava.Mustache;
import com.github.mustachejava.MustacheFactory;
import com.microsoft.prompty.InvokerException;
import com.microsoft.prompty.Renderer;
import com.microsoft.prompty.model.Prompty;
import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.io.Writer;
import java.util.Map;

/**
 * Renders Mustache templates.
 *
 * <p>Registered under {@code mustache}. Output is never HTML-escaped: a prompt is text sent to a
 * model, and escaping would corrupt any prompt containing angle brackets or quotes.
 */
public final class MustacheRenderer implements Renderer {

  private final MustacheFactory factory = new RawMustacheFactory();

  @Override
  public String render(Prompty agent, String template, Map<String, Object> inputs) {
    try {
      Mustache compiled = factory.compile(new StringReader(template), "prompty");
      StringWriter writer = new StringWriter();
      compiled.execute(writer, inputs).flush();
      return writer.toString();
    } catch (IOException | RuntimeException e) {
      throw InvokerException.render("Template rendering failed: " + e.getMessage(), e);
    }
  }

  /** A factory whose {@code encode} writes values through unchanged instead of HTML-escaping. */
  private static final class RawMustacheFactory extends DefaultMustacheFactory {
    @Override
    public void encode(String value, Writer writer) {
      try {
        writer.write(value);
      } catch (IOException e) {
        throw new java.io.UncheckedIOException(e);
      }
    }
  }
}
