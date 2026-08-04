package com.microsoft.prompty.harness;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.SpecVectors;
import com.microsoft.prompty.model.Checkpoint;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EngineEventKind;
import com.microsoft.prompty.model.HostToolRequest;
import com.microsoft.prompty.model.RunTurnRequest;
import com.microsoft.prompty.model.RunTurnResult;
import com.microsoft.prompty.model.RunTurnStatus;
import com.microsoft.prompty.model.TurnModelRequest;
import com.microsoft.prompty.model.TurnModelResponse;
import com.microsoft.prompty.model.TurnOptions;
import com.microsoft.prompty.model.TypraJson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.io.TempDir;

/**
 * Grades the reference turn runner against the shared replay vectors.
 *
 * <p>The vectors are normalized journal strings rather than raw records, so they assert the shape a
 * host observes — which events fire, in what order, carrying which identifying detail — without
 * pinning timestamps or ids that differ legitimately between runtimes.
 */
class ReplayVectorsTest {

  private static final String VECTORS = "harness/replay_vectors.json";

  @TempDir Path tempDir;

  @TestFactory
  List<DynamicTest> replayVectors() throws IOException {
    String clock = string(suite(), "clock");
    String sessionId = string(suite(), "sessionId");
    String turnId = string(suite(), "turnId");

    List<DynamicTest> tests = new ArrayList<>();
    for (Object raw : (List<?>) suite().get("scenarios")) {
      @SuppressWarnings("unchecked")
      Map<String, Object> scenario = (Map<String, Object>) raw;
      String name = string(scenario, "name");
      tests.add(
          DynamicTest.dynamicTest(
              name, () -> runScenario(scenario, name, clock, sessionId, turnId)));
    }
    assertFalse(tests.isEmpty(), "replay vectors must not be empty");
    return tests;
  }

  private void runScenario(
      Map<String, Object> scenario, String name, String clock, String sessionId, String turnId)
      throws IOException {
    Path journalPath = tempDir.resolve(name + ".jsonl");
    Outcome outcome = run(scenario, name, clock, sessionId, turnId, journalPath);

    @SuppressWarnings("unchecked")
    List<String> expected = (List<String>) scenario.get("expected");
    assertEquals(expected, normalizeJournal(journalPath), "normalized journal for " + name);
  }

  /** Runs one scenario end to end and returns everything a caller can observe. */
  private Outcome run(
      Map<String, Object> scenario,
      String name,
      String clock,
      String sessionId,
      String turnId,
      Path journalPath) {
    CollectingEventSink sink = new CollectingEventSink();
    JsonlEventJournalWriter journal = new JsonlEventJournalWriter(journalPath);
    InMemoryCheckpointStore checkpoints = new InMemoryCheckpointStore();

    boolean denied = "permission_denied".equals(name);
    var resolver =
        denied
            ? new DenyAllPermissionResolver()
            : (com.microsoft.prompty.model.PermissionResolver) new AllowAllPermissionResolver();

    FunctionHostToolExecutor tools =
        new FunctionHostToolExecutor()
            .with(
                "add",
                (arguments, request) -> {
                  double a = number(arguments.get("a"));
                  double b = number(arguments.get("b"));
                  return new LinkedHashMap<String, Object>(Map.of("sum", a + b));
                })
            .with(
                "fail",
                (arguments, request) -> {
                  throw new IllegalStateException("tool exploded");
                });

    ReferenceTurnRunner runner =
        new ReferenceTurnRunner(
            sink,
            journal,
            checkpoints,
            resolver,
            tools,
            request -> modelFor(name, request),
            ReferenceTurnRunner.fixedClock(clock),
            ReferenceTurnRunner.sequentialIds());

    RunTurnRequest request = new RunTurnRequest();
    request.sessionId = sessionId;
    request.turnId = turnId;
    @SuppressWarnings("unchecked")
    Map<String, Object> inputs = (Map<String, Object>) scenario.get("inputs");
    request.inputs = inputs == null ? Map.of() : inputs;

    TurnOptions options = new TurnOptions();
    Object maxIterations = scenario.get("maxIterations");
    options.maxIterations = maxIterations == null ? 3 : (int) number(maxIterations);
    request.options = options;

    return new Outcome(runner.run(request), sink, checkpoints);
  }

  private record Outcome(
      RunTurnResult result, CollectingEventSink sink, InMemoryCheckpointStore checkpoints) {}

  /**
   * The scripted model each scenario runs against.
   *
   * <p>Deliberately trivial: the vectors grade the runner's projection and durability ordering, so
   * anything the model decides for itself would be noise in the comparison.
   */
  private static TurnModelResponse modelFor(String scenario, TurnModelRequest request) {
    TurnModelResponse response = new TurnModelResponse();

    if ("no_tool".equals(scenario)) {
      Object name = request.inputs == null ? null : request.inputs.get("name");
      response.output = new LinkedHashMap<String, Object>(Map.of("text", "hello " + name));
      response.checkpointState = new LinkedHashMap<>(Map.of("stable", true));
      return response;
    }

    if (request.iteration == 0) {
      HostToolRequest tool = new HostToolRequest();
      tool.requestId = "exec-1";
      tool.toolCallId = "call-1";
      tool.toolName = "tool_failure".equals(scenario) ? "fail" : "add";
      tool.arguments = new LinkedHashMap<>(Map.of("a", 2, "b", 3));
      response.toolRequests = List.of(tool);
      response.checkpointState = new LinkedHashMap<>(Map.of("stable", true));
      return response;
    }

    // Later iterations echo what the tool round produced, so a mis-threaded result shows up as a
    // wrong answer rather than being silently discarded.
    Map<String, Object> output = new LinkedHashMap<>();
    List<com.microsoft.prompty.model.HostToolResult> results =
        request.toolResults == null ? List.of() : request.toolResults;
    if (!results.isEmpty()) {
      var first = results.get(0);
      output.put("toolResult", first.result);
      output.put("errorKind", first.errorKind);
    }
    response.output = output;
    response.checkpointState = new LinkedHashMap<>(Map.of("stable", true));
    return response;
  }

  /**
   * Collapses a journal file into the comparable strings the vectors declare.
   *
   * <p>Timestamps and generated ids are dropped on purpose: they are correct-by-construction here
   * and differ between runtimes for reasons that say nothing about behaviour.
   */
  private static List<String> normalizeJournal(Path path) throws IOException {
    List<String> normalized = new ArrayList<>();
    for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
      if (line.isBlank()) {
        continue;
      }
      Map<String, Object> record = asMap(TypraJson.parse(line));
      String kind = String.valueOf(record.get("kind"));
      switch (kind) {
        case "summary" -> {
          Map<String, Object> summary = asMap(record.get("summary"));
          normalized.add(
              "summary:"
                  + summary.get("sessionId")
                  + ":"
                  + summary.get("status")
                  + ":turns="
                  + intOf(summary.get("turns"))
                  + ":checkpoints="
                  + intOf(summary.get("checkpoints")));
        }
        case "session" -> {
          Map<String, Object> event = asMap(record.get("event"));
          Map<String, Object> payload = asMap(event.get("payload"));
          String type = String.valueOf(event.get("type"));
          StringBuilder text =
              new StringBuilder("session:")
                  .append(type)
                  .append(':')
                  .append(event.get("sessionId"))
                  .append(':')
                  .append(event.get("turnId"));
          if ("session_end".equals(type)) {
            text.append(':').append(payload.get("status"));
          }
          normalized.add(text.toString());
        }
        case "turn" -> {
          Map<String, Object> event = asMap(record.get("event"));
          Map<String, Object> payload = asMap(event.get("payload"));
          String type = String.valueOf(event.get("type"));
          StringBuilder text =
              new StringBuilder("turn:")
                  .append(type)
                  .append(':')
                  .append(intOf(event.get("iteration")));
          switch (type) {
            case "permission_requested" -> text.append(':').append(payload.get("requestId"));
            case "permission_completed" -> text.append(':').append(payload.get("approved"));
            case "tool_execution_start" -> text.append(':').append(payload.get("toolName"));
            case "tool_execution_complete", "tool_result" -> {
              text.append(':').append(payload.get("toolName"));
              text.append(':').append(payload.get("success"));
              if (payload.get("errorKind") != null) {
                text.append(':').append(payload.get("errorKind"));
              }
            }
            case "error" -> text.append(':').append(payload.get("errorKind"));
            case "turn_end" -> text.append(':').append(payload.get("status"));
            default -> {
              // Every other turn event is identified by type and iteration alone.
            }
          }
          normalized.add(text.toString());
        }
        default -> throw new IllegalStateException("unknown journal record kind: " + kind);
      }
    }
    return normalized;
  }

  @Test
  void runnerEmitsJournalsAndCheckpoints() throws IOException {
    Path journalPath = tempDir.resolve("direct.jsonl");
    Outcome outcome =
        run(
            Map.of("name", "tool_success"),
            "tool_success",
            string(suite(), "clock"),
            "session-1",
            "turn-1",
            journalPath);

    assertEquals(RunTurnStatus.SUCCESS, outcome.result().status);
    assertEquals(2, outcome.result().iterations, "one tool round plus the answering iteration");

    List<Checkpoint> saved = outcome.checkpoints().listCheckpoints("session-1");
    assertEquals(2, saved.size(), "a checkpoint per completed model invocation");
    assertEquals("turn-1-checkpoint-0", saved.get(0).id);
    assertEquals("turn-1-checkpoint-1", saved.get(1).id);
    assertEquals(1, saved.get(0).checkpointNumber);
    assertEquals(
        Boolean.TRUE,
        saved.get(0).state.get("stable"),
        "the model's own checkpoint state is merged into the saved state");

    assertEquals(
        List.of("session_start", "checkpoint_created", "checkpoint_created", "session_end"),
        outcome.sink().sessionEvents().stream().map(event -> event.type.value).toList());

    assertTrue(
        outcome.sink().turnEvents().stream().anyMatch(event -> event.type.value.equals("tool_result")),
        "the tool result reaches the host");
  }

  @Test
  void toolResultsReachTheCaller() throws IOException {
    Outcome outcome =
        run(
            Map.of("name", "tool_success"),
            "tool_success",
            string(suite(), "clock"),
            "session-1",
            "turn-1",
            tempDir.resolve("results.jsonl"));

    assertEquals(1, outcome.result().toolResults.size());
    var result = outcome.result().toolResults.get(0);
    assertEquals("add", result.toolName);
    assertEquals(Boolean.TRUE, result.success);
    assertEquals(5.0, number(asMap(result.result).get("sum")), 1e-9);
  }

  @Test
  void deniedToolNeverReachesTheExecutor() throws IOException {
    Outcome outcome =
        run(
            Map.of("name", "permission_denied"),
            "permission_denied",
            string(suite(), "clock"),
            "session-1",
            "turn-1",
            tempDir.resolve("denied.jsonl"));

    assertEquals(1, outcome.result().toolResults.size());
    var result = outcome.result().toolResults.get(0);
    assertEquals(Boolean.FALSE, result.success);
    assertEquals("permission_denied", result.errorKind);
    assertTrue(
        outcome.sink().turnEvents().stream()
            .noneMatch(event -> event.type.value.equals("tool_execution_start")),
        "a denied tool must not be started");
  }

  @Test
  void maxIterationsReportsAReadableMessage() throws IOException {
    Path journalPath = tempDir.resolve("max.jsonl");
    Outcome outcome =
        run(
            Map.of("name", "max_iterations", "maxIterations", 1),
            "max_iterations",
            string(suite(), "clock"),
            "session-1",
            "turn-1",
            journalPath);

    assertEquals(RunTurnStatus.ERROR, outcome.result().status);
    assertEquals("Maximum turn iterations reached", asMap(outcome.result().output).get("message"));

    // A host reading the journal and a host reading the return value must be told the same thing;
    // the normalized vectors compare only the status, so the message itself is checked here.
    Map<String, Object> turnEnd = payloadOf(journalPath, "turn", "turn_end");
    assertEquals(
        "Maximum turn iterations reached",
        asMap(turnEnd.get("response")).get("message"),
        "the journal carries the same message the caller receives");

    Map<String, Object> error = payloadOf(journalPath, "turn", "error");
    assertEquals("max_iterations", error.get("errorKind"));
    assertEquals("Maximum turn iterations reached", error.get("message"));
  }

  /** The payload of the first journal record of the given kind and type. */
  private static Map<String, Object> payloadOf(Path path, String kind, String type)
      throws IOException {
    for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
      if (line.isBlank()) {
        continue;
      }
      Map<String, Object> record = asMap(TypraJson.parse(line));
      if (!kind.equals(record.get("kind"))) {
        continue;
      }
      Map<String, Object> event = asMap(record.get("event"));
      if (type.equals(event.get("type"))) {
        return asMap(event.get("payload"));
      }
    }
    throw new AssertionError("no " + kind + " record of type " + type + " in the journal");
  }

  @Test
  void messagesUpdatedSurvivesAQuietConversationPort() {
    // The engine currently pairs every tool commit with a conversation update, so this rule is
    // exercised directly rather than through a turn that cannot separate the two.
    EngineCheckpoint settled = new EngineCheckpoint();
    assertTrue(
        ReferenceTurnRunner.shouldRecordMessagesUpdated(
            List.of(event(EngineEventKind.TOOL_RESULT_COMMITTED)), settled),
        "a finished tool round notifies the host even without a conversation update");
    assertTrue(
        ReferenceTurnRunner.shouldRecordMessagesUpdated(
            List.of(event(EngineEventKind.CONVERSATION_UPDATED)), settled),
        "a conversation update notifies the host on its own");

    EngineCheckpoint awaitingTool = new EngineCheckpoint();
    awaitingTool.pendingToolRequests = List.of(new com.microsoft.prompty.model.ModelToolRequest());
    assertFalse(
        ReferenceTurnRunner.shouldRecordMessagesUpdated(
            List.of(event(EngineEventKind.TOOL_RESULT_COMMITTED)), awaitingTool),
        "a round with a tool still outstanding is not finished");

    EngineCheckpoint awaitingModel = new EngineCheckpoint();
    awaitingModel.pendingModelResponse = new com.microsoft.prompty.model.ModelInvocationResponse();
    assertFalse(
        ReferenceTurnRunner.shouldRecordMessagesUpdated(
            List.of(event(EngineEventKind.TOOL_RESULT_COMMITTED)), awaitingModel),
        "a round with a model response still to apply is not finished");

    assertFalse(
        ReferenceTurnRunner.shouldRecordMessagesUpdated(
            List.of(event(EngineEventKind.POLICY_APPLIED)), settled),
        "unrelated events do not notify the host");
  }

  private static EngineEvent event(EngineEventKind kind) {
    EngineEvent event = new EngineEvent();
    event.kind = kind;
    return event;
  }

  @Test
  void journalCloseIsIdempotent() {
    JsonlEventJournalWriter journal = new JsonlEventJournalWriter(tempDir.resolve("close.jsonl"));
    com.microsoft.prompty.model.SessionSummary summary =
        new com.microsoft.prompty.model.SessionSummary();
    summary.sessionId = "session-1";
    assertTrue(journal.close(summary), "the first close writes the summary");
    assertFalse(journal.close(summary), "a second close must not append a second summary");
  }

  @Test
  void journalRecordsAreLfTerminatedOnEveryPlatform() throws Exception {
    // Rust's writeln! always emits LF. Normalization reads lines and so cannot see the terminator,
    // which is exactly why this has to be asserted on the raw bytes.
    Path path = tempDir.resolve("terminators.jsonl");
    JsonlEventJournalWriter journal = new JsonlEventJournalWriter(path);
    com.microsoft.prompty.model.SessionSummary summary =
        new com.microsoft.prompty.model.SessionSummary();
    summary.sessionId = "session-1";
    journal.close(summary);

    String raw = Files.readString(path, java.nio.charset.StandardCharsets.UTF_8);
    assertFalse(raw.contains("\r"), "journal lines must be LF-terminated, never CRLF");
    assertTrue(raw.endsWith("\n"), "every journal record ends with a newline");
  }

  @Test
  void unknownToolIsReportedRatherThanThrown() {
    HostToolRequest request = new HostToolRequest();
    request.requestId = "exec-1";
    request.toolName = "nope";
    var result = new FunctionHostToolExecutor().execute(request);

    assertEquals(Boolean.FALSE, result.success);
    assertEquals("not_found", result.errorKind);
    assertNotNull(result.result);
    assertEquals("No host tool registered for 'nope'", asMap(result.result).get("message"));
  }

  @Test
  void throwingToolIsReportedAsAnException() {
    HostToolRequest request = new HostToolRequest();
    request.requestId = "exec-1";
    request.toolName = "boom";
    var result =
        new FunctionHostToolExecutor()
            .with(
                "boom",
                (arguments, ignored) -> {
                  throw new IllegalStateException("tool exploded");
                })
            .execute(request);

    assertEquals(Boolean.FALSE, result.success);
    assertEquals("exception", result.errorKind);
    assertEquals("tool exploded", asMap(result.result).get("message"));
  }

  @Test
  void checkpointsListInIdOrder() {
    InMemoryCheckpointStore store = new InMemoryCheckpointStore();
    for (String id : List.of("turn-1-checkpoint-2", "turn-1-checkpoint-0", "turn-1-checkpoint-1")) {
      Checkpoint checkpoint = new Checkpoint();
      checkpoint.id = id;
      checkpoint.sessionId = "session-1";
      store.save(checkpoint);
    }
    Checkpoint other = new Checkpoint();
    other.id = "turn-1-checkpoint-0";
    other.sessionId = "session-2";
    store.save(other);

    assertEquals(
        List.of("turn-1-checkpoint-0", "turn-1-checkpoint-1", "turn-1-checkpoint-2"),
        store.listCheckpoints("session-1").stream().map(checkpoint -> checkpoint.id).toList());
    assertEquals(1, store.listCheckpoints("session-2").size(), "sessions do not share checkpoints");
    assertTrue(store.listCheckpoints("absent").isEmpty());
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> suite() throws IOException {
    return (Map<String, Object>) SpecVectors.read(VECTORS);
  }

  private static String string(Map<String, Object> source, String key) {
    return String.valueOf(source.get(key));
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
  }

  private static double number(Object value) {
    return value instanceof Number n ? n.doubleValue() : 0.0;
  }

  private static int intOf(Object value) {
    return value instanceof Number n ? n.intValue() : 0;
  }
}


