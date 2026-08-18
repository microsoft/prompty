package com.microsoft.prompty.harness;

import com.microsoft.prompty.model.EventSink;
import com.microsoft.prompty.model.SessionEvent;
import com.microsoft.prompty.model.TurnEvent;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Captures emitted turn and session events in memory.
 *
 * <p>The obvious sink for a test, but also the one a host reaches for while wiring an agent up: it
 * makes the engine's event stream inspectable without a file or a subscriber.
 */
public final class CollectingEventSink implements EventSink {

  private final List<TurnEvent> turnEvents = Collections.synchronizedList(new ArrayList<>());
  private final List<SessionEvent> sessionEvents = Collections.synchronizedList(new ArrayList<>());

  @Override
  public Boolean emitTurn(TurnEvent turnEvent) {
    turnEvents.add(turnEvent);
    return true;
  }

  @Override
  public Boolean emitSession(SessionEvent sessionEvent) {
    sessionEvents.add(sessionEvent);
    return true;
  }

  /** The turn events emitted so far, in order. */
  public List<TurnEvent> turnEvents() {
    synchronized (turnEvents) {
      return List.copyOf(turnEvents);
    }
  }

  /** The session events emitted so far, in order. */
  public List<SessionEvent> sessionEvents() {
    synchronized (sessionEvents) {
      return List.copyOf(sessionEvents);
    }
  }
}
