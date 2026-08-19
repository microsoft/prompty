package com.microsoft.prompty.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.Messages;
import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.model.DelegatedStateReference;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EngineEventKind;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.EngineTurnStatus;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolOutcome;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.Role;
import com.microsoft.prompty.model.TurnCommit;
import com.microsoft.prompty.model.TurnEngineResult;
import com.microsoft.prompty.model.TypraJson;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Grades the Java turn engine against the shared cross-runtime turn vectors.
 *
 * <p>The vectors pin more than the final answer. They pin the exact ordered list of journal events,
 * which is what actually proves two runtimes agree: two engines can reach the same output through
 * completely different orderings of persistence and effects, and only one of those orderings is
 * resumable.
 */
@DisplayName("engine turn vectors")
final class EngineTurnVectorsTest {

  @Test
  @DisplayName("every canonical turn vector reproduces Rust's committed turn and event journal")
  void everyCanonicalTurnVectorReproducesTheReferenceRun() {
    Map<String, Object> file = asMap(SpecVectors.read("engine/turn_vectors.json"));
    assertEquals("1", file.get("version"), "vector file version");
    List<?> cases = (List<?>) file.get("cases");
    assertTrue(cases != null && !cases.isEmpty(), "vector file must define cases");

    for (Object entry : cases) {
      runVector(asMap(entry));
    }
  }

  private void runVector(Map<String, Object> vector) {
    String name = (String) vector.get("name");
    Map<String, Object> expected = asMap(vector.get("expected"));

    ScriptedModel model = new ScriptedModel(responses(vector.get("model")));
    RecordingTools tools = new RecordingTools(stringMap(vector.get("toolOutputs")));
    RecordingDurability durability = new RecordingDurability();
    RecordingPostCommit postCommit = new RecordingPostCommit();

    TurnEngineEffects effects =
        TurnEngineEffects.of(model)
            .withPermission(new VectorPermissions(stringSet(vector.get("denyTools"))))
            .withTools(tools)
            .withDurability(durability)
            .withPostCommit(postCommit)
            .withClock(() -> "1970-01-01T00:00:00Z")
            .withIds(new DefaultPorts.SequentialIds());

    TurnEngine engine = TurnEngine.of(effects);

    CancellationToken cancellation = CancellationToken.create();
    if (Boolean.TRUE.equals(vector.get("cancelBeforeRun"))) {
      cancellation.cancel();
    }

    TurnEngineResult result =
        engine.run(
            TurnEngineRequest.of(
                "session-" + name, "turn-" + name, messages(vector.get("messages"))),
            cancellation);

    TurnCommit commit = result.commit;
    assertEquals(
        EngineTurnStatus.fromValue((String) expected.get("status")),
        commit.status,
        name + " status");
    SpecVectors.assertEquivalent(name + " output", expected.get("output"), commit.output);
    assertEquals(intOf(expected.get("iterations")), commit.iterations, name + " iterations");
    assertEquals(
        intOf(expected.get("snapshots")), result.snapshots.size(), name + " snapshot count");
    assertEquals(
        intOf(expected.get("toolResults")), result.toolResults.size(), name + " tool result count");

    List<String> toolOrder = new ArrayList<>();
    for (ModelToolResult toolResult : result.toolResults) {
      toolOrder.add(toolResult.requestId);
    }
    assertEquals(stringList(expected.get("toolResultOrder")), toolOrder, name + " tool order");

    List<String> expectedPortability = stringList(expected.get("snapshotPortability"));
    if (!expectedPortability.isEmpty()) {
      List<String> actual = new ArrayList<>();
      for (var snapshot : result.snapshots) {
        actual.add(snapshot.contextState.portability.value);
      }
      assertEquals(expectedPortability, actual, name + " snapshot portability");
    }

    List<Integer> expectedPrefixes = intList(expected.get("snapshotStablePrefixes"));
    if (!expectedPrefixes.isEmpty()) {
      List<Integer> actual = new ArrayList<>();
      for (var snapshot : result.snapshots) {
        actual.add(snapshot.stablePrefixMessages);
      }
      assertEquals(expectedPrefixes, actual, name + " snapshot stable prefixes");
    }

    if (expected.get("commitPortability") != null) {
      assertEquals(
          expected.get("commitPortability"),
          commit.contextState.portability.value,
          name + " commit portability");
    }
    if (expected.get("delegatedState") != null) {
      assertEquals(
          intOf(expected.get("delegatedState")),
          commit.contextState.delegatedState.size(),
          name + " delegated state count");
    }

    // Gapless sequences are the invariant a replay depends on: a hole means an effect was
    // journalled that a resumed run would never see.
    for (int i = 1; i < durability.events.size(); i++) {
      assertEquals(
          durability.events.get(i - 1).sequence + 1,
          durability.events.get(i).sequence,
          name + " event sequence continuity at index " + i);
    }

    List<String> expectedKinds = stringList(expected.get("eventKinds"));
    if (!expectedKinds.isEmpty()) {
      List<String> actualKinds = new ArrayList<>();
      for (EngineEvent event : durability.events) {
        actualKinds.add(event.kind.value);
      }
      assertEquals(expectedKinds, actualKinds, name + " event kinds");
    }

    assertEquals(
        commit.status == EngineTurnStatus.SUCCESS ? 1 : 0,
        postCommit.effectIds.size(),
        name + " post-commit invocations");
    assertEquals(
        intOf(expected.get("snapshots")), model.requests.size(), name + " model invocations");
  }

  // ---------------------------------------------------------------- vector decoding

  private static List<Message> messages(Object value) {
    List<Message> messages = new ArrayList<>();
    if (value == null) {
      return messages;
    }
    for (Object entry : (List<?>) value) {
      Map<String, Object> map = asMap(entry);
      messages.add(
          Messages.withText(roleOf((String) map.get("role")), (String) map.get("content")));
    }
    return messages;
  }

  private static Role roleOf(String role) {
    return switch (role == null ? "" : role) {
      case "system" -> Role.SYSTEM;
      case "assistant" -> Role.ASSISTANT;
      case "tool" -> Role.TOOL;
      default -> Role.USER;
    };
  }

  private static Deque<ModelInvocationResponse> responses(Object value) {
    Deque<ModelInvocationResponse> responses = new ArrayDeque<>();
    if (value == null) {
      return responses;
    }
    for (Object entry : (List<?>) value) {
      responses.add(response(asMap(entry)));
    }
    return responses;
  }

  private static ModelInvocationResponse response(Map<String, Object> vector) {
    ModelInvocationResponse response = new ModelInvocationResponse();
    response.output = vector.get("output");

    response.assistantMessages = new ArrayList<>();
    if (vector.get("assistant") instanceof String text) {
      response.assistantMessages.add(Messages.assistant(text));
    }

    response.toolRequests = new ArrayList<>();
    if (vector.get("tools") instanceof List<?> tools) {
      for (Object entry : tools) {
        Map<String, Object> map = asMap(entry);
        ModelToolRequest request = new ModelToolRequest();
        request.id = (String) map.get("id");
        request.name = (String) map.get("name");
        request.arguments = map.get("arguments");
        response.toolRequests.add(request);
      }
    }

    Object portability = vector.get("nextPortability");
    Object delegated = vector.get("delegatedState");
    if (portability != null || delegated != null) {
      InvocationContextState state = new InvocationContextState();
      state.portability =
          portability == null
              ? InvocationContextPortability.PORTABLE
              : InvocationContextPortability.fromValue((String) portability);
      state.delegatedState = new ArrayList<>();
      if (delegated instanceof List<?> references) {
        for (Object entry : references) {
          Map<String, Object> map = asMap(entry);
          DelegatedStateReference reference = new DelegatedStateReference();
          reference.provider = (String) map.get("provider");
          reference.kind = (String) map.get("kind");
          reference.id = (String) map.get("id");
          state.delegatedState.add(reference);
        }
      }
      response.nextContextState = state;
    }
    return response;
  }

  // ---------------------------------------------------------------- vector ports

  /** Replays canned responses in order and records the requests it was given. */
  private static final class ScriptedModel implements Ports.ModelPort {
    private final Deque<ModelInvocationResponse> responses;
    private final List<ModelInvocationRequest> requests = new ArrayList<>();

    ScriptedModel(Deque<ModelInvocationResponse> responses) {
      this.responses = responses;
    }

    @Override
    public ModelInvocationResponse invoke(
        ModelInvocationRequest request,
        CancellationToken cancellation,
        Ports.ModelStreamPort stream) {
      requests.add(request);
      ModelInvocationResponse response = responses.poll();
      if (response == null) {
        throw PortException.of("scripted model response exhausted");
      }
      return response;
    }
  }

  /** Denies tools by name, mirroring the vectors' {@code denyTools} list. */
  private static final class VectorPermissions implements Ports.PermissionPort {
    private final Set<String> denied;

    VectorPermissions(Set<String> denied) {
      this.denied = denied;
    }

    @Override
    public EnginePermissionDecision authorize(
        ModelToolRequest request, CancellationToken cancellation) {
      boolean approved = !denied.contains(request.name);
      EnginePermissionDecision decision = new EnginePermissionDecision();
      decision.approved = approved;
      decision.reason = approved ? null : "denied by vector";
      return decision;
    }
  }

  /** Returns the vector's canned output for a request id, falling back to its arguments. */
  private static final class RecordingTools implements Ports.ToolPort {
    private final Map<String, String> outputs;
    private final List<String> calls = new ArrayList<>();

    RecordingTools(Map<String, String> outputs) {
      this.outputs = outputs;
    }

    @Override
    public ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation) {
      calls.add(request.id);
      ModelToolResult result = new ModelToolResult();
      result.requestId = request.id;
      result.name = request.name;
      result.outcome = ModelToolOutcome.SUCCESS;
      result.output =
          outputs.containsKey(request.id)
              ? outputs.get(request.id)
              : TypraJson.stringify(request.arguments);
      return result;
    }
  }

  /** Captures the journal so the test can assert the exact event ordering. */
  private static final class RecordingDurability implements Ports.DurabilityPort {
    private final List<EngineEvent> events = new ArrayList<>();
    private final List<EngineCheckpoint> checkpoints = new ArrayList<>();

    @Override
    public void append(EngineEvent event) {
      events.add(event);
    }

    @Override
    public void appendWithCheckpoint(List<EngineEvent> batch, EngineCheckpoint checkpoint) {
      events.addAll(batch);
      checkpoints.add(checkpoint);
    }
  }

  private static final class RecordingPostCommit implements Ports.PostCommitPort {
    private final List<String> effectIds = new ArrayList<>();

    @Override
    public void afterCommit(String effectId, TurnCommit commit, CancellationToken cancellation) {
      effectIds.add(effectId);
    }
  }

  // ---------------------------------------------------------------- coercion helpers

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object value) {
    return value == null ? new LinkedHashMap<>() : (Map<String, Object>) value;
  }

  private static int intOf(Object value) {
    return value == null ? 0 : ((Number) value).intValue();
  }

  private static List<String> stringList(Object value) {
    List<String> list = new ArrayList<>();
    if (value instanceof List<?> entries) {
      for (Object entry : entries) {
        list.add((String) entry);
      }
    }
    return list;
  }

  private static List<Integer> intList(Object value) {
    List<Integer> list = new ArrayList<>();
    if (value instanceof List<?> entries) {
      for (Object entry : entries) {
        list.add(((Number) entry).intValue());
      }
    }
    return list;
  }

  private static Map<String, String> stringMap(Object value) {
    Map<String, String> map = new HashMap<>();
    if (value instanceof Map<?, ?> entries) {
      for (Map.Entry<?, ?> entry : entries.entrySet()) {
        map.put((String) entry.getKey(), (String) entry.getValue());
      }
    }
    return map;
  }

  private static Set<String> stringSet(Object value) {
    return new HashSet<>(stringList(value));
  }
}
