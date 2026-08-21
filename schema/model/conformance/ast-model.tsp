import "@typra/emitter";

// ---------------------------------------------------------------------------
// Prompty Jinja Subset — parse AST (T1 conformance contract).
//
// This is the discriminated node tree the `parseTemplate` conformance seam
// returns and that `AstVectors` enforce as data. See spec/jinja-grammar.md §4.
//
// INTENTIONALLY NOT imported by model/main.tsp yet. It is authored and
// typechecked now (Phase 1) but wiring it through the multi-runtime emitter is
// deferred to the coordinated Phase 3 regen (jinja-subset.md §10.4), because a
// full `npm run generate` rewrites all seven runtimes at once and the open
// structural emitter issues (typra#259/#260/#262) make an unattended regen
// unsafe. Typecheck standalone with a scratch entry that imports this file:
//   npx tsp compile <scratch>.tsp --no-emit
// ---------------------------------------------------------------------------

namespace Prompty.Conformance.JinjaAst;

// --- Expression nodes -------------------------------------------------------

/** The `kind` discriminator for a path segment in a variable accessor. */
alias PathSegmentKind = "attr" | "index";

/** One step of a dotted/indexed variable access, e.g. `.name` or `[0]`. */
@abstract
@discriminator("kind")
model PathSegment {
  @doc("The kind of path segment")
  kind: PathSegmentKind;
}

/** Attribute access: `.name` or `["name"]`. */
model AttrSegment extends PathSegment {
  kind: "attr";

  @doc("The attribute/key name")
  name: string;
}

/** Index access: `[expr]`. */
model IndexSegment extends PathSegment {
  kind: "index";

  @doc("The index expression")
  expr: Expr;
}

/** The `kind` discriminator for expression nodes. */
alias ExprKind = "var" | "lit" | "filter" | "unary" | "binary";

/** An expression used inside `{{ … }}` or an if/elif condition. */
@abstract
@discriminator("kind")
model Expr {
  @doc("The kind of expression")
  kind: ExprKind;
}

/** Variable / attribute / index access. */
model VarExpr extends Expr {
  kind: "var";

  @doc("The access path, applied left to right from the root identifier")
  root: string;

  @doc("Zero or more attribute/index steps after the root")
  path: PathSegment[];
}

/** A literal string/number/boolean/null. */
model LitExpr extends Expr {
  kind: "lit";

  @doc("The literal value (string, number, boolean, or null)")
  value: unknown;
}

/** A filter application: `input | name(args…)`. */
model FilterExpr extends Expr {
  kind: "filter";

  @doc("The filter name (e.g. upper, join, default)")
  name: string;

  @doc("The piped input expression")
  input: Expr;

  @doc("Positional filter arguments")
  args: Expr[];
}

/** Logical negation: `not operand`. */
model UnaryExpr extends Expr {
  kind: "unary";

  @doc("The unary operator")
  operator: "not";

  @doc("The negated operand")
  operand: Expr;
}

/** The `kind` discriminator for binary operators. */
alias BinaryOp = "and" | "or" | "in" | "==" | "!=" | "<" | ">" | "<=" | ">=";

/** A boolean / comparison / membership operation. No arithmetic. */
model BinaryExpr extends Expr {
  kind: "binary";

  @doc("The binary operator")
  operator: BinaryOp;

  @doc("The left operand")
  left: Expr;

  @doc("The right operand")
  right: Expr;
}

// --- Template nodes ---------------------------------------------------------

/** The `kind` discriminator for template AST nodes. */
alias NodeKind = "text" | "interp" | "if" | "for";

/** A node in the parsed template. Comments produce no node. */
@abstract
@discriminator("kind")
model Node {
  @doc("The kind of template node")
  kind: NodeKind;
}

/** Literal text (trim markers already applied). */
model TextNode extends Node {
  kind: "text";

  @doc("The verbatim text")
  value: string;
}

/** A `{{ … }}` interpolation. */
model InterpNode extends Node {
  kind: "interp";

  @doc("The interpolated expression")
  expr: Expr;
}

/** One branch of an if/elif chain. */
model Branch {
  @doc("The branch condition")
  test: Expr;

  @doc("The branch body")
  body: Node[];
}

/** An `if` / `elif` / `else` chain. */
model IfNode extends Node {
  kind: "if";

  @doc("The if branch followed by zero or more elif branches")
  branches: Branch[];

  @doc("The optional else body")
  elseBody?: Node[];
}

/** A `for var in seq` loop. No `for … else`. */
model ForNode extends Node {
  kind: "for";

  @doc("The loop variable name")
  loopVar: string;

  @doc("The iterated sequence expression")
  seq: Expr;

  @doc("The loop body")
  body: Node[];
}

/** A parsed template: an ordered list of nodes. */
model Template {
  @doc("The document nodes in source order")
  nodes: Node[];
}
