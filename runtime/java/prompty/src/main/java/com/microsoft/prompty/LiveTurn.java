package com.microsoft.prompty;

import com.microsoft.prompty.engine.ContextPipeline;
import com.microsoft.prompty.engine.HostPolicyException;
import com.microsoft.prompty.engine.ModelStreamChunk;
import com.microsoft.prompty.engine.PortException;
import com.microsoft.prompty.engine.Ports;
import com.microsoft.prompty.engine.ToolResults;
import com.microsoft.prompty.engine.TurnEngine;
import com.microsoft.prompty.engine.TurnEngineEffects;
import com.microsoft.prompty.engine.TurnEngineException;
import com.microsoft.prompty.engine.TurnEngineRequest;
import com.microsoft.prompty.model.EngineCheckpoint;
import com.microsoft.prompty.model.EngineEvent;
import com.microsoft.prompty.model.EngineEventKind;
import com.microsoft.prompty.model.EnginePermissionDecision;
import com.microsoft.prompty.model.EngineTurnStatus;
import com.microsoft.prompty.model.ErrorChunk;
import com.microsoft.prompty.model.FinalOutputPolicyRequest;
import com.microsoft.prompty.model.FinalOutputPolicyResult;
import com.microsoft.prompty.model.HostPolicyRequest;
import com.microsoft.prompty.model.HostPolicyResult;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.LoadContext;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationRequest;
import com.microsoft.prompty.model.ModelInvocationResponse;
import com.microsoft.prompty.model.ModelToolOutcome;
import com.microsoft.prompty.model.ModelToolRequest;
import com.microsoft.prompty.model.ModelToolResult;
import com.microsoft.prompty.model.Prompty;
import com.microsoft.prompty.model.RetryPolicyRequest;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.StreamChunk;
import com.microsoft.prompty.model.TextChunk;
import com.microsoft.prompty.model.ThinkingChunk;
import com.microsoft.prompty.model.ToolCall;
import com.microsoft.prompty.model.ToolChunk;
import com.microsoft.prompty.model.TurnEngineResult;
import com.microsoft.prompty.model.TypraJson;
import com.microsoft.prompty.model.UsageChunk;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Runs a live turn by binding the runtime's providers and extensions onto the canonical engine.
 *
 * <p>The engine does no I/O of its own — it decides what should happen and asks a port to make it
 * happen. Everything here is one of those ports: the executor and processor behind
 * {@link Ports.ModelPort}, guardrails and trimming and steering behind {@link Ports.HostPolicyPort},
 * tool dispatch behind {@link Ports.ToolPort}. Keeping the adaptation here rather than in the
 * engine is what lets the same loop drive a live provider and a deterministic replay.
 *
 * <p>Live events are projected from durable engine events rather than emitted alongside them, so a
 * caller watching the turn sees exactly what was committed, in commit order.
 */
final class LiveTurn {

  /** Numbers the anonymous sessions created for turns the caller did not name. */
  private static final AtomicLong TURN_IDS = new AtomicLong();

  private LiveTurn() {}

  /** Run a turn for an unnamed, non-resumable session. */
  static Object turn(Prompty agent, Map<String, Object> inputs, TurnOptions options) {
    long number = TURN_IDS.incrementAndGet();
    TurnEngineRequest request =
        TurnEngineRequest.of("legacy-session-" + number, "legacy-turn-" + number, List.of());
    request.inputs = inputs == null ? new LinkedHashMap<String, Object>() : inputs;
    return turn(agent, request, options);
  }

  /** Run a turn against a caller-owned engine request, which may resume a durable checkpoint. */
  static Object turn(Prompty agent, TurnEngineRequest request, TurnOptions options) {
    TurnOptions opts = options == null ? TurnOptions.defaults() : options;
    Events events = new Events(opts.onEvent());

    try (Tracer.Span span = Tracer.start("turn")) {
      span.emit("signature", "prompty.turn");

      Object inputs = request.inputs == null ? new LinkedHashMap<String, Object>() : request.inputs;
      request.inputs = inputs;
      span.emit("inputs", inputs);

      if (opts.parallelToolCalls()) {
        // The engine commits one effect at a time so a resumed turn replays tool results in the
        // order they were journaled. Running them concurrently would make that order depend on
        // scheduling, which is exactly what durability cannot tolerate.
        String message =
            "parallel_tool_calls=true is not supported by the canonical engine; tool effects "
                + "execute sequentially for deterministic durable ordering";
        events.emit(new AgentEvent.TurnStart(agent.name, opts.maxIterations()));
        events.emit(new AgentEvent.Error(message));
        events.emit(new AgentEvent.TurnEnd("error", 0, null));
        span.emit("error", message);
        throw InvokerException.validation(message);
      }

      String provider = Pipeline.provider(agent);
      boolean streaming = Pipeline.isStreaming(agent);
      boolean agentMode =
          !opts.tools().isEmpty() || (agent.tools != null && !agent.tools.isEmpty());

      Failures failures = new Failures();
      AtomicBoolean skipOutputGuardrail = new AtomicBoolean(false);

      request.maxIterations =
          agentMode ? opts.maxIterations() : Math.max(opts.maxIterations(), 1);
      request.maxModelAttempts = Math.max(opts.maxLlmRetries(), 1);

      Durability durability =
          new Durability(
              events,
              agent.name,
              provider,
              agent.model == null || agent.model.id == null || agent.model.id.isEmpty()
                  ? null
                  : agent.model.id,
              opts.maxIterations(),
              agentMode,
              opts.durability());

      TurnEngineEffects effects =
          TurnEngineEffects.of(
                  new LiveModel(
                      agent,
                      provider,
                      streaming,
                      opts.raw() && !agentMode,
                      agentMode,
                      skipOutputGuardrail,
                      failures))
              .withStream(new LiveStream(events))
              .withPolicy(
                  new LivePolicy(
                      agent,
                      inputs,
                      opts,
                      // A resumed turn already has its prepared conversation in the checkpoint;
                      // re-preparing would discard the tool exchange it was resumed to continue.
                      request.startIteration > 0
                          || request.policyAppliedForIteration
                          || !request.messages.isEmpty(),
                      skipOutputGuardrail,
                      failures))
              .withRetry(new LiveRetry(events, failures))
              .withConversation(new LiveConversation(provider, failures))
              .withPermission(
                  opts.permission() != null
                      ? opts.permission()
                      : new LivePermission(agent, opts.guardrails()))
              .withTools(new LiveTool(agent, inputs, opts.tools(), events))
              .withDurability(durability);

      if (opts.postCommit() != null) {
        effects = effects.withPostCommit(opts.postCommit());
      }

      TurnEngine engine = new TurnEngine(ContextPipeline.appendOnly(), effects);

      Object result;
      try {
        result = finish(engine.run(request, opts.cancellation()), opts, failures);
      } catch (TurnEngineException failure) {
        durability.finishUncommittedError();
        InvokerException recorded = failures.takeInvoker();
        throw recorded != null ? recorded : InvokerException.execute(failure.getMessage(), failure);
      } catch (InvokerException failure) {
        durability.finishUncommittedError();
        throw failure;
      }

      span.emit("result", result);
      return result;
    }
  }

  /** Map a committed turn onto the value a caller expects, or the failure it describes. */
  private static Object finish(TurnEngineResult result, TurnOptions opts, Failures failures) {
    EngineTurnStatus status = result.commit.status;

    if (status == EngineTurnStatus.SUCCESS) {
      return result.commit.output;
    }

    if (status == EngineTurnStatus.CANCELLED) {
      throw InvokerException.cancelled(failures.cancellationReasonOr("Operation cancelled"));
    }

    Object output = result.commit.output;
    String errorKind = stringAt(output, "errorKind", "engine_error");
    String message = stringAt(output, "message", "Turn failed");

    switch (errorKind) {
      case "prepare_error" -> throw orElse(failures.takeInvoker(), InvokerException.other(message));
      case "output_validation_failed" -> throw InvokerException.validation(message);
      case "model_error" -> throw InvokerException.retryExhausted(
          "LLM call failed after " + opts.maxLlmRetries() + " retries: " + message,
          result.commit.messages == null ? List.of() : result.commit.messages);
      case "model_outcome_unknown" -> throw orElse(
          failures.takeInvoker(), InvokerException.execute(message));
      case "max_iterations" -> throw InvokerException.execute(
          "Agent loop exceeded max iterations (" + opts.maxIterations() + ")");
      default -> throw InvokerException.execute(message);
    }
  }

  private static InvokerException orElse(InvokerException recorded, InvokerException fallback) {
    return recorded != null ? recorded : fallback;
  }

  private static String stringAt(Object value, String key, String fallback) {
    if (value instanceof Map<?, ?> map && map.get(key) instanceof String text && !text.isEmpty()) {
      return text;
    }
    return fallback;
  }

  // -------------------------------------------------------------------------
  // Event fan-out
  // -------------------------------------------------------------------------

  /**
   * Delivers events to the caller's listener.
   *
   * <p>A listener that throws is ignored on purpose: observing a turn must not be able to change
   * it, and a broken progress display is not a reason to abandon work the model already did.
   */
  private static final class Events {
    private final AgentEvent.Listener listener;

    Events(AgentEvent.Listener listener) {
      this.listener = listener;
    }

    void emit(AgentEvent event) {
      if (listener == null) {
        return;
      }
      try {
        listener.onEvent(event);
      } catch (RuntimeException ignored) {
        // Observation must not perturb execution.
      }
    }
  }

  /**
   * Carries a rich failure across the port boundary.
   *
   * <p>Ports may only fail with {@link PortException}, which is deliberately narrow — the engine
   * needs to know whether an effect definitely did not happen, not why. But the caller wants the
   * original error, so the specific exception is stashed here on the way out and recovered when the
   * turn resolves.
   */
  private static final class Failures {
    private volatile InvokerException invoker;
    private volatile String cancellationReason;

    PortException record(InvokerException failure) {
      this.invoker = failure;
      if (failure.kind() == InvokerException.Kind.EXECUTE_INDETERMINATE) {
        return PortException.indeterminate(failure.getMessage(), failure.metadata());
      }
      return PortException.of(failure.getMessage(), failure);
    }

    InvokerException takeInvoker() {
      InvokerException taken = invoker;
      invoker = null;
      return taken;
    }

    void setCancellationReason(String reason) {
      this.cancellationReason = reason;
    }

    String cancellationReasonOr(String fallback) {
      String reason = cancellationReason;
      return reason == null || reason.isEmpty() ? fallback : reason;
    }
  }

  // -------------------------------------------------------------------------
  // Host policy — prepare, steering, trimming, guardrails, validation
  // -------------------------------------------------------------------------

  /**
   * The seam every conversation-shaping extension plugs into.
   *
   * <p>The engine calls this once before each model invocation and once before committing the
   * final output. Doing the work here rather than inside the loop means every rewrite is visible
   * to the durable journal as a policy event, so a resumed turn sees the same conversation the
   * original one did.
   */
  private static final class LivePolicy implements Ports.HostPolicyPort {
    private final Prompty agent;
    private final Object inputs;
    private final TurnOptions options;
    private final AtomicBoolean prepared;
    private final AtomicBoolean skipOutputGuardrail;
    private final Failures failures;

    LivePolicy(
        Prompty agent,
        Object inputs,
        TurnOptions options,
        boolean alreadyPrepared,
        AtomicBoolean skipOutputGuardrail,
        Failures failures) {
      this.agent = agent;
      this.inputs = inputs;
      this.options = options;
      this.prepared = new AtomicBoolean(alreadyPrepared);
      this.skipOutputGuardrail = skipOutputGuardrail;
      this.failures = failures;
    }

    @Override
    public HostPolicyResult beforeModel(HostPolicyRequest request, CancellationToken cancellation) {
      List<Message> messages =
          request.messages == null ? new ArrayList<>() : new ArrayList<>(request.messages);
      int stablePrefix =
          Math.min(Math.max(0, request.stablePrefixMessages == null ? 0 : request.stablePrefixMessages),
              messages.size());
      boolean preparedNow = false;

      if (prepared.compareAndSet(false, true)) {
        try {
          messages = new ArrayList<>(Pipeline.prepare(agent, asInputMap(inputs)));
        } catch (InvokerException failure) {
          failures.record(failure);
          throw new HostPolicyException("prepare_error", failure.getMessage());
        }
        stablePrefix = messages.size();
        preparedNow = true;
      }

      int steeringCount = 0;
      Steering steering = options.steering();
      if (steering != null) {
        List<Message> injected = steering.drain();
        steeringCount = injected.size();
        messages.addAll(injected);
      }

      int trimmedCount = 0;
      Integer budget = options.contextBudget();
      if (budget != null) {
        List<Message> beforeTrim = messages;
        Context.Trimmed trimmed = Context.trimToContextWindow(messages, budget);
        trimmedCount = trimmed.dropped().size();
        List<Message> kept = trimmed.messages();
        if (trimmedCount > 0 && options.compaction() != null) {
          compact(options.compaction(), trimmed.dropped(), kept);
        }
        // The stable prefix is a claim about what the provider has already seen. Trimming can
        // invalidate it, so it is re-derived from where the two lists actually still agree.
        stablePrefix = Math.min(stablePrefix, commonPrefixLength(beforeTrim, kept));
        messages = kept;
      }

      Guardrails guardrails = options.guardrails();
      if (guardrails != null) {
        GuardrailResult decision = guardrails.checkInput(messages, agent);
        if (!decision.allowed()) {
          throw new HostPolicyException(
              "input_guardrail_denied",
              "Input guardrail denied: " + decision.reasonOr("Input denied"));
        }
      }

      HostPolicyResult result = new HostPolicyResult();
      result.messages = messages;
      result.stablePrefixMessages = stablePrefix;
      result.metadata = new LinkedHashMap<>();
      result.metadata.put("prepared", preparedNow);
      result.metadata.put("steeringCount", steeringCount);
      result.metadata.put("trimmedCount", trimmedCount);
      result.metadata.put("notifyMessagesUpdated", steeringCount > 0 || trimmedCount > 0);
      return result;
    }

    @Override
    public FinalOutputPolicyResult beforeCommit(
        FinalOutputPolicyRequest request, CancellationToken cancellation) {
      Object output = request.output;

      Guardrails guardrails = options.guardrails();
      if (guardrails != null && !skipOutputGuardrail.get()) {
        GuardrailResult decision = guardrails.checkOutput(output, agent);
        if (!decision.allowed()) {
          throw new HostPolicyException(
              "output_guardrail_denied",
              "Output guardrail denied: " + decision.reasonOr("Output denied"));
        }
        if (decision.hasRewrite()) {
          output = decision.rewrite();
        }
      }

      output = StructuredResult.unwrap(output);

      if (options.validator() != null) {
        String failure = options.validator().apply(output);
        if (failure != null && !failure.isEmpty()) {
          throw new HostPolicyException(
              "output_validation_failed", "Output validation failed: " + failure);
        }
      }

      FinalOutputPolicyResult result = new FinalOutputPolicyResult();
      result.output = output;
      return result;
    }

    /**
     * Replace the mechanical summary with a model-written one, in place.
     *
     * <p>Best-effort: a summarizer that fails or returns nothing leaves the default summary
     * standing, because losing the compaction is far better than losing the turn.
     */
    private static void compact(Compaction compaction, List<Message> dropped, List<Message> kept) {
      String summary;
      try {
        summary = compaction.summarize(dropped);
      } catch (RuntimeException failure) {
        return;
      }
      if (summary == null || summary.isBlank()) {
        return;
      }
      for (int i = 0; i < kept.size(); i++) {
        Message message = kept.get(i);
        if (message.role == com.microsoft.prompty.model.Role.USER
            && Messages.text(message).startsWith("[Context summary:")) {
          kept.set(i, Messages.user("[Context summary: " + summary + "]"));
          return;
        }
      }
    }

    private static int commonPrefixLength(List<Message> left, List<Message> right) {
      int limit = Math.min(left.size(), right.size());
      int count = 0;
      SaveContext context = new SaveContext();
      while (count < limit
          && left.get(count).save(context).equals(right.get(count).save(context))) {
        count++;
      }
      return count;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asInputMap(Object inputs) {
      return inputs instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }
  }

  // -------------------------------------------------------------------------
  // Model invocation
  // -------------------------------------------------------------------------

  /** Invokes the registered executor and processor for one prepared context. */
  private static final class LiveModel implements Ports.ModelPort {
    private final Prompty agent;
    private final String provider;
    private final boolean streaming;
    private final boolean rawFinal;
    private final boolean agentMode;
    private final AtomicBoolean skipOutputGuardrail;
    private final Failures failures;

    LiveModel(
        Prompty agent,
        String provider,
        boolean streaming,
        boolean rawFinal,
        boolean agentMode,
        AtomicBoolean skipOutputGuardrail,
        Failures failures) {
      this.agent = agent;
      this.provider = provider;
      this.streaming = streaming;
      this.rawFinal = rawFinal;
      this.agentMode = agentMode;
      this.skipOutputGuardrail = skipOutputGuardrail;
      this.failures = failures;
    }

    @Override
    public ModelInvocationResponse invoke(
        ModelInvocationRequest request,
        CancellationToken cancellation,
        Ports.ModelStreamPort stream) {
      if (cancellation.isCancelled()) {
        throw PortException.of("Operation cancelled");
      }

      if (!streaming) {
        return nonStreaming(request, cancellation, null);
      }

      Iterator<Object> raw;
      try {
        raw = Registry.executor(provider).executeStreamWithContext(agent, request, cancellation);
      } catch (InvokerException streamFailure) {
        if (streamFailure.kind() == InvokerException.Kind.EXECUTE_INDETERMINATE) {
          // The provider may or may not have run. Falling back would risk a duplicate call, so
          // the engine is told the outcome is unknown and handles reconciliation.
          throw failures.record(streamFailure);
        }
        try {
          return nonStreaming(request, cancellation, streamFailure.getMessage());
        } catch (InvokerException fallbackFailure) {
          throw failures.record(
              InvokerException.execute(
                  streamFailure.getMessage()
                      + " (stream), then "
                      + fallbackFailure.getMessage()
                      + " (non-stream)"));
        }
      }

      return consumeStream(request, cancellation, stream, raw);
    }

    private ModelInvocationResponse consumeStream(
        ModelInvocationRequest request,
        CancellationToken cancellation,
        Ports.ModelStreamPort stream,
        Iterator<Object> raw) {
      List<Object> rawChunks = new ArrayList<>();
      StringBuilder text = new StringBuilder();
      List<ToolCall> toolCalls = new ArrayList<>();
      com.microsoft.prompty.model.InvocationUsage usage = null;

      Iterator<Object> tee = Streams.peeking(raw, rawChunks::add);
      Iterator<StreamChunk> chunks;
      try {
        chunks = Registry.processor(provider).processStream(agent, tee);
      } catch (InvokerException failure) {
        Streams.close(raw);
        throw failures.record(failure);
      }

      try {
        while (chunks.hasNext()) {
          if (cancellation.isCancelled()) {
            throw PortException.of("Operation cancelled");
          }
          StreamChunk chunk = chunks.next();
          if (chunk instanceof TextChunk value) {
            stream.emit(new ModelStreamChunk.Text(value.value));
            text.append(value.value);
          } else if (chunk instanceof ThinkingChunk value) {
            stream.emit(new ModelStreamChunk.Thinking(value.value));
          } else if (chunk instanceof ToolChunk value) {
            toolCalls.add(value.toolCall);
          } else if (chunk instanceof UsageChunk value) {
            usage = value.usage;
          } else if (chunk instanceof StreamFailure failure) {
            // A stream that dies mid-flight may already have been completed by the provider, in
            // which case retrying would run the same tools and incur the same charge twice. Keeping
            // the indeterminate marking is what lets the engine reconcile rather than blindly retry.
            throw failures.record(
                failure.outcomeUnknown
                    ? InvokerException.indeterminateExecution(
                        failure.message,
                        Map.of("provider", provider, "phase", "stream_transport"))
                    : InvokerException.execute(failure.message));
          } else if (chunk instanceof ErrorChunk value) {
            throw failures.record(InvokerException.execute(value.message));
          }
        }
      } catch (InvokerException failure) {
        throw failures.record(failure);
      } finally {
        Streams.close(chunks);
        Streams.close(raw);
      }

      // Responses-style providers deliver the authoritative final object as a terminal chunk.
      // When present it is processed directly, because it carries structure the deltas do not.
      Object completed = completedResponse(rawChunks);
      if (completed != null) {
        ModelInvocationResponse response = processed(completed, request);
        if (isEmpty(response.toolRequests)) {
          response.output = StructuredResult.unwrap(response.output);
        }
        response.metadata =
            envelope(completed, rawChunks, asText(response.output), true, response.metadata, null);
        return response;
      }

      ModelInvocationResponse response = new ModelInvocationResponse();
      response.toolRequests = normalize(toolCalls);
      response.output =
          response.toolRequests.isEmpty() ? StructuredResult.unwrap(text.toString()) : null;
      response.usage = usage;
      response.assistantMessages = new ArrayList<>();
      response.nextContextState = portable();
      response.metadata = envelope(null, rawChunks, text.toString(), true, null, null);
      return response;
    }

    private ModelInvocationResponse nonStreaming(
        ModelInvocationRequest request, CancellationToken cancellation, String streamError) {
      Object raw;
      ModelInvocationResponse response;
      try {
        raw = Registry.executor(provider).executeWithContext(agent, request, cancellation);
        response =
            rawFinal && !agentMode
                ? Registry.processor(provider).processRawWithContext(agent, raw, request)
                : Registry.processor(provider).processWithContext(agent, raw, request);
      } catch (InvokerException failure) {
        throw failures.record(failure);
      }

      if (rawFinal && !agentMode) {
        // The caller asked for the provider's own words. Guardrails inspect processed output, so
        // running them over an unprocessed body would compare against a shape they never expect.
        skipOutputGuardrail.set(true);
        response.output = raw;
        response.toolRequests = new ArrayList<>();
      } else if (isEmpty(response.toolRequests)) {
        response.output = StructuredResult.unwrap(response.output);
      }

      response.metadata =
          envelope(raw, List.of(), asText(response.output), false, response.metadata, streamError);
      return response;
    }

    private ModelInvocationResponse processed(Object raw, ModelInvocationRequest request) {
      try {
        return Registry.processor(provider).processWithContext(agent, raw, request);
      } catch (InvokerException failure) {
        throw failures.record(failure);
      }
    }

    /**
     * Metadata the conversation port needs to rebuild a provider-valid tool exchange.
     *
     * <p>Formatting a tool round is provider-specific and needs the original response, so it is
     * carried forward here rather than reconstructed from the normalized contract, which has
     * already discarded the provider's shape.
     */
    private static Map<String, Object> envelope(
        Object rawResponse,
        List<Object> rawChunks,
        String textContent,
        boolean streamed,
        Map<String, Object> providerMetadata,
        String streamError) {
      Map<String, Object> metadata = new LinkedHashMap<>();
      metadata.put("rawResponse", rawResponse);
      metadata.put("rawChunks", rawChunks);
      metadata.put("textContent", textContent);
      metadata.put("streamed", streamed);
      metadata.put("providerMetadata", providerMetadata);
      if (streamError != null) {
        metadata.put("streamError", streamError);
      }
      return metadata;
    }

    private static Object completedResponse(List<Object> rawChunks) {
      for (int i = rawChunks.size() - 1; i >= 0; i--) {
        if (rawChunks.get(i) instanceof Map<?, ?> chunk
            && "response.completed".equals(chunk.get("type"))
            && chunk.get("response") != null) {
          return chunk.get("response");
        }
      }
      return null;
    }

    /**
     * Convert provider tool calls to the engine's contract.
     *
     * <p>The raw argument text is preserved alongside the parsed value: providers expect their own
     * encoding echoed back verbatim in the next request, and re-serializing a parsed object would
     * not reproduce it byte for byte.
     */
    private static List<ModelToolRequest> normalize(List<ToolCall> toolCalls) {
      List<ModelToolRequest> requests = new ArrayList<>(toolCalls.size());
      for (ToolCall call : toolCalls) {
        ModelToolRequest request = new ModelToolRequest();
        request.id = call.id;
        request.name = call.name;
        Object parsed;
        try {
          parsed = TypraJson.parse(call.arguments);
        } catch (RuntimeException notJson) {
          parsed = call.arguments;
        }
        request.arguments = parsed;
        request.metadata = new LinkedHashMap<>();
        request.metadata.put("argumentsText", call.arguments);
        requests.add(request);
      }
      return requests;
    }

    private static InvocationContextState portable() {
      InvocationContextState state = new InvocationContextState();
      state.portability = InvocationContextPortability.PORTABLE;
      state.delegatedState = new ArrayList<>();
      return state;
    }

    private static String asText(Object output) {
      return output instanceof String text ? text : null;
    }

    private static boolean isEmpty(List<?> list) {
      return list == null || list.isEmpty();
    }
  }

  /** Forwards in-flight model chunks to the caller as events. */
  private record LiveStream(Events events) implements Ports.ModelStreamPort {
    @Override
    public void emit(ModelStreamChunk chunk) {
      if (chunk instanceof ModelStreamChunk.Text text) {
        events.emit(new AgentEvent.Token(text.value()));
      } else if (chunk instanceof ModelStreamChunk.Thinking thinking) {
        events.emit(new AgentEvent.Thinking(thinking.value()));
      }
    }
  }

  /** Reports each retry to the caller. */
  private record LiveRetry(Events events, Failures failures) implements Ports.RetryPolicyPort {
    @Override
    public void backoff(RetryPolicyRequest request, CancellationToken cancellation) {
      if (cancellation.isCancelled()) {
        failures.setCancellationReason("Operation cancelled");
        throw PortException.of("Operation cancelled");
      }
      events.emit(
          new AgentEvent.Retry(
              "model",
              request.nextAttempt == null ? 0 : request.nextAttempt,
              request.maxAttempts == null ? 0 : request.maxAttempts,
              request.reason == null ? "" : request.reason));
    }
  }

  // -------------------------------------------------------------------------
  // Conversation, permission, tools
  // -------------------------------------------------------------------------

  /** Delegates tool-exchange formatting to the provider's executor. */
  private record LiveConversation(String provider, Failures failures)
      implements Ports.ConversationPort {

    @Override
    public List<Message> formatToolExchange(
        ModelInvocationResponse response, List<ModelToolResult> results) {
      if (response.toolRequests == null || response.toolRequests.isEmpty() || results.isEmpty()) {
        throw PortException.configuration(
            "tool conversation formatting requires non-empty requests and results");
      }

      List<ToolCall> calls = new ArrayList<>(response.toolRequests.size());
      List<String> outputs = new ArrayList<>(response.toolRequests.size());
      for (ModelToolRequest request : response.toolRequests) {
        ToolCall call = new ToolCall();
        call.id = request.id;
        call.name = request.name;
        call.arguments = argumentsText(request);
        calls.add(call);

        // Results are matched by request id rather than position: the engine may commit them out
        // of order across a resume, and pairing the wrong result with a call would silently
        // mislead the model.
        String output = "";
        for (ModelToolResult result : results) {
          if (result.requestId != null && result.requestId.equals(request.id)) {
            output = ToolResults.modelText(result);
            break;
          }
        }
        outputs.add(output);
      }

      Map<String, Object> metadata = response.metadata == null ? Map.of() : response.metadata;
      String textContent =
          metadata.get("textContent") instanceof String text ? text : null;
      boolean streamed = Boolean.TRUE.equals(metadata.get("streamed"));

      try {
        Executor executor = Registry.executor(provider);
        if (streamed) {
          List<Object> rawChunks =
              metadata.get("rawChunks") instanceof List<?> chunks
                  ? new ArrayList<>(chunks)
                  : List.of();
          return executor.formatStreamToolMessages(rawChunks, calls, outputs, textContent);
        }
        return executor.formatToolMessages(metadata.get("rawResponse"), calls, outputs, textContent);
      } catch (InvokerException failure) {
        throw failures.record(failure);
      }
    }
  }

  /** Applies the tool guardrail, when one is configured. */
  private record LivePermission(Prompty agent, Guardrails guardrails)
      implements Ports.PermissionPort {

    @Override
    public EnginePermissionDecision authorize(
        ModelToolRequest request, CancellationToken cancellation) {
      EnginePermissionDecision decision = new EnginePermissionDecision();
      if (guardrails == null) {
        decision.approved = true;
        return decision;
      }

      Object arguments;
      try {
        arguments = ToolDispatch.parseArguments(argumentsText(request));
      } catch (IllegalArgumentException unparseable) {
        arguments = Map.of();
      }

      GuardrailResult result = guardrails.checkTool(request.name, arguments, agent);
      if (result.allowed()) {
        decision.approved = true;
        return decision;
      }

      decision.approved = false;
      // The reason is written as the model-visible result text, so it reads as a tool outcome the
      // model can respond to rather than an opaque refusal.
      decision.reason = "Error: Tool guardrail denied: " + result.reasonOr("Tool denied");
      decision.metadata = new LinkedHashMap<>();
      decision.metadata.put("errorKind", "guardrail_denied");
      return decision;
    }
  }

  /** Runs one authorized tool request through the dispatcher. */
  private record LiveTool(
      Prompty agent, Object inputs, Map<String, ToolHandler> tools, Events events)
      implements Ports.ToolPort {

    @Override
    public ModelToolResult execute(ModelToolRequest request, CancellationToken cancellation) {
      ToolCall call = new ToolCall();
      call.id = request.id;
      call.name = request.name;
      call.arguments = argumentsText(request);

      String output;
      try {
        output = ToolDispatch.dispatch(call, tools, agent, inputs);
      } catch (RuntimeException unexpected) {
        // The dispatcher already converts handler failures to text; reaching here means the
        // dispatcher itself failed. Reporting it as a tool error keeps the turn recoverable.
        String message = unexpected.getMessage();
        output =
            "Error: Tool '"
                + request.name
                + "' failed: "
                + (message == null ? unexpected.getClass().getSimpleName() : message);
        events.emit(new AgentEvent.Error(output));
      }

      boolean failed = output.startsWith("Error:");
      ModelToolResult result = new ModelToolResult();
      result.requestId = request.id;
      result.name = request.name;
      result.outcome = failed ? ModelToolOutcome.FAILED : ModelToolOutcome.SUCCESS;
      result.output = output;
      result.errorKind = failed ? "tool_error" : null;
      return result;
    }
  }

  /**
   * The argument text a provider expects echoed back.
   *
   * <p>Prefers the verbatim text the provider sent; falls back to re-encoding the parsed value for
   * requests that were reconstructed from a checkpoint rather than received live.
   */
  private static String argumentsText(ModelToolRequest request) {
    if (request.metadata != null
        && request.metadata.get("argumentsText") instanceof String text) {
      return text;
    }
    if (request.arguments instanceof String text) {
      return text;
    }
    return request.arguments == null ? "" : TypraJson.stringify(request.arguments);
  }

  // -------------------------------------------------------------------------
  // Durability and event projection
  // -------------------------------------------------------------------------

  /**
   * Persists the journal and projects it as live events.
   *
   * <p>Projection happens here, after persistence, so a caller never observes something the
   * journal does not record. The terminal event is emitted at most once regardless of how the turn
   * ends, because a caller that has been told the turn is over must not be told again.
   */
  private static final class Durability implements Ports.DurabilityPort {
    private final Events events;
    private final String agentName;
    private final String provider;
    private final String modelId;
    private final int configuredMaxIterations;
    private final boolean agentMode;
    private final Ports.DurabilityPort delegate;

    private List<Message> messages = List.of();
    private int completedModelIterations;
    private boolean terminalEmitted;

    Durability(
        Events events,
        String agentName,
        String provider,
        String modelId,
        int configuredMaxIterations,
        boolean agentMode,
        Ports.DurabilityPort delegate) {
      this.events = events;
      this.agentName = agentName;
      this.provider = provider;
      this.modelId = modelId;
      this.configuredMaxIterations = configuredMaxIterations;
      this.agentMode = agentMode;
      this.delegate = delegate;
    }

    @Override
    public void append(EngineEvent event) {
      if (delegate != null) {
        delegate.append(event);
      }
      project(event);
    }

    @Override
    public void appendWithCheckpoint(List<EngineEvent> batch, EngineCheckpoint checkpoint) {
      if (delegate != null) {
        delegate.appendWithCheckpoint(batch, checkpoint);
      }
      messages = checkpoint.messages == null ? List.of() : List.copyOf(checkpoint.messages);
      completedModelIterations =
          checkpoint.completedModelIterations == null ? 0 : checkpoint.completedModelIterations;

      for (EngineEvent event : batch) {
        project(event);
      }

      // A tool round that leaves nothing outstanding has just folded its results into the
      // conversation, which is a change the caller should see even though no separate
      // conversation event was written for it.
      boolean toolCommitted = false;
      for (EngineEvent event : batch) {
        if (event.kind == EngineEventKind.TOOL_EXECUTION_COMPLETED
            || event.kind == EngineEventKind.TOOL_RESULT_COMMITTED) {
          toolCommitted = true;
          break;
        }
      }
      if (toolCommitted
          && isEmpty(checkpoint.pendingToolRequests)
          && checkpoint.pendingModelResponse == null) {
        events.emit(new AgentEvent.MessagesUpdated(messages));
      }
    }

    private void project(EngineEvent event) {
      Map<String, Object> payload =
          event.payload instanceof Map<?, ?> map ? castMap(map) : Map.of();

      switch (event.kind) {
        case TURN_STARTED ->
            events.emit(new AgentEvent.TurnStart(agentName, configuredMaxIterations));

        case POLICY_APPLIED -> {
          Map<String, Object> metadata =
              payload.get("metadata") instanceof Map<?, ?> map ? castMap(map) : Map.of();
          long steeringCount = asLong(metadata.get("steeringCount"));
          if (steeringCount > 0) {
            events.emit(
                new AgentEvent.Status("Injected " + steeringCount + " steering message(s)"));
          }
          if (Boolean.TRUE.equals(metadata.get("notifyMessagesUpdated"))) {
            events.emit(new AgentEvent.MessagesUpdated(messages));
          }
        }

        case MODEL_INVOCATION_STARTED ->
            events.emit(
                new AgentEvent.LlmStart(
                    provider,
                    modelId,
                    (int) asLong(payload.get("messageCount")),
                    event.iteration == null ? 0 : event.iteration));

        case MODEL_INVOCATION_COMPLETED, MODEL_INVOCATION_RECONCILED ->
            events.emit(new AgentEvent.LlmComplete(event.iteration == null ? 0 : event.iteration));

        case TOOL_EXECUTION_STARTED -> {
          if (payload.get("toolRequest") instanceof Map<?, ?> map) {
            ModelToolRequest request = ModelToolRequest.load(map, new LoadContext());
            events.emit(new AgentEvent.ToolCallStart(request.name, argumentsText(request)));
          }
        }

        case TOOL_EXECUTION_COMPLETED, TOOL_RESULT_COMMITTED -> {
          if (payload.get("toolResult") instanceof Map<?, ?> map) {
            ModelToolResult result = ModelToolResult.load(map, new LoadContext());
            String output = ToolResults.modelText(result);
            events.emit(new AgentEvent.ToolResult(result.name, output));
            events.emit(
                new AgentEvent.ToolCallComplete(
                    result.name,
                    result.outcome == ModelToolOutcome.SUCCESS,
                    output,
                    result.errorKind));
          }
        }

        case CONVERSATION_UPDATED -> events.emit(new AgentEvent.MessagesUpdated(messages));

        case TURN_COMMITTED -> projectTerminal(payload, "success");

        case TURN_CANCELLED -> {
          events.emit(new AgentEvent.Cancelled());
          projectTerminal(payload, "cancelled");
        }

        case TURN_FAILED, TURN_RECONCILIATION_REQUIRED -> {
          if (payload.get("output") instanceof Map<?, ?> output
              && "max_iterations".equals(output.get("errorKind"))) {
            events.emit(
                new AgentEvent.Error(
                    "Agent loop exceeded max iterations (" + configuredMaxIterations + ")"));
          }
          projectTerminal(payload, "error");
        }

        default -> {}
      }
    }

    private void projectTerminal(Map<String, Object> payload, String status) {
      if (terminalEmitted) {
        return;
      }
      terminalEmitted = true;
      // Iterations are only meaningful for an agent loop; a plain round-trip reports zero rather
      // than claiming a loop it never ran.
      int iterations = agentMode ? completedModelIterations : 0;
      boolean success = "success".equals(status);
      Object response = success ? payload.get("output") : null;
      if (success) {
        events.emit(new AgentEvent.Done(response, messages));
      }
      events.emit(new AgentEvent.TurnEnd(status, iterations, response));
    }

    /** Report a turn that failed before it could commit anything. */
    void finishUncommittedError() {
      if (terminalEmitted) {
        return;
      }
      terminalEmitted = true;
      events.emit(
          new AgentEvent.TurnEnd("error", agentMode ? completedModelIterations : 0, null));
    }

    private static long asLong(Object value) {
      return value instanceof Number number ? number.longValue() : 0L;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> map) {
      return (Map<String, Object>) map;
    }

    private static boolean isEmpty(List<?> list) {
      return list == null || list.isEmpty();
    }
  }
}
