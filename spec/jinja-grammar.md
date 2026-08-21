# The Prompty Jinja Subset — Grammar, AST & Semantics

**Status**: Draft · **Tracking**: [microsoft/prompty#492](https://github.com/microsoft/prompty/issues/492)
· **Companion to**: [`jinja-subset.md`](jinja-subset.md) (the normative feature floor)

> [`jinja-subset.md`](jinja-subset.md) defines _what_ features the renderer supports and their
> whitespace semantics. **This document defines the _grammar_** (an explicit EBNF), the
> **parse AST** those productions build, and the **B2 leaf semantics** (how values stringify and
> what is truthy) — the machine-checkable contract behind the T1 conformance layer (§10 of the
> companion). It exists so a hand-written tokenizer → recursive-descent parser → evaluator can be
> ported to every runtime and verified against shared goldens, rather than renting a third-party
> Jinja engine per runtime.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHOULD**, **MAY**, and
**OPTIONAL** are interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

---

## 1. Scope

This grammar covers exactly the REQUIRED features of the subset (companion §2) plus the trim
markers (§3): variable/attribute/index access, `{{ … }}` interpolation with filters, `{% if %}` /
`{% elif %}` / `{% else %}` / `{% endif %}`, `{% for … in … %}` / `{% endfor %}` with the `loop`
object, `{# … #}` comments, and the `{%- … -%}` / `{{- … -}}` whitespace-trim markers. It
deliberately excludes arithmetic, `set`, macros, inheritance, includes, tests, and every other
item in companion §4. Anything the grammar cannot parse is a **syntax error** in a `strict`
context and is otherwise handled per §5.5.

---

## 2. Lexical grammar (tokenizer)

The tokenizer scans the raw template into a flat token stream. Three delimiter pairs open
non-text regions; everything else is literal text.

```ebnf
(* --- top level: text and tag regions --- *)
token         = comment | statement | expression | text ;

comment       = "{#" , comment_body , "#}" ;
comment_body  = { any_char - "#}" } ;                (* non-greedy up to first "#}" *)

statement     = stmt_open , ws_ctrl? , stmt_inner , ws_ctrl? , stmt_close ;
stmt_open     = "{%" ;
stmt_close    = "%}" ;

expression    = expr_open , ws_ctrl? , expr_inner , ws_ctrl? , expr_close ;
expr_open     = "{{" ;
expr_close    = "}}" ;

ws_ctrl       = "-" ;   (* the trim marker; adjacency to the delimiter is significant *)

text          = { any_char }                          (* maximal run containing no delimiter *)
              - ( { any_char } , ( "{{" | "{%" | "{#" ) , { any_char } ) ;
```

Notes:

- `{%- … %}` trims **all** whitespace immediately **before** the tag in the preceding text token;
  `{% … -%}` trims **all** whitespace immediately **after** the tag in the following text token.
  Both markers MAY appear on the same tag. "Whitespace" here is `[ \t\r\n]`. See companion §3.
- A literal text token consisting solely of `[ \t]` between two tags is **preserved verbatim**
  (this is the exact case `Jinja2.NET` drops — companion §5.2). The tokenizer MUST NOT special-case
  whitespace-only text; only explicit trim markers remove whitespace.
- The tokenizer does not interpret `stmt_inner` / `expr_inner`; it captures the raw inner string
  and hands it to the parser's expression sub-grammar (§3).

---

## 3. Syntactic grammar (parser)

The parser consumes the token stream and builds the **parse AST** (§4). Statement inner strings
are re-lexed with the expression sub-grammar.

```ebnf
(* --- document --- *)
template      = { node } ;
node          = text_node | interp_node | if_node | for_node ;
                (* comment tokens are dropped during parse and produce no node *)

text_node     = text ;                                (* trim markers already applied *)

interp_node   = expr_open , expr , expr_close ;

(* --- control: if / elif / else --- *)
if_node       = "{% if" , expr , "%}" ,
                { node } ,
                { "{% elif" , expr , "%}" , { node } } ,
                [ "{% else %}" , { node } ] ,
                "{% endif %}" ;

(* --- control: for --- *)
for_node      = "{% for" , identifier , "in" , expr , "%}" ,
                { node } ,
                "{% endfor %}" ;
                (* no `for … else`; see companion §4 *)

(* --- expression sub-grammar (used in {{ }} and if/elif conditions) --- *)
expr          = or_expr ;
or_expr       = and_expr , { "or" , and_expr } ;
and_expr      = not_expr , { "and" , not_expr } ;
not_expr      = "not" , not_expr | comparison ;
comparison    = filter_expr , [ comp_op , filter_expr ]
              | filter_expr , "in" , filter_expr ;
comp_op       = "==" | "!=" | "<" | ">" | "<=" | ">=" ;

filter_expr   = primary , { "|" , filter } ;
filter        = identifier , [ "(" , [ arg_list ] , ")" ] ;
arg_list      = expr , { "," , expr } ;

primary       = literal
              | accessor
              | "(" , expr , ")" ;

accessor      = identifier , { "." , identifier | "[" , expr , "]" } ;

literal       = string | number | boolean | null ;
string        = '"' , { char - '"' } , '"' | "'" , { char - "'" } , "'" ;
number        = [ "-" ] , digit , { digit } , [ "." , digit , { digit } ] ;
boolean       = "true" | "false" ;                    (* lowercase only — Bucket A #1 *)
null          = "null" ;
identifier    = ( letter | "_" ) , { letter | digit | "_" } ;
```

**No arithmetic.** There is deliberately no `+ - * /` production in `expr` (Bucket A #8). `-` is
only a numeric-literal sign or a trim marker.

**Precedence** (lowest → highest): `or` → `and` → `not` → comparison/`in` → filter (`|`) →
primary. Comparisons are non-associative (at most one `comp_op` per `comparison`).

---

## 4. Parse AST (the T1 contract)

The parser emits a discriminated node tree. This is what the `parseTemplate` conformance seam
returns and what `AstVectors` (§6) enforce as data. Each node carries a `kind` discriminator.

| `kind`     | Fields | Meaning |
| ---------- | ------ | ------- |
| `text`     | `value: string` | Literal text (trim markers already applied). |
| `interp`   | `expr: Expr` | A `{{ … }}` interpolation. |
| `for`      | `loopVar: string`, `seq: Expr`, `body: Node[]` | `for loopVar in seq`. |
| `if`       | `branches: Branch[]`, `elseBody: Node[]?` | `if`/`elif`/`else` chain; each `Branch` = `{ test: Expr, body: Node[] }`. |

Expression (`Expr`) nodes:

| `kind`     | Fields | Meaning |
| ---------- | ------ | ------- |
| `var`      | `root: string`, `path: PathSeg[]` | Variable/attribute/index access. `PathSeg` = `{ kind: "attr", name }` or `{ kind: "index", expr: Expr }`. |
| `lit`      | `value: string \| number \| bool \| null` | A literal. |
| `filter`   | `name: string`, `input: Expr`, `args: Expr[]` | `input \| name(args…)`. |
| `unary`    | `operator: "not"`, `operand: Expr` | Logical negation. |
| `binary`   | `operator: "and" \| "or" \| "in" \| "==" \| "!=" \| "<" \| ">" \| "<=" \| ">="`, `left: Expr`, `right: Expr` | Boolean / comparison / membership. |

Comments produce **no** node. The AST is comment-free and trim-normalized, so it is a pure
function of the template independent of any input values — which is what makes it a stable golden.

A sketch of the same contract in TypeSpec lives at
[`schema/model/conformance/ast-model.tsp`](../schema/model/conformance/ast-model.tsp) (authored,
typechecked, and intentionally **not** yet wired into `main.tsp` — Phase 3 wiring; companion §10.4).

---

## 5. B2 leaf semantics (evaluation)

The evaluator walks the parse AST with an input scope and produces the **rendered segment tree**
(§7). These are the deliberately-portable "clean" semantics (Bucket A), _not_ a mirror of any one
engine's Python-isms.

### 5.1 Stringification

| Value | Renders as |
| ----- | ---------- |
| string | itself, verbatim (no HTML escaping) |
| integer | decimal digits (`30`) |
| float | minimal decimal (`1.5`; `1`, never `1.0`) |
| `true` / `false` | `true` / `false` (lowercase) |
| `null` / undefined | empty string `""` |
| list / dict | see §5.4 (only meaningful via `join`/`length`/iteration) |

### 5.2 Truthiness

Falsy: `""`, `[]` (empty list), `{}` (empty dict), `0`, `0.0`, `false`, `null`, undefined.
Everything else is truthy. (Bucket A #5/#6.)

### 5.3 Access & lookup

- `a.b` and `a["b"]` are equivalent for dict/object member access.
- `a[0]` indexes a list (0-based). Negative indices are **not** supported.
- A missing attribute/key/index resolves to **undefined** (→ empty string on interpolation; falsy
  in conditions) — it MUST NOT raise, except under a `strict` property (companion §8.4).

### 5.4 Filters (the six + optional `replace`)

| Filter | Signature | Semantics |
| ------ | --------- | --------- |
| `upper` | `str → str` | ASCII/Unicode upper-case. |
| `lower` | `str → str` | Lower-case. |
| `trim` | `str → str` | Strip leading/trailing `[ \t\r\n]`. |
| `join` | `list, sep="" → str` | Stringify each element (§5.1) and concatenate with `sep`. |
| `length` | `str \| list \| dict → int` | Element/character count. |
| `default` | `value, fallback → value` | `fallback` iff `value` is undefined/`null` (**not** merely falsy). |
| `replace` | `str, old, new → str` | Literal substring replace. **Conditional** — included only if the corpus shows real usage (Bucket A #10). |

### 5.5 Errors

- **Syntax errors** (unparseable template): raise at parse time. In a non-strict context the
  runtime MAY choose to surface a clear diagnostic; it MUST NOT silently emit corrupt output.
- **Lookup misses**: undefined (see §5.3), never an error, except under `strict`.
- **Type misuse** (e.g. `join` on a non-list): raise a clear evaluation error.

### 5.6 The `loop` object (REQUIRED)

Inside a `for` body a `loop` variable is in scope with: `loop.index` (1-based), `loop.index0`
(0-based), `loop.first` (bool), `loop.last` (bool), `loop.length` (int). Dict iteration is in
**insertion order** (Bucket A #7); iterating a dict binds the loop variable to each **key**.

---

## 6. Conformance layers

Three golden sets, all generated from the Python reference oracle (companion §10):

| Set | Operation / seam | Enforces |
| --- | ---------------- | -------- |
| `RenderVectors` | `Renderer.render` (existing) | template + inputs → final string. |
| `AstVectors` | `ParseTemplateConformance.parseTemplate` (new seam, §4) | template → parse AST (input-independent). |
| Security vectors | render→parse contract (companion §8.6) | provenance & strict-throw invariants. |

`AstVectors` isolate a parser bug from an evaluator bug: an AST mismatch localizes the defect to
tokenize/parse, a render mismatch with a matching AST localizes it to evaluation.

---

## 7. Rendered segment tree (render→parse contract)

Evaluation does **not** produce a flat string; it produces an ordered list of **provenance-tagged
segments** (companion §8.4). This is what retires the two in-band sentinels.

| Segment `kind` | Fields | Provenance |
| -------------- | ------ | ---------- |
| `literal` | `text: string` | from the template body (author-trusted) |
| `interp` | `text: string`, `source: string?`, `strict: bool` | from an input value (untrusted); `source` names the input property |
| `rich` | `node: <structured>`, `source: string` | a rich/thread input expanded structurally (replaces `__PROMPTY_THREAD_` markers) |

The parser consumes segments structurally: role boundaries are recognized only in `literal`
segments (author-trusted), so an `interp` segment whose text looks like `system:` cannot forge a
role boundary — prevention by construction. A `strict` `interp` segment matching the role-boundary
pattern raises (loud fail-closed; companion §8.4). Concatenating `literal.text` + `interp.text` +
flattened `rich` reproduces the legacy flat string exactly, so the segment tree is a strict
superset of today's behavior (Phase 4 flips the default; companion §10.3).

---

## 8. Portability checklist (per-runtime port)

A conformant port MUST:

1. Tokenize per §2 (whitespace-only inter-tag text preserved; trim markers honored).
2. Parse per §3 into the §4 AST (comment-free, trim-normalized) — matches `AstVectors`.
3. Evaluate per §5 (Bucket A leaf semantics; `loop` object; insertion-order dict iteration).
4. Emit the §7 segment tree (or, in the transitional default, the equivalent flat string) —
   matches `RenderVectors`.
5. Enforce the strict-throw + provenance invariants — matches the security vectors.
