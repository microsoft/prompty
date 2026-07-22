# Prompty Turn Engine Architecture

**Status:** Rust-first incubation contract
**Date:** 2026-07-21

This document defines the execution semantics that Prompty will prove in Rust before
promoting stable data contracts into TypeSpec and implementing them in other runtimes.
It supersedes independently evolving live and reference agent loops. Existing APIs
remain available during incubation, but new orchestration behavior belongs in one
`TurnEngine`.

## Goals

The engine MUST:

- preserve `.prompty` as the portable, reviewable asset for instructions, inputs,
  outputs, tools, and model preferences;
- keep execution policy and concrete host bindings outside the asset;
- support provider-specific behavior without embedding provider logic in the state machine;
- use the same state transitions for live execution and deterministic conformance;
- make context assembly, tools, permissions, checkpoints, memory effects, and provider
  state explicit and observable;
- support simple one-shot prompts without requiring applications to configure every port;
- define which executions are portable and which depend on provider-held state.

The engine MUST NOT:

- prescribe a vector database, embedding model, graph store, ranking algorithm, or
  memory taxonomy;
- treat conversation history, transient context, and durable memory as the same state;
- claim deterministic re-execution when a provider retains opaque state;
- allow a `.prompty` asset to grant permissions, select credentials, or choose concrete
  persistence implementations.

## Configuration Layers

Execution is resolved from three layers:

1. **Prompty asset:** portable semantic intent.
2. **Execution profile:** retry, context, concurrency, durability, and memory policy.
3. **Host bindings:** providers, tools, permissions, context sources, stores, clocks,
   identifiers, journals, and credentials.

Resolution produces an immutable `ResolvedRunPlan` before the first external effect.
The plan records selected capabilities and any portability limitations.

## Canonical State Machine

Both live and deterministic runners MUST delegate to this state machine:

```text
START
  -> RESOLVE_PLAN
  -> PREPARE_INVOCATION
  -> INVOKE_MODEL
  -> [FINAL] COMMIT_TURN -> RUN_POST_COMMIT_EFFECTS -> END
  -> [TOOLS] AUTHORIZE_TOOLS -> EXECUTE_TOOLS -> CHECKPOINT -> PREPARE_INVOCATION
  -> [CANCEL] COMMIT_CANCELLATION -> END
  -> [UNKNOWN] COMMIT_RECONCILIATION_REQUIRED -> END
  -> [FAULT] COMMIT_FAILURE -> END
```

A turn contains one or more model invocations. `iteration` identifies the semantic
model round. A retry of the same model request is an `attempt`, not another iteration.

Cancellation MUST be checked:

- before context preparation;
- before every model attempt;
- during retry waits;
- before every tool execution;
- before committing another iteration.

Cancellation does not erase already committed effects.

An indeterminate model or tool outcome MUST NOT be retried automatically. The turn commits
`reconciliation_required` so a host can query provider or tool state using the stable request
identity before deciding whether to continue.

## Invocation Context

Context is assembled using composable runtime-local components:

```text
ContextSource[]
  -> ContextTransform[]
  -> ContextPackingStrategy
  -> ModelInvocationContextSnapshot
```

Sources may provide history, recalled memory, files, search results, host state,
summaries, or multimodal references. Transforms may filter, redact, classify, rank,
deduplicate, or enrich candidates. Packing selects and orders candidates under token,
cost, relevance, and cache-affinity constraints.

Filtering MUST retain an auditable excluded decision for every removed candidate; transforms
must not make a candidate disappear from the snapshot decision record. Candidate identifiers
MUST be unique within an invocation so decisions cannot alias contributions from different
sources.

Every model invocation MUST receive one immutable snapshot. Retries MUST reuse that
snapshot. A subsequent model round MAY receive a new snapshot after committed tool,
steering, or synchronous memory effects.

A snapshot MUST record:

- session, turn, invocation, iteration, and snapshot identity;
- ordered model-visible messages or content segments;
- candidate inclusion/exclusion decisions;
- stable-prefix boundaries used for prompt or KV-cache affinity;
- portability classification and provider-held state references;
- sufficient metadata to audit token/cost estimation and packing behavior.

Snapshot immutability is semantic: after `model_invocation_started`, its model-visible
content MUST NOT change.

## Memory Semantics

Prompty defines memory timing and effects, not a storage algorithm.

- **Recall** is a `ContextSource`.
- **Synchronous agent-directed mutation** is an ordinary authorized tool/effect and MAY
  influence a later invocation in the same turn.
- **Derived consolidation** runs after the final turn commit or as an explicitly
  journaled background job.
- **Procedural memory** normally belongs in Prompty assets, tools, or application code,
  not in a fact store.

Memory implementations MAY use relational, vector, graph, temporal graph, hierarchical,
or provider-managed storage. Portable records SHOULD support scope, provenance,
observation time, validity time, modality references, expiry, deletion, confidence,
version, and mutation identity.

The baseline contract is versioned single-writer mutation. Concurrent shared-memory
implementations MUST advertise a separate capability and define conflict or merge
semantics.

## Provider State and Portability

Each invocation is classified as:

- **portable:** all model-visible state is materialized locally;
- **delegated:** provider-held state is referenced explicitly but requires that provider
  for re-execution;
- **opaque:** provider state cannot be reconstructed sufficiently for re-execution.

Provider response identifiers, conversation handles, cache identifiers, or similar
state MUST be represented structurally. They MUST NOT be hidden only in adapter-local
options.

Replay claims MUST distinguish:

1. projection verification of recorded semantic events;
2. simulated replay using recorded effect outcomes;
3. portable live re-execution;
4. provider-dependent re-execution.

## Tools, Permissions, and Ordering

Tool requests are normalized by the provider port. The engine owns semantic ordering.

- Permission is resolved before execution.
- Denial becomes a tool result rather than an unrecorded early return.
- A denied request emits `tool_result_committed`, not an execution-completed event.
- Tool failures become explicit failed results unless the failure prevents the host from
  determining whether an effect occurred.
- Results commit in original model-request order.
- Implementations MAY execute independent tools concurrently, but observable semantic
  commit order remains stable.
- Every effect carries an idempotency key or stable request identifier.

The Rust legacy `TurnOptions.parallel_tool_calls` adapter currently rejects `true` with a
validation error and an error turn lifecycle. It MUST NOT silently downgrade the request to
sequential execution; durable parallel batches require a future explicit engine contract.

Unknown tools are plan/configuration failures. Runtime tool failures are model-visible
results that allow recovery.

## Events and Durability

The engine emits one monotonic semantic event stream. UI updates, telemetry,
trajectories, journals, checkpoints, and replay records are projections of this stream.
Ephemeral token/thinking deltas MAY use a separate delivery channel, but they MUST NOT
change committed semantic ordering.

At minimum the stream represents:

- turn start/end;
- context preparation and snapshot identity;
- model invocation start/completion/failure;
- model reconciliation required/resolved;
- permission request/decision;
- tool execution start/completion;
- checkpoint creation;
- cancellation;
- final commit;
- post-commit effect start/completion/failure.

A checkpoint MUST identify the last committed semantic sequence represented by its
state. Its `checkpoint_created` event may follow that sequence. A host continuing an
existing journal MUST resume sequence numbering from the greater of the checkpoint
sequence and the durable journal tail. Resume MUST NOT repeat committed effects. Effects
whose outcome is unknown after interruption require explicit reconciliation; the engine
MUST NOT assume success or failure.

Checkpoints MUST persist the exact `stable_prefix_messages` boundary. Resuming MUST restore
that boundary rather than treating later tool results, steering, summaries, or compacted
messages as cache-stable. Legacy checkpoints without the field decode conservatively as zero.

Resume APIs require the host's durable journal-tail sequence; checkpoint sequence alone is not
sufficient because later semantic events may already exist. Every atomic checkpoint write also
includes a `checkpoint_created` event so journal projections observe model-response,
intermediate-tool, and final-tool checkpoints consistently.

An externally visible tool result and the checkpoint containing that result MUST be persisted
atomically through the durability port before another effect can run. If that atomic write fails,
the engine returns explicit recovery state containing the checkpoint and completed tool results;
it MUST NOT return an ordinary retryable error. Exactly-once recovery across process loss still
requires the tool host to honor the stable request identifier as an idempotency or reconciliation
key. A checkpoint taken within a multi-tool round MUST also retain the active invocation identity
and all remaining ordered tool requests, so resume continues with the next uncommitted effect
rather than skipping the rest of the batch or invoking the model early. Checkpoints retain
structured completed tool results and an explicit reconciliation-required marker; resuming such
a checkpoint MUST NOT invoke the model until the host resolves the indeterminate effect.
The resolved tool result and cleared reconciliation marker MUST themselves be atomically
journaled and checkpointed before any later model or tool effect can run.

Every completed model response MUST also be atomically journaled with a checkpoint containing
its assistant messages, provider-state transition, pending tool batch, and final output state.
Resume after that checkpoint MUST continue tools or commit the final output without invoking the
model again.

An indeterminate model invocation MUST atomically persist typed model-reconciliation state,
including the stable invocation identity, exact model request snapshot, failed attempt, error,
and provider metadata. `resume_after_model_reconciliation` accepts the host-confirmed
`ModelInvocationResponse`, journals it with a checkpoint, and continues tools or final commit
without re-invoking the reconciled model request. Tool reconciliation remains a distinct API and
MUST reject model-reconciliation checkpoints.

Post-commit effects receive an unambiguously encoded identity deterministically derived from the
session and turn and
MUST be idempotent. Failure to persist a
post-commit start event prevents the effect from running. Failure to persist completion or failure
after the effect ran is returned as non-fatal recovery information and MUST NOT make the committed
turn appear to have failed.

## Runtime-Local Ports

Native runtime interfaces own async, streaming, cancellation, and SDK-specific behavior:

- `ModelPort`
- `ContextSource`
- `ContextTransform`
- `ContextPackingStrategy`
- `PermissionPort`
- `ToolPort`
- `DurabilityPort` (atomic semantic-event and checkpoint persistence)
- `Clock`
- `IdGenerator`
- post-commit effect ports

Portable TypeSpec models will be promoted only after the Rust state machine and
conformance vectors establish stable semantics. Native interfaces themselves are not
generated.

## Rust-First Conformance Gate

The Rust engine is ready for application integration only when deterministic tests cover:

- one-invocation completion;
- multiple tool rounds;
- permission denial;
- tool failure recovery;
- cancellation at every effect boundary;
- retry reuse of the same context snapshot;
- stable tool-result commit ordering;
- checkpoint/resume without repeated effects;
- portable and delegated provider state;
- memory recall as a context source;
- synchronous memory mutation followed by a new snapshot;
- post-commit consolidation events;
- event sequence and replay projection stability.

CutReady integration begins after this gate. CutReady may then evolve its APIs, storage,
and authoring UI to exercise the proven Prompty runtime rather than constraining its
design.
