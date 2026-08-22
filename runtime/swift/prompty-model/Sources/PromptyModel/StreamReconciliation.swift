/// Outcome of reconciling a classified stream-chunk sequence — the
/// provider-agnostic half of the ``Processor.processStream`` contract.
///
/// Providers own only the wire classification that turns their raw SSE chunks
/// into ``StreamChunk`` values (text vs. determinate/indeterminate failure).
/// ``reconcileStream(_:)`` then reduces that classified sequence identically for
/// every provider, mirroring the verified Python reference
/// (`prompty.core.streaming`) and the Rust reference (`prompty::streaming`).
import Foundation

/// Reconcile classified stream chunks into a ``StreamReconciliation``.
///
/// Partial text is the concatenation of every text chunk. A stream requires
/// reconciliation when any terminal failure is indeterminate (the provider
/// outcome is unknown). A completion is committed only when the stream
/// terminates with no failure at all.
public struct StreamReconciliation: Equatable {
  /// Concatenation of every text chunk emitted on the stream.
  public var partialText: String
  /// True when any terminal failure is indeterminate (outcome unknown).
  public var requiresReconciliation: Bool
  /// True only when the stream terminated with no failure at all.
  public var completionCommitted: Bool

  public init(partialText: String, requiresReconciliation: Bool, completionCommitted: Bool) {
    self.partialText = partialText
    self.requiresReconciliation = requiresReconciliation
    self.completionCommitted = completionCommitted
  }

  /// The wire projection used by the ``processStream`` conformance vectors.
  public func save() -> [String: Any] {
    [
      "partialText": partialText,
      "requiresReconciliation": requiresReconciliation,
      "completionCommitted": completionCommitted,
    ]
  }
}
public func reconcileStream(_ chunks: [StreamChunk]) -> StreamReconciliation {
  var partialText = ""
  var requiresReconciliation = false
  var hasFailure = false

  for chunk in chunks {
    switch chunk {
    case .textChunk(let text):
      partialText += text.value
    case .failureChunk(let failure):
      hasFailure = true
      if failure.failure.outcome == .indeterminate {
        requiresReconciliation = true
      }
    default:
      break
    }
  }

  return StreamReconciliation(
    partialText: partialText,
    requiresReconciliation: requiresReconciliation,
    completionCommitted: !hasFailure)
}
