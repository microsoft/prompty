// Copyright (c) Microsoft. All rights reserved.

/**
 * Provider-agnostic stream reconciliation — the reducer half of the
 * `Processor.processStream` contract.
 *
 * Providers own only the wire classification that turns their raw SSE chunks
 * into `StreamChunk` values (text vs. determinate/indeterminate failure).
 * {@link reconcileStream} then reduces that classified sequence identically for
 * every provider, mirroring the verified Python reference
 * (`prompty.core.streaming`) and the Rust reference (`prompty::streaming`). The
 * conformance harness drives the real provider classifier and feeds its output
 * here, so the reduction rules live in one provider-agnostic place.
 */

import { FailureChunk, StreamChunk, TextChunk } from "../model/index.js";

/** Outcome of reconciling a classified stream-chunk sequence. */
export interface StreamReconciliation {
  /** Concatenation of every text chunk emitted on the stream. */
  partialText: string;
  /** True when any terminal failure is indeterminate (outcome unknown). */
  requiresReconciliation: boolean;
  /** True only when the stream terminated with no failure at all. */
  completionCommitted: boolean;
}

/**
 * Reduce classified stream chunks into a {@link StreamReconciliation}.
 *
 * Partial text is the concatenation of every text chunk. A stream requires
 * reconciliation when any terminal failure is indeterminate. A completion is
 * committed only when the stream terminates with no failure at all.
 */
export function reconcileStream(chunks: StreamChunk[]): StreamReconciliation {
  let partialText = "";
  let requiresReconciliation = false;
  let hasFailure = false;

  for (const chunk of chunks) {
    if (chunk instanceof TextChunk) {
      partialText += chunk.value;
    } else if (chunk instanceof FailureChunk) {
      hasFailure = true;
      if (chunk.failure.outcome === "indeterminate") {
        requiresReconciliation = true;
      }
    }
  }

  return {
    partialText,
    requiresReconciliation,
    completionCommitted: !hasFailure,
  };
}
