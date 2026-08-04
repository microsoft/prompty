package com.microsoft.prompty.engine;

/**
 * An ephemeral chunk produced while a model invocation is in flight.
 *
 * <p>Stream chunks deliberately sit outside the durable event journal. They arrive at whatever rate
 * the provider emits them, they carry no commit semantics, and a host that drops them still gets an
 * identical committed turn. Only the completed {@code ModelInvocationResponse} participates in
 * ordering, so a replayed turn need not reproduce chunk boundaries.
 */
public sealed interface ModelStreamChunk {

  /** Model-visible output text. */
  record Text(String value) implements ModelStreamChunk {}

  /** Reasoning text, where the provider exposes it separately from output. */
  record Thinking(String value) implements ModelStreamChunk {}

  /** A raw provider chunk, passed through for hosts that understand the provider's shape. */
  record Provider(Object value) implements ModelStreamChunk {}
}
