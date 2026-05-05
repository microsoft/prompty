/**
 * Rust expression visitor — Expr IR → Rust source fragments.
 */

import { Expr, FieldAssignment, Construct, VariantConstruct, ArrayLiteral, FieldRead, TypeRegistry } from "../../ir/expansion.js";
import { ExprVisitor, assertNever } from "../../ir/visitor.js";
import { toSnakeCase } from "../../ir/utilities.js";

const RUST_KEYWORDS = new Set([
  "as", "break", "const", "continue", "crate", "else", "enum", "extern",
  "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
  "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
  "super", "trait", "true", "type", "unsafe", "use", "where", "while",
  "async", "await", "dyn",
]);

function rustFieldName(name: string): string {
  const snake = toSnakeCase(name);
  return RUST_KEYWORDS.has(snake) ? `r#${snake}` : snake;
}

export class RustExprVisitor implements ExprVisitor {
  registry?: TypeRegistry;

  constructor(registry?: TypeRegistry) {
    this.registry = registry;
  }

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
        // Always use .into() in Rust — handles String→String, bool→Value, i64→Value, etc.
        return `${toSnakeCase(expr.name)}.into()`;
      case "construct":
        return this.visitConstruct(expr);
      case "variant":
        return this.visitVariant(expr);
      case "array":
        return this.visitArray(expr);
      case "dict":
        return `serde_json::json!({${expr.entries.map(e => `"${e.key}": ${this.visitExpr(e.value)}`).join(", ")}})`;
      case "field_read":
        return this.visitFieldRead(expr);
      default:
        return assertNever(expr);
    }
  }

  private visitConstruct(expr: Construct): string {
    const typeName = expr.typeName.name;

    // Check if this is a polymorphic type — discriminator fields need enum variant wrapping
    const typeNode = this.registry?.get(typeName);
    if (typeNode?.discriminator && typeNode.childTypes.length > 0) {
      return this.visitPolymorphicConstruct(expr, typeNode);
    }

    if (expr.fields.length === 0) {
      return `${typeName} { ..Default::default() }`;
    }
    const fields = expr.fields.map(f => {
      let val = this.wrapFieldValue(f);
      // For enum fields, convert string literals to EnumName::VariantName
      if (f.value.kind === "string" && typeNode) {
        const prop = typeNode.properties.find(p => p.name === f.propertyName);
        if (prop?.enumName) {
          const variantName = f.value.value.charAt(0).toUpperCase() + f.value.value.slice(1);
          const enumVal = `${prop.enumName}::${variantName}`;
          val = f.isOptional ? `Some(${enumVal})` : enumVal;
        }
      }
      return `${toSnakeCase(f.propertyName)}: ${val}`;
    }).join(", ");
    return `${typeName} { ${fields}, ..Default::default() }`;
  }

  /**
   * Handle Construct on a polymorphic type — the discriminator field becomes an enum variant.
   * E.g., Property { kind: "boolean", example: v } → Property { kind: PropertyKind::Custom { kind_name: "boolean".to_string() }, example: Some(v.into()), ..Default::default() }
   */
  private visitPolymorphicConstruct(expr: Construct, typeNode: import("../../ir/ast.js").TypeNode): string {
    const typeName = expr.typeName.name;
    const enumName = `${typeName}Kind`;
    const discFieldName = typeNode.discriminator!;

    // Find the discriminator field assignment
    const discField = expr.fields.find(f => f.propertyName === discFieldName);
    const discValue = discField?.value;

    // If no discriminator field or not a string literal, fall back to normal construction
    if (!discField || discValue?.kind !== "string") {
      const fields = expr.fields.map(f =>
        `${toSnakeCase(f.propertyName)}: ${this.wrapFieldValue(f)}`
      ).join(", ");
      return fields.length > 0
        ? `${typeName} { ${fields}, ..Default::default() }`
        : `${typeName} { ..Default::default() }`;
    }

    const discValueStr = discValue.value;

    // Find matching named child type
    const childType = typeNode.childTypes.find(child => {
      const dp = child.properties.find((p: any) => p.name === discFieldName);
      return dp?.defaultValue === discValueStr;
    });

    let kindValue: string;
    if (childType) {
      // Named variant (e.g., PropertyKind::Array)
      const variantName = childType.typeName.name.replace(typeName, '') || childType.typeName.name;
      kindValue = `${enumName}::${variantName}`;
    } else {
      // Wildcard/Custom variant — carries kind_name field
      kindValue = `${enumName}::Custom { kind_name: "${discValueStr}".to_string() }`;
    }

    // Non-discriminator fields
    const baseFields = expr.fields
      .filter(f => f.propertyName !== discFieldName)
      .map(f => `${toSnakeCase(f.propertyName)}: ${this.wrapFieldValue(f)}`);

    const allFields = [
      `${toSnakeCase(discFieldName)}: ${kindValue}`,
      ...baseFields,
    ];

    return `${typeName} { ${allFields.join(", ")}, ..Default::default() }`;
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

  private visitFieldRead(expr: FieldRead): string {
    return `${toSnakeCase(expr.objectName)}.${rustFieldName(expr.fieldName)}`;
  }
}
