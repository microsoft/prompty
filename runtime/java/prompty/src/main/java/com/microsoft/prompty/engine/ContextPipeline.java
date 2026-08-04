package com.microsoft.prompty.engine;

import com.microsoft.prompty.model.ContextCandidate;
import com.microsoft.prompty.model.ContextRequest;
import com.microsoft.prompty.model.InvocationContextDecision;
import com.microsoft.prompty.model.InvocationContextDisposition;
import com.microsoft.prompty.model.InvocationContextPortability;
import com.microsoft.prompty.model.InvocationContextState;
import com.microsoft.prompty.model.Message;
import com.microsoft.prompty.model.ModelInvocationContextSnapshot;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Composes context sources, transforms, and a packing strategy into one immutable snapshot per model
 * invocation.
 *
 * <p>Sources and transforms run in registration order. That ordering is load-bearing: a replayed run
 * must reproduce the same candidate list and the same decision list, and it can only do so if every
 * stage runs in a fixed sequence.
 *
 * <p>Every candidate that enters the pipeline leaves it accounted for. Candidates a transform drops,
 * and candidates the packer silently ignores, both get an explicit {@code EXCLUDED} decision, so the
 * snapshot records why a piece of context is missing rather than leaving it unexplained.
 */
public final class ContextPipeline {

  /** Supplies candidates such as history, recalled memory, files, or host state. */
  public interface Source {
    String name();

    List<ContextCandidate> load(ContextRequest request);
  }

  /** Filters, redacts, ranks, deduplicates, or enriches candidates. */
  public interface Transform {
    String name();

    List<ContextCandidate> apply(ContextRequest request, List<ContextCandidate> candidates);
  }

  /** Selects and orders candidates under token, cost, and cache-affinity constraints. */
  public interface PackingStrategy {
    String name();

    ModelInvocationContextSnapshot pack(ContextRequest request, List<ContextCandidate> candidates);
  }

  private final List<Source> sources = new ArrayList<>();
  private final List<Transform> transforms = new ArrayList<>();
  private final PackingStrategy packing;

  public ContextPipeline(PackingStrategy packing) {
    this.packing = packing;
  }

  /** A pipeline with no sources or transforms that appends candidates in order. */
  public static ContextPipeline appendOnly() {
    return new ContextPipeline(new AppendPackingStrategy());
  }

  public ContextPipeline withSource(Source source) {
    sources.add(source);
    return this;
  }

  public ContextPipeline withTransform(Transform transform) {
    transforms.add(transform);
    return this;
  }

  /** Assemble and validate the snapshot for one model invocation. */
  public ModelInvocationContextSnapshot prepare(ContextRequest request) {
    List<ContextCandidate> candidates = new ArrayList<>();
    for (Source source : sources) {
      List<ContextCandidate> loaded;
      try {
        loaded = source.load(request);
      } catch (ContextException e) {
        throw ContextException.stage("context source", source.name(), e);
      }
      if (loaded != null) {
        candidates.addAll(loaded);
      }
    }

    Set<String> seen = new HashSet<>();
    for (ContextCandidate candidate : candidates) {
      if (!seen.add(candidate.id)) {
        throw ContextException.invalidSnapshot("duplicate context candidate id '" + candidate.id + "'");
      }
    }

    List<InvocationContextDecision> excluded = new ArrayList<>();
    for (Transform transform : transforms) {
      List<ContextCandidate> before = candidates;
      try {
        candidates = transform.apply(request, new ArrayList<>(before));
      } catch (ContextException e) {
        throw ContextException.stage("context transform", transform.name(), e);
      }
      if (candidates == null) {
        candidates = new ArrayList<>();
      }
      Set<String> retained = new LinkedHashSet<>();
      for (ContextCandidate candidate : candidates) {
        retained.add(candidate.id);
      }
      for (ContextCandidate candidate : before) {
        if (!retained.contains(candidate.id)) {
          excluded.add(
              decision(
                  candidate,
                  InvocationContextDisposition.EXCLUDED,
                  "excluded by context transform '" + transform.name() + "'",
                  null));
        }
      }
    }

    List<ContextCandidate> packedCandidates = new ArrayList<>(candidates);
    ModelInvocationContextSnapshot snapshot;
    try {
      snapshot = packing.pack(request, candidates);
    } catch (ContextException e) {
      throw ContextException.stage("packing strategy", packing.name(), e);
    }
    if (snapshot.decisions == null) {
      snapshot.decisions = new ArrayList<>();
    }

    Set<String> decided = new HashSet<>();
    for (InvocationContextDecision decision : snapshot.decisions) {
      decided.add(decision.candidateId);
    }
    for (ContextCandidate candidate : packedCandidates) {
      if (!decided.contains(candidate.id)) {
        excluded.add(
            decision(
                candidate,
                InvocationContextDisposition.EXCLUDED,
                "excluded without an explicit decision by packing strategy '" + packing.name() + "'",
                null));
      }
    }
    snapshot.decisions.addAll(excluded);
    Snapshots.validateFor(snapshot, request);
    return snapshot;
  }

  private static InvocationContextDecision decision(
      ContextCandidate candidate,
      InvocationContextDisposition disposition,
      String reason,
      Integer rank) {
    InvocationContextDecision decision = new InvocationContextDecision();
    decision.candidateId = candidate.id;
    decision.disposition = disposition;
    decision.reason = reason;
    decision.rank = rank;
    decision.metadata = candidate.metadata;
    return decision;
  }

  /**
   * The deterministic baseline packer: keep the request's messages, then append every candidate's
   * messages in order.
   *
   * <p>Production profiles replace this with token-aware, relevance-aware, or cache-affinity
   * strategies without the engine changing at all — which is the point of packing being a port.
   */
  public static final class AppendPackingStrategy implements PackingStrategy {
    @Override
    public String name() {
      return "append";
    }

    @Override
    public ModelInvocationContextSnapshot pack(
        ContextRequest request, List<ContextCandidate> candidates) {
      List<Message> messages = new ArrayList<>(request.messages);
      List<InvocationContextDecision> decisions = new ArrayList<>();
      int rank = 0;
      for (ContextCandidate candidate : candidates) {
        if (candidate.messages != null) {
          messages.addAll(candidate.messages);
        }
        decisions.add(
            decision(
                candidate,
                InvocationContextDisposition.INCLUDED,
                "included by append strategy",
                rank));
        rank++;
      }

      ModelInvocationContextSnapshot snapshot = new ModelInvocationContextSnapshot();
      snapshot.id = "context:" + request.invocationId;
      snapshot.sessionId = request.sessionId;
      snapshot.turnId = request.turnId;
      snapshot.invocationId = request.invocationId;
      snapshot.iteration = request.iteration;
      snapshot.messages = messages;
      snapshot.decisions = decisions;
      snapshot.stablePrefixMessages = request.stablePrefixMessages;

      InvocationContextState state = new InvocationContextState();
      InvocationContextState requested = request.contextState;
      state.portability =
          requested == null ? InvocationContextPortability.PORTABLE : requested.portability;
      state.delegatedState =
          requested == null || requested.delegatedState == null
              ? null
              : new ArrayList<>(requested.delegatedState);
      snapshot.contextState = state;
      return snapshot;
    }
  }
}
