package com.microsoft.prompty.engine;

/**
 * The bundle of effect ports one {@link TurnEngine} drives.
 *
 * <p>Every field defaults to a neutral implementation, so a host overrides only the effects it
 * actually cares about. Wiring just a {@link Ports.ModelPort} is enough to run a real turn.
 */
public final class TurnEngineEffects {

  public Ports.ModelPort model;
  public Ports.ModelStreamPort stream = new DefaultPorts.NoopModelStream();
  public Ports.HostPolicyPort policy = new DefaultPorts.NoopHostPolicy();
  public Ports.RetryPolicyPort retry = new DefaultPorts.NoopRetryPolicy();
  public Ports.ConversationPort conversation = new DefaultPorts.DefaultConversation();
  public Ports.PermissionPort permission = new DefaultPorts.AllowAllPermissions();
  public Ports.ToolPort tools;
  public Ports.DurabilityPort durability = new DefaultPorts.NoopDurability();
  public Ports.PostCommitPort postCommit = new DefaultPorts.NoopPostCommit();
  public Ports.Clock clock = new DefaultPorts.SystemClock();
  public Ports.IdGenerator ids = new DefaultPorts.SequentialIds();

  public static TurnEngineEffects of(Ports.ModelPort model) {
    TurnEngineEffects effects = new TurnEngineEffects();
    effects.model = model;
    return effects;
  }

  public TurnEngineEffects withStream(Ports.ModelStreamPort stream) {
    this.stream = stream;
    return this;
  }

  public TurnEngineEffects withPolicy(Ports.HostPolicyPort policy) {
    this.policy = policy;
    return this;
  }

  public TurnEngineEffects withRetry(Ports.RetryPolicyPort retry) {
    this.retry = retry;
    return this;
  }

  public TurnEngineEffects withConversation(Ports.ConversationPort conversation) {
    this.conversation = conversation;
    return this;
  }

  public TurnEngineEffects withPermission(Ports.PermissionPort permission) {
    this.permission = permission;
    return this;
  }

  public TurnEngineEffects withTools(Ports.ToolPort tools) {
    this.tools = tools;
    return this;
  }

  public TurnEngineEffects withDurability(Ports.DurabilityPort durability) {
    this.durability = durability;
    return this;
  }

  public TurnEngineEffects withPostCommit(Ports.PostCommitPort postCommit) {
    this.postCommit = postCommit;
    return this;
  }

  public TurnEngineEffects withClock(Ports.Clock clock) {
    this.clock = clock;
    return this;
  }

  public TurnEngineEffects withIds(Ports.IdGenerator ids) {
    this.ids = ids;
    return this;
  }
}
