/**
 * Expression visitor interface and shared helpers.
 *
 * The ExprVisitor interface is the contract between the shared IR and
 * per-language code emitters. Each language implements its own visitor
 * in `languages/<lang>/visitor.ts`.
 */

import { Expr, Construct, VariantConstruct, TypeRegistry } from "./expansion.js";

// ============================================================================
// Visitor interface
// ============================================================================

export interface ExprVisitor {
  visitExpr(expr: Expr): string;
  /** Optional type registry for wire format generation and type-aware codegen. */
  registry?: TypeRegistry;
}

/**
 * Render a Construct expression's fields as a plain object literal.
 * Used by TypeScript, Python, C#, Go coercions where the template wraps
 * the literal in language-specific loading logic (e.g., `TypeName.load({...}, ctx)`).
 *
 * @param expr - A Construct or VariantConstruct expression
 * @param visitor - The language-specific visitor for rendering field values
 * @param format - How to format the fields:
 *   - "js": `{ field: value }` (TypeScript, Go)
 *   - "py": `{"field": value}` (Python)
 */
export function renderObjectLiteral(
  expr: Construct | VariantConstruct,
  visitor: ExprVisitor,
  format: "js" | "py" = "js",
): string {
  const fields = expr.fields.map(f => {
    const val = visitor.visitExpr(f.value);
    switch (format) {
      case "js":
        return `${f.propertyName}: ${val}`;
      case "py":
        return `"${f.propertyName}": ${val}`;
    }
  });
  return `{ ${fields.join(", ")} }`;
}

// ============================================================================
// Naming helpers — reusable across visitors
// ============================================================================

/** camelCase → PascalCase (first char uppercase). */
export function toPascalCase(name: string): string {
  // Handle snake_case first
  if (name.includes("_")) {
    return name
      .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      .replace(/^(.)/, (_, char) => char.toUpperCase());
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Exhaustive check helper — TypeScript enforces all Expr.kind arms are handled. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected expression kind: ${(x as Expr).kind}`);
}
