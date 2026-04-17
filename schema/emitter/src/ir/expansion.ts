/**
 * Expression IR — Type-directed lowering for the emitter.
 *
 * This module implements the "lowering" pass of the transpiler:
 * given an untyped data literal (from @factory sets or @coerce expansion)
 * and a target type (TypeNode/PropertyNode), produce a typed Expr tree.
 *
 * The Expr tree is language-agnostic. Per-language visitors in render-expr.ts
 * walk it to produce target language code.
 *
 * Architecture (following TypeScript/Roslyn/Babel pattern):
 *   Data literal + Type graph → resolve() → Expr tree → visit() → code string
 */

import { TypeNode, PropertyNode, TypeName } from "./ast.js";

// ============================================================================
// Expression IR — Algebraic Data Type (sum type)
// ============================================================================

/** A literal string value. */
export interface StringLiteral {
  kind: "string";
  value: string;
}

/** A literal number value. */
export interface NumberLiteral {
  kind: "number";
  value: number;
}

/** A literal boolean value. */
export interface BooleanLiteral {
  kind: "boolean";
  value: boolean;
}

/** A null/None/nil value. */
export interface NullLiteral {
  kind: "null";
}

/** Reference to a factory/coercion parameter (substituted at runtime). */
export interface ParamRef {
  kind: "param";
  name: string;
  paramType: string;
}

/** Direct construction of a non-polymorphic type. */
export interface Construct {
  kind: "construct";
  typeName: TypeName;
  fields: FieldAssignment[];
}

/**
 * Construction of a discriminated union variant.
 * The base type has a discriminator field; we're constructing a specific child.
 */
export interface VariantConstruct {
  kind: "variant";
  baseTypeName: TypeName;
  discriminator: string;
  discriminatorValue: string;
  variantTypeName: TypeName;
  fields: FieldAssignment[];
}

/** An array/list/vector literal. */
export interface ArrayLiteral {
  kind: "array";
  elementTypeName: TypeName;
  items: Expr[];
}

/** A dictionary/map literal. */
export interface DictLiteral {
  kind: "dict";
  entries: { key: string; value: Expr }[];
}

/**
 * A field read from a source object. Used in wire format mapping
 * to read fields from core types (e.g., `opts.maxOutputTokens`).
 */
export interface FieldRead {
  kind: "field_read";
  /** Source object/variable name (e.g., "opts") */
  objectName: string;
  /** Field name on the source object (e.g., "maxOutputTokens") */
  fieldName: string;
  /** Type of the field (e.g., "int32", "string") */
  fieldType: string;
  /** Whether the field is optional on the source object */
  isOptional: boolean;
}

/** A field assignment within a Construct or VariantConstruct. */
export interface FieldAssignment {
  /** Original property name from TypeSpec (camelCase). */
  propertyName: string;
  value: Expr;
  /** Whether the target property is optional (emitters may need wrapping, e.g., Some(), null check) */
  isOptional: boolean;
}

/** The Expression IR — a tagged union with exhaustive pattern matching. */
export type Expr =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | NullLiteral
  | ParamRef
  | Construct
  | VariantConstruct
  | ArrayLiteral
  | DictLiteral
  | FieldRead;

// ============================================================================
// Type reference collection — for factory import resolution
// ============================================================================

/**
 * Recursively collect all TypeName references from an Expr tree.
 * Used by emitters to determine which additional types need importing
 * when factory/coercion expressions reference types from other modules.
 */
export function collectExprTypeRefs(expr: Expr): TypeName[] {
  const refs: TypeName[] = [];
  function walk(e: Expr) {
    switch (e.kind) {
      case "construct":
        refs.push(e.typeName);
        e.fields.forEach(f => walk(f.value));
        break;
      case "variant":
        refs.push(e.baseTypeName);
        refs.push(e.variantTypeName);
        e.fields.forEach(f => walk(f.value));
        break;
      case "array":
        refs.push(e.elementTypeName);
        e.items.forEach(walk);
        break;
      case "dict":
        e.entries.forEach(ent => walk(ent.value));
        break;
      case "string":
      case "number":
      case "boolean":
      case "null":
      case "param":
      case "field_read":
        break;
    }
  }
  walk(expr);
  return refs;
}

// ============================================================================
// Type Registry — flat lookup for type-directed resolution
// ============================================================================

/**
 * Registry of TypeNodes by name, enabling the resolver to look up types
 * when processing nested objects and discriminated unions.
 *
 * Built from the emitter's type graph (TypeNode tree + enumerateTypes).
 */
export class TypeRegistry {
  private types = new Map<string, TypeNode>();

  /** Register a type by its simple name. */
  register(node: TypeNode): void {
    this.types.set(node.typeName.name, node);
  }

  /** Look up a type by simple name. Returns undefined if not found. */
  get(name: string): TypeNode | undefined {
    return this.types.get(name);
  }

  /** Build a registry from a root TypeNode by walking all reachable types. */
  static fromTypeGraph(roots: TypeNode[]): TypeRegistry {
    const registry = new TypeRegistry();
    const visited = new Set<string>();

    function walk(node: TypeNode): void {
      const key = `${node.typeName.namespace}.${node.typeName.name}`;
      if (visited.has(key)) return;
      visited.add(key);
      registry.register(node);
      for (const child of node.childTypes) {
        walk(child);
      }
      for (const prop of node.properties) {
        if (prop.type) {
          walk(prop.type);
        }
      }
    }

    for (const root of roots) {
      walk(root);
    }
    return registry;
  }
}

// ============================================================================
// Resolver — type-directed lowering (the "frontend")
// ============================================================================

/** Regex matching a `{paramName}` placeholder (must be the entire string). */
const PARAM_PLACEHOLDER = /^\{(\w+)\}$/;

/**
 * Resolve a @factory decorator into a typed Expr tree.
 *
 * @param sets - Field assignments from the decorator (e.g., { allowed: true })
 * @param params - Parameter declarations (e.g., { reason: "string" })
 * @param targetType - The TypeNode this factory constructs
 * @param registry - Type registry for resolving nested types
 * @returns A Construct expression representing the factory body
 */
export function resolveFactoryExpr(
  sets: Record<string, unknown>,
  params: Record<string, string>,
  targetType: TypeNode,
  registry: TypeRegistry,
): Construct {
  const fields: FieldAssignment[] = [];

  // 1. Resolve each explicitly-set field
  for (const [fieldName, value] of Object.entries(sets)) {
    const prop = targetType.properties.find(p => p.name === fieldName);
    if (!prop) {
      throw new Error(
        `Property '${fieldName}' not found on type '${targetType.typeName.name}'. ` +
        `Available: [${targetType.properties.map(p => p.name).join(", ")}]`
      );
    }
    fields.push({
      propertyName: fieldName,
      value: resolveValue(value, prop, params, registry),
      isOptional: prop.isOptional,
    });
  }

  // 2. Add flat params — params that match a top-level property not already in sets
  for (const [paramName, paramType] of Object.entries(params)) {
    if (paramName in sets) continue; // already handled as a nested placeholder
    // Check if this param was consumed as a placeholder inside sets
    if (isParamConsumedInSets(paramName, sets)) continue;
    const prop = targetType.properties.find(p => p.name === paramName);
    if (!prop) {
      throw new Error(
        `Parameter '${paramName}' does not match any property on type '${targetType.typeName.name}'. ` +
        `Available: [${targetType.properties.map(p => p.name).join(", ")}]`
      );
    }
    fields.push({
      propertyName: paramName,
      value: { kind: "param", name: paramName, paramType },
      isOptional: prop.isOptional,
    });
  }

  return {
    kind: "construct",
    typeName: targetType.typeName,
    fields,
  };
}

/**
 * Resolve a @coerce decorator into a typed Expr tree.
 *
 * A coercion is essentially a factory with a single implicit parameter named "value".
 * The expansion dict maps property names to values, where "{value}" is the parameter ref.
 *
 * @param expansion - The expansion dict (e.g., { id: "{value}" })
 * @param scalarType - The scalar type string (e.g., "string")
 * @param targetType - The TypeNode this coercion constructs
 * @param registry - Type registry for resolving nested types
 * @returns A Construct expression representing the coercion expansion
 */
export function resolveCoerceExpr(
  expansion: Record<string, unknown>,
  scalarType: string,
  targetType: TypeNode,
  registry: TypeRegistry,
  paramName: string = "value",
): Construct {
  // The expansion uses {value} as the fixed placeholder. Resolve with "value" as param,
  // then rename the ParamRef to the caller's desired paramName.
  const expr = resolveFactoryExpr(expansion, { value: scalarType }, targetType, registry);
  if (paramName !== "value") {
    renameParam(expr, "value", paramName);
  }
  return expr;
}

/** Recursively rename a ParamRef in an Expr tree. */
function renameParam(expr: Expr, from: string, to: string): void {
  switch (expr.kind) {
    case "param":
      if (expr.name === from) expr.name = to;
      break;
    case "construct":
      for (const f of expr.fields) renameParam(f.value, from, to);
      break;
    case "variant":
      for (const f of expr.fields) renameParam(f.value, from, to);
      break;
    case "array":
      for (const item of expr.items) renameParam(item, from, to);
      break;
    case "dict":
      for (const entry of expr.entries) renameParam(entry.value, from, to);
      break;
    // Literals and field reads don't contain params
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "field_read":
      break;
    default: {
      const _exhaustive: never = expr;
      throw new Error(`Unknown expr kind: ${(_exhaustive as Expr).kind}`);
    }
  }
}

// ============================================================================
// Internal resolution — structural recursion, type-directed
// ============================================================================

/**
 * Resolve a single value against a property's type.
 * This is the core recursive function — it dispatches on the value's shape
 * and the target property's type information.
 */
function resolveValue(
  value: unknown,
  prop: PropertyNode,
  params: Record<string, string>,
  registry: TypeRegistry,
): Expr {
  // String value — could be a literal, a param ref, or a nested field
  if (typeof value === "string") {
    return resolveStringValue(value, prop, params);
  }

  // Boolean literal
  if (typeof value === "boolean") {
    return { kind: "boolean", value };
  }

  // Number literal
  if (typeof value === "number") {
    return { kind: "number", value };
  }

  // Null
  if (value === null || value === undefined) {
    return { kind: "null" };
  }

  // Array — resolve each element against the collection's element type
  if (Array.isArray(value)) {
    return resolveArrayValue(value, prop, params, registry);
  }

  // Object — resolve as a typed construction (possibly polymorphic)
  if (typeof value === "object") {
    return resolveObjectValue(value as Record<string, unknown>, prop, params, registry);
  }

  throw new Error(`Cannot resolve value of type '${typeof value}' for property '${prop.name}'`);
}

/**
 * Resolve a string value — either a param placeholder or a string literal.
 */
function resolveStringValue(
  value: string,
  _prop: PropertyNode,
  params: Record<string, string>,
): Expr {
  const match = PARAM_PLACEHOLDER.exec(value);
  if (match) {
    const paramName = match[1];
    if (paramName in params) {
      return { kind: "param", name: paramName, paramType: params[paramName] };
    }
    throw new Error(
      `Placeholder '{${paramName}}' does not match any declared parameter. ` +
      `Available: [${Object.keys(params).join(", ")}]`
    );
  }
  return { kind: "string", value };
}

/**
 * Resolve an array value against a collection property.
 */
function resolveArrayValue(
  items: unknown[],
  prop: PropertyNode,
  params: Record<string, string>,
  registry: TypeRegistry,
): ArrayLiteral {
  if (!prop.isCollection && !prop.type) {
    // If property isn't marked as collection, use its type name for the array
  }

  // Get the element type — from prop.type (which is the element TypeNode for collections)
  const elementType = prop.type;
  const elementTypeName = prop.typeName;

  const resolvedItems = items.map((item, index) => {
    if (elementType && typeof item === "object" && item !== null && !Array.isArray(item)) {
      return resolveObjectAgainstType(item as Record<string, unknown>, elementType, params, registry);
    }
    // For scalar array elements, create a synthetic property to resolve against
    if (typeof item === "string") {
      return resolveStringValue(item, prop, params);
    }
    if (typeof item === "boolean") {
      return { kind: "boolean" as const, value: item };
    }
    if (typeof item === "number") {
      return { kind: "number" as const, value: item };
    }
    throw new Error(`Cannot resolve array element at index ${index} for property '${prop.name}'`);
  });

  return {
    kind: "array",
    elementTypeName,
    items: resolvedItems,
  };
}

/**
 * Resolve an object value against a property's type.
 * Delegates to resolveObjectAgainstType after finding the target type.
 */
function resolveObjectValue(
  obj: Record<string, unknown>,
  prop: PropertyNode,
  params: Record<string, string>,
  registry: TypeRegistry,
): Expr {
  // Find the target type — either from prop.type or registry lookup
  let targetType = prop.type;
  if (!targetType) {
    targetType = registry.get(prop.typeName.name);
  }

  if (!targetType) {
    throw new Error(
      `Cannot resolve object for property '${prop.name}': type '${prop.typeName.name}' not found in registry`
    );
  }

  return resolveObjectAgainstType(obj, targetType, params, registry);
}

/**
 * Resolve an object against a known TypeNode.
 * Handles discriminated unions (→ VariantConstruct) and plain types (→ Construct).
 */
function resolveObjectAgainstType(
  obj: Record<string, unknown>,
  targetType: TypeNode,
  params: Record<string, string>,
  registry: TypeRegistry,
): Construct | VariantConstruct {
  // Check for discriminated union dispatch
  if (targetType.discriminator && targetType.childTypes.length > 0) {
    const discriminatorValue = obj[targetType.discriminator];
    if (typeof discriminatorValue === "string") {
      return resolveVariantConstruct(obj, targetType, discriminatorValue, params, registry);
    }
  }

  // Plain type — resolve all fields
  return resolveConstruct(obj, targetType, params, registry);
}

/**
 * Resolve a discriminated union variant.
 * Looks up the child type by discriminator value, then resolves fields
 * against the child type's properties.
 */
function resolveVariantConstruct(
  obj: Record<string, unknown>,
  baseType: TypeNode,
  discriminatorValue: string,
  params: Record<string, string>,
  registry: TypeRegistry,
): VariantConstruct {
  // Find the child type matching this discriminator value
  const childType = baseType.childTypes.find(child => {
    const discProp = child.properties.find(p => p.name === baseType.discriminator);
    return discProp?.defaultValue === discriminatorValue;
  });

  if (!childType) {
    throw new Error(
      `No child type of '${baseType.typeName.name}' has ${baseType.discriminator}='${discriminatorValue}'. ` +
      `Available: [${baseType.childTypes.map(c => {
        const dp = c.properties.find(p => p.name === baseType.discriminator);
        return dp?.defaultValue ?? "*";
      }).join(", ")}]`
    );
  }

  // Resolve fields against the child type (excluding the discriminator itself)
  const fields: FieldAssignment[] = [];
  for (const [fieldName, value] of Object.entries(obj)) {
    if (fieldName === baseType.discriminator) continue; // discriminator is implicit
    // Look for the property on the child type first, then base type
    const prop = childType.properties.find(p => p.name === fieldName)
      ?? baseType.properties.find(p => p.name === fieldName);
    if (!prop) {
      throw new Error(
        `Property '${fieldName}' not found on variant '${childType.typeName.name}' ` +
        `or base '${baseType.typeName.name}'`
      );
    }
    fields.push({
      propertyName: fieldName,
      value: resolveValue(value, prop, params, registry),
      isOptional: prop.isOptional,
    });
  }

  return {
    kind: "variant",
    baseTypeName: baseType.typeName,
    discriminator: baseType.discriminator!,
    discriminatorValue,
    variantTypeName: childType.typeName,
    fields,
  };
}

/**
 * Resolve a plain (non-polymorphic) object construction.
 */
function resolveConstruct(
  obj: Record<string, unknown>,
  targetType: TypeNode,
  params: Record<string, string>,
  registry: TypeRegistry,
): Construct {
  const fields: FieldAssignment[] = [];
  for (const [fieldName, value] of Object.entries(obj)) {
    const prop = targetType.properties.find(p => p.name === fieldName);
    if (!prop) {
      throw new Error(
        `Property '${fieldName}' not found on type '${targetType.typeName.name}'. ` +
        `Available: [${targetType.properties.map(p => p.name).join(", ")}]`
      );
    }
    fields.push({
      propertyName: fieldName,
      value: resolveValue(value, prop, params, registry),
      isOptional: prop.isOptional,
    });
  }

  return {
    kind: "construct",
    typeName: targetType.typeName,
    fields,
  };
}

/**
 * Check if a param name is used as a {placeholder} anywhere in the sets tree.
 * Used to avoid double-emitting params that appear both as top-level property
 * matches and as nested placeholders.
 */
function isParamConsumedInSets(paramName: string, sets: Record<string, unknown>): boolean {
  const placeholder = `{${paramName}}`;
  function search(value: unknown): boolean {
    if (value === placeholder) return true;
    if (Array.isArray(value)) return value.some(search);
    if (value !== null && typeof value === "object") {
      return Object.values(value as Record<string, unknown>).some(search);
    }
    return false;
  }
  return Object.values(sets).some(search);
}
