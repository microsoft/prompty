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

import { Expr, FieldAssignment, Construct, VariantConstruct, ArrayLiteral, FieldRead } from "./expansion.js";
import { TypeRegistry } from "./expansion.js";
import { toSnakeCase } from "./utilities.js";

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
 *   - "pairs": array of `{ property, value }` objects (C#)
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
    const fields = expr.fields.map(f =>
      `${toSnakeCase(f.propertyName)}: ${this.wrapFieldValue(f)}`
    ).join(", ");
    return `${typeName} { ${fields}, ..Default::default() }`;
  }

  /**
   * Handle Construct on a polymorphic type — the discriminator field becomes an enum variant.
   * E.g., Property { kind: "boolean", example: v } → Property { kind: PropertyKind::Custom { kind_name: "boolean".to_string() }, example: Some(v.into()), ..Default::default() }
   */
  private visitPolymorphicConstruct(expr: Construct, typeNode: import("./ast.js").TypeNode): string {
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
    return `${toSnakeCase(expr.objectName)}.${toSnakeCase(expr.fieldName)}`;
  }
}

// ============================================================================
// TypeScript visitor
// ============================================================================

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

// ============================================================================
// Python visitor
// ============================================================================

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

// ============================================================================
// C# visitor
// ============================================================================

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
 * @param registry - Optional type registry for wire format generation
 */
export function getVisitor(language: string, registry?: TypeRegistry): ExprVisitor {
  const factory = visitors[language];
  if (!factory) {
    throw new Error(`No ExprVisitor for language '${language}'. Available: [${Object.keys(visitors).join(", ")}]`);
  }
  const visitor = factory();
  if (registry) {
    visitor.registry = registry;
  }
  return visitor;
}
