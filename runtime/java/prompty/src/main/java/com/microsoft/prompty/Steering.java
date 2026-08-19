package com.microsoft.prompty;

import com.microsoft.prompty.model.Message;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * A queue of mid-turn instructions to fold into the conversation.
 *
 * <p>Steering exists so a caller can influence a turn that is already running — a user typing a
 * correction while the agent works through tool calls, for instance. Sends are therefore safe from
 * any thread, and the turn drains the queue once at the start of each iteration so injected text
 * lands on an iteration boundary rather than partway through a model call.
 *
 * <p>Draining is atomic: the queue is emptied and its contents returned in one step, so a message
 * can never be delivered twice or lost to a concurrent send.
 */
public final class Steering {

  private final ConcurrentLinkedQueue<String> queue = new ConcurrentLinkedQueue<>();

  /** Queue an instruction to inject before the next model call. */
  public void send(String message) {
    if (message != null) {
      queue.add(message);
    }
  }

  /** Atomically remove every queued instruction, as user messages. */
  public List<Message> drain() {
    List<Message> messages = new ArrayList<>();
    String next;
    while ((next = queue.poll()) != null) {
      messages.add(Messages.user(next));
    }
    return messages;
  }

  /** Whether anything is waiting to be injected. */
  public boolean hasPending() {
    return !queue.isEmpty();
  }

  /** Whether nothing is waiting to be injected. */
  public boolean isEmpty() {
    return queue.isEmpty();
  }

  /** How many instructions are waiting. */
  public int size() {
    return queue.size();
  }
}
