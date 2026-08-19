package com.microsoft.prompty;

/**
 * A caller-supplied implementation of one tool.
 *
 * <p>Handlers take parsed arguments and return the text the model should see. Returning text rather
 * than a typed value is deliberate: whatever a tool produces has to be rendered into the
 * conversation for the model to read, so the handler is the right place to decide how.
 *
 * <p>A handler that throws is not fatal. The turn converts the failure into an {@code "Error: ..."}
 * result and feeds it back to the model, which can then apologise, retry with different arguments,
 * or route around the tool. A tool being broken is a fact the model can act on, not a reason to
 * abandon the turn.
 *
 * <p>Handlers are synchronous, matching the rest of this runtime. Where the Rust reference
 * distinguishes sync from async handlers, callers here run blocking work directly — on a virtual
 * thread if it should not occupy a platform thread.
 */
@FunctionalInterface
public interface ToolHandler {

  /**
   * Run the tool.
   *
   * @param arguments the parsed arguments, normally a {@code Map<String, Object>}
   * @return the result text to return to the model
   */
  String call(Object arguments);
}
