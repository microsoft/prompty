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
    // Look up the target type to check which fields are optional (pointer types in Go)
    const typeNode = this.registry?.get(typeName);
    const fields = expr.fields.map(f => {
      const val = this.visitExpr(f.value);
      const prop = typeNode?.properties.find(p => p.name === f.propertyName);
      // Optional fields are pointers in Go — wrap scalar values with a helper
      const needsAddr = prop?.isOptional && !prop.isCollection && !prop.isDict;
      return `${toPascalCase(f.propertyName)}: ${needsAddr ? `ptrOf(${val})` : val}`;
    }).join(", ");
    return `${typeName}{ ${fields} }`;
  }

  private visitVariant(expr: VariantConstruct): string {
    // Go child types are full structs with an explicit discriminator field.
    const variantName = expr.variantTypeName.name;
    // Include the discriminator (e.g., Kind: "text") since Go has no default field values.
    const discField = `${toPascalCase(expr.discriminator)}: "${expr.discriminatorValue}"`;
    const dataFields = expr.fields.map(f =>
      `${toPascalCase(f.propertyName)}: ${this.visitExpr(f.value)}`
    );
    const allFields = [discField, ...dataFields].join(", ");
    return `${variantName}{ ${allFields} }`;
  }

  private visitArray(expr: ArrayLiteral): string {
    const elementType = expr.elementTypeName.name;
    // Polymorphic types are stored as []interface{} in Go (no inheritance).
    // A type is polymorphic if it has child types in the registry.
    const typeNode = this.registry?.get(elementType);
    const isPolymorphic = typeNode !== undefined && typeNode.childTypes.length > 0;
    const goElementType = isPolymorphic ? "interface{}" : elementType;
    if (expr.items.length === 0) {
      return `[]${goElementType}{}`;
    }
    const items = expr.items.map(i => this.visitExpr(i)).join(", ");
    return `[]${goElementType}{${items}}`;
  }

  private escapeString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}
