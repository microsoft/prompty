/**
 * Go expression visitor — Expr IR → Go source fragments.
 */

import { Expr, Construct, VariantConstruct, ArrayLiteral, TypeRegistry } from "../../ir/expansion.js";
import { ExprVisitor, toPascalCase, assertNever } from "../../ir/visitor.js";

export class GoExprVisitor implements ExprVisitor {
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
        return "nil";
      case "param":
        return expr.name;
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `map[string]interface{}{${expr.entries.map(e => `"${e.key}": ${this.visitExpr(e.value)}`).join(", ")}}`;
      case "field_read":
        return `${expr.objectName}.${toPascalCase(expr.fieldName)}`;
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
