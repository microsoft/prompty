/**
 * Ordered context assembly for immutable model-invocation snapshots.
 */

import { ContextCandidate } from "../model/pipeline/context-candidate.js";
import { ContextRequest } from "../model/pipeline/context-request.js";
import { InvocationContextDecision } from "../model/pipeline/invocation-context-decision.js";
import { ModelInvocationContextSnapshot } from "../model/pipeline/model-invocation-context-snapshot.js";
import { TurnCancellationToken } from "./turn-engine-cancellation.js";

export class TurnContextError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TurnContextError";
  }
}

export interface ContextSource {
  readonly name: string;
  load(
    request: ContextRequest,
    cancellation: TurnCancellationToken,
  ): Promise<ContextCandidate[]>;
}

export interface ContextTransform {
  readonly name: string;
  apply(
    request: ContextRequest,
    candidates: readonly ContextCandidate[],
    cancellation: TurnCancellationToken,
  ): Promise<ContextCandidate[]>;
}

export interface ContextPackingStrategy {
  readonly name: string;
  pack(
    request: ContextRequest,
    candidates: readonly ContextCandidate[],
    cancellation: TurnCancellationToken,
  ): Promise<ModelInvocationContextSnapshot>;
}

/** Baseline packer that appends every candidate in deterministic source order. */
export class AppendContextPackingStrategy implements ContextPackingStrategy {
  readonly name = "append";

  async pack(
    request: ContextRequest,
    candidates: readonly ContextCandidate[],
  ): Promise<ModelInvocationContextSnapshot> {
    const messages = [...request.messages];
    const decisions: InvocationContextDecision[] = [];
    for (const [rank, candidate] of candidates.entries()) {
      messages.push(...candidate.messages);
      decisions.push(
        new InvocationContextDecision({
          candidateId: candidate.id,
          disposition: "included",
          reason: "included by append strategy",
          rank,
          metadata: candidate.metadata,
        }),
      );
    }

    return new ModelInvocationContextSnapshot({
      id: `context:${request.invocationId}`,
      sessionId: request.sessionId,
      turnId: request.turnId,
      invocationId: request.invocationId,
      iteration: request.iteration,
      messages,
      decisions,
      stablePrefixMessages: request.stablePrefixMessages,
      contextState: request.contextState,
    });
  }
}

/**
 * Composes sources, transforms, and packing in registration order.
 *
 * Every removed candidate is retained as an excluded decision and the returned
 * snapshot is deeply frozen to preserve retry identity and immutability.
 */
export class ContextPipeline {
  readonly #sources: ContextSource[];
  readonly #transforms: ContextTransform[];
  readonly #packing: ContextPackingStrategy;

  constructor(options: {
    sources?: readonly ContextSource[];
    transforms?: readonly ContextTransform[];
    packing?: ContextPackingStrategy;
  } = {}) {
    this.#sources = [...(options.sources ?? [])];
    this.#transforms = [...(options.transforms ?? [])];
    this.#packing = options.packing ?? new AppendContextPackingStrategy();
  }

  withSource(source: ContextSource): ContextPipeline {
    return new ContextPipeline({
      sources: [...this.#sources, source],
      transforms: this.#transforms,
      packing: this.#packing,
    });
  }

  withTransform(transform: ContextTransform): ContextPipeline {
    return new ContextPipeline({
      sources: this.#sources,
      transforms: [...this.#transforms, transform],
      packing: this.#packing,
    });
  }

  async prepare(
    request: ContextRequest,
    cancellation: TurnCancellationToken,
  ): Promise<ModelInvocationContextSnapshot> {
    cancellation.throwIfCancellationRequested();
    let candidates: ContextCandidate[] = [];
    for (const source of this.#sources) {
      cancellation.throwIfCancellationRequested();
      try {
        candidates.push(...(await source.load(request, cancellation)));
      } catch (error) {
        throw new TurnContextError(`Context source '${source.name}' failed`, {
          cause: error,
        });
      }
    }
    assertUniqueCandidates(candidates);

    const excluded: InvocationContextDecision[] = [];
    for (const transform of this.#transforms) {
      cancellation.throwIfCancellationRequested();
      const before = candidates;
      try {
        candidates = await transform.apply(request, before, cancellation);
      } catch (error) {
        throw new TurnContextError(
          `Context transform '${transform.name}' failed`,
          { cause: error },
        );
      }
      assertUniqueCandidates(candidates);
      const retained = new Set(candidates.map((candidate) => candidate.id));
      for (const candidate of before) {
        if (!retained.has(candidate.id)) {
          excluded.push(
            new InvocationContextDecision({
              candidateId: candidate.id,
              disposition: "excluded",
              reason: `excluded by context transform '${transform.name}'`,
              metadata: candidate.metadata,
            }),
          );
        }
      }
    }

    cancellation.throwIfCancellationRequested();
    let snapshot: ModelInvocationContextSnapshot;
    try {
      snapshot = await this.#packing.pack(request, candidates, cancellation);
    } catch (error) {
      throw new TurnContextError(
        `Context packing strategy '${this.#packing.name}' failed`,
        { cause: error },
      );
    }

    const decided = new Set(
      (snapshot.decisions ?? []).map((decision) => decision.candidateId),
    );
    for (const candidate of candidates) {
      if (!decided.has(candidate.id)) {
        excluded.push(
          new InvocationContextDecision({
            candidateId: candidate.id,
            disposition: "excluded",
            reason: `excluded without an explicit decision by packing strategy '${this.#packing.name}'`,
            metadata: candidate.metadata,
          }),
        );
      }
    }
    snapshot.decisions = [...(snapshot.decisions ?? []), ...excluded];
    validateSnapshot(snapshot, request);
    return deepFreeze(snapshot);
  }
}

export function validateSnapshot(
  snapshot: ModelInvocationContextSnapshot,
  request?: ContextRequest,
): void {
  if (
    snapshot.stablePrefixMessages < 0 ||
    snapshot.stablePrefixMessages > snapshot.messages.length
  ) {
    throw new TurnContextError(
      `Stable prefix contains ${snapshot.stablePrefixMessages} messages but snapshot contains ${snapshot.messages.length}`,
    );
  }

  const delegated = snapshot.contextState?.delegatedState ?? [];
  if (
    snapshot.contextState?.portability === "portable" &&
    delegated.length > 0
  ) {
    throw new TurnContextError(
      "Portable snapshots cannot contain delegated provider state",
    );
  }
  if (
    snapshot.contextState?.portability === "delegated" &&
    delegated.length === 0
  ) {
    throw new TurnContextError(
      "Delegated snapshots must identify provider-held state",
    );
  }

  if (
    request &&
    (snapshot.sessionId !== request.sessionId ||
      snapshot.turnId !== request.turnId ||
      snapshot.invocationId !== request.invocationId ||
      snapshot.iteration !== request.iteration)
  ) {
    throw new TurnContextError(
      `Snapshot identity does not match invocation '${request.invocationId}'`,
    );
  }
}

function assertUniqueCandidates(candidates: readonly ContextCandidate[]): void {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) {
      throw new TurnContextError(
        `Duplicate context candidate id '${candidate.id}'`,
      );
    }
    ids.add(candidate.id);
  }
}

function deepFreeze<T>(value: T): T {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
