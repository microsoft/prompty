package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.microsoft.prompty.model.ContentPart;
import com.microsoft.prompty.model.ImagePart;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.TextPart;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Pins the message text folds that other runtimes spell {@code msg.text()} /
 * {@code msg.toTextContent()}.
 *
 * <p>Java has no extension methods, so these folds live as static functions over the generated
 * {@link Message} type in {@link Messages}. The behaviour is pinned to the Rust reference in
 * {@code runtime/rust/prompty/src/model_ext.rs}.
 */
class MessageFoldTest {

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
    assertEquals("first\nsecond", Messages.text(message(text("first"), text("second"))));
  }

  @Test
  void textIgnoresNonTextParts() {
    assertEquals("caption", Messages.text(message(text("caption"), image("https://example.com/i.png"))));
  }

  @Test
  void textIsEmptyWithoutTextParts() {
    assertEquals("", Messages.text(message(image("https://example.com/i.png"))));
    assertEquals("", Messages.text(message()));
  }

  @Test
  void textToleratesNullParts() {
    Message message = new Message();
    message.parts = null;
    assertEquals("", Messages.text(message));
  }

  @Test
  void toTextContentReturnsStringWhenEveryPartIsText() {
    Object content = Messages.toTextContent(message(text("simple")));
    assertInstanceOf(String.class, content);
    assertEquals("simple", content);
  }

  @Test
  void toTextContentJoinsMultipleTextParts() {
    assertEquals("one\ntwo", Messages.toTextContent(message(text("one"), text("two"))));
  }

  @Test
  void toTextContentReturnsWireFormWhenAnyPartIsRich() {
    Object content = Messages.toTextContent(message(text("Hello"), image("data:image/png;base64,abc")));
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
    assertEquals("", Messages.toTextContent(message()));
  }
}
