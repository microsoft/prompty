package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.Agent;
import java.util.List;

/**
 * Optional policy hooks that run around a turn's model calls and tool dispatch.
 *
 * <p>Each hook is independent and optional; an absent hook allows unconditionally, so a partially
 * configured {@code Guardrails} is always safe to pass. A hook returns a decision rather than
 * throwing, which keeps "denied" an ordinary, inspectable outcome instead of an exceptional one —
 * the turn engine needs to record a denial durably, not unwind through it.
 */
public final class Guardrails {

  /** Checked before each model call, against the messages about to be sent. */
  @FunctionalInterface
  public interface Input {
    GuardrailResult check(List<Message> messages, Agent agent);
  }

  /** Checked against the final output, once no more tool calls are outstanding. */
  @FunctionalInterface
  public interface Output {
    GuardrailResult check(Object output, Agent agent);
  }

  /** Checked before each tool execution, against the tool's name and parsed arguments. */
  @FunctionalInterface
  public interface Tool {
    GuardrailResult check(String name, Object arguments, Agent agent);
  }

  private final Input input;
  private final Output output;
  private final Tool tool;

  private Guardrails(Input input, Output output, Tool tool) {
    this.input = input;
    this.output = output;
    this.tool = tool;
  }

  /** Guardrails with no hooks configured; every check allows. */
  public static Guardrails none() {
    return new Guardrails(null, null, null);
  }

  /** A copy of these guardrails with the input hook replaced. */
  public Guardrails withInput(Input input) {
    return new Guardrails(input, output, tool);
  }

  /** A copy of these guardrails with the output hook replaced. */
  public Guardrails withOutput(Output output) {
    return new Guardrails(input, output, tool);
  }

  /** A copy of these guardrails with the tool hook replaced. */
  public Guardrails withTool(Tool tool) {
    return new Guardrails(input, output, tool);
  }

  /** Run the input hook, or allow if none is configured. */
  public GuardrailResult checkInput(List<Message> messages, Agent agent) {
    return input == null ? GuardrailResult.allow() : input.check(messages, agent);
  }

  /** Run the output hook, or allow if none is configured. */
  public GuardrailResult checkOutput(Object output, Agent agent) {
    return this.output == null ? GuardrailResult.allow() : this.output.check(output, agent);
  }

  /** Run the tool hook, or allow if none is configured. */
  public GuardrailResult checkTool(String name, Object arguments, Agent agent) {
    return tool == null ? GuardrailResult.allow() : tool.check(name, arguments, agent);
  }
}
