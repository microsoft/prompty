package com.microsoft.prompty;

import com.microsoft.prompty.engine.Ports;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * How one turn should run.
 *
 * <p>Everything here is optional. The defaults describe a plain conversational round-trip; each
 * setting opts into one additional behaviour, and they compose. Instances are immutable and built
 * with {@link #builder()}, so an options bundle can be shared across turns without one turn's
 * configuration leaking into another's.
 */
public final class TurnOptions {

  /** Model calls a turn will make before giving up. */
  public static final int DEFAULT_MAX_ITERATIONS = 10;

  /** Attempts per model call, including the first. */
  public static final int DEFAULT_MAX_LLM_RETRIES = 3;

  private final int maxIterations;
  private final int maxLlmRetries;
  private final boolean raw;
  private final boolean parallelToolCalls;
  private final Map<String, ToolHandler> tools;
  private final AgentEvent.Listener onEvent;
  private final CancellationToken cancellation;
  private final Integer contextBudget;
  private final Guardrails guardrails;
  private final Steering steering;
  private final Compaction compaction;
  private final Function<Object, String> validator;
  private final Ports.DurabilityPort durability;
  private final Ports.PermissionPort permission;
  private final Ports.PostCommitPort postCommit;

  private TurnOptions(Builder builder) {
    this.maxIterations = builder.maxIterations;
    this.maxLlmRetries = builder.maxLlmRetries;
    this.raw = builder.raw;
    this.parallelToolCalls = builder.parallelToolCalls;
    this.tools = Map.copyOf(builder.tools);
    this.onEvent = builder.onEvent;
    this.cancellation = builder.cancellation;
    this.contextBudget = builder.contextBudget;
    this.guardrails = builder.guardrails;
    this.steering = builder.steering;
    this.compaction = builder.compaction;
    this.validator = builder.validator;
    this.durability = builder.durability;
    this.permission = builder.permission;
    this.postCommit = builder.postCommit;
  }

  /** Options with every default in place. */
  public static TurnOptions defaults() {
    return builder().build();
  }

  /** A new builder, pre-populated with the defaults. */
  public static Builder builder() {
    return new Builder();
  }

  /** How many model calls this turn may make. */
  public int maxIterations() {
    return maxIterations;
  }

  /** How many attempts each model call gets. */
  public int maxLlmRetries() {
    return maxLlmRetries;
  }

  /** Whether to return the provider's raw response instead of the processed result. */
  public boolean raw() {
    return raw;
  }

  /** Whether the caller asked for tool calls to run concurrently. */
  public boolean parallelToolCalls() {
    return parallelToolCalls;
  }

  /** Caller-supplied tool implementations, keyed by tool name. */
  public Map<String, ToolHandler> tools() {
    return tools;
  }

  /** Where live events go, or null. */
  public AgentEvent.Listener onEvent() {
    return onEvent;
  }

  /** The token this turn watches, never null. */
  public CancellationToken cancellation() {
    return cancellation == null ? CancellationToken.none() : cancellation;
  }

  /** The character budget for the conversation, or null for no trimming. */
  public Integer contextBudget() {
    return contextBudget;
  }

  /** The policy hooks, or null. */
  public Guardrails guardrails() {
    return guardrails;
  }

  /** The mid-turn instruction queue, or null. */
  public Steering steering() {
    return steering;
  }

  /** The summarizer for trimmed messages, or null. */
  public Compaction compaction() {
    return compaction;
  }

  /** A final-output check returning an error message, or null when valid. */
  public Function<Object, String> validator() {
    return validator;
  }

  /** Where the durable journal is written, or null to keep the turn in memory. */
  public Ports.DurabilityPort durability() {
    return durability;
  }

  /** Who authorizes tool calls, or null to defer to guardrails. */
  public Ports.PermissionPort permission() {
    return permission;
  }

  /** A non-fatal effect to run after a successful commit, or null. */
  public Ports.PostCommitPort postCommit() {
    return postCommit;
  }

  /** Builds {@link TurnOptions}. */
  public static final class Builder {
    private int maxIterations = DEFAULT_MAX_ITERATIONS;
    private int maxLlmRetries = DEFAULT_MAX_LLM_RETRIES;
    private boolean raw;
    private boolean parallelToolCalls;
    private final Map<String, ToolHandler> tools = new LinkedHashMap<>();
    private AgentEvent.Listener onEvent;
    private CancellationToken cancellation;
    private Integer contextBudget;
    private Guardrails guardrails;
    private Steering steering;
    private Compaction compaction;
    private Function<Object, String> validator;
    private Ports.DurabilityPort durability;
    private Ports.PermissionPort permission;
    private Ports.PostCommitPort postCommit;

    private Builder() {}

    /** Cap the number of model calls. */
    public Builder maxIterations(int maxIterations) {
      this.maxIterations = maxIterations;
      return this;
    }

    /** Cap the attempts per model call. */
    public Builder maxLlmRetries(int maxLlmRetries) {
      this.maxLlmRetries = maxLlmRetries;
      return this;
    }

    /** Return the provider's raw response instead of the processed result. */
    public Builder raw(boolean raw) {
      this.raw = raw;
      return this;
    }

    /**
     * Ask for concurrent tool execution.
     *
     * <p>Rejected at turn start: the engine commits each tool effect durably in request order, and
     * running them concurrently would make the journal — and therefore replay — non-deterministic.
     */
    public Builder parallelToolCalls(boolean parallelToolCalls) {
      this.parallelToolCalls = parallelToolCalls;
      return this;
    }

    /** Register one tool implementation. */
    public Builder tool(String name, ToolHandler handler) {
      this.tools.put(name, handler);
      return this;
    }

    /** Register several tool implementations. */
    public Builder tools(Map<String, ToolHandler> tools) {
      if (tools != null) {
        this.tools.putAll(tools);
      }
      return this;
    }

    /** Receive live events. */
    public Builder onEvent(AgentEvent.Listener onEvent) {
      this.onEvent = onEvent;
      return this;
    }

    /** Watch a cancellation token. */
    public Builder cancellation(CancellationToken cancellation) {
      this.cancellation = cancellation;
      return this;
    }

    /** Trim the conversation to this many characters before each model call. */
    public Builder contextBudget(Integer contextBudget) {
      this.contextBudget = contextBudget;
      return this;
    }

    /** Apply policy hooks around model calls and tool dispatch. */
    public Builder guardrails(Guardrails guardrails) {
      this.guardrails = guardrails;
      return this;
    }

    /** Inject mid-turn instructions from this queue. */
    public Builder steering(Steering steering) {
      this.steering = steering;
      return this;
    }

    /** Summarize trimmed messages rather than dropping them mechanically. */
    public Builder compaction(Compaction compaction) {
      this.compaction = compaction;
      return this;
    }

    /** Reject a final output by returning an error message from this function. */
    public Builder validator(Function<Object, String> validator) {
      this.validator = validator;
      return this;
    }

    /** Persist the engine journal so the turn can be resumed. */
    public Builder durability(Ports.DurabilityPort durability) {
      this.durability = durability;
      return this;
    }

    /** Authorize tool calls through a host-supplied policy. */
    public Builder permission(Ports.PermissionPort permission) {
      this.permission = permission;
      return this;
    }

    /** Run a non-fatal effect after a successful commit. */
    public Builder postCommit(Ports.PostCommitPort postCommit) {
      this.postCommit = postCommit;
      return this;
    }

    /** Build the options. */
    public TurnOptions build() {
      return new TurnOptions(this);
    }
  }
}
