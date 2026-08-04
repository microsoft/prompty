package com.microsoft.prompty.anthropic;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.Messages;
import com.microsoft.prompty.Streams;
import com.microsoft.prompty.VectorAgents;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.ToolCall;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Covers request shaping the shared vectors leave ungraded.
 *
 * <p>There are only five Anthropic wire vectors, so most of the conversion is reached by no fixture
 * at all. These tests aim at the parts a plausible refactor could change without a vector noticing:
 * how several system messages combine, how options merge, and how a message's metadata reshapes it.
 */
class WireMessageTest {

  private static Message message(String role, String text, Map<String, Object> metadata) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("role", role);
    data.put("parts", List.of(Map.of("kind", "text", "value", text)));
    if (metadata != null) {
      data.put("metadata", metadata);
    }
    return Message.load(data, new LoadContext());
  }

  private static Prompty plainAgent() {
    return VectorAgents.buildAgent(new LinkedHashMap<>(), "claude-3", "anthropic");
  }

  // ------------------------------------------------------------- system

  @Test
  void severalSystemMessagesAreJoinedWithABlankLine() {
    Map<String, Object> body =
        Wire.buildChatArgs(
            plainAgent(),
            List.of(
                message("system", "First rule.", null),
                message("system", "Second rule.", null),
                message("user", "hi", null)));

    // The blank line is what keeps two instructions from reading as one run-on sentence.
    assertEquals("First rule.\n\nSecond rule.", body.get("system"));
  }

  @Test
  void developerMessagesJoinTheSystemPromptRatherThanTheConversation() {
    Map<String, Object> body =
        Wire.buildChatArgs(
            plainAgent(),
            List.of(
                message("system", "Be brief.", null),
                message("developer", "Never guess.", null),
                message("user", "hi", null)));

    assertEquals("Be brief.\n\nNever guess.", body.get("system"));
    // Anthropic has no system role in the message list, so both must have left it.
    List<?> messages = assertInstanceOf(List.class, body.get("messages"));
    assertEquals(1, messages.size());
    assertEquals("user", assertInstanceOf(Map.class, messages.get(0)).get("role"));
  }

  @Test
  void aPromptWithNoSystemMessageSendsNoSystemField() {
    Map<String, Object> body = Wire.buildChatArgs(plainAgent(), List.of(message("user", "hi", null)));
    assertFalse(body.containsKey("system"));
  }

  @Test
  void toolRoleMessagesBecomeUserTurns() {
    Map<String, Object> body = Wire.buildChatArgs(plainAgent(), List.of(message("tool", "42", null)));
    // A tool ran on the model's behalf, so its output is the caller speaking.
    assertEquals("user", Streams.pointer(body, "messages", 0, "role"));
  }

  // ------------------------------------------------------------- metadata reshaping

  @Test
  void aBatchOfToolResultsReplacesTheMessageContentWholesale() {
    List<Object> results =
        List.of(Map.of("type", "tool_result", "tool_use_id", "toolu_1", "content", "sunny"));
    Map<String, Object> body =
        Wire.buildChatArgs(
            plainAgent(),
            List.of(message("user", "ignored", Map.<String, Object>of("tool_results", results))));

    assertEquals(results, Streams.pointer(body, "messages", 0, "content"));
  }

  @Test
  void aSingleToolResultIsWrappedAsAToolResultBlock() {
    Map<String, Object> body =
        Wire.buildChatArgs(
            plainAgent(),
            List.of(message("user", "sunny", Map.<String, Object>of("tool_use_id", "toolu_1"))));

    assertEquals("tool_result", Streams.pointer(body, "messages", 0, "content", 0, "type"));
    assertEquals("toolu_1", Streams.pointer(body, "messages", 0, "content", 0, "tool_use_id"));
    assertEquals("sunny", Streams.pointer(body, "messages", 0, "content", 0, "content"));
  }

  @Test
  void anEmptyToolUseIdIsStillTreatedAsAToolResult() {
    // Present-but-empty means the caller built a broken message. Reinterpreting it as ordinary
    // content would hide that behind a confusing success instead of a clear rejection.
    Map<String, Object> body =
        Wire.buildChatArgs(
            plainAgent(),
            List.of(message("user", "x", Map.<String, Object>of("tool_use_id", ""))));
    assertEquals("tool_result", Streams.pointer(body, "messages", 0, "content", 0, "type"));
  }

  @Test
  void rawAssistantBlocksAreReplayedVerbatim() {
    List<Object> blocks =
        List.of(Map.of("type", "thinking", "thinking", "hmm", "signature", "sig-abc"));
    Map<String, Object> body =
        Wire.buildChatArgs(
            plainAgent(),
            List.of(message("assistant", "ignored", Map.<String, Object>of("content", blocks))));

    // A thinking block's signature only validates against the exact bytes Anthropic produced, so
    // re-deriving the block from the message text would break the replay.
    assertEquals(blocks, Streams.pointer(body, "messages", 0, "content"));
  }

  // ------------------------------------------------------------- parts

  @Test
  void remoteImagesAreSentByUrlAndLocalOnesAsBase64() {
    Map<String, Object> remote =
        Wire.messageToWire(
            imageMessage("https://example.com/cat.png", null));
    assertEquals("url", Streams.pointer(remote, "content", 0, "source", "type"));
    assertEquals("https://example.com/cat.png", Streams.pointer(remote, "content", 0, "source", "url"));

    Map<String, Object> local = Wire.messageToWire(imageMessage("aGVsbG8=", "image/jpeg"));
    assertEquals("base64", Streams.pointer(local, "content", 0, "source", "type"));
    assertEquals("image/jpeg", Streams.pointer(local, "content", 0, "source", "media_type"));
    assertEquals("aGVsbG8=", Streams.pointer(local, "content", 0, "source", "data"));
  }

  @Test
  void anUndeclaredMediaTypeDefaultsButABlankOneIsSentAsGiven() {
    assertEquals(
        "image/png",
        Streams.pointer(Wire.messageToWire(imageMessage("aGVsbG8=", null)), "content", 0, "source", "media_type"));
    // Guessing a type the caller explicitly blanked out risks labelling the bytes wrongly, which
    // yields a garbled image rather than an error.
    assertEquals(
        "",
        Streams.pointer(Wire.messageToWire(imageMessage("aGVsbG8=", "")), "content", 0, "source", "media_type"));
  }

  @Test
  void audioAndFilePartsDegradeToVisiblePlaceholders() {
    for (Map.Entry<String, String> entry :
        Map.of("audio", "[audio content not supported by Anthropic]",
                "file", "[file content not supported by Anthropic]")
            .entrySet()) {
      Map<String, Object> data = new LinkedHashMap<>();
      data.put("role", "user");
      data.put("parts", List.of(Map.of("kind", entry.getKey(), "source", "x")));
      Map<String, Object> wire = Wire.messageToWire(Message.load(data, new LoadContext()));

      // Silently dropping the part would leave the model answering a question it cannot see.
      assertEquals("text", Streams.pointer(wire, "content", 0, "type"));
      assertEquals(entry.getValue(), Streams.pointer(wire, "content", 0, "text"));
    }
  }

  private static Message imageMessage(String source, String mediaType) {
    Map<String, Object> part = new LinkedHashMap<>();
    part.put("kind", "image");
    part.put("source", source);
    if (mediaType != null) {
      part.put("mediaType", mediaType);
    }
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("role", "user");
    data.put("parts", List.of(part));
    return Message.load(data, new LoadContext());
  }

  // ------------------------------------------------------------- options

  @Test
  void additionalPropertiesFillGapsWithoutOverridingDeclaredOptions() {
    Prompty agent =
        VectorAgents.buildAgent(
            Map.<String, Object>of(
                "options",
                Map.of(
                    "temperature",
                    0.5,
                    "additionalProperties",
                    Map.of("temperature", 0.9, "top_logprobs", 3))),
            "claude-3",
            "anthropic");

    Map<String, Object> body = Wire.buildChatArgs(agent, List.of());
    // A declared option is the author's explicit intent; an escape-hatch property is a fallback for
    // things the model has no field for, so it must not quietly win.
    assertEquals(0.5, ((Number) body.get("temperature")).doubleValue(), 1e-9);
    assertEquals(3, ((Number) body.get("top_logprobs")).intValue());
  }

  @Test
  void anExplicitMaxTokensReplacesTheDefault() {
    Prompty agent =
        VectorAgents.buildAgent(
            Map.<String, Object>of("options", Map.of("maxOutputTokens", 512)),
            "claude-3",
            "anthropic");
    assertEquals(512, ((Number) Wire.buildChatArgs(agent, List.of()).get("max_tokens")).intValue());
  }

  @Test
  void temperatureSurvivesAsTheAuthorWroteIt() {
    Prompty agent =
        VectorAgents.buildAgent(
            Map.<String, Object>of("options", Map.of("temperature", 0.7)), "claude-3", "anthropic");
    // Widening a 32-bit 0.7 to a double naively yields 0.699999988079071 on the wire.
    assertEquals("0.7", String.valueOf(Wire.buildChatArgs(agent, List.of()).get("temperature")));
  }

  // ------------------------------------------------------------- tool replay

  @Test
  void aNonEmptyAssistantTurnIsReplayedWithItsBlocksIntact() {
    List<Object> blocks =
        List.of(
            Map.of("type", "text", "text", "Let me check."),
            Map.of("type", "tool_use", "id", "toolu_1", "name", "get_weather", "input", Map.of()));
    ToolCall call = new ToolCall();
    call.id = "toolu_1";
    call.name = "get_weather";

    List<Message> messages =
        Wire.formatToolMessages(Map.of("content", blocks), List.of(call), List.of("sunny"));

    assertEquals(blocks, Messages.metadata(messages.get(0)).get("content"));
  }

  @Test
  void theReplayedBlocksAreCopiedRatherThanAliased() {
    Map<String, Object> block = new LinkedHashMap<>();
    block.put("type", "text");
    block.put("text", "hi");
    List<Object> blocks = new ArrayList<>(List.of(block));
    ToolCall call = new ToolCall();
    call.id = "toolu_1";

    List<Message> messages =
        Wire.formatToolMessages(Map.of("content", blocks), List.of(call), List.of("ok"));
    Object stored = Messages.metadata(messages.get(0)).get("content");

    // The metadata outlives the response object; sharing any node of it would let a caller that
    // reuses the response silently rewrite a message already sent.
    assertNotSame(blocks, stored);
    blocks.clear();
    List<?> storedList = assertInstanceOf(List.class, stored);
    assertEquals(1, storedList.size());

    // The nested block has to be copied too — duplicating only the outer list would leave the
    // block maps aliased, which is the case a shallow copy quietly misses.
    block.put("text", "rewritten");
    assertEquals("hi", Streams.pointer(stored, 0, "text"));
  }

  @Test
  void aResponseWithNoContentStillProducesTheTwoTurnShape() {
    ToolCall call = new ToolCall();
    call.id = "toolu_1";
    List<Message> messages = Wire.formatToolMessages(Map.of(), List.of(call), List.of("ok"));

    assertEquals(2, messages.size());
    assertTrue(assertInstanceOf(List.class, Messages.metadata(messages.get(0)).get("content")).isEmpty());
  }

  // ------------------------------------------------------------- streamed replay

  @Test
  void aDeltaWithNoPrecedingBlockStartStillProducesAValidBlock() {
    // Anthropic always sends content_block_start first, but a replayed or trimmed capture may not.
    // The reconstructed block still has to be one the API will accept on the next request.
    List<Object> chunks =
        List.of(
            delta(0, Map.of("type", "text_delta", "text", "hi")),
            delta(1, Map.of("type", "thinking_delta", "thinking", "hmm")),
            delta(2, Map.of("type", "signature_delta", "signature", "sig-abc")));

    List<?> blocks = replayBlocks(chunks);

    assertEquals(Map.of("type", "text", "text", "hi"), blocks.get(0));
    assertEquals(Map.of("type", "thinking", "thinking", "hmm"), blocks.get(1));
    // A thinking block is rejected without its `thinking` field, so a signature arriving alone has
    // to seed one rather than produce `{type: thinking, signature: ...}`.
    assertEquals(Map.of("type", "thinking", "thinking", "", "signature", "sig-abc"), blocks.get(2));
  }

  @Test
  void thinkingTextAndSignatureAccumulateIntoTheSameBlock() {
    List<Object> chunks =
        List.of(
            delta(0, Map.of("type", "thinking_delta", "thinking", "one ")),
            delta(0, Map.of("type", "thinking_delta", "thinking", "two")),
            delta(0, Map.of("type", "signature_delta", "signature", "sig-abc")));

    // The signature only validates against the exact thinking text it was produced for, so both
    // have to land on one block in the order they arrived.
    assertEquals(
        Map.of("type", "thinking", "thinking", "one two", "signature", "sig-abc"),
        replayBlocks(chunks).get(0));
  }

  private static List<?> replayBlocks(List<Object> chunks) {
    List<Message> messages = Wire.formatStreamToolMessages(chunks, List.of(), List.of(), "");
    return assertInstanceOf(List.class, Messages.metadata(messages.get(0)).get("content"));
  }

  private static Map<String, Object> delta(int index, Map<String, Object> delta) {
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("type", "content_block_delta");
    event.put("index", index);
    event.put("delta", delta);
    return event;
  }
}
