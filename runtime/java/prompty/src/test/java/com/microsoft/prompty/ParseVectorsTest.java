package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.SaveContext;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Runs the shared {@code spec/vectors/parse} suite against the prompty chat parser.
 *
 * <p>Parsing decides where one message ends and the next begins, which is what separates the prompt
 * author's instructions from user-supplied content. The vectors cover the boundary cases that decide
 * it: markers that are only markers at the start of a line, content that merely looks like a marker,
 * and exactly which surrounding whitespace is significant.
 */
class ParseVectorsTest {

  private static final Pattern NONCE_MARKER =
      Pattern.compile("__PROMPTY_THREAD_([a-f0-9]+)_(\\w+)__");

  @TestFactory
  List<DynamicTest> parseVectors() {
    Registry.bootstrap();
    List<DynamicTest> tests = new ArrayList<>();
    for (Map<String, Object> testCase : SpecVectors.readArray("parse/parse_vectors.json")) {
      String name = SpecVectors.string(testCase, "name");
      tests.add(dynamicTest(name, () -> runCase(name, testCase)));
    }
    return tests;
  }

  private void runCase(String name, Map<String, Object> testCase) {
    Map<String, Object> input = SpecVectors.map(testCase, "input");
    Map<String, Object> expected = SpecVectors.map(testCase, "expected");

    String rendered = SpecVectors.string(input, "rendered");
    Map<String, Object> threadInputs = SpecVectors.map(input, "thread_inputs");

    Agent agent = buildAgent(threadInputs);
    List<Message> messages = Pipeline.parse(agent, rendered, null);
    messages = Threads.expand(messages, noncesIn(rendered, threadInputs), threadInputs);

    SpecVectors.assertMatches("[" + name + "] messages", expected.get("messages"), save(messages));
  }

  /**
   * Recover the nonce markers the renderer would have produced.
   *
   * <p>These vectors start from already-rendered text, so the markers are read back out of it rather
   * than generated — the point of the case is what the pipeline does with a marker, not how the
   * marker was chosen.
   */
  private static Map<String, String> noncesIn(String rendered, Map<String, Object> threadInputs) {
    Map<String, String> nonces = new LinkedHashMap<>();
    Matcher matcher = NONCE_MARKER.matcher(rendered);
    while (matcher.find()) {
      String property = matcher.group(2);
      if (threadInputs.containsKey(property)) {
        nonces.put(property, matcher.group());
      }
    }
    return nonces;
  }

  private static Agent buildAgent(Map<String, Object> threadInputs) {
    List<Object> declared = new ArrayList<>();
    for (String name : threadInputs.keySet()) {
      declared.add(Map.of("name", name, "kind", "thread"));
    }

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("kind", "prompt");
    data.put("name", "test");
    data.put("model", Map.of("id", "test"));
    data.put("instructions", "");
    data.put("inputs", declared);
    return Agent.load(data, new LoadContext(null, null));
  }

  /** Render messages as the vectors describe them: a role plus a list of content parts. */
  private static List<Object> save(List<Message> messages) {
    SaveContext context = new SaveContext("array", false);

    List<Object> saved = new ArrayList<>(messages.size());
    for (Message message : messages) {
      Map<String, Object> item = new LinkedHashMap<>(message.save(context));
      // The vectors call the parts "content", which is how every provider wire format names them.
      Object parts = item.remove("parts");
      item.put("content", parts);
      saved.add(item);
    }
    return saved;
  }

  /** Guards against a silent regression where every vector is skipped. */
  @org.junit.jupiter.api.Test
  void suiteIsComplete() {
    assertEquals(19, SpecVectors.readArray("parse/parse_vectors.json").size(), "parse vector count");
  }

  /**
   * A nonce that happens to be all digits must still validate.
   *
   * <p>Nonces are random hex, so roughly one in eighteen thousand comes out as digits only with a
   * leading zero. Attribute values are coerced to numbers where they parse, and that coercion drops
   * the leading zero, so the nonce no longer matches the one that was stamped and a perfectly
   * legitimate render is rejected as a prompt injection. This pins the case that made the agent
   * vectors fail intermittently.
   */
  @org.junit.jupiter.api.Test
  void allDigitNonceWithLeadingZeroStillValidates() {
    String nonce = "0123456789012345";
    List<Message> messages =
        com.microsoft.prompty.parsers.PromptyChatParser.parseChat(
            "system[nonce=\"" + nonce + "\"]:\nYou are helpful.", nonce);

    assertEquals(1, messages.size(), "expected the marker to be accepted");
    assertEquals(
        null, messages.get(0).metadata.get("nonce"), "the nonce must not leak into metadata");
  }

  /** A marker carrying the wrong nonce is still rejected once coercion is off. */
  @org.junit.jupiter.api.Test
  void mismatchedNonceIsStillRejected() {
    assertThrows(
        InvokerException.class,
        () ->
            com.microsoft.prompty.parsers.PromptyChatParser.parseChat(
                "system[nonce=\"0123456789012345\"]:\nHi", "0123456789012346"));
  }

  /**
   * Attribute-block forms that the sibling runtimes exercise must keep parsing.
   *
   * <p>The boundary pattern had to be rewritten to stop it backtracking (see {@link
   * com.microsoft.prompty.parsers.PromptyChatParser}), and the risk of any such rewrite is silently
   * narrowing the accepted syntax. These are the forms the Rust, Python and TypeScript parser tests
   * rely on, including a quoted value containing a comma — the case a naive fix breaks.
   */
  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(
      strings = {
        "user[name=\"Alice\"]",
        "assistant[name=\"Bot\",temperature=0.5]",
        "system[nonce=\"abc123\",name=\"Alice\"]",
        "user[name=\"Alice, Bob\"]",
        "user[a=x]",
        "user[a=x , b=y]"
      })
  void attributeFormsSharedWithSiblingRuntimesStillParse(String marker) {
    List<Message> messages =
        com.microsoft.prompty.parsers.PromptyChatParser.parseChat(marker + ":\nHello");

    assertEquals(1, messages.size(), "expected " + marker + " to be recognised as a role marker");
    assertEquals("Hello", textOf(messages.get(0)));
  }

  /**
   * An unterminated attribute block must not hang the parser.
   *
   * <p>Rendered text carries user-supplied values, so a marker-shaped line is attacker-influenced.
   * The original pattern let the value class swallow the separator and the closing bracket, so
   * {@code user[a= a= a= …} could be split across the attribute loop in exponentially many ways,
   * with each further repetition costing about four times the last.
   *
   * <p>The size is chosen so the two failure modes stay distinguishable. Eleven repetitions cost the
   * old pattern about twelve seconds, so the two-second bound fails clearly on a regression, and the
   * rewritten pattern returns in well under a millisecond, so the bound is never close on a healthy
   * build. Keeping the size small also matters because {@code assertTimeoutPreemptively} interrupts
   * the worker thread, and regex backtracking ignores interrupts — a regression therefore leaks a
   * busy thread until the match finishes on its own, which at this size is seconds rather than never.
   */
  @org.junit.jupiter.api.Test
  void unterminatedAttributeBlockIsRejectedWithoutBacktracking() {
    String attack = "user[a=" + " a=".repeat(11);

    List<Message> messages =
        org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(
            java.time.Duration.ofSeconds(2),
            () -> com.microsoft.prompty.parsers.PromptyChatParser.parseChat(attack));

    assertEquals(1, messages.size(), "an unterminated block is not a marker, so it stays content");
    assertEquals(attack, textOf(messages.get(0)));
  }

  private static String textOf(Message message) {
    return ((com.microsoft.prompty.model.TextPart) message.parts.get(0)).value;
  }
}
