# Prompty for Swift

A Swift implementation of the Prompty runtime: load a `.prompty` file, render it,
turn it into messages, call a model, and read the result back.

The Rust runtime is the behavioral reference for this port, and both are checked
against the same cross-runtime vectors in [`spec/vectors`](../../spec/vectors).

## Layout

Two SwiftPM packages live here, and the split is deliberate.

| Package         | Module         | Contents                                    | Hand-written?      |
| --------------- | -------------- | ------------------------------------------- | ------------------ |
| `prompty-model` | `PromptyModel` | The domain types and pipeline protocols     | No — generated     |
| `prompty`       | `Prompty`      | Loader, renderers, parser, registry, harness | Yes                |
| `prompty`       | `PromptyOpenAI`| The OpenAI executor and processor           | Yes                |

`prompty-model` is emitted from the TypeSpec definitions in [`schema`](../../schema)
by the Typra emitter. **Never edit anything under `prompty-model/Sources` by hand.**
Every file there is overwritten by the next generation run. If a generated type is
wrong, the fix belongs in the schema or in the emitter — see
[Generated model](#generated-model) below.

The runtime does not define its own domain types. `Prompty`, `Model`, `Message`,
`ContentPart`, `Tool` and the four pipeline protocols (`Renderer`, `Parser`,
`Executor`, `Processor`) all come from `PromptyModel`, and the hand-written code
conforms to them.

## Using it

```swift
import Prompty
import PromptyOpenAI

Registry.shared.registerDefaults()  // jinja2 + mustache renderers, prompty parser
registerOpenAI()                    // openai executor + processor

let answer = try await Pipeline.invoke(
  path: "basic.prompty",
  inputs: ["question": "What is the capital of Iceland?"]
)
```

`Pipeline.invoke` is the whole flow. The individual stages are available when you
need to step into the middle of it:

```swift
let agent    = try Loader.load(path: "basic.prompty")
let messages = try await Pipeline.prepare(agent, inputs: inputs)  // render + parse
let raw      = try await Pipeline.run(agent, messages: messages)  // execute + process
```

### Tool calls

When a prompt declares tools, the host drives the loop. Read the calls, then ask
for the arguments the tool should actually receive — that second step is where
tool bindings are applied:

```swift
let raw = try await Pipeline.run(agent, messages: messages)

for call in Pipeline.toolCalls(in: raw) {
  let args = Pipeline.boundArguments(agent, call: call, inputs: inputs)
  let result = try myTools[call.name]!(args)
  results.append(result)
}
```

The recorded `call` is left as the provider sent it. That matters: a bound value
is hidden from the model on purpose, and `Pipeline.toolMessages` replays the
call's own `arguments` on the next round, so writing the value back into the
call would hand the model exactly what the binding withheld.

A parameter listed under a tool's `bindings` is deliberately hidden from the
model, and the runtime supplies it from the prompt's own inputs instead:

```yaml
tools:
  - name: get_weather
    kind: function
    bindings:
      unit:
        input: preferred_unit   # the model never sees `unit`; this fills it in
```

`Pipeline.toolCalls(in:)` always returns the model's arguments untouched, so
`Pipeline.boundArguments(_:call:inputs:)` at the dispatch site is what makes a
binding take effect. Skipping it leaves the bound parameter missing entirely —
it was already stripped from the schema, so the model never supplied it.

Bindings are applied only when the provider's payload is a JSON object (or is
empty, which is the no-argument call). An array, a scalar, or malformed JSON is
passed through rather than replaced by an object holding only the bound values.

Streaming, structured output and tool calls are covered in
[`Tests/PromptyTests/LiveOpenAITests.swift`](prompty/Tests/PromptyTests/LiveOpenAITests.swift),
which exercises each of them against the real API.

## Building and testing

Requires a Swift 6.x toolchain.

```bash
cd runtime/swift/prompty
swift build
swift test
```

### On Windows

SwiftPM shells out to `git`, and a bare repository in the parent tree makes those
calls fail. Set the escape hatch before building:

```powershell
$env:GIT_CONFIG_COUNT='1'
$env:GIT_CONFIG_KEY_0='safe.bareRepository'
$env:GIT_CONFIG_VALUE_0='all'
```

Incremental builds suppress warnings that a clean build reports. When you care
about the warning output, clean first:

```powershell
swift package clean
swift build --build-tests
```

### Live tests

Most tests are offline. The tests in `LiveOpenAITests` call the real OpenAI API
and **skip themselves** when `OPENAI_API_KEY` is missing, so a checkout without
credentials still runs a full green suite.

To run them, put a `.env` beside `Package.swift`:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

That file is ignored by git and must never be committed. The runtime itself never
reads `.env` — populating the environment is the host's job, so the loading lives
in the test, not the library.

## Generated model

Regenerate after changing anything in [`schema`](../../schema):

```bash
cd schema
npm install
npm run generate
```

Generation also touches the other runtimes. Keep a Swift change reviewable by
reverting the rest:

```bash
git checkout -- runtime/rust runtime/python runtime/typescript runtime/go runtime/csharp vscode
```

### The emitter shim

`schema/scripts/patch-swift-emitter-defects.mjs` runs as part of generation and
repairs output that the Swift emitter gets wrong today — most importantly, base
fields dropped from types that `extend` another type, which affects three
`Property` subtypes and all five `Tool` subtypes.

The shim is a scripted post-generation step, so the generated files are still
never hand-edited. It is pinned to the emitter version it was written against and
**fails loudly** rather than silently mis-patching when it sees a version it does
not recognise, when an anchor it expects is missing, or when it finds a file in a
half-patched state.

Each defect has been reported upstream. When a release fixes one, delete the
corresponding patch and re-run generation: the shim is meant to shrink to nothing
and then be removed.

`GeneratedModelRoundTripTests` covers every field the shim injects, so a silently
regressed patch fails the suite rather than the runtime.

## Conformance

`Tests/PromptyTests` runs the shared vectors from [`spec/vectors`](../../spec/vectors)
— loading, rendering, parsing, provider wire format, response processing, and
harness replay — plus Swift-specific regression tests for defects the vectors
cannot express, such as Windows line endings.

### Coverage against the shared vectors

This port is **not parity-complete**. Six of the ten shared vector files are
exercised, and two of those six run only their OpenAI subset. The other four
describe surface area this runtime does not implement. That is a deliberate
scoping decision for an initial port, not an oversight.

| Vector file                             |   Cases | Status                                |
| --------------------------------------- | ------: | ------------------------------------- |
| `load/load_vectors.json`                |      25 | Run                                   |
| `render/render_vectors.json`            |      23 | Run                                   |
| `parse/parse_vectors.json`              |      15 | Run                                   |
| `wire/wire_vectors.json`                | 22 / 27 | Run — 5 Anthropic cases skipped       |
| `process/process_vectors.json`          | 17 / 21 | Run — 4 Anthropic cases skipped       |
| `harness/replay_vectors.json`           |       5 | Run                                   |
| `engine/turn_vectors.json`              |       5 | **Not wired** — engine incomplete     |
| `agent/agent_vectors.json`              |      28 | **Not implemented** — no agent layer  |
| `discovery/discovery_vectors.json`      |       7 | **Not implemented** — no discovery    |
| `discovery/enrichment_vectors.json`     |       9 | **Not implemented** — no enrichment   |

The nine skipped Anthropic cases are provider coverage, not a contract gap: this
package ships the OpenAI provider only, so `WireVectorTests` and
`ProcessVectorTests` filter on `input.provider`. An Anthropic package would pick
them up unchanged.

The turn engine is the substantive gap. `ReferenceTurnRunner` already implements
the iteration loop, permission mediation, host tool execution, and checkpointing,
so three of the five engine vectors (`final_output`, `ordered_tool_round`,
`permission_denial_is_model_visible`) describe behavior that exists but is not
yet asserted against the shared file. The remaining two — `delegated_provider_state`
and `cancel_before_context` — need delegated provider state and cancellation,
which this port does not provide. Wiring the engine vectors and closing those two
capabilities is follow-up work tracked separately from this PR.
