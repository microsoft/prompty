package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.microsoft.prompty.model.ContentPart;
import com.microsoft.prompty.model.ImagePart;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.TextPart;
import com.microsoft.prompty.model.ToolResult;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Covers the hand-written {@code @method} implementations that live in the
 * emitter's extension seams.
 *
 * <p>The seams are created as throwing stubs when missing, and the emitter
 * never rewrites them, so an unimplemented seam is invisible to the generated
 * suites and fails only at runtime. These tests pin the behaviour to the Rust
 * reference in {@code runtime/rust/prompty/src/model_ext.rs}.
 */
class ExtensionSeamTest {

  private static TextPart text(String value) {
    TextPart part = new TextPart();
    part.value = value;
    return part;
  }

  private static ImagePart image(String source) {
    ImagePart part = new ImagePart();
    part.source = source;
    return part;
  }

  private static Message message(ContentPart... parts) {
    Message message = new Message();
    message.parts = new ArrayList<>(List.of(parts));
    return message;
  }

  @Test
  void textConcatenatesTextParts() {
    assertEquals("first\nsecond", message(text("first"), text("second")).text());
  }

  @Test
  void textIgnoresNonTextParts() {
    assertEquals("caption", message(text("caption"), image("https://example.com/i.png")).text());
  }

  @Test
  void textIsEmptyWithoutTextParts() {
    assertEquals("", message(image("https://example.com/i.png")).text());
    assertEquals("", message().text());
  }

  @Test
  void textToleratesNullParts() {
    Message message = new Message();
    message.parts = null;
    assertEquals("", message.text());
  }

  @Test
  void toTextContentReturnsStringWhenEveryPartIsText() {
    Object content = message(text("simple")).toTextContent();
    assertInstanceOf(String.class, content);
    assertEquals("simple", content);
  }

  @Test
  void toTextContentJoinsMultipleTextParts() {
    assertEquals("one\ntwo", message(text("one"), text("two")).toTextContent());
  }

  @Test
  void toTextContentReturnsWireFormWhenAnyPartIsRich() {
    Object content = message(text("Hello"), image("data:image/png;base64,abc")).toTextContent();
    assertInstanceOf(List.class, content);

    List<?> parts = (List<?>) content;
    assertEquals(2, parts.size());
    assertEquals("text", ((Map<?, ?>) parts.get(0)).get("kind"));
    assertEquals("image", ((Map<?, ?>) parts.get(1)).get("kind"));
  }

  @Test
  void toTextContentReturnsEmptyStringForNoParts() {
    // An empty part list vacuously satisfies "every part is text", which is the
    // behaviour the Rust reference relies on to keep empty messages scalar.
    assertEquals("", message().toTextContent());
  }

  @Test
  void toolResultTextConcatenatesTextParts() {
    ToolResult result = new ToolResult();
    result.parts = new ArrayList<>(List.of(text("72\u00b0F"), image("https://example.com/i.png"), text("sunny")));
    assertEquals("72\u00b0F\nsunny", result.text());
  }

  @Test
  void toolResultTextToleratesNullParts() {
    ToolResult result = new ToolResult();
    result.parts = null;
    assertEquals("", result.text());
  }

  @Test
  void seamsAreReachableThroughTheGeneratedEntryPoints() {
    // The generated methods delegate to the seam classes, which the emitter
    // creates as throwing stubs when absent and never overwrites. Assert against
    // literals so an unimplemented seam fails here rather than at runtime.
    Message message = message(text("delegated"));
    assertEquals("delegated", message.text());
    assertEquals("delegated", message.toTextContent());

    ToolResult result = new ToolResult();
    result.parts = new ArrayList<>(List.of(text("delegated")));
    assertEquals("delegated", result.text());
  }
}
