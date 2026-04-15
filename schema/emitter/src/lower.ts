/**
 * Lowering pass — TypeNode graph → Declaration IR.
 *
 * This module converts the emitter's type graph (TypeNode/PropertyNode)
 * into the language-agnostic Declaration IR (FileDecl/TypeDecl).
 *
 * The lowering is shared across all 5 target languages. Per-language
 * emitter functions consume the FileDecl tree and emit code.
 *
 * Key responsibilities:
 *   - Classify every property into a PropertyCategory
 *   - Build load/save method specifications
 *   - Resolve polymorphic dispatch
 *   - Resolve collection helpers
 *   - Resolve factory methods via the Expression IR
 *   - Compute file-level imports
 */

import { TypeNode, PropertyNode, TypeName } from "./ast.js";
import {
  TypeRegistry,
  resolveFactoryExpr,
  collectExprTypeRefs,
  Expr,
} from "./expansion.js";
import {
  PropertyCategory,
  FileDecl,
  TypeDecl,
  FieldDecl,
  LoadDecl,
  SaveDecl,
  CoercionDecl,
  CoercionAssignment,
  LoadAssignment,
  SaveAssignment,
  PolymorphicDispatchDecl,
  PolymorphicVariant,
  PolymorphicDefault,
  CollectionHelperDecl,
  FactoryDecl,
  MethodStubDecl,
  ImportRef,
} from "./declarations.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Lower a base TypeNode (and all its children) into a FileDecl.
 *
 * This is the main entry point for the lowering pass. It produces a complete
 * FileDecl containing one or more TypeDecls (parent + children for polymorphic types).
 *
 * The result is fully language-agnostic — per-language emitters handle rendering.
 *
 * @param node - The base TypeNode (must not have a parent — i.e., `node.base === null`)
 * @param registry - TypeRegistry for resolving type references
 * @param polymorphicTypeNames - Set of type names that are polymorphic bases
 */
export function lowerFile(
  node: TypeNode,
  registry: TypeRegistry,
  polymorphicTypeNames?: Set<string>,
): FileDecl {
  const polyNames = polymorphicTypeNames ?? collectPolymorphicTypeNames(node, registry);

  // Lower all types in this file (parent + children)
  const types: TypeDecl[] = [
    lowerType(node, registry, polyNames),
    ...node.childTypes.map(ct => lowerType(ct, registry, polyNames)),
  ];

  // Resolve file-level imports
  const imports = resolveImports(node, types, registry);

  return {
    typeName: node.typeName,
    types,
    imports,
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
  };
}

/**
 * Collect all polymorphic type names from a set of nodes.
 */
export function collectPolymorphicTypeNames(
  rootNode: TypeNode,
  registry: TypeRegistry,
): Set<string> {
  const names = new Set<string>();

  function walk(node: TypeNode): void {
    if (node.discriminator && node.childTypes.length > 0) {
      names.add(node.typeName.name);
    }
    for (const prop of node.properties) {
      if (prop.type) walk(prop.type);
    }
    for (const child of node.childTypes) {
      walk(child);
    }
  }

  walk(rootNode);
  return names;
}

// ============================================================================
// Type lowering
// ============================================================================

/**
 * Lower a single TypeNode into a TypeDecl.
 */
export function lowerType(
  node: TypeNode,
  registry: TypeRegistry,
  polymorphicTypeNames: Set<string>,
): TypeDecl {
  const fields = node.properties.map(p => lowerField(p, polymorphicTypeNames));
  const collectionHelpers = lowerCollectionHelpers(node);
  const polymorphicDispatch = lowerPolymorphicDispatch(node);
  const factories = lowerFactories(node, registry);
  const coercionProperty = findCoercionProperty(node);

  // Build load/save method specs
  const load = lowerLoad(node, fields, polymorphicDispatch);
  const save = lowerSave(node, fields);

  return {
    typeName: node.typeName,
    base: node.base,
    isAbstract: node.isAbstract,
    description: node.description,
    fields,
    coercionProperty,
    load,
    save,
    factories,
    collectionHelpers,
    polymorphicDispatch,
    methods: lowerMethods(node),
  };
}

// ============================================================================
// Property classification — the core insight
// ============================================================================

/**
 * Classify a property into one of 5 categories.
 * This is the fundamental decision that drives ALL code generation.
 *
 * Decision tree:
 *   isDict → "dict"
 *   isCollection && isScalar → "collection_scalar"
 *   isCollection && !isScalar → "collection_complex"
 *   isScalar → "scalar"
 *   !isScalar → "complex"
 */
export function classifyProperty(
  prop: PropertyNode,
  polymorphicTypeNames: Set<string>,
): PropertyCategory {
  if (prop.isDict) {
    return { kind: "dict" };
  }

  if (prop.isCollection) {
    if (prop.isScalar) {
      return { kind: "collection_scalar", scalarType: prop.typeName.name };
    }
    return { kind: "collection_complex", typeName: prop.typeName.name };
  }

  if (prop.isScalar) {
    return { kind: "scalar", scalarType: prop.typeName.name };
  }

  return { kind: "complex", typeName: prop.typeName.name };
}

// ============================================================================
// Field lowering
// ============================================================================

/**
 * Lower a PropertyNode into a FieldDecl.
 */
function lowerField(
  prop: PropertyNode,
  polymorphicTypeNames: Set<string>,
): FieldDecl {
  return {
    name: prop.name,
    typeName: prop.typeName,
    category: classifyProperty(prop, polymorphicTypeNames),
    isOptional: prop.isOptional,
    defaultValue: prop.defaultValue,
    allowedValues: prop.allowedValues,
    description: prop.description,
  };
}

// ============================================================================
// Load method lowering
// ============================================================================

/**
 * Lower the load/deserialization method specification.
 *
 * Produces language-agnostic coercion and assignment data. Each emitter
 * decides variable names, rendering, and expression formatting.
 */
function lowerLoad(
  node: TypeNode,
  fields: FieldDecl[],
  polymorphicDispatch: PolymorphicDispatchDecl | null,
): LoadDecl {
  // Determine if this type has a discriminator with child variants
  const hasDiscriminatorWithChildren =
    node.discriminator != null &&
    (node.childTypes?.length ?? 0) > 0;

  const coercions: CoercionDecl[] = (node.coercions || []).map(c => {
    // Build structured assignments from the expansion dict
    const assignments: CoercionAssignment[] = Object.entries(c.expansion).map(
      ([key, value]) => ({
        fieldName: key,
        isInput: value === "{value}",
        literalValue: value === "{value}" ? undefined : String(value),
      }),
    );

    // Determine if this coercion needs runtime dispatch:
    // only when the discriminator field is set dynamically AND child types exist
    const setsDiscriminator = node.discriminator != null &&
      assignments.some(a => a.fieldName === node.discriminator && a.isInput);
    const needsDispatch = setsDiscriminator && hasDiscriminatorWithChildren;

    return {
      scalarType: c.scalar,
      assignments,
      needsDispatch,
    };
  });

  // Per-property load assignments
  const assignments: LoadAssignment[] = fields.map(f => ({
    sourceName: f.name,
    fieldName: f.name,
    category: f.category,
    isOptional: f.isOptional,
    parentTypeName: node.typeName.name,
  }));

  return {
    coercions,
    assignments,
    hasPolymorphicDispatch: polymorphicDispatch !== null,
    hasContextHooks: true, // All types support context hooks
  };
}

// ============================================================================
// Save method lowering
// ============================================================================

/**
 * Lower the save/serialization method specification.
 */
function lowerSave(
  node: TypeNode,
  fields: FieldDecl[],
): SaveDecl {
  const assignments: SaveAssignment[] = fields.map(f => ({
    targetName: f.name,
    fieldName: f.name,
    category: f.category,
    isOptional: f.isOptional,
    parentTypeName: node.typeName.name,
  }));

  return {
    assignments,
    hasBase: node.base !== null,
    hasContextHooks: true,
  };
}

// ============================================================================
// Polymorphic dispatch lowering
// ============================================================================

/**
 * Lower polymorphic dispatch specification from TypeNode.
 * Returns null if the type is not polymorphic (no discriminator or no children).
 */
function lowerPolymorphicDispatch(
  node: TypeNode,
): PolymorphicDispatchDecl | null {
  const polyTypes = node.retrievePolymorphicTypes();
  if (!polyTypes) return null;

  const variants: PolymorphicVariant[] = polyTypes.types.map((t: any) => ({
    value: t.value,
    typeName: (t.instance as TypeNode).typeName,
  }));

  let defaultVariant: PolymorphicDefault | null = null;
  if (polyTypes.default) {
    const defaultNode = polyTypes.default.instance as TypeNode;
    defaultVariant = {
      typeName: defaultNode.typeName,
      isSelfReference: defaultNode.typeName.name === node.typeName.name,
    };
  }

  const baseDispatch: PolymorphicDispatchDecl = {
    discriminatorField: node.discriminator!,
    variants,
    defaultVariant,
    isAbstract: node.isAbstract,
  };

  return baseDispatch;
}

// ============================================================================
// Collection helper lowering
// ============================================================================

/**
 * Lower collection helpers for complex collection properties.
 * These are properties like `tools: Tool[]` or `parts: ContentPart[]`
 * that need dedicated load/save helper methods for dict↔array conversion.
 */
function lowerCollectionHelpers(node: TypeNode): CollectionHelperDecl[] {
  return node.properties
    .filter(p => p.isCollection && !p.isScalar && !p.isDict)
    .map(p => ({
      propertyName: p.name,
      elementTypeName: p.typeName,
      innerFields: p.type?.properties.filter(t => t.name !== "name").map(t => t.name) || [],
      hasNameProperty: p.type?.properties.some(t => t.name === "name") || false,
    }));
}

// ============================================================================
// Factory method lowering
// ============================================================================

/**
 * Lower factory methods. Resolves the Expr tree via the Expression IR
 * but stores it as a typed Expr (not pre-rendered string).
 * Emitters will visit the Expr with their own visitor for language-specific output.
 */
function lowerFactories(
  node: TypeNode,
  registry: TypeRegistry,
): FactoryDecl[] {
  if (!node.factories || node.factories.length === 0) return [];

  // Pre-compute safe names to avoid field/method collisions
  const fieldNames = new Set(node.properties.map(p => p.name));

  return node.factories.map(f => {
    const expr = resolveFactoryExpr(f.sets, f.params, node, registry);
    // Compute safe name — prefix with create_ if it collides with a field
    const safeName = fieldNames.has(f.name) ? `create_${f.name}` : f.name;

    return {
      name: f.name,
      safeName,
      params: f.params,
      body: expr,
    };
  });
}

// ============================================================================
// Method stub lowering
// ============================================================================

function lowerMethods(node: TypeNode): MethodStubDecl[] {
  return (node.methods || []).map(m => ({
    name: m.name,
    returns: m.returns,
    description: m.description,
  }));
}

// ============================================================================
// Coercion property detection
// ============================================================================

/**
 * Find the property that receives "{value}" in coercion expansions.
 */
function findCoercionProperty(node: TypeNode): string | null {
  if (!node.coercions || node.coercions.length === 0) return null;

  for (const alt of node.coercions) {
    for (const [key, value] of Object.entries(alt.expansion)) {
      if (value === "{value}") {
        return key;
      }
    }
  }
  return null;
}

// ============================================================================
// Import resolution
// ============================================================================

/**
 * Resolve file-level imports from type references.
 * Groups imports by module: each module maps to the symbols imported from it.
 */
function resolveImports(
  rootNode: TypeNode,
  types: TypeDecl[],
  registry: TypeRegistry,
): ImportRef[] {
  // Types defined in this file (excluded from imports)
  const definedInFile = new Set([
    rootNode.typeName.name,
    ...rootNode.childTypes.map(c => c.typeName.name),
  ]);
  const importMap = new Map<string, Set<string>>();

  const addImport = (typeName: string, module?: string) => {
    if (definedInFile.has(typeName)) return;
    // Determine which module this type lives in
    const refNode = registry.get(typeName);
    const mod = module ?? (refNode?.base ? refNode.base.name : typeName);
    if (!importMap.has(mod)) importMap.set(mod, new Set());
    importMap.get(mod)!.add(typeName);
  };

  // Collect import refs from all properties across all types in this file
  for (const type of types) {
    for (const field of type.fields) {
      // Only import non-scalar, non-dict types
      if (field.category.kind === "complex" || field.category.kind === "collection_complex") {
        addImport(field.typeName.name);
      }
    }

    // Factory-referenced imports (may include child types like TextPart)
    for (const factory of type.factories) {
      for (const ref of collectExprTypeRefs(factory.body)) {
        if (definedInFile.has(ref.name)) continue;
        addImport(ref.name);
      }
    }
  }

  return Array.from(importMap.entries())
    .map(([module, names]) => ({ module, names: Array.from(names).sort() }))
    .sort((a, b) => a.module.localeCompare(b.module));
}
