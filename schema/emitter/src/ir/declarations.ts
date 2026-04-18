/**
 * Declaration IR — Type-level code generation for the emitter.
 *
 * This module defines the "declaration" IR that replaces Nunjucks templates.
 * Where the Expression IR (expansion.ts) handles factory/coercion bodies,
 * the Declaration IR handles entire type definitions: structs, fields,
 * load/save methods, polymorphic dispatch, collection helpers, and factories.
 *
 * Architecture:
 *   TypeNode graph → lowerFile() → FileDecl → emitPythonFile() → .py code
 *                                            → emitRustFile()   → .rs code
 *                                            → emitTypeScriptFile() → .ts code
 *                                            → emitCSharpFile() → .cs code
 *                                            → emitGoFile()     → .go code
 *
 * The lowering pass (lower.ts) converts the TypeNode graph into FileDecl trees.
 * Per-language emitter functions walk the FileDecl tree to produce code.
 *
 * Key design principle: PropertyCategory is the fundamental 5-way classification
 * that drives ALL per-property code generation across all languages.
 */

import { TypeName } from "./ast.js";
import { Expr } from "./expansion.js";

// ============================================================================
// PropertyCategory — the fundamental classification
// ============================================================================

/**
 * Every property in the type system falls into exactly one of these categories.
 * This classification determines:
 *   - Type annotation in each language
 *   - Default value
 *   - Load (deserialization) pattern
 *   - Save (serialization) pattern
 *   - Whether a collection helper is generated
 *
 * Templates previously computed this via chains of `if isScalar && isCollection && !isDict`.
 * Now it's classified once in the lowering pass.
 */
export type PropertyCategory =
  | { kind: "scalar"; scalarType: string }
  | { kind: "complex"; typeName: string }
  | { kind: "collection_scalar"; scalarType: string }
  | { kind: "collection_complex"; typeName: string }
  | { kind: "dict" };

// ============================================================================
// EnumDef — a string-literal enum type
// ============================================================================

/**
 * Represents a named string-literal enum type (e.g., `Role`, `AuthenticationMode`).
 * Derived from TypeSpec `alias X = "a" | "b" | "c"` unions.
 *
 * Language emitters use this to produce:
 *   - Python: `Role = Literal["system", "user", ...]`
 *   - TypeScript: `type Role = "system" | "user" | ...`
 *   - C#: `public enum Role { ... }` (with JSON string conversion)
 *   - Rust: `pub enum Role { ... }` (with serde rename_all)
 *   - Go: `type Role string` with const block
 */
export interface EnumDef {
  /** Enum type name (PascalCase from the TypeSpec alias, e.g., "Role") */
  name: string;
  /** Known string values (e.g., ["system", "user", "assistant", "developer", "tool"]) */
  values: string[];
  /** True when the alias includes `| string` — accepts arbitrary strings beyond the known values */
  isOpen: boolean;
}

// ============================================================================
// FileDecl — a complete generated file
// ============================================================================

/**
 * Represents an entire generated source file.
 * Contains one or more types (parent + children for polymorphic types),
 * resolved imports, and file-level metadata.
 */
export interface FileDecl {
  /** Primary type name (used for file naming) */
  typeName: TypeName;
  /** All types defined in this file (parent first, then children) */
  types: TypeDecl[];
  /** Resolved imports — each entry maps a module to the symbols imported from it */
  imports: ImportRef[];
  /** Whether any type in the file is abstract */
  containsAbstract: boolean;
  /** String-literal enum types used by fields in this file */
  enums: EnumDef[];
  /** Semantic group derived from TSP source subfolder (e.g. "connection", "tools"). Empty string for root-level files. */
  group: string;
}

/**
 * A single import statement grouping: one module, multiple symbols.
 */
export interface ImportRef {
  /** Module/file to import from (e.g., "ContentPart" in Python, "content-part" in TS) */
  module: string;
  /** Symbols imported from that module (e.g., ["ContentPart", "TextPart"]) */
  names: string[];
  /** Semantic group of the imported module (e.g. "connection"). Empty string for root-level modules. */
  group: string;
}

// ============================================================================
// TypeDecl — a single type definition
// ============================================================================

/**
 * Represents a complete type definition (class/struct/dataclass).
 * Contains everything needed to generate the type and all its methods.
 */
export interface TypeDecl {
  /** Type name */
  typeName: TypeName;
  /** Parent type name (for inheritance) */
  base: TypeName | null;
  /** Whether this type is abstract (Python: ABC, C#: abstract, TS: abstract) */
  isAbstract: boolean;
  /** Whether this type is a protocol interface (Python: Protocol, TS: interface, Rust: trait, C#: interface, Go: interface) */
  isProtocol: boolean;
  /** Human-readable description for docstrings/comments */
  description: string;
  /** All fields defined on this type */
  fields: FieldDecl[];
  /** The property name that receives scalar coercion value, if any */
  coercionProperty: string | null;
  /** Load method specification */
  load: LoadDecl;
  /** Save method specification */
  save: SaveDecl;
  /** Factory methods (reuse Expr IR for bodies) */
  factories: FactoryDecl[];
  /** Collection helper methods (load_items/save_items for complex collections) */
  collectionHelpers: CollectionHelperDecl[];
  /** Polymorphic dispatch specification (if this type has a discriminator) */
  polymorphicDispatch: PolymorphicDispatchDecl | null;
  /** Method stubs to be implemented in extension modules */
  methods: MethodStubDecl[];
  /** Wire conversion specification (generated when any field has knownAs mappings) */
  wire: WireDecl | null;
}

// ============================================================================
// FieldDecl — a single field/property
// ============================================================================

/**
 * Represents a single field on a type.
 * The category determines ALL code generation patterns for this field.
 */
export interface FieldDecl {
  /** Original property name from TypeSpec (camelCase) */
  name: string;
  /** Type name for annotations */
  typeName: TypeName;
  /** The fundamental classification that drives code generation */
  category: PropertyCategory;
  /** Whether this field is optional (None/null/nil default) */
  isOptional: boolean;
  /** Default value for the field (primitives only) */
  defaultValue: string | number | boolean | null;
  /** Allowed string values (for enum-like constraints) */
  allowedValues: string[];
  /** Named enum type for this field (e.g., "Role"), null if not an enum field */
  enumName: string | null;
  /** True when the enum includes a bare `string` variant (open — accepts any string) */
  isOpenEnum: boolean;
  /** Human-readable description for docstrings */
  description: string;
  /** Wire name mappings per provider (e.g., { openai: "max_completion_tokens" }) */
  knownAs: Record<string, string>;
}

// ============================================================================
// LoadDecl — load/deserialization method
// ============================================================================

/**
 * Specification for the load()/load_from_value() static method.
 * The emitter generates per-property deserialization based on field categories.
 */
export interface LoadDecl {
  /** Coercion checks applied before dict validation (isinstance checks) */
  coercions: CoercionDecl[];
  /** Per-property load assignments, ordered by field order */
  assignments: LoadAssignment[];
  /** Whether this type dispatches to polymorphic subtypes */
  hasPolymorphicDispatch: boolean;
  /** Whether LoadContext hooks are applied (process_input, process_output) */
  hasContextHooks: boolean;
}

/**
 * A coercion check: if the input matches a scalar type, transform it.
 *
 * Emitters use `assignments` for direct property setting (no intermediate dict).
 */
export interface CoercionDecl {
  /** Scalar type name from TypeSpec (e.g., "string", "boolean", "int64") */
  scalarType: string;
  /** Structured assignments — each property to set on the new instance */
  assignments: CoercionAssignment[];
  /**
   * True when the coercion involves a dynamic discriminator value on a
   * type with child variants.  The emitter must call the dispatch method
   * (e.g. `load_kind()`) instead of constructing the instance directly.
   */
  needsDispatch: boolean;
}

/**
 * A single field assignment within a coercion.
 */
export interface CoercionAssignment {
  /** Property name (camelCase, as declared in TypeSpec) */
  fieldName: string;
  /** True when the value comes from the scalar input data */
  isInput: boolean;
  /** Literal string value when `isInput` is false */
  literalValue?: string;
}

/**
 * A single property load assignment.
 * The category determines the deserialization pattern used by each language emitter.
 */
export interface LoadAssignment {
  /** Original property name (dict key, camelCase) */
  sourceName: string;
  /** Field to assign to (same as sourceName — emitters apply their own casing) */
  fieldName: string;
  /** Category determines the load pattern */
  category: PropertyCategory;
  /** Whether the field is optional */
  isOptional: boolean;
  /** Parent type name (needed for calling collection helpers like Parent.load_items) */
  parentTypeName: string;
  /** Enum type name (if this field references a named enum) */
  enumName: string | null;
  /** Allowed values for enum fields */
  allowedValues: string[];
  /** Default value (for fallback on missing/invalid data) */
  defaultValue: string | number | boolean | null;
  /** Whether the enum is open (accepts arbitrary string values) */
  isOpenEnum: boolean;
}

// ============================================================================
// SaveDecl — save/serialization method
// ============================================================================

/**
 * Specification for the save() instance method.
 */
export interface SaveDecl {
  /** Per-property save assignments */
  assignments: SaveAssignment[];
  /** Whether to call super().save() first (has a base class) */
  hasBase: boolean;
  /** Whether SaveContext hooks are applied (process_object, process_dict) */
  hasContextHooks: boolean;
}

/**
 * A single property save assignment.
 */
export interface SaveAssignment {
  /** Property name (dict key to write to, camelCase) */
  targetName: string;
  /** Field name to read from (same as targetName — emitters apply their own casing) */
  fieldName: string;
  /** Category determines the serialization pattern */
  category: PropertyCategory;
  /** Whether the field is optional (skip if null/None/nil) */
  isOptional: boolean;
  /** Parent type name (for collection save helpers) */
  parentTypeName: string;
  /** Enum type name (if this field references a named enum) */
  enumName: string | null;
  /** Whether the enum is open (accepts arbitrary string values) */
  isOpenEnum: boolean;
}

// ============================================================================
// PolymorphicDispatchDecl — discriminator-based type dispatch
// ============================================================================

/**
 * Specification for discriminator-based polymorphic dispatch.
 * Generated as load_kind() in Python, loadKind() in TS, switch in C#, etc.
 */
export interface PolymorphicDispatchDecl {
  /** Discriminator field name (e.g., "kind") */
  discriminatorField: string;
  /** Concrete variant types with their discriminator values */
  variants: PolymorphicVariant[];
  /** Default/fallback type (wildcard or self-reference for non-abstract bases) */
  defaultVariant: PolymorphicDefault | null;
  /** Whether the base type is abstract (affects error handling on unknown values) */
  isAbstract: boolean;
}

/**
 * A concrete polymorphic variant (a child type with a known discriminator value).
 */
export interface PolymorphicVariant {
  /** Discriminator value that selects this variant (e.g., "text", "function") */
  value: string;
  /** Type to construct when this variant is matched */
  typeName: TypeName;
}

/**
 * Default/fallback for polymorphic dispatch.
 */
export interface PolymorphicDefault {
  /** The fallback type */
  typeName: TypeName;
  /** Whether this is a self-reference (base type falling back to itself — avoid infinite recursion) */
  isSelfReference: boolean;
}

// ============================================================================
// CollectionHelperDecl — load_items/save_items for complex collections
// ============================================================================

/**
 * Specification for collection helper methods.
 * Generated for properties that are collections of complex types
 * (e.g., list[Tool], Vec<Property>).
 *
 * These handle the dict↔array format conversion:
 *   - Array format: [{ name: "a", kind: "b" }, ...]
 *   - Dict/object format: { "a": { kind: "b" }, ... }
 */
export interface CollectionHelperDecl {
  /** Property name (used for method naming: load_<name>, save_<name>) */
  propertyName: string;
  /** Element type name (the type being loaded/saved) */
  elementTypeName: TypeName;
  /** Field names on the element type (excluding "name" — used for shorthand detection) */
  innerFields: string[];
  /** Whether the element type has a "name" property (enables dict format) */
  hasNameProperty: boolean;
}

// ============================================================================
// FactoryDecl — factory method (reuses Expr IR)
// ============================================================================

/**
 * A factory method declaration.
 * The body is a pre-resolved Expr from the expression IR — emitters
 * visit it with their ExprVisitor to produce language-specific code.
 */
export interface FactoryDecl {
  /** Original factory name from @factory decorator */
  name: string;
  /** Parameter name → type string mapping */
  params: Record<string, string>;
  /** Pre-resolved expression tree for the factory body */
  body: Expr;
}

// ============================================================================
// MethodStubDecl — helper method stubs
// ============================================================================

/**
 * A method stub to be implemented in an extension module.
 * Generated as comments/trait stubs pointing users to implement these.
 * For protocol types, generates full interface method signatures.
 */
export interface MethodStubDecl {
  /** Method name */
  name: string;
  /** Return type as a string */
  returns: string;
  /** Human-readable description */
  description: string;
  /** Method parameters as ordered map of name → type string */
  params: Record<string, string>;
  /** Whether this method is optional (has a default implementation) */
  optional: boolean;
  /** Whether this method is synchronous (not wrapped in async/Promise/Task) */
  sync: boolean;
}

// ============================================================================
// WireDecl — provider-specific wire format conversion
// ============================================================================

/**
 * Specification for the toWire(provider) method.
 * Generated when at least one field on a type has knownAs mappings.
 * Maps camelCase field names to provider-specific wire names.
 */
export interface WireDecl {
  /** All known provider identifiers (e.g., ["openai", "anthropic"]) */
  providers: string[];
  /** Per-field wire name mappings */
  mappings: WireFieldMapping[];
}

/**
 * A single field's wire name mappings across providers.
 */
export interface WireFieldMapping {
  /** Original field name (camelCase) */
  fieldName: string;
  /** Category of the field (for serialization) */
  category: PropertyCategory;
  /** Whether the field is optional */
  isOptional: boolean;
  /** Parent type name (for collection helpers) */
  parentTypeName: string;
  /** Provider → wire field name map */
  wireNames: Record<string, string>;
}
