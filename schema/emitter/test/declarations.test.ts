/**
 * Tests for Declaration IR — lowering pass and property classification.
 *
 * Uses Node.js built-in test runner (`node --test`).
 *
 * Reuses the same TypeNode/PropertyNode fixtures from expansion.test.ts
 * to verify that lowerFile(), lowerType(), and classifyProperty() produce
 * correct Declaration IR from known type graphs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Model, ModelProperty } from "@typespec/compiler";

import { TypeRegistry } from "../src/ir/expansion.js";
import { TypeNode, PropertyNode } from "../src/ir/ast.js";
import {
  classifyProperty,
  lowerFile,
  lowerType,
  collectPolymorphicTypeNames,
} from "../src/ir/lower.js";

// ============================================================================
// Test fixtures (same as expansion.test.ts)
// ============================================================================

function makeType(name: string, props: PropertyNode[] = [], opts?: {
  discriminator?: string;
  childTypes?: TypeNode[];
  namespace?: string;
  base?: { namespace: string; name: string };
  factories?: Array<{ name: string; sets: Record<string, any>; params: Record<string, string> }>;
  coercions?: Array<{ scalar: string; expansion: Record<string, any> }>;
  isAbstract?: boolean;
  methods?: Array<{ name: string; returns: string; description: string; params?: Record<string, string>; optional?: boolean; sync?: boolean }>;
}): TypeNode {
  const node = new TypeNode({} as Model, `Test ${name}`);
  node.typeName = { namespace: opts?.namespace ?? "Test", name };
  node.properties = props;
  node.discriminator = opts?.discriminator;
  node.childTypes = opts?.childTypes ?? [];
  node.factories = opts?.factories ?? [];
  node.coercions = opts?.coercions ?? [];
  node.isAbstract = opts?.isAbstract ?? false;
  node.base = opts?.base ?? null;
  node.methods = (opts?.methods ?? []).map(m => ({ ...m, params: m.params ?? {}, optional: m.optional ?? false, sync: m.sync ?? false }));
  return node;
}

function makeProp(name: string, typeName: string, opts?: {
  isScalar?: boolean;
  isOptional?: boolean;
  isCollection?: boolean;
  isDict?: boolean;
  type?: TypeNode;
  defaultValue?: string | number | boolean | null;
  namespace?: string;
  allowedValues?: string[];
}): PropertyNode {
  const prop = new PropertyNode({} as ModelProperty, `Test ${name}`);
  prop.name = name;
  prop.typeName = { namespace: opts?.namespace ?? "Test", name: typeName };
  prop.isScalar = opts?.isScalar ?? (["string", "boolean", "number", "integer", "int32", "int64", "float", "float32", "float64"].includes(typeName));
  prop.isOptional = opts?.isOptional ?? false;
  prop.isCollection = opts?.isCollection ?? false;
  prop.isDict = opts?.isDict ?? false;
  prop.type = opts?.type;
  prop.defaultValue = opts?.defaultValue ?? null;
  prop.allowedValues = opts?.allowedValues ?? [];
  return prop;
}

// -- Shared fixtures --

const textPart = makeType("TextPart", [
  makeProp("kind", "string", { isScalar: true, defaultValue: "text" }),
  makeProp("value", "string", { isScalar: true }),
], { base: { namespace: "Test", name: "ContentPart" } });

const imagePart = makeType("ImagePart", [
  makeProp("kind", "string", { isScalar: true, defaultValue: "image" }),
  makeProp("url", "string", { isScalar: true }),
], { base: { namespace: "Test", name: "ContentPart" } });

const contentPart = makeType("ContentPart", [
  makeProp("kind", "string", { isScalar: true }),
], {
  discriminator: "kind",
  childTypes: [textPart, imagePart],
});

// NamedProp for testing collection hasNameProperty
const namedBinding = makeType("Binding", [
  makeProp("name", "string", { isScalar: true }),
  makeProp("value", "string", { isScalar: true }),
]);

const toolResult = makeType("ToolResult", [
  makeProp("parts", "ContentPart", { isCollection: true, type: contentPart }),
], {
  factories: [
    { name: "text", sets: { parts: [{ kind: "text", value: "{value}" }] }, params: { value: "string" } },
  ],
});

const message = makeType("Message", [
  makeProp("role", "string", { isScalar: true }),
  makeProp("parts", "ContentPart", { isCollection: true, type: contentPart }),
  makeProp("metadata", "dictionary", { isDict: true, isOptional: true }),
]);

// Type with coercions (shorthand)
const modelType = makeType("Model", [
  makeProp("id", "string", { isScalar: true }),
  makeProp("provider", "string", { isScalar: true, isOptional: true }),
], {
  coercions: [{ scalar: "string", expansion: { id: "{value}" } }],
});

// Abstract polymorphic base (e.g., Connection)
const apiKeyConnection = makeType("ApiKeyConnection", [
  makeProp("kind", "string", { isScalar: true, defaultValue: "key" }),
  makeProp("endpoint", "string", { isScalar: true }),
  makeProp("apiKey", "string", { isScalar: true, isOptional: true }),
], { base: { namespace: "Test", name: "Connection" } });

const connectionType = makeType("Connection", [
  makeProp("kind", "string", { isScalar: true }),
], {
  discriminator: "kind",
  childTypes: [apiKeyConnection],
  isAbstract: true,
});

// Type with methods
const output = makeType("Output", [
  makeProp("value", "string", { isScalar: true }),
], {
  methods: [{ name: "text", returns: "string", description: "Get the text value", optional: false, sync: false }],
});

// Type with dict, optional complex, and polymorphic ref
const complexType = makeType("ComplexType", [
  makeProp("name", "string", { isScalar: true }),
  makeProp("model", "Model", { type: modelType }),
  makeProp("tags", "string", { isScalar: true, isCollection: true }),
  makeProp("bindings", "Binding", { isCollection: true, type: namedBinding }),
  makeProp("metadata", "dictionary", { isDict: true }),
  makeProp("content", "ContentPart", { type: contentPart }),
  makeProp("optModel", "Model", { type: modelType, isOptional: true }),
]);

function buildTestRegistry(): TypeRegistry {
  return TypeRegistry.fromTypeGraph([
    contentPart, textPart, imagePart,
    toolResult, message, modelType,
    connectionType, apiKeyConnection,
    output, namedBinding, complexType,
  ]);
}

// ============================================================================
// classifyProperty tests
// ============================================================================

describe("classifyProperty", () => {
  const polyNames = new Set(["ContentPart", "Connection"]);

  it("classifies scalar property", () => {
    const prop = makeProp("name", "string", { isScalar: true });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "scalar", scalarType: "string" });
  });

  it("classifies optional scalar property", () => {
    const prop = makeProp("reason", "string", { isScalar: true, isOptional: true });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "scalar", scalarType: "string" });
  });

  it("classifies boolean scalar", () => {
    const prop = makeProp("allowed", "boolean", { isScalar: true });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "scalar", scalarType: "boolean" });
  });

  it("classifies complex type", () => {
    const prop = makeProp("model", "Model", { type: modelType });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "complex", typeName: "Model" });
  });

  it("classifies collection of scalars", () => {
    const prop = makeProp("tags", "string", { isScalar: true, isCollection: true });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "collection_scalar", scalarType: "string" });
  });

  it("classifies collection of complex types", () => {
    const prop = makeProp("parts", "ContentPart", { isCollection: true, type: contentPart });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "collection_complex", typeName: "ContentPart" });
  });

  it("classifies dict property", () => {
    const prop = makeProp("metadata", "dictionary", { isDict: true });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "dict" });
  });

  it("classifies polymorphic reference as complex", () => {
    // Previously was polymorphic_ref; now all non-scalar non-collection types are "complex"
    const prop = makeProp("content", "ContentPart", { type: contentPart });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "complex", typeName: "ContentPart" });
  });

  it("dict takes priority over collection", () => {
    // A dict+collection combo should be classified as dict
    const prop = makeProp("extra", "string", { isDict: true, isCollection: true });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "dict" });
  });

  it("non-polymorphic complex type is classified as complex", () => {
    const prop = makeProp("model", "Model", { type: modelType });
    const cat = classifyProperty(prop, polyNames);
    assert.deepEqual(cat, { kind: "complex", typeName: "Model" });
  });
});

// ============================================================================
// collectPolymorphicTypeNames tests
// ============================================================================

describe("collectPolymorphicTypeNames", () => {
  it("finds polymorphic base types", () => {
    const registry = buildTestRegistry();
    const names = collectPolymorphicTypeNames(contentPart, registry);
    assert.ok(names.has("ContentPart"));
    assert.equal(names.size, 1); // Only ContentPart itself
  });

  it("returns empty set for non-polymorphic types", () => {
    const registry = buildTestRegistry();
    const names = collectPolymorphicTypeNames(modelType, registry);
    assert.equal(names.size, 0);
  });

  it("finds polymorphic types through property references", () => {
    const registry = buildTestRegistry();
    const names = collectPolymorphicTypeNames(message, registry);
    assert.ok(names.has("ContentPart"));
  });
});

// ============================================================================
// lowerType tests
// ============================================================================

describe("lowerType", () => {
  const registry = buildTestRegistry();
  const polyNames = new Set(["ContentPart", "Connection"]);

  it("lowers a simple type with scalar fields", () => {
    const decl = lowerType(modelType, registry, polyNames);
    assert.equal(decl.typeName.name, "Model");
    assert.equal(decl.isAbstract, false);
    assert.equal(decl.base, null);
    assert.equal(decl.fields.length, 2);
    assert.equal(decl.fields[0].name, "id");
    assert.deepEqual(decl.fields[0].category, { kind: "scalar", scalarType: "string" });
    assert.equal(decl.fields[1].name, "provider");
    assert.equal(decl.fields[1].isOptional, true);
  });

  it("detects coercion property", () => {
    const decl = lowerType(modelType, registry, polyNames);
    assert.equal(decl.coercionProperty, "id");
  });

  it("lowers coercions in load method", () => {
    const decl = lowerType(modelType, registry, polyNames);
    assert.equal(decl.load.coercions.length, 1);
    assert.equal(decl.load.coercions[0].scalarType, "string");
    assert.equal(decl.load.coercions[0].assignments.length, 1);
    assert.equal(decl.load.coercions[0].assignments[0].fieldName, "id");
    assert.equal(decl.load.coercions[0].assignments[0].isInput, true);
  });

  it("lowers a type with complex collection", () => {
    const decl = lowerType(message, registry, polyNames);
    assert.equal(decl.fields.length, 3);
    // parts is collection_complex
    assert.deepEqual(decl.fields[1].category, { kind: "collection_complex", typeName: "ContentPart" });
    // metadata is dict
    assert.deepEqual(decl.fields[2].category, { kind: "dict" });
    // Should have a collection helper for parts
    assert.equal(decl.collectionHelpers.length, 1);
    assert.equal(decl.collectionHelpers[0].propertyName, "parts");
  });

  it("lowers polymorphic dispatch", () => {
    const decl = lowerType(contentPart, registry, polyNames);
    assert.ok(decl.polymorphicDispatch);
    assert.equal(decl.polymorphicDispatch!.discriminatorField, "kind");
    assert.equal(decl.polymorphicDispatch!.variants.length, 2);
    assert.equal(decl.polymorphicDispatch!.variants[0].value, "text");
    assert.equal(decl.polymorphicDispatch!.variants[0].typeName.name, "TextPart");
    assert.equal(decl.polymorphicDispatch!.variants[1].value, "image");
  });

  it("lowers abstract polymorphic base", () => {
    const decl = lowerType(connectionType, registry, polyNames);
    assert.ok(decl.polymorphicDispatch);
    assert.equal(decl.polymorphicDispatch!.isAbstract, true);
    assert.equal(decl.polymorphicDispatch!.variants.length, 1);
    assert.equal(decl.polymorphicDispatch!.variants[0].value, "key");
  });

  it("lowers non-abstract polymorphic base with default", () => {
    const decl = lowerType(contentPart, registry, polyNames);
    assert.ok(decl.polymorphicDispatch);
    assert.ok(decl.polymorphicDispatch!.defaultVariant);
    assert.equal(decl.polymorphicDispatch!.defaultVariant!.isSelfReference, true);
  });

  it("lowers factory methods", () => {
    const decl = lowerType(toolResult, registry, polyNames);
    assert.equal(decl.factories.length, 1);
    assert.equal(decl.factories[0].name, "text");
    assert.deepEqual(decl.factories[0].params, { value: "string" });
    assert.equal(decl.factories[0].body.kind, "construct");
  });

  it("factory name is always the canonical name (no collision avoidance in IR)", () => {
    // Collision avoidance is language-specific — the IR stores the canonical name.
    // Python adds create_ prefix in its emitter; TS/Rust/C#/Go use name directly.
    const conflictType = makeType("Conflict", [
      makeProp("text", "string", { isScalar: true }),
    ], {
      factories: [
        { name: "text", sets: { text: "{val}" }, params: { val: "string" } },
      ],
    });
    const conflictRegistry = TypeRegistry.fromTypeGraph([conflictType]);
    const decl = lowerType(conflictType, conflictRegistry, new Set());
    assert.equal(decl.factories[0].name, "text");
  });

  it("lowers method stubs", () => {
    const decl = lowerType(output, registry, polyNames);
    assert.equal(decl.methods.length, 1);
    assert.equal(decl.methods[0].name, "text");
    assert.equal(decl.methods[0].returns, "string");
  });

  it("lowers collection helper with name property detection", () => {
    const typeWithNamedCollection = makeType("Container", [
      makeProp("bindings", "Binding", { isCollection: true, type: namedBinding }),
    ]);
    const decl = lowerType(typeWithNamedCollection, registry, polyNames);
    assert.equal(decl.collectionHelpers.length, 1);
    assert.equal(decl.collectionHelpers[0].hasNameProperty, true);
    assert.deepEqual(decl.collectionHelpers[0].innerFields, ["value"]); // "name" excluded
  });

  it("lowers load assignments for all property categories", () => {
    const decl = lowerType(complexType, registry, polyNames);
    const cats = decl.load.assignments.map(a => a.category.kind);
    assert.ok(cats.includes("scalar")); // name
    assert.ok(cats.includes("complex")); // model
    assert.ok(cats.includes("collection_scalar")); // tags
    assert.ok(cats.includes("collection_complex")); // bindings
    assert.ok(cats.includes("dict")); // metadata
    assert.ok(cats.includes("complex")); // content (was polymorphic_ref, now just complex)
  });

  it("lowers save assignments matching load assignments", () => {
    const decl = lowerType(complexType, registry, polyNames);
    assert.equal(decl.save.assignments.length, decl.load.assignments.length);
    // Save categories should match load categories
    for (let i = 0; i < decl.save.assignments.length; i++) {
      assert.deepEqual(
        decl.save.assignments[i].category,
        decl.load.assignments[i].category,
      );
    }
  });

  it("sets hasBase correctly for child types", () => {
    const decl = lowerType(textPart, registry, polyNames);
    assert.equal(decl.save.hasBase, true);
    assert.equal(decl.base?.name, "ContentPart");
  });

  it("sets hasBase to false for root types", () => {
    const decl = lowerType(modelType, registry, polyNames);
    assert.equal(decl.save.hasBase, false);
  });
});

// ============================================================================
// lowerFile tests
// ============================================================================

describe("lowerFile", () => {
  const registry = buildTestRegistry();
  const polyNames = new Set(["ContentPart", "Connection"]);

  it("lowers a simple file with one type", () => {
    const file = lowerFile(modelType, registry, polyNames);
    assert.equal(file.typeName.name, "Model");
    assert.equal(file.types.length, 1);
    assert.equal(file.containsAbstract, false);
  });

  it("lowers a polymorphic file with parent + children", () => {
    const file = lowerFile(contentPart, registry, polyNames);
    assert.equal(file.typeName.name, "ContentPart");
    assert.equal(file.types.length, 3); // ContentPart + TextPart + ImagePart
    assert.equal(file.types[0].typeName.name, "ContentPart");
    assert.equal(file.types[1].typeName.name, "TextPart");
    assert.equal(file.types[2].typeName.name, "ImagePart");
  });

  it("marks containsAbstract when base is abstract", () => {
    const file = lowerFile(connectionType, registry, polyNames);
    assert.equal(file.containsAbstract, true);
  });

  it("resolves imports excluding types defined in file", () => {
    const file = lowerFile(contentPart, registry, polyNames);
    // ContentPart, TextPart, ImagePart are all in this file — no self-imports
    const importNames = file.imports.flatMap(i => i.names);
    assert.ok(!importNames.includes("ContentPart"));
    assert.ok(!importNames.includes("TextPart"));
    assert.ok(!importNames.includes("ImagePart"));
  });

  it("resolves factory-referenced imports", () => {
    const file = lowerFile(toolResult, registry, polyNames);
    // ToolResult.text factory references TextPart and ContentPart
    const importNames = file.imports.flatMap(i => i.names);
    assert.ok(importNames.includes("TextPart"));
  });

  it("groups imports by module", () => {
    const file = lowerFile(toolResult, registry, polyNames);
    // TextPart should be imported from ContentPart module
    const contentImport = file.imports.find(i => i.module === "ContentPart");
    assert.ok(contentImport);
    assert.ok(contentImport!.names.includes("TextPart"));
  });

  it("produces identical IR regardless of eventual target language", () => {
    // The IR is language-agnostic — same input always produces same output
    const file1 = lowerFile(modelType, registry, polyNames);
    const file2 = lowerFile(modelType, registry, polyNames);
    assert.deepEqual(file1, file2);
  });
});
