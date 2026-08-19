# Prompty for Java

The Java implementation of the Prompty runtime.

Prompty is a markdown-based asset format (`.prompty`) for LLM prompts: YAML
frontmatter describes the model, inputs, outputs, tools and template
configuration, and the markdown body becomes the prompt instructions. The
runtime loads, renders, parses, executes and processes those assets.

> **Status:** in development. The generated model layer and its example suites
> are complete; the loader, renderers, parser, pipeline and providers are being
> ported from the Rust reference implementation.

## Layout

| Module              | Contents                                                        |
| ------------------- | --------------------------------------------------------------- |
| `prompty`           | Canonical generated model + loader, renderers, parser, pipeline |
| `prompty-openai`    | OpenAI provider (executor + processor)                          |
| `prompty-anthropic` | Anthropic provider (executor + processor)                       |
| `prompty-foundry`   | Azure AI Foundry provider (executor + processor)                |

## The model layer is generated — do not edit it

`prompty/src/main/java/com/microsoft/prompty/model/` and
`prompty/src/test/java/com/microsoft/prompty/model/` are emitted from the
TypeSpec definition in [`schema/`](../../schema) by the Typra emitter. They are
the single canonical model layer for this runtime; there is no hand-written
duplicate. Regenerate with:

```bash
cd schema
npm install      # first time only
npm run generate
```

`npm run generate` runs `tsp compile` followed by
`schema/scripts/normalize-typra-output.mjs`, which applies a deterministic,
idempotent normalization pass to the emitted Java (see
`schema/scripts/normalize-java-output.mjs`). That shim exists only because the
Typra Java backend currently emits source that does not compile and that
diverges from the C#/Rust/Go/Python backends; every defect it works around is
documented at the top of the shim and has been reported upstream. The shim is
part of the generation pipeline, not a manual edit — running the pipeline twice
from a clean tree produces byte-identical output.

The emitter also produces example-driven suites next to the model. They are
package-private, so `GeneratedExamplesTest` discovers the compiled
`*GeneratedTest` classes by reflection and runs each as a named dynamic test,
which keeps the suite in step with the schema without a checked-in registry.
`ModelNormalizationTest` covers the behaviour the shim adds on top of the
emitter output, which the generated examples do not exercise.

## Building

The Gradle wrapper provisions Gradle itself; a JDK is required to run it. The
build pins a Java 21 toolchain, so a newer JDK works as long as Gradle can
locate or provision a 21 toolchain.

```bash
cd runtime/java
./gradlew build          # compile + unit tests
./gradlew :prompty:test  # unit tests for the core module only
```

## Live provider tests

Tests tagged `live` call real providers and are excluded from the default `test`
task. They read credentials from the process environment; the test support code
also reads `runtime/java/.env` when present so the file does not have to be
exported manually.

```bash
cp .env.example .env     # then fill in credentials
./gradlew test -PliveTests
```

`.env` is git-ignored and must never be committed.
