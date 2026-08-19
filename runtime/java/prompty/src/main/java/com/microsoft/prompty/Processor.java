package com.microsoft.prompty;

import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.StreamChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Turns a provider's raw response into a usable result.
 *
 * <p>Registered under the {@code prompty.processors} group, keyed by {@code agent.model.provider}.
 */
public interface Processor {

  /**
   * Extract the usable result from a raw provider response.
   *
   * <p>What "usable" means is provider- and API-shaped: assistant text for a chat completion, an
   * embedding vector for an embedding call, structured data when the agent declares outputs.
   *
   * @throws InvokerException with {@link InvokerException.Kind#PROCESS} if the response cannot be
   *     interpreted
   */
  Object process(Agent agent, Object response);

  /**
   * Convert a raw streaming response into typed chunks.
   *
   * @throws InvokerException with {@link InvokerException.Kind#PROCESS} if streaming is unsupported
   */
  default Iterator<StreamChunk> processStream(Agent agent, Iterator<Object> response) {
    throw InvokerException.process("Streaming not supported by this processor");
  }

  /**
   * Map a raw response onto the generated live-invocation contract.
   *
   * <p>The default runs {@link #process} and then recognises the established
   * {@code {id, name, arguments}} tool-call shape, so an existing processor participates in the turn
   * engine without changes. It reports the resulting context as portable, because a processor that
   * has not opted in cannot be holding provider-side state. A provider with native continuation
   * support should override this and return a typed delegated state reference instead.
   */
  default ModelInvocationResponse processWithContext(
      Agent agent, Object response, ModelInvocationRequest request) {
    Object output = process(agent, response);
    List<ModelToolRequest> toolRequests = legacyToolRequests(output);
    ModelInvocationResponse result = new ModelInvocationResponse();
    result.output = toolRequests.isEmpty() ? output : null;
    result.assistantMessages = legacyAssistantMessages(output, toolRequests);
    result.toolRequests = toolRequests;
    result.nextContextState = portableState();
    return result;
  }

  /**
   * Map a raw response without running {@link #process}.
   *
   * <p>Preserves raw execution semantics — the caller asked for the provider's own words — while
   * still producing the contract the turn engine consumes.
   */
  default ModelInvocationResponse processRawWithContext(
      Agent agent, Object response, ModelInvocationRequest request) {
    ModelInvocationResponse result = new ModelInvocationResponse();
    result.output = response;
    result.assistantMessages = legacyAssistantMessages(response, List.of());
    result.toolRequests = new ArrayList<>();
    result.nextContextState = portableState();
    return result;
  }

  private static InvocationContextState portableState() {
    InvocationContextState state = new InvocationContextState();
    state.portability = InvocationContextPortability.PORTABLE;
    state.delegatedState = new ArrayList<>();
    return state;
  }

  /**
   * Recognise tool calls in a processed output that predates the typed contract.
   *
   * <p>Accepts a list of {@code {id, name, arguments}} maps, which is what every processor written
   * against the pre-contract shape produces.
   */
  private static List<ModelToolRequest> legacyToolRequests(Object output) {
    List<ModelToolRequest> requests = new ArrayList<>();
    if (!(output instanceof List<?> list)) {
      return requests;
    }
    for (Object item : list) {
      if (!(item instanceof Map<?, ?> map)) {
        return new ArrayList<>();
      }
      Object id = map.get("id");
      Object name = map.get("name");
      Object arguments = map.get("arguments");
      if (!(id instanceof String) || !(name instanceof String) || arguments == null) {
        return new ArrayList<>();
      }
      ModelToolRequest request = new ModelToolRequest();
      request.id = (String) id;
      request.name = (String) name;
      request.arguments = arguments;
      requests.add(request);
    }
    return requests;
  }

  /**
   * The assistant message implied by a processed output.
   *
   * <p>Always exactly one message, because a turn the model took is a turn that has to appear in the
   * conversation the next request is built from. A tool-call round carries empty text and records
   * the calls under a {@code tool_calls} metadata key; anything that is not already text is
   * stringified rather than dropped.
   */
  private static List<Message> legacyAssistantMessages(
      Object output, List<ModelToolRequest> toolRequests) {
    String content;
    if (output instanceof String text) {
      content = text;
    } else if (!toolRequests.isEmpty()) {
      content = "";
    } else {
      content = output == null ? "null" : String.valueOf(output);
    }

    Message assistant = Messages.assistant(content);
    if (!toolRequests.isEmpty()) {
      List<Object> toolCalls = new ArrayList<>();
      for (ModelToolRequest request : toolRequests) {
        Object arguments = request.arguments;
        String encoded =
            arguments instanceof String text ? text : arguments == null ? "{}" : String.valueOf(arguments);
        toolCalls.add(
            Map.of(
                "id", request.id,
                "type", "function",
                "function", Map.of("name", request.name, "arguments", encoded)));
      }
      Messages.metadata(assistant).put("tool_calls", toolCalls);
    }
    return new ArrayList<>(List.of(assistant));
  }
}
