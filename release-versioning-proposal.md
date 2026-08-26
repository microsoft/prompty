# Prompty Release & Versioning Proposal (post-beta)

**Status:** Draft for review · Author: session with @sethjuarez · Date: 2026-08-23
**Decision needed:** Adopt (or amend) before cutting `2.0.0` stable.

---

## 1. Problem statement

Prompty is **one spec** (`.prompty` file format) with **many implementations**
(python, typescript, csharp, rust, java, swift). The current release process:

- Version bump is **manual and discretionary** (`scripts/release.py --bump minor`);
  the human decides major/minor/patch — nothing ties the bump to what actually changed.
- The Python release script **pushes commit + tag directly to `main`** locally, then the
  tag triggers PyPI publish. No review gate, no provenance on the version decision.
- Every runtime versions **independently already** (tag namespaces `python/`, `typescript/`,
  `csharp/`, `rust/`), but there is **no documented contract** for which runtime version
  supports which `.prompty` format version.
- No automated changelog; release notes are ad hoc.

What's **already good** (keep it):

- Per-runtime tag namespacing (`python/2.0.0b3`, `typescript/*`, `csharp/*`, `rust/*`).
- A "verify tag matches source version" guard in **every** publish workflow.
- OIDC / trusted publishing (PyPI, npm provenance, NuGet OIDC). Rust still uses a token secret.

---

## 2. Core recommendation

Adopt a **two-layer versioning model**:

1. **Format version** — versions the `.prompty` schema itself (the compatibility currency).
2. **Runtime versions** — each language package versions **independently** via
   Conventional Commits + automated release PRs, and **declares which format version(s)
   it supports**.

This keeps per-package versions **honest** (a bump means that package changed) while giving
users **one stable answer** to "are these compatible?" — they compare against the format
version, not against each other.

> Rejected alternative — **lockstep** (all runtimes share one number): produces hollow
> "no changes" releases, couples cadence to the slowest runtime, and makes patch numbers lie.
> Only worth it if we want to market "Prompty 2.3" as a single product line. We can revisit,
> but independent is the lower-friction match for the repo as it exists today.

---

## 3. Format version contract

### 3.1 Scheme

- The `.prompty` file format gets its own version, **`format: N`** (a single integer, or
  `MAJOR.MINOR` if we want additive vs breaking granularity). Source of truth: the in-repo
  TypeSpec/Typra model + `Prompty.yaml` JSON Schema.
- **Bump MAJOR** when a valid old file stops loading, or field semantics change incompatibly.
- **Bump MINOR** (if we use `MAJOR.MINOR`) for additive, backward-compatible fields.
- The format version is **independent of any runtime's semver**. Runtime `2.x` and `3.x`
  can both speak format `2`.

### 3.2 How files declare it (optional, additive)

Today `.prompty` files carry no `format:` marker and the loader injects `kind: prompt`.
Proposed: allow an **optional** top-level `format:` key in frontmatter. When absent, the
loader assumes the current default and may emit an info/deprecation note — matching the
existing legacy-migration philosophy in the loader. This stays backward compatible.

### 3.3 Compatibility matrix (lives in `/docs` + each package README)

| Runtime pkg      | Version line | Supports format |
| ---------------- | ------------ | --------------- |
| `prompty` (py)   | `2.x`        | `2`             |
| `@prompty/core`  | `2.x`        | `2`             |
| `Prompty.Core`   | `2.x`        | `2`             |
| `prompty` (rust) | `2.x`        | `2`             |

Rule of thumb: a runtime MAJOR bump is required only when it **drops** support for a format
version it previously accepted — not merely because its own API changed.

---

## 4. Semantic versioning rules per runtime

Standard SemVer, with the public contract defined as **(a) the package's public API** and
**(b) the set of `.prompty` format versions it accepts**:

- **MAJOR** — remove/rename public API, or drop a previously-supported format version.
- **MINOR** — additive API, new provider/tool support, accept a new format version.
- **PATCH** — bug fixes, perf, docs, internal refactors, security fixes (like PR #502).

Exit beta by cutting **`2.0.0`** for each runtime that's ready; runtimes not ready stay on
their own prerelease line (PEP 440 `bN` / npm `-alpha`, etc.). Independence means Swift can
still be `b`-something while Python is `2.0.0`.

---

## 5. Automation: Conventional Commits + release-please

### 5.1 Commit convention

Adopt **Conventional Commits** (already partially in use — e.g. `chore(python): release …`,
`fix: avoid shell interpretation …`). Scope = runtime:

```
feat(python): add anthropic provider          → minor
fix(rust): handle empty tool list             → patch
feat(ts)!: rename load() to loadPrompty()      → major (! or BREAKING CHANGE:)
chore(python): …                               → no release
docs: …                                        → no release
```

Enforce with a lightweight commit-lint check in `hygiene.yml` (warn first, block later).

### 5.2 release-please, one config per runtime

Use **googleapis/release-please** in **manifest mode** so each runtime is its own release
"package" with its own version, changelog, and release PR:

- On merge to `main`, release-please opens/updates a **release PR per runtime** that has
  unreleased Conventional Commits: bumps the version file, updates `CHANGELOG.md`.
- Merging that release PR creates the git tag in the runtime's existing namespace
  (`python/2.1.0`, `typescript/2.1.0`, …).
- The **existing publish workflows fire unchanged** — they already trigger on those tags and
  already verify tag == source version. release-please just replaces the manual
  `scripts/release.py` bump+push step.

Sketch `release-please-config.json`:

```json
{
  "separate-pull-requests": true,
  "tag-separator": "/",
  "packages": {
    "runtime/python/prompty": {
      "release-type": "python",
      "component": "python",
      "version-file": "prompty/_version.py"
    },
    "runtime/typescript": {
      "release-type": "node",
      "component": "typescript"
    },
    "runtime/csharp": {
      "release-type": "simple",
      "component": "csharp",
      "extra-files": ["Prompty.Core/Prompty.Core.csproj"]
    },
    "runtime/rust": {
      "release-type": "rust",
      "component": "rust"
    }
  }
}
```

(Exact `version-file` / `extra-files` wiring needs a validation pass against each runtime's
version source — noted as open work, not settled here.)

### 5.3 What `scripts/release.py` becomes

- Retire it as the primary path (release-please owns bump + tag).
- Optionally keep a thin **`--dry-run` preview** / manual-escape-hatch version, but drop the
  `shell=True` invocation entirely (PR #502 is the interim fix; the real fix is not shelling
  out for releases at all).

---

## 6. Migration plan (incremental, low-risk)

1. **Pilot on Python** (it's furthest along + the one we're actively touching):
   - Add Conventional Commit linting (warn-only).
   - Add release-please for `runtime/python/prompty` only.
   - Keep manual script available as fallback for one or two releases.
2. **Publish the format-version contract doc** + compat matrix; add optional `format:` key
   support to the loader (additive, backward compatible).
3. **Cut `2.0.0` stable for Python** via the new flow to prove it end-to-end.
4. **Roll out** release-please configs to ts / csharp / rust (their publish workflows already
   accept the tags).
5. **Retire** `scripts/release.py` shell path once every runtime is on release-please.
6. Standardize Rust onto a trusted-publishing token story consistent with the others (cleanup).

---

## 7. Open questions to noodle on

1. Format version granularity: single integer `format: 2` vs `MAJOR.MINOR` (`2.1`)?
2. Do we ever want a **marketing** umbrella version ("Prompty 2") decoupled from package
   numbers, for docs/site messaging?
3. Should the optional `format:` key eventually become **required** at a future format MAJOR?
4. Runtimes at different maturity (swift/java still early) — do they exit beta on their own
   timeline, or do we gate the `2.0.0` announcement on a minimum set?
5. Changelog aggregation: per-runtime `CHANGELOG.md` only, or also a root aggregated view?
6. Commit-lint: warn-only indefinitely, or hard-block after a grace period?

---

## 9. Live provider conformance vectors (cross-runtime)

Separate but related idea that came up while reviewing the release plan: extend the
existing `@vector` conformance system to cover **live provider behavior**, so every runtime
exercises real OpenAI / Anthropic / Foundry endpoints in CI — and self-waives when keys
are absent.

### 9.1 Why this is the right layer

The repo already has a cross-runtime vector system:

- `@vector` cases are declared once in the **TypeSpec schema** (source of truth).
- **Typra emits `test_vector_conformance.py` into every runtime** automatically — so a
  vector added once shows up in py / ts / csharp / rust / … with no per-language work.
- Each runtime hand-authors `vector_adapters.py`, registering
  `VECTOR_ADAPTERS["Contract.operation"] = {invoke, normalize}` as the single seam.
- The harness already resolves `$env`, `$file`, `$json` refs in vector input — so
  **credential injection via `$env` already exists** (reads `os.environ`, returns `""`
  when missing).

So "emitted in every language → shows up in CI" is a property we get for free.

### 9.2 Key insight — structure is the contract, not content

Live LLM responses are non-deterministic, so we do **not** assert on content. We assert that
a live response **maps into a schema-valid instance of the canonical types** — the same kind
of structural assertion the offline vectors already make, just fed by a live call instead of
a fixture. The adapter reduces the live response to **shape, not values**.

| Live vector       | Structural assertion (not content)                                              |
| ----------------- | ------------------------------------------------------------------------------- |
| chat              | normalizes to `Message`, `role=assistant`, `content` non-empty, `finishReason ∈ enum` |
| tool call         | yields a `ToolCall` with `name` + `arguments` parsing as a JSON object of the declared shape |
| embedding         | float vector of the model's expected dimensionality (structural + deterministic) |
| structured output | response JSON validates against the declared `outputs` schema                    |
| streaming         | chunks reassemble into the same structural shape as the non-streamed response   |

No fuzzy matchers, no golden content, no per-model brittleness — the projection is "conforms
to the type," which is exactly what the schema already defines. Assertions stay exact-match
at the harness level.

### 9.3 Skip semantics — a new, principled axis

Today the harness **never skips silently**: a missing adapter is a hard fail; `VECTOR_WAIVERS`
are explicit and reasoned. Live vectors add a **third, distinct axis**:

- **waiver** — this runtime does not implement the behavior (existing).
- **credentials-absent** — environment has no key → legitimate `pytest.skip`
  (`"credentials absent: ANTHROPIC_API_KEY"`). Environmental, not a conformance dodge. **New.**
- **failure** — implemented, keys present, wrong structure.

Mechanism: add a `requires: [ENV_KEYS]` field to live vectors. The harness checks presence and
skips as *credentials-absent* when missing. Consequence: the suite lights up wherever secrets
exist (each runtime's CI) and self-waives everywhere else — including **fork PRs**, which can't
see secrets. That fork-PR behavior is a feature, not a gap.

### 9.4 Shape of the work

1. Define a live-conformance contract in the schema (e.g. `LiveChatConformance.complete`,
   `LiveEmbeddingConformance.embed`, …) with `requires` credential lists and **structural**
   `expected` shapes.
2. Typra emits the vectors into every runtime (no per-language authoring of the cases).
3. Each runtime authors one adapter per live operation: call the provider, normalize the
   response to its structural shape.
4. Add a `requires`/credentials-absent skip axis to the harness (schema + emitter change,
   applied uniformly across runtimes).
5. Add an **opt-in CI job per runtime** wired to that runtime's secrets/environment. Default
   PR checks stay offline; the live job runs on `main` / release branches (and skips cleanly
   without secrets).

### 9.5 Costs / caveats

- Live vectors in **every** runtime's CI multiply API cost by the number of runtimes and add
  flakiness — structural (not content) assertions are what keep them stable.
- Secrets must be provisioned per runtime CI environment; keep them out of fork-PR context.
- Ties into §3: these vectors also become the enforcement mechanism for the **format-version
  contract** — "does runtime X actually accept format N" can be a vector.

### 9.6 Open questions

1. One live contract per API type (chat/embedding/image/tool/structured/streaming), or one
   umbrella `LiveConformance` with an operation per shape?
2. Where do live vectors run — every push to `main`, nightly, or pre-release only (cost)?
3. Do we assert model-specific structural facts (e.g. embedding dimensionality) per provider,
   or keep vectors provider-agnostic and let the adapter supply expected dims?
4. Should `credentials-absent` skips be **reported** (surfaced in a summary) so we can see which
   providers a given CI env actually covered, rather than silently green?

---

## 10. TL;DR

- Keep **independent** runtime versions; add an explicit **format-version contract** as the
  real compatibility currency.
- Move bumps from manual `scripts/release.py` → **Conventional Commits + release-please**
  (release PRs, auto changelog), reusing the **existing per-runtime tag → publish** workflows.
- Exit beta by cutting **`2.0.0`** per runtime, piloting on Python first.
- Extend the `@vector` system with **live provider conformance vectors** that assert
  **structure, not content**, emitted into every runtime and self-waiving as
  *credentials-absent* when keys are missing.
