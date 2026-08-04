package com.microsoft.prompty.harness;

import com.microsoft.prompty.CancellationToken;
import com.microsoft.prompty.engine.ContextPipeline;
import com.microsoft.prompty.engine.PortException;
import com.microsoft.prompty.engine.Ports;
import com.microsoft.prompty.engine.TurnEngine;
import com.microsoft.prompty.engine.TurnEngineEffects;
import com.microsoft.prompty.engine.TurnEngineRequest;
import com.microsoft.prompty.model.Checkpoint;
import com.microsoft.prompty.model.CheckpointStore;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EngineEventKind;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.EngineTurnStatus;
import com.microsoft.prompty.model.EventJournalWriter;
import com.microsoft.prompty.model.EventSink;
import com.microsoft.prompty.model.HostToolExecutor;
import com.microsoft.prompty.model.HostToolRequest;
import com.microsoft.prompty.model.HostToolResult;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolOutcome;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.PermissionDecision;
import com.microsoft.prompty.model.PermissionRequest;
import com.microsoft.prompty.model.PermissionResolver;
import com.microsoft.prompty.model.RunTurnRequest;
import com.microsoft.prompty.model.RunTurnResult;
import com.microsoft.prompty.model.RunTurnStatus;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.SessionEvent;
import com.microsoft.prompty.model.SessionEventType;
import com.microsoft.prompty.model.SessionSummary;
import com.microsoft.prompty.model.SessionSummaryStatus;
import com.microsoft.prompty.model.TurnEvent;
import com.microsoft.prompty.model.TurnEventType;
import com.microsoft.prompty.model.TurnModelRequest;
import com.microsoft.prompty.model.TurnModelResponse;
import com.microsoft.prompty.model.TurnOptions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * Runs one turn through the canonical engine against the host-facing protocol types.
 *
 * <p>The engine speaks in ports; a host speaks in event sinks, journals, checkpoint stores,
 * permission resolvers, and tool executors. This runner is the translation between the two, and it
 * exists so that a host implementing the five documented protocols gets the real engine — the same
 * loop, the same durability ordering, the same cancellation semantics — rather than a simplified
 * one written for convenience.
 *
 * <p>It is also what the shared replay vectors grade. Because the clock and id generator are
 * injected, a run produces a byte-identical journal every time, which is what makes cross-runtime
 * comparison meaningful.
 */
public final class ReferenceTurnRunner {

  /** Invokes the model for one iteration. */
  public interface ModelCallback extends Function<TurnModelRequest, TurnModelResponse> {}

  private final EventSink eventSink;
  private final EventJournalWriter journal;
  private final CheckpointStore checkpointStore;
  private final PermissionResolver permissionResolver;
  private final HostToolExecutor hostToolExecutor;
  private final ModelCallback invokeModel;
  private final Ports.Clock clock;
  private final Ports.IdGenerator ids;

  public ReferenceTurnRunner(
      EventSink eventSink,
      EventJournalWriter journal,
      CheckpointStore checkpointStore,
      PermissionResolver permissionResolver,
      HostToolExecutor hostToolExecutor,
      ModelCallback invokeModel,
      Ports.Clock clock,
      Ports.IdGenerator ids) {
    this.eventSink = eventSink;
    this.journal = journal;
    this.checkpointStore = checkpointStore;
    this.permissionResolver = permissionResolver;
    this.hostToolExecutor = hostToolExecutor;
    this.invokeModel = invokeModel;
    this.clock = clock;
    this.ids = ids;
  }

  /** Run one turn to completion. */
  public RunTurnResult run(RunTurnRequest request) {
    TurnOptions options = request.options == null ? new TurnOptions() : request.options;
    int maxIterations = Math.max(0, options.maxIterations == null ? 10 : options.maxIterations);
    Map<String, Object> inputs = request.inputs == null ? Map.of() : request.inputs;

    State state = new State();
    Durability durability = new Durability(state, options, inputs);

    TurnEngineEffects effects =
        TurnEngineEffects.of(new Model(state, options, inputs))
            .withPermission(new Permission(state))
            .withTools(new Tools(state))
            .withDurability(durability)
            .withClock(clock)
            .withIds(ids);

    TurnEngineRequest engineRequest =
        TurnEngineRequest.of(request.sessionId, request.turnId, List.of());
    engineRequest.inputs = inputs;
    engineRequest.maxIterations = maxIterations;
    // A zero-iteration turn has nothing left to decide, so the engine must not wait for a model to
    // declare the output final.
    engineRequest.finalOutputReady = maxIterations == 0;
    // The reference model callback is a plain function: a second attempt would call it again with
    // the same arguments and get the same answer, so retrying only hides the failure.
    engineRequest.maxModelAttempts = 1;

    var engineResult = new TurnEngine(ContextPipeline.appendOnly(), effects).run(engineRequest, new CancellationToken());

    if (state.adapterFailure != null) {
      throw new IllegalStateException(state.adapterFailure);
    }

    RunTurnStatus status =
        switch (engineResult.commit.status) {
          case SUCCESS -> RunTurnStatus.SUCCESS;
          case CANCELLED -> RunTurnStatus.CANCELLED;
          default -> RunTurnStatus.ERROR;
        };

    Object output = engineResult.commit.output;
    if (status == RunTurnStatus.ERROR && "max_iterations".equals(errorKind(output))) {
      // The engine reports the reason it stopped; a caller wants the message it can show. The
      // reason survives on the error event either way.
      output = new LinkedHashMap<>(Map.of("message", "Maximum turn iterations reached"));
    }

    SessionSummary summary = new SessionSummary();
    summary.sessionId = request.sessionId;
    summary.status =
        status == RunTurnStatus.SUCCESS ? SessionSummaryStatus.SUCCESS : SessionSummaryStatus.ERROR;
    summary.turns = 1;
    summary.checkpoints = state.checkpoints.size();
    journal.close(summary);

    RunTurnResult result = new RunTurnResult();
    result.sessionId = request.sessionId;
    result.turnId = request.turnId;
    result.status = status;
    result.output = output;
    result.iterations = engineResult.commit.iterations;
    result.toolResults = List.copyOf(state.allResults);
    result.checkpoints = List.copyOf(state.checkpoints);
    return result;
  }

  /** State shared between the port adapters for the duration of one run. */
  private static final class State {
    /** Results the model has not yet been shown. Drained on the next invocation. */
    final List<HostToolResult> pendingResults = new ArrayList<>();

    /** Every result produced during the turn, for the caller. */
    final List<HostToolResult> allResults = new ArrayList<>();

    final List<Checkpoint> checkpoints = new ArrayList<>();

    /** Permission requests projected from events, keyed by engine tool request id. */
    final Map<String, PermissionRequest> permissionRequests = new ConcurrentHashMap<>();

    /**
     * The first adapter failure, if any.
     *
     * <p>Held rather than thrown so the engine can finish unwinding: a port that throws mid-turn
     * would skip the durability writes that explain what went wrong.
     */
    volatile String adapterFailure;

    synchronized void fail(String message) {
      if (adapterFailure == null) {
        adapterFailure = message;
      }
    }

    synchronized List<HostToolResult> drainPending() {
      List<HostToolResult> drained = List.copyOf(pendingResults);
      pendingResults.clear();
      return drained;
    }

    synchronized void record(HostToolResult result) {
      pendingResults.add(result);
      allResults.add(result);
    }

    synchronized HostToolResult pendingFor(String requestId) {
      for (HostToolResult result : pendingResults) {
        if (requestId.equals(result.requestId)) {
          return result;
        }
      }
      return null;
    }
  }

  private final class Model implements Ports.ModelPort {
    private final State state;
    private final TurnOptions options;
    private final Map<String, Object> inputs;

    Model(State state, TurnOptions options, Map<String, Object> inputs) {
      this.state = state;
      this.options = options;
      this.inputs = inputs;
    }

    @Override
    public ModelInvocationResponse invoke(
        ModelInvocationRequest request, CancellationToken cancellation, Ports.ModelStreamPort stream) {
      TurnModelRequest modelRequest = new TurnModelRequest();
      modelRequest.sessionId = request.context.sessionId;
      modelRequest.turnId = request.context.turnId;
      modelRequest.iteration = request.context.iteration;
      modelRequest.inputs = inputs;
      modelRequest.options = options;
      modelRequest.toolResults = state.drainPending();

      TurnModelResponse response;
      try {
        response = invokeModel.apply(modelRequest);
      } catch (RuntimeException e) {
        String message = "reference model callback: " + describe(e);
        state.fail(message);
        throw PortException.of(message);
      }

      ModelInvocationResponse invocation = new ModelInvocationResponse();
      invocation.output = response.output;
      invocation.assistantMessages = List.of();

      List<ModelToolRequest> toolRequests = new ArrayList<>();
      List<HostToolRequest> hosts = response.toolRequests == null ? List.of() : response.toolRequests;
      for (int index = 0; index < hosts.size(); index++) {
        HostToolRequest host = hosts.get(index);
        ModelToolRequest tool = new ModelToolRequest();
        tool.id =
            firstNonNull(
                host.requestId,
                host.toolCallId,
                "reference-tool-" + request.context.iteration + "-" + index);
        tool.name = host.toolName;
        tool.arguments = host.arguments;
        // The engine works in its own tool vocabulary, so the host request rides along in metadata
        // rather than being reconstructed later from fields the engine may have normalized.
        tool.metadata = new LinkedHashMap<>(Map.of("hostToolRequest", host.save(new SaveContext())));
        toolRequests.add(tool);
      }
      invocation.toolRequests = toolRequests;
      invocation.metadata =
          new LinkedHashMap<>(Map.of("referenceResponse", response.save(new SaveContext())));
      return invocation;
    }
  }

  private final class Permission implements Ports.PermissionPort {
    private final State state;

    Permission(State state) {
      this.state = state;
    }

    @Override
    public EnginePermissionDecision authorize(
        ModelToolRequest request, CancellationToken cancellation) {
      PermissionRequest permission = state.permissionRequests.get(request.id);
      if (permission == null) {
        throw PortException.configuration(
            "permission request '" + request.id + "' was not projected");
      }
      PermissionDecision decision;
      try {
        decision = permissionResolver.request(permission);
      } catch (RuntimeException e) {
        String message = "reference permission resolver: " + describe(e);
        state.fail(message);
        throw PortException.of(message);
      }

      if (!Boolean.TRUE.equals(decision.approved)) {
        // A refusal is an answer, not an error: the model asked to run something and is told no, in
        // the same shape a tool failure would take, so it can adapt rather than stall.
        HostToolRequest host = hostRequest(request);
        HostToolResult denied = new HostToolResult();
        denied.requestId = host.requestId == null ? request.id : host.requestId;
        denied.toolCallId = host.toolCallId;
        denied.toolName = host.toolName;
        denied.success = false;
        denied.result =
            new LinkedHashMap<>(
                Map.of("message", decision.reason == null ? "Permission denied" : decision.reason));
        denied.errorKind = "permission_denied";
        state.record(denied);
      }

      EnginePermissionDecision engineDecision = new EnginePermissionDecision();
      engineDecision.approved = decision.approved;
      engineDecision.reason = decision.reason;
      engineDecision.metadata =
          new LinkedHashMap<>(Map.of("permissionDecision", decision.save(new SaveContext())));
      return engineDecision;
    }
  }

  private final class Tools implements Ports.ToolPort {
    private final State state;

    Tools(State state) {
      this.state = state;
    }

    @Override
    public ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation) {
      HostToolRequest host = hostRequest(request);
      HostToolResult result;
      try {
        result = hostToolExecutor.execute(host);
      } catch (RuntimeException e) {
        String message = "reference host tool executor: " + describe(e);
        state.fail(message);
        throw PortException.configuration(message);
      }
      state.record(result);

      ModelToolResult engineResult = new ModelToolResult();
      engineResult.requestId = request.id;
      engineResult.name = request.name;
      engineResult.outcome =
          Boolean.TRUE.equals(result.success) ? ModelToolOutcome.SUCCESS : ModelToolOutcome.FAILED;
      engineResult.output = result.result;
      engineResult.errorKind = result.errorKind;
      engineResult.metadata =
          new LinkedHashMap<>(Map.of("hostToolResult", result.save(new SaveContext())));
      return engineResult;
    }
  }

  private final class Durability implements Ports.DurabilityPort {
    private final State state;
    private final TurnOptions options;
    private final Map<String, Object> inputs;

    Durability(State state, TurnOptions options, Map<String, Object> inputs) {
      this.state = state;
      this.options = options;
      this.inputs = inputs;
    }

    @Override
    public void append(EngineEvent event) {
      project(event);
    }

    @Override
    public void appendWithCheckpoint(List<EngineEvent> events, EngineCheckpoint checkpoint) {
      for (EngineEvent event : events) {
        project(event);
        if (event.kind == EngineEventKind.MODEL_INVOCATION_COMPLETED
            || event.kind == EngineEventKind.MODEL_INVOCATION_RECONCILED) {
          saveModelCheckpoint(event);
        }
      }

      if (shouldRecordMessagesUpdated(events, checkpoint)) {
        List<Object> results = new ArrayList<>();
        synchronized (state) {
          for (HostToolResult result : state.pendingResults) {
            results.add(result.save(new SaveContext()));
          }
        }
        recordTurn(
            TurnEventType.MESSAGES_UPDATED,
            checkpoint.turnId,
            checkpoint.iteration == null ? 0 : checkpoint.iteration,
            new LinkedHashMap<>(Map.of("toolResults", results)));
      }
    }

    private void project(EngineEvent event) {
      int iteration = event.iteration == null ? 0 : event.iteration;
      Map<String, Object> payload = asMap(event.payload);

      switch (event.kind) {
        case TURN_STARTED -> {
          recordSession(
              SessionEventType.SESSION_START,
              event.sessionId,
              event.turnId,
              map("sessionId", event.sessionId, "schemaVersion", "1"));
          Map<String, Object> turnStart = new LinkedHashMap<>();
          turnStart.put("inputs", payload.getOrDefault("inputs", inputs));
          turnStart.put("maxIterations", payload.get("maxIterations"));
          recordTurn(TurnEventType.TURN_START, event.turnId, 0, turnStart);
        }
        case MODEL_INVOCATION_STARTED ->
            recordTurn(
                TurnEventType.LLM_START,
                event.turnId,
                iteration,
                map("attempt", payload.get("attempt")));
        case MODEL_INVOCATION_COMPLETED, MODEL_INVOCATION_RECONCILED ->
            recordTurn(TurnEventType.LLM_COMPLETE, event.turnId, iteration, new LinkedHashMap<>());
        case PERMISSION_REQUESTED -> {
          ModelToolRequest toolRequest =
              ModelToolRequest.load(payload.get("toolRequest"), new LoadContext());
          HostToolRequest host = hostRequest(toolRequest);
          PermissionRequest permission = buildPermissionRequest(host);
          state.permissionRequests.put(toolRequest.id, permission);
          recordTurn(
              TurnEventType.PERMISSION_REQUESTED,
              event.turnId,
              iteration,
              permission.save(new SaveContext()));
        }
        case PERMISSION_RESOLVED -> {
          Object decision =
              asMap(asMap(asMap(payload.get("decision")).get("metadata")).get("permissionDecision"));
          recordTurn(TurnEventType.PERMISSION_COMPLETED, event.turnId, iteration, decision);
        }
        case TOOL_EXECUTION_STARTED -> {
          ModelToolRequest toolRequest =
              ModelToolRequest.load(payload.get("toolRequest"), new LoadContext());
          recordTurn(
              TurnEventType.TOOL_EXECUTION_START,
              event.turnId,
              iteration,
              hostRequest(toolRequest).save(new SaveContext()));
        }
        case TOOL_EXECUTION_COMPLETED -> {
          ModelToolResult toolResult =
              ModelToolResult.load(payload.get("toolResult"), new LoadContext());
          HostToolResult host = hostResultOrNull(toolResult);
          if (host == null) {
            // A result the host never produced has nothing to report; the engine's own event
            // already records that the execution finished.
            return;
          }
          recordTurn(
              TurnEventType.TOOL_EXECUTION_COMPLETE,
              event.turnId,
              iteration,
              host.save(new SaveContext()));
        }
        case TOOL_RESULT_COMMITTED -> {
          ModelToolResult toolResult =
              ModelToolResult.load(payload.get("toolResult"), new LoadContext());
          HostToolResult host = hostResult(toolResult);
          recordTurn(
              TurnEventType.TOOL_RESULT, event.turnId, iteration, host.save(new SaveContext()));
        }
        case TURN_COMMITTED, TURN_FAILED, TURN_CANCELLED, TURN_RECONCILIATION_REQUIRED ->
            projectTurnEnd(event, payload);
        default -> {
          // The remaining engine events are internal bookkeeping with no host-facing counterpart.
        }
      }
    }

    private void projectTurnEnd(EngineEvent event, Map<String, Object> payload) {
      if (state.adapterFailure != null) {
        // The run is already doomed and the caller will be told why. Writing a tidy end record here
        // would claim the turn concluded normally.
        return;
      }
      int iterations = state.checkpoints.size();
      RunTurnStatus status =
          switch (event.kind) {
            case TURN_COMMITTED -> RunTurnStatus.SUCCESS;
            case TURN_CANCELLED -> RunTurnStatus.CANCELLED;
            default -> RunTurnStatus.ERROR;
          };

      Object output = payload.get("output");
      Object errorPayload = output;
      if ("max_iterations".equals(errorKind(output))) {
        errorPayload =
            map("errorKind", "max_iterations", "message", "Maximum turn iterations reached");
        output = map("message", "Maximum turn iterations reached");
      }

      if (event.kind == EngineEventKind.TURN_FAILED) {
        recordTurn(TurnEventType.ERROR, event.turnId, iterations, errorPayload);
      }
      recordTurn(
          TurnEventType.TURN_END,
          event.turnId,
          iterations,
          map("iterations", iterations, "status", status.value, "response", output));
      recordSession(
          SessionEventType.SESSION_END,
          event.sessionId,
          event.turnId,
          map("sessionId", event.sessionId, "status", status.value, "reason", "turn_complete"));
    }

    private void saveModelCheckpoint(EngineEvent event) {
      int iteration = event.iteration == null ? 0 : event.iteration;
      Map<String, Object> payload = asMap(event.payload);
      TurnModelResponse response =
          TurnModelResponse.load(
              asMap(payload.get("metadata")).get("referenceResponse"), new LoadContext());

      Map<String, Object> checkpointState = new LinkedHashMap<>();
      checkpointState.put("iteration", iteration);
      checkpointState.put("output", response.output);
      List<Object> toolRequests = new ArrayList<>();
      if (response.toolRequests != null) {
        for (HostToolRequest request : response.toolRequests) {
          toolRequests.add(request.save(new SaveContext()));
        }
      }
      checkpointState.put("toolRequests", toolRequests);
      if (response.checkpointState != null) {
        // The model gets the last word on its own resumable state; the fields above are what the
        // runner needs to reconstruct a turn, not a claim about what the model considers durable.
        checkpointState.putAll(response.checkpointState);
      }

      Checkpoint checkpoint = new Checkpoint();
      checkpoint.id = event.turnId + "-checkpoint-" + iteration;
      checkpoint.sessionId = event.sessionId;
      checkpoint.turnId = event.turnId;
      checkpoint.checkpointNumber = iteration + 1;
      checkpoint.title = "Turn " + event.turnId + " iteration " + iteration;
      checkpoint.state = checkpointState;
      checkpoint.createdAt = clock.now();

      Checkpoint saved;
      try {
        saved = checkpointStore.save(checkpoint);
      } catch (RuntimeException e) {
        throw PortException.of("reference checkpoint store: " + describe(e));
      }
      synchronized (state) {
        state.checkpoints.add(saved);
      }
      recordSession(
          SessionEventType.CHECKPOINT_CREATED,
          event.sessionId,
          event.turnId,
          map("checkpointId", saved.id, "checkpointNumber", saved.checkpointNumber));
    }

    private PermissionRequest buildPermissionRequest(HostToolRequest request) {
      PermissionRequest permission = new PermissionRequest();
      permission.requestId =
          request.requestId == null ? ids.nextId("permission") : request.requestId + "-permission";
      permission.toolCallId = request.toolCallId;
      permission.permission = "tool.execute";
      permission.target = request.toolName;
      permission.details = request.save(new SaveContext());
      return permission;
    }

    private HostToolResult hostResult(ModelToolResult result) {
      HostToolResult host = hostResultOrNull(result);
      if (host != null) {
        return host;
      }
      // A denied request never reached the executor, so the engine result carries no host metadata;
      // the refusal we already recorded is the answer.
      HostToolResult pending = state.pendingFor(result.requestId);
      if (pending == null) {
        throw PortException.of("engine tool result is missing hostToolResult metadata");
      }
      return pending;
    }

    private void recordTurn(TurnEventType type, String turnId, int iteration, Object payload) {
      TurnEvent event = new TurnEvent();
      event.id = ids.nextId("turn-event");
      event.type = type;
      event.timestamp = clock.now();
      event.turnId = turnId;
      event.iteration = iteration;
      event.payload = asMap(payload);
      eventSink.emitTurn(event);
      journal.appendTurn(event);
    }

    private void recordSession(
        SessionEventType type, String sessionId, String turnId, Object payload) {
      SessionEvent event = new SessionEvent();
      event.id = ids.nextId("session-event");
      event.type = type;
      event.timestamp = clock.now();
      event.sessionId = sessionId;
      event.turnId = turnId;
      event.payload = asMap(payload);
      eventSink.emitSession(event);
      journal.appendSession(event);
    }
  }

  /** A clock that always reports the same instant, so a replay is byte-identical. */
  public static Ports.Clock fixedClock(String timestamp) {
    return () -> timestamp;
  }

  /** An id generator that numbers each kind from one, so a replay is byte-identical. */
  public static Ports.IdGenerator sequentialIds() {
    AtomicLong counter = new AtomicLong();
    return kind -> kind + "-" + counter.incrementAndGet();
  }

  /**
   * Whether a batch of engine events concluded something the host should be told its messages
   * changed for.
   *
   * <p>Two independent reasons, because they mean different things. A conversation update says the
   * message list moved. A finished tool round says every request the model made has an answer and
   * nothing is outstanding — which is the moment a host can safely render or persist the thread.
   *
   * <p>Today's engine emits a conversation update alongside every tool commit, so the second arm
   * never decides the outcome on its own. It is kept because deriving "the round is over" from "the
   * engine happened to also say the messages changed" would break silently the day the engine
   * batches those events differently, and a host that had been notified would simply stop being
   * notified.
   */
  static boolean shouldRecordMessagesUpdated(List<EngineEvent> events, EngineCheckpoint checkpoint) {
    if (anyKind(events, EngineEventKind.CONVERSATION_UPDATED)) {
      return true;
    }
    boolean toolRoundEnded =
        anyKind(events, EngineEventKind.TOOL_EXECUTION_COMPLETED)
            || anyKind(events, EngineEventKind.TOOL_RESULT_COMMITTED);
    return toolRoundEnded
        && isEmpty(checkpoint.pendingToolRequests)
        && checkpoint.pendingModelResponse == null;
  }

  private static HostToolRequest hostRequest(ModelToolRequest request) {
    Object raw = request.metadata == null ? null : request.metadata.get("hostToolRequest");
    if (raw == null) {
      throw PortException.configuration("engine tool request is missing hostToolRequest metadata");
    }
    return HostToolRequest.load(raw, new LoadContext());
  }

  private static HostToolResult hostResultOrNull(ModelToolResult result) {
    Object raw = result.metadata == null ? null : result.metadata.get("hostToolResult");
    return raw == null ? null : HostToolResult.load(raw, new LoadContext());
  }

  private static String errorKind(Object output) {
    Object kind = asMap(output).get("errorKind");
    return kind instanceof String text ? text : null;
  }

  private static boolean anyKind(List<EngineEvent> events, EngineEventKind kind) {
    for (EngineEvent event : events) {
      if (event.kind == kind) {
        return true;
      }
    }
    return false;
  }

  private static boolean isEmpty(List<?> values) {
    return values == null || values.isEmpty();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object value) {
    if (value instanceof Map<?, ?> map) {
      return (Map<String, Object>) map;
    }
    return new LinkedHashMap<>();
  }

  private static Map<String, Object> map(Object... pairs) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      result.put(String.valueOf(pairs[i]), pairs[i + 1]);
    }
    return result;
  }

  /**
   * Returns the first non-null value. Rust chains {@code Option::or_else}, which only falls through
   * on {@code None} — an explicitly empty id is used verbatim rather than skipped.
   */
  private static String firstNonNull(String... values) {
    for (String value : values) {
      if (value != null) {
        return value;
      }
    }
    return "";
  }

  private static String describe(Throwable error) {
    return error.getMessage() == null ? error.toString() : error.getMessage();
  }

  /** Builder-free convenience for the common wiring. */
  public static ReferenceTurnRunner of(
      EventSink eventSink,
      EventJournalWriter journal,
      CheckpointStore checkpointStore,
      PermissionResolver permissionResolver,
      HostToolExecutor hostToolExecutor,
      ModelCallback invokeModel) {
    return new ReferenceTurnRunner(
        eventSink,
        journal,
        checkpointStore,
        permissionResolver,
        hostToolExecutor,
        invokeModel,
        new com.microsoft.prompty.engine.DefaultPorts.SystemClock(),
        sequentialIds());
  }
}

