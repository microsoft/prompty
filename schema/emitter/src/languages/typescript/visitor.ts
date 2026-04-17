/**
 * TypeScript expression visitor — Expr IR → TypeScript source fragments.
 */

import { Expr, Construct, VariantConstruct, ArrayLiteral, TypeRegistry } from "../../ir/expansion.js";
import { ExprVisitor, assertNever } from "../../ir/visitor.js";

export class TypeScriptExprVisitor implements ExprVisitor {
  registry?: TypeRegistry;

  constructor(registry?: TypeRegistry) {
    this.registry = registry;
  }

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
        return expr.name;
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `{ ${expr.entries.map(e => `${e.key}: ${this.visitExpr(e.value)}`).join(", ")} }`;
      case "field_read":
        return `${expr.objectName}.${expr.fieldName}`;
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
