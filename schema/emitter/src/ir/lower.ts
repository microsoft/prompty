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
  EnumDef,
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
  WireDecl,
  WireFieldMapping,
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

  // Collect unique enum definitions from all fields across all types
  const enums = collectEnums(types);

  return {
    typeName: node.typeName,
    types,
    imports,
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
    enums,
    group: node.group,
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

  // Clear enum metadata from discriminator fields — they're handled by polymorphic dispatch
  if (polymorphicDispatch) {
    for (const field of fields) {
      if (field.name === polymorphicDispatch.discriminatorField) {
        field.enumName = null;
        field.isOpenEnum = false;
      }
    }
  }

  // Build load/save method specs
  const load = lowerLoad(node, fields, polymorphicDispatch);
  const save = lowerSave(node, fields);

  return {
    typeName: node.typeName,
    base: node.base,
    isAbstract: node.isAbstract,
    isProtocol: node.isProtocol,
    description: node.description,
    fields,
    coercionProperty,
    load,
    save,
    factories,
    collectionHelpers,
    polymorphicDispatch,
    methods: lowerMethods(node),
    wire: lowerWire(node, fields),
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
  const knownAs: Record<string, string> = {};
  for (const entry of prop.knownAs) {
    knownAs[entry.provider] = entry.name;
  }
  return {
    name: prop.name,
    typeName: prop.typeName,
    category: classifyProperty(prop, polymorphicTypeNames),
    isOptional: prop.isOptional,
    defaultValue: prop.defaultValue,
    allowedValues: prop.allowedValues,
    enumName: prop.enumName,
    isOpenEnum: prop.isOpenEnum,
    description: prop.description,
    knownAs,
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
    enumName: f.enumName,
    allowedValues: f.allowedValues,
    defaultValue: f.defaultValue,
    isOpenEnum: f.isOpenEnum,
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
    enumName: f.enumName,
    isOpenEnum: f.isOpenEnum,
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

  return node.factories.map(f => {
    const expr = resolveFactoryExpr(f.sets, f.params, node, registry);

    return {
      name: f.name,
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
    params: m.params || {},
    optional: m.optional ?? false,
    sync: m.sync ?? false,
  }));
}

// ============================================================================
// Wire conversion lowering
// ============================================================================

/**
 * Lower wire conversion data from knownAs mappings on fields.
 * Returns null if no field has wire mappings.
 */
function lowerWire(node: TypeNode, fields: FieldDecl[]): WireDecl | null {
  const providerSet = new Set<string>();
  const mappings: WireFieldMapping[] = [];

  for (const field of fields) {
    if (Object.keys(field.knownAs).length > 0) {
      for (const provider of Object.keys(field.knownAs)) {
        providerSet.add(provider);
      }
      mappings.push({
        fieldName: field.name,
        category: field.category,
        isOptional: field.isOptional,
        parentTypeName: node.typeName.name,
        wireNames: field.knownAs,
      });
    }
  }

  if (mappings.length === 0) return null;

  return {
    providers: Array.from(providerSet).sort(),
    mappings,
  };
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
// Enum collection
// ============================================================================

/**
 * Collect unique enum definitions from all fields across all types in a file.
 * Deduplicates by enum name — same-named enums with the same values share one definition.
 */
function collectEnums(types: TypeDecl[]): EnumDef[] {
  const seen = new Map<string, EnumDef>();
  // Collect discriminator field names to skip — these are handled by polymorphic dispatch
  const discriminatorFields = new Set<string>();
  for (const type of types) {
    if (type.polymorphicDispatch) {
      discriminatorFields.add(type.polymorphicDispatch.discriminatorField);
    }
  }
  for (const type of types) {
    for (const field of type.fields) {
      // Skip discriminator fields — they use the polymorphic Kind enum instead
      if (discriminatorFields.has(field.name)) continue;
      if (field.enumName && field.allowedValues.length > 0 && !seen.has(field.enumName)) {
        seen.set(field.enumName, {
          name: field.enumName,
          values: field.allowedValues,
          isOpen: field.isOpenEnum,
        });
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
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

    // Protocol method type references (param types and return types)
    for (const method of type.methods) {
      for (const typeName of extractMethodTypeRefs(method)) {
        addImport(typeName);
      }
    }
  }

  return Array.from(importMap.entries())
    .map(([module, names]) => {
      // Look up the group of the module's root node in the registry
      const modNode = registry.get(module);
      const group = modNode?.group ?? "";
      return { module, names: Array.from(names).sort(), group };
    })
    .sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * Extract type names referenced in method parameter types and return type.
 * Handles formats like "Prompty", "Message[]", "Record<unknown>", "string", "unknown".
 */
function extractMethodTypeRefs(method: MethodStubDecl): string[] {
  const SCALARS = new Set(["string", "int32", "float32", "float64", "boolean", "unknown"]);
  const refs: string[] = [];

  const extract = (typeStr: string) => {
    // Strip nullable suffix and array suffix: "string?" → "string", "Message[]" → "Message"
    const base = typeStr.replace(/\?$/, "").replace(/\[\]$/, "");
    // Skip scalars, Record<>, and generic types
    if (SCALARS.has(base) || base.startsWith("Record<")) return;
    refs.push(base);
  };

  extract(method.returns);
  for (const pType of Object.values(method.params)) {
    extract(pType);
  }

  return refs;
}
