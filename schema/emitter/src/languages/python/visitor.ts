/**
 * Python expression visitor — Expr IR → Python source fragments.
 */

import { Expr, Construct, VariantConstruct, ArrayLiteral, TypeRegistry } from "../../ir/expansion.js";
import { ExprVisitor, assertNever } from "../../ir/visitor.js";
import { toSnakeCase } from "../../ir/utilities.js";

export class PythonExprVisitor implements ExprVisitor {
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
        return expr.value ? "True" : "False";
      case "null":
        return "None";
      case "param":
        return toSnakeCase(expr.name);
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `{${expr.entries.map(e => `"${e.key}": ${this.visitExpr(e.value)}`).join(", ")}}`;
      case "field_read":
        return `${toSnakeCase(expr.objectName)}.${toSnakeCase(expr.fieldName)}`;
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
