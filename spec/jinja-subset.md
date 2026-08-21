# The Prompty Jinja Subset

**Status**: Draft · **Tracking**: [microsoft/prompty#492](https://github.com/microsoft/prompty/issues/492)
· **Companion to**: [`spec.md`](spec.md) §5 (Rendering)

> This document defines the **Prompty Jinja Subset**: the explicit set of Jinja2
> template features, and their whitespace/control semantics, that **every** runtime's
> default (`format.kind == "jinja2"`) renderer MUST implement **identically**. It is the
> contract the shared `Renderer.render` conformance vectors
> ([`schema/model/conformance/vectors/render.tsp`](../schema/model/conformance/vectors/render.tsp))
> enforce across all runtimes.
>
> `.prompty` files are authored once and expected to render byte-for-byte identically in
> Python, C#, Rust, TypeScript, Java, Swift, and Go. Full Jinja2 is a large, engine-specific
> surface; guaranteeing cross-runtime identity over all of it is not feasible. This subset is
> the deliberately small, portable floor we DO guarantee.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHOULD**, **MAY**, and
**OPTIONAL** are interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

---

## §1 Engines per runtime

Each runtime binds the `"jinja2"` renderer key to a different underlying engine. This is the
root cause of divergence risk: the subset is what these seven engines must agree on.

| Runtime    | Engine                          | Kind                        | Renderer source |
| ---------- | ------------------------------- | --------------------------- | --------------- |
| Python     | `jinja2` (sandboxed)            | Reference Jinja2            | `runtime/python/prompty/prompty/renderers/jinja2.py` |
| C#         | `Jinja2.NET` 1.4.1              | Third-party Jinja2 port     | `runtime/csharp/Prompty.Core/Jinja2Renderer.cs` |
| Rust       | `minijinja`                     | Jinja2-compatible           | `runtime/rust/prompty/src/renderers/nunjucks.rs` |
| TypeScript | `nunjucks`                      | Jinja2-compatible           | `runtime/typescript/packages/core/src/renderers/nunjucks.ts` |
| Java       | `jinjava` (HubSpot)             | Jinja2-compatible           | `runtime/java/prompty/src/main/java/com/microsoft/prompty/renderers/JinjaRenderer.java` |
| Swift      | hand-written subset parser      | Custom recursive-descent    | `runtime/swift/prompty/Sources/Prompty/Jinja2Renderer.swift` |
| Go         | _(none — no renderer yet)_      | Absent layer                | — (adapter-level waiver) |

**Python (`jinja2`) is the reference.** When this document says "the expected result", it
means what stock `jinja2` produces. The render vectors were derived from it.

---

## §2 REQUIRED features (the conformance floor)

The default renderer MUST support every feature in this section, producing output identical
to the reference engine. Each row lists the enforcing render vector where one exists.

### §2.1 Variable substitution & attribute access

| Feature                        | Syntax                              | Vector |
| ------------------------------ | ----------------------------------- | ------ |
| Scalar substitution            | `{{ name }}`                        | `simple_substitution` |
| Multiple / mixed-type vars     | `{{ a }} {{ b }} {{ n }}`           | `multiple_variables` |
| Dotted attribute access        | `{{ user.name }}`, `{{ a.b.c }}`    | `nested_object` |
| Undefined variable → empty     | `{{ missing }}` → `""`              | `missing_variable_renders_empty` |
| No HTML escaping               | `{{ "<b>" }}` → `<b>` (verbatim)    | `html_not_escaped` |

- Integers and other scalars MUST stringify as the reference does (`30`, not `30.0`).
- An **undefined** variable MUST render as the empty string, never raise, never print
  `Undefined` / `null` / `None`. (Renderers configure lenient/keep-going undefined behavior.)
- Output MUST NOT be HTML-escaped. Prompts are text sent to a model, not markup.
- Whitespace **inside** the `{{ … }}` delimiters is insignificant: `{{name}}` and
  `{{ name }}` are equivalent.

### §2.2 Conditionals

```jinja
{% if cond %}…{% elif other %}…{% else %}…{% endif %}
```

- `if`, `else`, `endif` are REQUIRED. `elif` is REQUIRED.
- Truthiness MUST follow the reference: `false`, `0`, `""`, empty list/map, and
  undefined are falsy; everything else is truthy.
- Vectors: `conditional_block` (true branch), `conditional_false` (else branch).

### §2.3 Loops

```jinja
{% for item in list %}…{% endfor %}
```

- `for … in …` / `endfor` are REQUIRED over lists.
- The loop body is emitted once per element with `item` bound in the inner scope.
- Literal text in the body (including spaces — see §3) MUST be preserved verbatim.
- Vector: `for_loop` — `"Items: {% for item in items %}{{item}} {% endfor %}"` with
  `["a","b","c"]` MUST render `"Items: a b c "`.
- The `loop` helper variable (`loop.index`, `loop.first`, …) is **OPTIONAL** (§4).

### §2.4 Comments

```jinja
Hello{# not rendered #} World
```

- `{# … #}` comments MUST be stripped and produce no output.
- Vector: `jinja2_comment` → `"Hello World"`.

### §2.5 Filters

The following filters are REQUIRED and MUST match reference semantics:

| Filter    | Example                        | Result        | Vector |
| --------- | ------------------------------ | ------------- | ------ |
| `upper`   | `{{ "hello" \| upper }}`       | `HELLO`       | `filter_basic`, `filter_upper` |
| `lower`   | `{{ "HELLO" \| lower }}`       | `hello`       | `filter_lower` |
| `trim`    | `{{ "  hi  " \| trim }}`       | `hi`          | `filter_trim` |
| `join`    | `{{ list \| join(", ") }}`     | `a, b, c`     | `filter_join` |
| `length`  | `{{ list \| length }}`         | `5`           | `filter_length` |
| `default` | `{{ missing \| default("x") }}`| `x`           | `default_filter` |

- `default` MUST fall back when the value is undefined. (Reference `default` falls back on
  *undefined* only unless `default(v, true)` is given; the subset requires at least the
  undefined-fallback behavior the vector asserts.)
- Filter argument whitespace is insignificant: `{{ x|upper }}` ≡ `{{ x | upper }}`.

Any other filter is **OPTIONAL** (§4). A `.prompty` file that relies on a non-listed filter
is not guaranteed to be portable.

---

## §3 Whitespace & control semantics (normative)

This is the crux of #492 — the C# divergence is a whitespace bug. The subset pins whitespace
behavior explicitly so "renders identically" is unambiguous.

### §3.1 Default whitespace is significant and preserved

Outside of tag-trim markers (§3.2), the renderer MUST preserve **all** literal characters of
the template verbatim, including spaces, tabs, and newlines — **including** whitespace-only
text that sits directly between two tags.

- Vector `whitespace_preserved`: `"line1\n  line2\n    line3"` → unchanged.
- Vector `for_loop`: the single space between `{{item}}` and `{% endfor %}` is a literal text
  node and MUST survive each iteration → `"Items: a b c "`.

> **Normative statement.** A literal text node that consists solely of spaces and/or tabs and
> is positioned between two template tags (`{{…}}`, `{%…%}`, `{#…#}`) MUST be emitted
> unchanged. Runtimes MUST NOT strip, collapse, or trim such nodes. This is the exact behavior
> stock `jinja2`, `minijinja`, `nunjucks`, and `jinjava` exhibit by default, and it is where
> `Jinja2.NET` diverges (§5.2).

### §3.2 Trim markers `{%- … -%}` / `{{- … -}}`

Explicit trim markers are the **only** sanctioned way to remove surrounding whitespace:

- `{%-` / `-%}` (and `{{-` / `-}}`) strip whitespace immediately **before** / **after** the
  tag, respectively, up to and including adjacent newlines, exactly as the reference does.
- Renderers MUST honor trim markers where present and MUST NOT apply trimming where they are
  absent.

**Classification:** trim markers are REQUIRED of engine-backed runtimes (they come for free
with `jinja2`/`minijinja`/`nunjucks`/`jinjava`). The hand-written Swift renderer does **not**
implement them today (§5.3); this is a tracked gap. There is currently **no render vector**
exercising trim markers — adding one is a follow-up (§6) so the contract is machine-enforced
rather than prose-only.

### §3.3 Newlines and blank lines

- Newlines are literal characters and MUST be preserved (§3.1). They are **not** horizontal
  whitespace and MUST NOT be trimmed except by explicit trim markers.
- `trim_blocks` / `lstrip_blocks` (Jinja2 environment options that auto-strip the newline
  after a block tag and leading line whitespace) MUST be **OFF**. Enabling them silently
  changes output and breaks cross-runtime identity.

### §3.4 Role markers & nonces pass through unchanged

- The renderer does not interpret role markers (`system:`, `user:`, `assistant:`); they are
  literal text passed through for the parser (§6 of `spec.md`). Vector: `role_markers_preserved`.
- `thread`/`image`/`file`/`audio` inputs are replaced with a nonce **before** rendering; the
  renderer treats the nonce as an opaque string. Vector: `thread_nonce_injection`.

---

## §4 OPTIONAL / out of scope

Runtimes MAY support these, but portability across runtimes is **not** guaranteed and no
vector enforces them:

- The `loop` object inside `for` (`loop.index`, `loop.first`, `loop.last`, …).
- `for … else` clauses.
- Filters beyond the six in §2.5 (`replace`, `capitalize`, `first`, `last`, `tojson`, …).
  (Some runtimes ship extras — e.g. Swift adds `capitalize`, `first`, `last`, `reverse`,
  `string`, `int`, `tojson` — but relying on them makes a template non-portable.)
- Tests (`is defined`, `is none`, `is number`, …).
- Template inheritance (`{% extends %}`, `{% block %}`), includes, imports, macros.
- `{% set %}`, `{% with %}`, whitespace-sensitive `{% filter %}` blocks.
- Arithmetic / rich expressions in `{{ … }}` beyond attribute access and filters.

Explicitly **forbidden** regardless of engine capability:

- Arbitrary code execution, filesystem access, or network calls from a template. Engines
  SHOULD run sandboxed (`spec.md` §5.5). Prototype-chain escape hatches (`__proto__`,
  `constructor`, `prototype`) MUST be stripped/blocked (see the C#/TS sanitizers).

---

## §5 Conformance audit

Method: rendered every `render.tsp` vector through each runtime's engine and read each
renderer's source. "Verified" = executed; "Source-verified" = confirmed by reading the
implementation; "Reference" = the engine the vectors are derived from.

| Runtime    | Subset conformance                | Evidence |
| ---------- | --------------------------------- | -------- |
| Python     | ✅ Conformant (reference)          | **Verified** — 23/23 render vectors pass (`pytest tests/model/test_vector_conformance.py -k render`); reference `jinja2`, keep-trailing-newline on, sandboxed. |
| Rust       | ✅ Conformant                      | Source-verified; in-crate unit tests assert `for_loop` → `"Items: a b c "`. |
| TypeScript | ✅ Conformant                      | Source-verified `nunjucks`, `autoescape:false`, `throwOnUndefined:false`. |
| Java       | ✅ Conformant                      | Source-verified `jinjava`, `failOnUnknownTokens(false)`, unknown var → empty. |
| Swift      | ⚠️ Conformant to current vectors; **no trim-marker support** | Source-verified (§5.3). |
| Go         | ⏸️ No renderer (absent layer)      | Adapter-level `Renderer.render` waiver in `vectoradapters.go`. |
| **C#**     | ❌ **Divergent** — drops space/tab-only text nodes between tags | **Verified** repro (§5.2). |

### §5.1 Engine-backed runtimes (Python, Rust, TS, Java)

All four wrap a mature Jinja2-compatible library configured for: no HTML escaping, lenient
undefined → empty string, and default (significant) whitespace. They pass the full render
vector set and support trim markers by virtue of the underlying engine. No divergences found.

### §5.2 C# — `Jinja2.NET` 1.4.1 (the #492 divergence) — VERIFIED

**Symptom.** A literal text node made up **only** of spaces/tabs, positioned directly between
two tags, is discarded. Any other character in the node — a letter, punctuation, or a
**newline** — protects the whole node.

Minimal repros (context `items=["a","b","c"]`, `flag=true`):

| Template                                             | Reference (`jinja2`) | `Jinja2.NET` 1.4.1 |
| ---------------------------------------------------- | -------------------- | ------------------ |
| `Items: {% for i in items %}{{i}} {% endfor %}`      | `Items: a b c `      | `Items: abc` ❌     |
| `{% for i in items %} {{i}}{% endfor %}`             | ` a b c`             | `abc` ❌            |
| `{% for i in items %}{{i}}\t{% endfor %}`  (tab)     | `a\tb\tc\t`          | `abc` ❌            |
| `{% for i in items %}{{i}}, {% endfor %}`            | `a, b, c, `          | `a, b, c, ` ✅      |
| `{% for i in items %}[{{i}}] {% endfor %}`           | `[a] [b] [c] `       | `[a] [b] [c] ` ✅   |
| `{% for i in items %}{{i}}\n{% endfor %}`  (newline) | `a\nb\nc\n`          | `a\nb\nc\n` ✅      |
| `{% for i in items %}a b c{% endfor %}`              | `a b ca b ca b c`    | `a b ca b ca b c` ✅ |
| `{% if flag %}a b c{% endif %}`                      | `a b c`              | `a b c` ✅          |

**Rule.** `Jinja2.NET` treats a pure horizontal-whitespace (space/tab) text node between two
tags as insignificant and drops it — as if `{%-`/`-%}` trim were unconditionally on for
whitespace-only gaps. Everything else (interior spaces, spaces guarded by any non-ws char,
newlines) renders correctly. It is narrow but real, and it hits the common
`{% for %}{{x}} {% endfor %}` "space-separated list" idiom.

**Failing conformance test:** `VectorConformanceTests.Vector95RendererRenderForLoop`
(`dotnet test … --filter FullyQualifiedName~Vector95RendererRenderForLoop`):

```
Expected: "{"rendered":"Items: a b c "}"
Actual:   "{"rendered":"Items: abc"}"
```

These CI checks are **advisory** (no required status checks on `main`), so this does not gate
merge — but it is a genuine, authored-once-render-anywhere break.

### §5.3 Swift — hand-written subset parser — trim-marker gap

The Swift renderer is a bespoke recursive-descent parser, not a Jinja2 library. Audit
findings from `Jinja2Renderer.swift`:

- ✅ Default whitespace is correct: literal text (including whitespace-only text between tags)
  is accumulated verbatim; only the **tag interior** is trimmed (`readDelimited` →
  `trimmingCharacters(in: .whitespaces)`), which is correct.
- ❌ **No `{%-` / `-%}` trim-marker support.** A tag interior beginning with `-` is trimmed to
  a keyword of `-`, which is not `if`/`for`/`endif`/`endfor`/`else`/`elif`, so the parser
  throws `unsupported template tag`. Repro (source-level): `{%- if x %}a{% endif %}` → parse
  error rather than trimmed output.
- ⚠️ Iteration over a map yields **sorted keys** (`iterate` sorts `dict.keys`); the reference
  iterates dict items. No current vector exercises map iteration, so this is latent.

Swift passes every current render vector but is **not** trim-marker conformant. Because no
vector tests trim markers yet, this gap is prose-only until §6's follow-up vector lands.

### §5.4 Go — absent layer

Go ships the generated model layer, discovery mapper, and reference turn engine, but **no**
`.prompty` loader/renderer/parser. `Renderer.render` is honestly waived at the adapter level
in `runtime/go/prompty/vectoradapters/vectoradapters.go` (`absentPipeline`). This is an
absent-layer gap, not a divergence — there is no engine to audit.

---

## §6 Divergences & resolution plan

| # | Runtime | Divergence | Enforced by vector? | Resolution |
| - | ------- | ---------- | ------------------- | ---------- |
| 1 | C#      | Drops space/tab-only text nodes between tags (§5.2) | **Yes** (`for_loop`, currently failing) | §6.1 |
| 2 | Swift   | No `{%-`/`-%}` trim markers (§5.3) | No (needs new vector) | §6.2 |
| 3 | Swift   | Map iteration order = sorted keys (§5.3) | No | Track only; add vector if it matters |

### §6.1 Resolving the C# divergence (primary)

Two paths, per the #492 plan:

- **(a) Replace `Jinja2.NET`** with a conformant engine (e.g. Scriban or Fluid) behind a
  Jinja-compat shim. **Highest fidelity, highest risk**: every existing `.prompty` template
  and all render vectors must be re-validated, and Scriban/Fluid are Liquid-family, not
  Jinja2 — the shim would be substantial. This is a product decision with migration risk
  across all C# templates.
- **(b) Fix `Jinja2.NET` upstream** (or vendor/patch it): the bug is narrow (pure-ws text
  nodes between tags), so a targeted lexer/whitespace fix is plausible and far lower blast
  radius than an engine swap. Preferred **if** upstream is responsive or vendoring is
  acceptable.

A lightweight **(c) pre-render shim** — protecting whitespace-only inter-tag nodes before
handing the template to `Jinja2.NET`, then unprotecting — is possible but fragile (it must
correctly tokenize tags/strings/comments to know what "between tags" means) and is a stopgap
at best. Recommend (b), fall back to (a).

Until resolved, the failing vector should be **honestly waived per-vector** (§7), not hidden
by dropping the whole `Renderer.render` adapter (which would silently un-cover the 20+ passing
render vectors).

### §6.2 Add trim-marker render vectors

To make §3.2 machine-enforced rather than prose, add render vectors such as
`for_loop_trim` (`{% for i in items %}{{i}}{%- endfor %}` and `{%- … -%}` forms) and a
`whitespace_trim_marker` case. This will (correctly) surface the Swift gap and any others, and
turn "trim markers are REQUIRED" into an enforced contract. Sequence this **after** the C# fix
so C#'s adapter isn't juggling two failures at once.

---

## §7 Per-vector waiver mechanism (harness proposal)

**Problem.** The shared vector harness (upstream `sethjuarez/typra`, emitted into each runtime)
supports **only adapter-level, all-or-nothing** waivers. In the C# harness
(`VectorConformanceTests.RunVector`), the waiver lookup fires **only when no adapter is
registered** for an operation:

```csharp
if (!adapters.TryGetValue(operationKey, out var adapter) && !adapters.TryGetValue(operation, out adapter))
{
    var waivers = VectorAdapters.Waivers();
    if (waivers.TryGetValue(operationKey, out var reason) …) { /* SKIP */ }
    Assert.Fail(…);
}
```

Because C# **does** register a `Renderer.render` adapter (and should — it covers 20+ vectors),
there is no way to waive the single `for_loop` vector. It's all-or-nothing: keep the adapter
and fail `for_loop`, or drop the adapter and dishonestly un-cover every render vector.

**Proposal.** Extend the emitted harness (in `sethjuarez/typra`, so all runtimes inherit it)
to support a **per-vector** waiver keyed by `"<Contract>.<operation>:<vectorName>"`, consulted
**even when an adapter is registered**. Shape (illustrative):

```
VectorWaivers (per-vector) = {
  "Renderer.render:for_loop": {
    reason: "Jinja2.NET 1.4.1 drops space/tab-only text nodes between tags; see spec/jinja-subset.md §5.2",
    tracking: "https://github.com/microsoft/prompty/issues/492",
  }
}
```

Harness behavior when a per-vector waiver matches:

1. Still **invoke** the adapter and compare — so a waived vector that *starts passing* is
   detected (an "unexpectedly passing waiver" should warn/fail so waivers don't rot), **or**
2. Skip with a visible `SKIP … (waived: reason [tracking])` line.

Option (1) ("expected-fail") is preferable: it keeps the divergence visible, requires a
documented reason + tracking link, is scoped to exactly one runtime + one vector, and
auto-detects when the underlying engine is fixed. This is the honest analogue of an xfail.

**Constraints observed.** `VectorConformanceTests.cs` and the runtime `vectoradapters` harness
plumbing are emitter-owned (`DO NOT EDIT`), so this MUST be implemented in the upstream Typra
emitter and regenerated — not hand-patched into the generated file. Runtimes would then
declare per-vector waivers in their editable `VectorAdapters`/`vectoradapters` module.

---

## §8 Summary

- The **Prompty Jinja Subset** = variable substitution + dotted access, `if`/`elif`/`else`,
  `for`, comments, six filters (`upper`/`lower`/`trim`/`join`/`length`/`default`), no HTML
  escaping, undefined→empty, **significant/preserved whitespace**, and explicit `{%-`/`-%}`
  trim markers. Everything else is OPTIONAL and non-portable.
- Audit: Python/Rust/TS/Java conformant; Swift conformant to current vectors but lacks trim
  markers; Go has no renderer (honest absent-layer waiver); **C# `Jinja2.NET` diverges** by
  dropping whitespace-only inter-tag text nodes (verified).
- Fix path: prefer an upstream/vendored `Jinja2.NET` whitespace fix (b) over a full engine
  swap (a); add trim-marker vectors; and add a **per-vector expected-fail waiver** to the
  upstream Typra harness so the one known C# divergence can be honestly, visibly waived while
  the 20+ passing render vectors stay enforced.
