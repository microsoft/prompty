# Prompty conformance policy

Prompty conformance vectors own observable behavior. Runtime implementations own
their internals.

## Boundary

A vector should assert a behavior when a Prompty author, host application,
provider request, replay log, or processor result can observe the difference.
Examples include accepted input shapes, rejected invalid inputs, emitted wire
shape, message ordering, lifecycle status, replay output, stream reconciliation,
guardrail effects, and error categories.

A vector should not assert implementation strategy unless the strategy is itself
part of the public contract. Examples include whether a runtime uses async
tasks, threads, sequential fallback, a specific SDK object model, private memory
layout, retry mechanics, or local persistence format.

## Contract levels

- `required`: every runtime that implements the seam must pass the vector.
- `optional`: a runtime may skip only when the vector declares a capability in
  `requires` and the runtime reports that capability unavailable.
- `host-defined`: the host supplies policy or credentials; vectors may assert
  the portable behavior around that host input, not the host's private decision.
- `implementation-defined`: vectors may document the boundary, but must not
  encode one runtime's private strategy as required behavior.

When no level is stated, a vector is `required`.

## Waivers and adapters

Runtime-specific expected-error annotations such as `rust_expected_error` are
not contract metadata. They make parity drift look intentional and are forbidden
in shared vectors and generated vector payloads.

Temporary gaps must use the vector runner's explicit waiver table, keyed by the
operation or vector id, with a reason that names the issue/owner and expected
removal condition. A waived vector that starts passing must fail as an xpass so
the waiver is removed.

Adapters may normalize idiomatic language shapes into canonical JSON, but they
must not drop fields, statuses, errors, or annotations to hide a real behavior
difference. If normalization is needed, it should be narrow, documented, and
derived from the shared model contract.

## Parallel tool calls

`parallel_tool_calls=true` is a Prompty-visible option and is therefore owned by
vectors at the observable boundary. Runtimes must accept the option, execute or
deny each requested tool according to shared guardrail and registration rules,
append provider-visible tool results in the original `tool_calls` order, and
produce the same lifecycle/error category.

Runtimes may execute tool effects concurrently or use deterministic sequential
execution behind that ordered boundary. True concurrency is not required unless
the product explicitly makes performance or overlap observable.

## Live provider vectors

Provider wire vectors are deterministic and required: they own the canonical
request shape for each provider/API family. Live provider vectors are separate
acceptance probes: they run only when their `requires` capability tokens are
available, then make a real provider call and assert structural success.

A missing credential or unavailable provider feature is a skip, not a pass and
not a waiver. A present credential/capability followed by provider rejection is
a real conformance failure because the runtime's observable provider boundary no
longer matches the live service.
