package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import java.util.List;

/**
 * Something observable that happened while a turn ran.
 *
 * <p>Events are a live, best-effort narration for a caller that wants to show progress — streamed
 * tokens, tool activity, retries. They are deliberately not the durable record: the engine's
 * journal is. A dropped or slow event listener must never change what a turn does, so nothing here
 * carries a result the turn depends on.
 *
 * <p>Every event is projected from a durable engine event, which is what keeps the narration
 * consistent with what was actually committed.
 */
public sealed interface AgentEvent {

  /** A short, stable name for this event, suitable for logs and filters. */
  String type();

  /** The turn began. */
  record TurnStart(String agent, int maxIterations) implements AgentEvent {
    @Override
    public String type() {
      return "turn_start";
    }
  }

  /** The turn reached a terminal state. Always the last event. */
  record TurnEnd(String status, int iterations, Object response) implements AgentEvent {
    @Override
    public String type() {
      return "turn_end";
    }
  }

  /** A model call is about to be made. */
  record LlmStart(String provider, String modelId, int messageCount, int iteration)
      implements AgentEvent {
    @Override
    public String type() {
      return "llm_start";
    }
  }

  /** A model call returned. */
  record LlmComplete(int iteration) implements AgentEvent {
    @Override
    public String type() {
      return "llm_complete";
    }
  }

  /** A transient failure will be retried. */
  record Retry(String operation, int attempt, int maxAttempts, String reason)
      implements AgentEvent {
    @Override
    public String type() {
      return "retry";
    }
  }

  /** A streamed text token. */
  record Token(String text) implements AgentEvent {
    @Override
    public String type() {
      return "token";
    }
  }

  /** A streamed reasoning token. */
  record Thinking(String text) implements AgentEvent {
    @Override
    public String type() {
      return "thinking";
    }
  }

  /** A tool is about to run. */
  record ToolCallStart(String name, String arguments) implements AgentEvent {
    @Override
    public String type() {
      return "tool_call_start";
    }
  }

  /** A tool produced a result. */
  record ToolResult(String name, String result) implements AgentEvent {
    @Override
    public String type() {
      return "tool_result";
    }
  }

  /** A tool finished, with normalized success metadata. */
  record ToolCallComplete(String name, boolean success, String result, String errorKind)
      implements AgentEvent {
    @Override
    public String type() {
      return "tool_call_complete";
    }
  }

  /** A human-readable progress note. */
  record Status(String message) implements AgentEvent {
    @Override
    public String type() {
      return "status";
    }
  }

  /** The conversation changed — tool results appended, context trimmed, steering injected. */
  record MessagesUpdated(List<Message> messages) implements AgentEvent {
    @Override
    public String type() {
      return "messages_updated";
    }
  }

  /** The turn produced its final response. Emitted before {@link TurnEnd}. */
  record Done(Object response, List<Message> messages) implements AgentEvent {
    @Override
    public String type() {
      return "done";
    }
  }

  /** Something went wrong. Not necessarily terminal — a failed tool is reported here too. */
  record Error(String message) implements AgentEvent {
    @Override
    public String type() {
      return "error";
    }
  }

  /** The turn was cancelled. */
  record Cancelled() implements AgentEvent {
    @Override
    public String type() {
      return "cancelled";
    }
  }

  /** Receives events as a turn runs. */
  @FunctionalInterface
  interface Listener {
    void onEvent(AgentEvent event);
  }
}
