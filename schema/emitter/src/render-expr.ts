/**
 * Expression visitors — per-language code generation from Expr IR.
 *
 * Each visitor walks the Expr tree (from expansion.ts) and produces
 * target language source code. This is the "codegen" pass, analogous
 * to Roslyn's BoundTreeRewriter or TypeScript's emitter.
 *
 * One visitor per target language. Each implements an exhaustive switch
 * over Expr.kind — TypeScript enforces completeness via `never`.
 */

import { Expr, FieldAssignment, Construct, VariantConstruct, ArrayLiteral } from "./expansion.js";
import { toSnakeCase } from "./utilities.js";

// ============================================================================
// Visitor interface
// ============================================================================

export interface ExprVisitor {
  visitExpr(expr: Expr): string;
}

// ============================================================================
// Naming helpers — reusable across visitors
// ============================================================================

/** camelCase → PascalCase (first char uppercase). */
function toPascalCase(name: string): string {
  // Handle snake_case first
  if (name.includes("_")) {
    return name
      .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      .replace(/^(.)/, (_, char) => char.toUpperCase());
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Exhaustive check helper — TypeScript enforces all Expr.kind arms are handled. */
function assertNever(x: never): never {
  throw new Error(`Unexpected expression kind: ${(x as Expr).kind}`);
}

// ============================================================================
// Rust visitor
// ============================================================================

export class RustExprVisitor implements ExprVisitor {
  visitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "string":
        return `"${this.escapeString(expr.value)}".to_string()`;
      case "number":
        return String(expr.value);
      case "boolean":
        return expr.value ? "true" : "false";
      case "null":
        return "None";
      case "param":
        return expr.paramType === "string"
          ? `${toSnakeCase(expr.name)}.into()`
          : toSnakeCase(expr.name);
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `serde_json::json!({${expr.entries.map(e => `"${e.key}": ${this.visitExpr(e.value)}`).join(", ")}})`;
      default:
        return assertNever(expr);
    }
  }

  private visitConstruct(expr: Construct): string {
    const typeName = expr.typeName.name;
    if (expr.fields.length === 0) {
      return `${typeName} { ..Default::default() }`;
    }
    const fields = expr.fields.map(f =>
      `${toSnakeCase(f.propertyName)}: ${this.wrapFieldValue(f)}`
    ).join(", ");
    return `${typeName} { ${fields}, ..Default::default() }`;
  }

  private visitVariant(expr: VariantConstruct): string {
    const baseName = expr.baseTypeName.name;
    const variantName = expr.variantTypeName.name;
    const enumName = `${baseName}Kind`;
    const fields = expr.fields.map(f =>
      `${toSnakeCase(f.propertyName)}: ${this.wrapFieldValue(f)}`
    ).join(", ");
    const kindValue = fields.length > 0
      ? `${enumName}::${variantName} { ${fields} }`
      : `${enumName}::${variantName}`;
    return `${baseName} { ${toSnakeCase(expr.discriminator)}: ${kindValue}, ..Default::default() }`;
  }

  private visitArray(expr: ArrayLiteral): string {
    if (expr.items.length === 0) {
      return "vec![]";
    }
    const items = expr.items.map(i => this.visitExpr(i)).join(", ");
    return `vec![${items}]`;
  }

  /**
   * Wrap field values appropriately for Rust — Option<T> fields need Some(),
   * string fields need .into(), etc.
   */
  private wrapFieldValue(field: FieldAssignment): string {
    const inner = this.visitExpr(field.value);
    if (field.isOptional) {
      return `Some(${inner})`;
    }
    return inner;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

// ============================================================================
// TypeScript visitor
// ============================================================================

export class TypeScriptExprVisitor implements ExprVisitor {
  visitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "string":
        return `"${this.escapeString(expr.value)}"`;
      case "number":
        return String(expr.value);
      case "boolean":
        return expr.value ? "true" : "false";
      case "null":
        return "undefined";
      case "param":
        return expr.name; // camelCase as-is (TypeSpec names are already camelCase)
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `{ ${expr.entries.map(e => `${e.key}: ${this.visitExpr(e.value)}`).join(", ")} }`;
      default:
        return assertNever(expr);
    }
  }

  private visitConstruct(expr: Construct): string {
    const typeName = expr.typeName.name;
    if (expr.fields.length === 0) {
      return `new ${typeName}({})`;
    }
    const fields = expr.fields.map(f =>
      `${f.propertyName}: ${this.visitExpr(f.value)}`
    ).join(", ");
    return `new ${typeName}({ ${fields} })`;
  }

  private visitVariant(expr: VariantConstruct): string {
    // In TypeScript, polymorphic children are full classes — construct the variant type directly
    const variantName = expr.variantTypeName.name;
    if (expr.fields.length === 0) {
      return `new ${variantName}({})`;
    }
    const fields = expr.fields.map(f =>
      `${f.propertyName}: ${this.visitExpr(f.value)}`
    ).join(", ");
    return `new ${variantName}({ ${fields} })`;
  }

  private visitArray(expr: ArrayLiteral): string {
    if (expr.items.length === 0) {
      return "[]";
    }
    const items = expr.items.map(i => this.visitExpr(i)).join(", ");
    return `[${items}]`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

// ============================================================================
// Python visitor
// ============================================================================

export class PythonExprVisitor implements ExprVisitor {
  visitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "string":
        return `"${this.escapeString(expr.value)}"`;
      case "number":
        return String(expr.value);
      case "boolean":
        return expr.value ? "True" : "False";
      case "null":
        return "None";
      case "param":
        return toSnakeCase(expr.name); // Python uses snake_case
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `{${expr.entries.map(e => `"${e.key}": ${this.visitExpr(e.value)}`).join(", ")}}`;
      default:
        return assertNever(expr);
    }
  }

  private visitConstruct(expr: Construct): string {
    const typeName = expr.typeName.name;
    if (expr.fields.length === 0) {
      return `${typeName}()`;
    }
    const fields = expr.fields.map(f =>
      `${toSnakeCase(f.propertyName)}=${this.visitExpr(f.value)}`
    ).join(", ");
    return `${typeName}(${fields})`;
  }

  private visitVariant(expr: VariantConstruct): string {
    // In Python, polymorphic children are full classes
    const variantName = expr.variantTypeName.name;
    if (expr.fields.length === 0) {
      return `${variantName}()`;
    }
    const fields = expr.fields.map(f =>
      `${toSnakeCase(f.propertyName)}=${this.visitExpr(f.value)}`
    ).join(", ");
    return `${variantName}(${fields})`;
  }

  private visitArray(expr: ArrayLiteral): string {
    if (expr.items.length === 0) {
      return "[]";
    }
    const items = expr.items.map(i => this.visitExpr(i)).join(", ");
    return `[${items}]`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

// ============================================================================
// C# visitor
// ============================================================================

export class CSharpExprVisitor implements ExprVisitor {
  visitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "string":
        return `"${this.escapeString(expr.value)}"`;
      case "number":
        return String(expr.value);
      case "boolean":
        return expr.value ? "true" : "false";
      case "null":
        return "null";
      case "param":
        return expr.name; // camelCase param names in C#
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `new Dictionary<string, object?> { ${expr.entries.map(e => `{ "${e.key}", ${this.visitExpr(e.value)} }`).join(", ")} }`;
      default:
        return assertNever(expr);
    }
  }

  private visitConstruct(expr: Construct): string {
    const typeName = expr.typeName.name;
    if (expr.fields.length === 0) {
      return `new ${typeName}()`;
    }
    // C# uses object initializer syntax: new Type { Prop = value }
    const fields = expr.fields.map(f =>
      `${toPascalCase(f.propertyName)} = ${this.visitExpr(f.value)}`
    ).join(", ");
    return `new ${typeName} { ${fields} }`;
  }

  private visitVariant(expr: VariantConstruct): string {
    // In C#, polymorphic children are full classes
    const variantName = expr.variantTypeName.name;
    if (expr.fields.length === 0) {
      return `new ${variantName}()`;
    }
    const fields = expr.fields.map(f =>
      `${toPascalCase(f.propertyName)} = ${this.visitExpr(f.value)}`
    ).join(", ");
    return `new ${variantName} { ${fields} }`;
  }

  private visitArray(expr: ArrayLiteral): string {
    const elementType = expr.elementTypeName.name;
    if (expr.items.length === 0) {
      return `new List<${elementType}>()`;
    }
    const items = expr.items.map(i => this.visitExpr(i)).join(", ");
    return `new List<${elementType}> { ${items} }`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

// ============================================================================
// Go visitor
// ============================================================================

export class GoExprVisitor implements ExprVisitor {
  visitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "string":
        return `"${this.escapeString(expr.value)}"`;
      case "number":
        return String(expr.value);
      case "boolean":
        return expr.value ? "true" : "false";
      case "null":
        return "nil";
      case "param":
        return expr.name; // Go uses camelCase for local params
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `map[string]interface{}{${expr.entries.map(e => `"${e.key}": ${this.visitExpr(e.value)}`).join(", ")}}`;
      default:
        return assertNever(expr);
    }
  }

  private visitConstruct(expr: Construct): string {
    const typeName = expr.typeName.name;
    if (expr.fields.length === 0) {
      return `${typeName}{}`;
    }
    // Go uses struct literal: Type{ Field: value }
    const fields = expr.fields.map(f =>
      `${toPascalCase(f.propertyName)}: ${this.visitExpr(f.value)}`
    ).join(", ");
    return `${typeName}{ ${fields} }`;
  }

  private visitVariant(expr: VariantConstruct): string {
    // Go polymorphism TBD — for now, construct the variant type directly
    const variantName = expr.variantTypeName.name;
    if (expr.fields.length === 0) {
      return `${variantName}{}`;
    }
    const fields = expr.fields.map(f =>
      `${toPascalCase(f.propertyName)}: ${this.visitExpr(f.value)}`
    ).join(", ");
    return `${variantName}{ ${fields} }`;
  }

  private visitArray(expr: ArrayLiteral): string {
    const elementType = expr.elementTypeName.name;
    if (expr.items.length === 0) {
      return `[]${elementType}{}`;
    }
    const items = expr.items.map(i => this.visitExpr(i)).join(", ");
    return `[]${elementType}{${items}}`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

// ============================================================================
// Visitor registry — look up by language name
// ============================================================================

const visitors: Record<string, () => ExprVisitor> = {
  rust: () => new RustExprVisitor(),
  typescript: () => new TypeScriptExprVisitor(),
  python: () => new PythonExprVisitor(),
  csharp: () => new CSharpExprVisitor(),
  go: () => new GoExprVisitor(),
};

/**
 * Get an ExprVisitor instance for the given target language.
 * @param language - Target language name (rust, typescript, python, csharp, go)
 */
export function getVisitor(language: string): ExprVisitor {
  const factory = visitors[language];
  if (!factory) {
    throw new Error(`No ExprVisitor for language '${language}'. Available: [${Object.keys(visitors).join(", ")}]`);
  }
  return factory();
}
