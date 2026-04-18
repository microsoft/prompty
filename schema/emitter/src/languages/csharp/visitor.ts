/**
 * C# expression visitor — Expr IR → C# source fragments.
 */

import { Expr, Construct, VariantConstruct, ArrayLiteral, TypeRegistry } from "../../ir/expansion.js";
import { ExprVisitor, toPascalCase, assertNever } from "../../ir/visitor.js";

export class CSharpExprVisitor implements ExprVisitor {
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
        return "null";
      case "param":
        return expr.name;
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `new Dictionary<string, object?> { ${expr.entries.map(e => `{ "${e.key}", ${this.visitExpr(e.value)} }`).join(", ")} }`;
      case "field_read":
        return `${expr.objectName}.${toPascalCase(expr.fieldName)}`;
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
    const fields = expr.fields.map(f => {
      let val = this.visitExpr(f.value);
      // For enum fields, convert string literals to EnumName.MemberName
      if (f.value.kind === "string" && this.registry) {
        const typeNode = this.registry.get(typeName);
        if (typeNode) {
          const prop = typeNode.properties.find(p => p.name === f.propertyName);
          if (prop?.enumName) {
            val = `${prop.enumName}.${toPascalCase(f.value.value)}`;
          }
        }
      }
      return `${toPascalCase(f.propertyName)} = ${val}`;
    }).join(", ");
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
