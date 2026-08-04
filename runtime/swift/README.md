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

`spec/vectors/engine/turn_vectors.json` describes a full turn engine that this
port does not implement yet; those vectors are not run.
