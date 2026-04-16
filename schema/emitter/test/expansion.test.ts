/**
 * Tests for Expression IR — resolver and per-language visitors.
 *
 * Uses Node.js built-in test runner (`node --test`).
 *
 * Test organization:
 *   1. Type graph fixtures (TypeNode/PropertyNode construction)
 *   2. Resolver tests (resolveFactoryExpr, resolveCoerceExpr)
 *   3. Visitor tests (one suite per language × expr kind)
 *   4. Integration tests (resolve → render, verified against known output)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Model, ModelProperty } from "@typespec/compiler";

import {
  TypeRegistry,
  resolveFactoryExpr,
  resolveCoerceExpr,
  Expr,
} from "../src/ir/expansion.js";
import { RustExprVisitor } from "../src/languages/rust/visitor.js";
import { TypeScriptExprVisitor } from "../src/languages/typescript/visitor.js";
import { PythonExprVisitor } from "../src/languages/python/visitor.js";
import { CSharpExprVisitor } from "../src/languages/csharp/visitor.js";
import { GoExprVisitor } from "../src/languages/go/visitor.js";
import { ExprVisitor } from "../src/ir/visitor.js";
import { TypeNode, PropertyNode, TypeName } from "../src/ir/ast.js";

// Local visitor lookup — replaces the old getVisitor() from render-expr.ts
const visitors: Record<string, (registry?: TypeRegistry) => ExprVisitor> = {
  rust: (r) => new RustExprVisitor(r),
  typescript: (r) => new TypeScriptExprVisitor(r),
  python: (r) => new PythonExprVisitor(r),
  csharp: (r) => new CSharpExprVisitor(r),
  go: (r) => new GoExprVisitor(r),
};
function getVisitor(lang: string, registry?: TypeRegistry): ExprVisitor {
  const factory = visitors[lang];
  if (!factory) throw new Error(`No ExprVisitor for language '${lang}'.`);
  return factory(registry);
}

// ============================================================================
// Test fixtures — minimal TypeNode/PropertyNode construction
// ============================================================================

/** Create a minimal TypeNode for testing. */
function makeType(name: string, props: PropertyNode[] = [], opts?: {
  discriminator?: string;
  childTypes?: TypeNode[];
  namespace?: string;
  factories?: Array<{ name: string; sets: Record<string, any>; params: Record<string, string> }>;
}): TypeNode {
  const node = new TypeNode({} as Model, `Test ${name}`);
  node.typeName = { namespace: opts?.namespace ?? "Test", name };
  node.properties = props;
  node.discriminator = opts?.discriminator;
  node.childTypes = opts?.childTypes ?? [];
  node.factories = opts?.factories ?? [];
  return node;
}

/** Create a minimal PropertyNode for testing. */
function makeProp(name: string, typeName: string, opts?: {
  isScalar?: boolean;
  isOptional?: boolean;
  isCollection?: boolean;
  isDict?: boolean;
  type?: TypeNode;
  defaultValue?: string | number | boolean | null;
  namespace?: string;
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
  return prop;
}

// ---- Shared type graph fixtures ----

// GuardrailResult: { allowed: boolean, reason?: string, rewrite?: unknown }
const guardrailResult = makeType("GuardrailResult", [
  makeProp("allowed", "boolean", { isScalar: true }),
  makeProp("reason", "string", { isScalar: true, isOptional: true }),
  makeProp("rewrite", "any", { isScalar: true, isOptional: true }),
]);

// TextPart: { value: string } (child of ContentPart)
const textPart = makeType("TextPart", [
  makeProp("kind", "string", { isScalar: true, defaultValue: "text" }),
  makeProp("value", "string", { isScalar: true }),
]);

// ImagePart: { url: string } (child of ContentPart)
const imagePart = makeType("ImagePart", [
  makeProp("kind", "string", { isScalar: true, defaultValue: "image" }),
  makeProp("url", "string", { isScalar: true }),
]);

// ContentPart: discriminated union with "kind" field
const contentPart = makeType("ContentPart", [
  makeProp("kind", "string", { isScalar: true }),
], {
  discriminator: "kind",
  childTypes: [textPart, imagePart],
});

// ToolResult: { parts: ContentPart[] }
const toolResult = makeType("ToolResult", [
  makeProp("parts", "ContentPart", { isCollection: true, type: contentPart }),
]);

// Message: { role: string, parts: ContentPart[] }
const message = makeType("Message", [
  makeProp("role", "string", { isScalar: true }),
  makeProp("parts", "ContentPart", { isCollection: true, type: contentPart }),
]);

// Model (simple, non-polymorphic): { id: string, provider: string }
const modelType = makeType("Model", [
  makeProp("id", "string", { isScalar: true }),
  makeProp("provider", "string", { isScalar: true }),
]);

function buildTestRegistry(): TypeRegistry {
  return TypeRegistry.fromTypeGraph([
    guardrailResult, contentPart, textPart, imagePart, toolResult, message, modelType,
  ]);
}

// ============================================================================
// TypeRegistry tests
// ============================================================================

describe("TypeRegistry", () => {
  it("registers and looks up types by name", () => {
    const registry = new TypeRegistry();
    registry.register(guardrailResult);
    assert.equal(registry.get("GuardrailResult"), guardrailResult);
    assert.equal(registry.get("NonExistent"), undefined);
  });

  it("fromTypeGraph walks the full type graph", () => {
    const registry = buildTestRegistry();
    assert.ok(registry.get("GuardrailResult"));
    assert.ok(registry.get("ContentPart"));
    assert.ok(registry.get("TextPart"));
    assert.ok(registry.get("ImagePart"));
    assert.ok(registry.get("ToolResult"));
    assert.ok(registry.get("Message"));
    assert.ok(registry.get("Model"));
  });

  it("handles cycles gracefully (same type reachable multiple ways)", () => {
    const registry = TypeRegistry.fromTypeGraph([toolResult, contentPart]);
    assert.ok(registry.get("ToolResult"));
    assert.ok(registry.get("ContentPart"));
    assert.ok(registry.get("TextPart"));
  });
});

// ============================================================================
// Resolver tests — resolveFactoryExpr
// ============================================================================

describe("resolveFactoryExpr", () => {
  const registry = buildTestRegistry();

  it("resolves a simple boolean set (GuardrailResult.allow)", () => {
    const expr = resolveFactoryExpr(
      { allowed: true },
      {},
      guardrailResult,
      registry,
    );
    assert.equal(expr.kind, "construct");
    assert.equal(expr.typeName.name, "GuardrailResult");
    assert.equal(expr.fields.length, 1);
    assert.deepStrictEqual(expr.fields[0], {
      propertyName: "allowed",
      value: { kind: "boolean", value: true },
      isOptional: false,
    });
  });

  it("resolves sets + params (GuardrailResult.deny)", () => {
    const expr = resolveFactoryExpr(
      { allowed: false },
      { reason: "string" },
      guardrailResult,
      registry,
    );
    assert.equal(expr.kind, "construct");
    assert.equal(expr.fields.length, 2);
    // allowed = false
    assert.deepStrictEqual(expr.fields[0], {
      propertyName: "allowed",
      value: { kind: "boolean", value: false },
      isOptional: false,
    });
    // reason = ParamRef (optional field!)
    assert.deepStrictEqual(expr.fields[1], {
      propertyName: "reason",
      value: { kind: "param", name: "reason", paramType: "string" },
      isOptional: true,
    });
  });

  it("resolves factory with no sets and no params (empty constructor)", () => {
    const expr = resolveFactoryExpr({}, {}, guardrailResult, registry);
    assert.equal(expr.kind, "construct");
    assert.equal(expr.fields.length, 0);
  });

  it("resolves string literal set values", () => {
    const expr = resolveFactoryExpr(
      { role: "user" },
      {},
      message,
      registry,
    );
    assert.equal(expr.fields.length, 1);
    assert.deepStrictEqual(expr.fields[0].value, { kind: "string", value: "user" });
  });

  it("resolves number literal set values", () => {
    const numType = makeType("NumType", [makeProp("count", "number", { isScalar: true })]);
    const expr = resolveFactoryExpr({ count: 42 }, {}, numType, registry);
    assert.deepStrictEqual(expr.fields[0].value, { kind: "number", value: 42 });
  });

  it("resolves param placeholders inside sets", () => {
    const expr = resolveFactoryExpr(
      { role: "{role}" },
      { role: "string" },
      message,
      registry,
    );
    assert.equal(expr.fields.length, 1);
    assert.deepStrictEqual(expr.fields[0].value, {
      kind: "param", name: "role", paramType: "string",
    });
  });

  it("does not double-emit params consumed as nested placeholders", () => {
    // If "role" is both a param and used as {role} inside sets, it should only appear once
    const expr = resolveFactoryExpr(
      { role: "{role}" },
      { role: "string" },
      message,
      registry,
    );
    // Should have exactly 1 field (role), not 2
    assert.equal(expr.fields.length, 1);
  });

  it("resolves nested array with variant objects", () => {
    const expr = resolveFactoryExpr(
      { parts: [{ kind: "text", value: "{val}" }] },
      { val: "string" },
      toolResult,
      registry,
    );
    assert.equal(expr.kind, "construct");
    assert.equal(expr.fields.length, 1);
    const partsField = expr.fields[0];
    assert.equal(partsField.propertyName, "parts");
    assert.equal(partsField.value.kind, "array");

    if (partsField.value.kind === "array") {
      assert.equal(partsField.value.items.length, 1);
      const item = partsField.value.items[0];
      assert.equal(item.kind, "variant");
      if (item.kind === "variant") {
        assert.equal(item.baseTypeName.name, "ContentPart");
        assert.equal(item.discriminatorValue, "text");
        assert.equal(item.variantTypeName.name, "TextPart");
        assert.equal(item.fields.length, 1);
        assert.equal(item.fields[0].propertyName, "value");
        assert.equal(item.fields[0].isOptional, false);
        assert.deepStrictEqual(item.fields[0].value, {
          kind: "param", name: "val", paramType: "string",
        });
      }
    }
  });

  it("throws for unknown property in sets", () => {
    assert.throws(
      () => resolveFactoryExpr({ unknown: true }, {}, guardrailResult, registry),
      /Property 'unknown' not found on type 'GuardrailResult'/,
    );
  });

  it("throws for param not matching any property", () => {
    assert.throws(
      () => resolveFactoryExpr({}, { badParam: "string" }, guardrailResult, registry),
      /Parameter 'badParam' does not match any property/,
    );
  });

  it("throws for unresolved param placeholder", () => {
    assert.throws(
      () => resolveFactoryExpr({ role: "{unknown}" }, { other: "string" }, message, registry),
      /Placeholder '\{unknown\}' does not match any declared parameter/,
    );
  });

  it("throws for unknown discriminator value", () => {
    assert.throws(
      () => resolveFactoryExpr(
        { parts: [{ kind: "unknown_type", value: "x" }] },
        {},
        toolResult,
        registry,
      ),
      /No child type of 'ContentPart' has kind='unknown_type'/,
    );
  });
});

// ============================================================================
// Resolver tests — resolveCoerceExpr
// ============================================================================

describe("resolveCoerceExpr", () => {
  const registry = buildTestRegistry();

  it("resolves a simple coercion (Model with id coercion)", () => {
    const expr = resolveCoerceExpr(
      { id: "{value}" },
      "string",
      modelType,
      registry,
    );
    assert.equal(expr.kind, "construct");
    assert.equal(expr.typeName.name, "Model");
    assert.equal(expr.fields.length, 1);
    assert.deepStrictEqual(expr.fields[0], {
      propertyName: "id",
      value: { kind: "param", name: "value", paramType: "string" },
      isOptional: false,
    });
  });

  it("resolves a coercion with mixed literal and param", () => {
    const expr = resolveCoerceExpr(
      { role: "system", parts: "{value}" },
      "string",
      message,
      registry,
    );
    assert.equal(expr.fields.length, 2);
    assert.deepStrictEqual(expr.fields[0].value, { kind: "string", value: "system" });
    assert.deepStrictEqual(expr.fields[1].value, {
      kind: "param", name: "value", paramType: "string",
    });
  });
});

// ============================================================================
// Visitor tests — Rust
// ============================================================================

describe("RustExprVisitor", () => {
  const v = new RustExprVisitor();

  it("renders string literal", () => {
    assert.equal(v.visitExpr({ kind: "string", value: "hello" }), '"hello".to_string()');
  });

  it("renders number literal", () => {
    assert.equal(v.visitExpr({ kind: "number", value: 42 }), "42");
  });

  it("renders boolean literal", () => {
    assert.equal(v.visitExpr({ kind: "boolean", value: true }), "true");
    assert.equal(v.visitExpr({ kind: "boolean", value: false }), "false");
  });

  it("renders null literal", () => {
    assert.equal(v.visitExpr({ kind: "null" }), "None");
  });

  it("renders string param ref with .into()", () => {
    assert.equal(
      v.visitExpr({ kind: "param", name: "reason", paramType: "string" }),
      "reason.into()",
    );
  });

  it("renders non-string param ref with .into()", () => {
    assert.equal(
      v.visitExpr({ kind: "param", name: "count", paramType: "integer" }),
      "count.into()",
    );
  });

  it("renders camelCase param as snake_case with .into()", () => {
    assert.equal(
      v.visitExpr({ kind: "param", name: "maxTokens", paramType: "integer" }),
      "max_tokens.into()",
    );
  });

  it("renders Construct", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [
        { propertyName: "allowed", value: { kind: "boolean", value: true }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "GuardrailResult { allowed: true, ..Default::default() }");
  });

  it("renders empty Construct with only default", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [],
    };
    assert.equal(v.visitExpr(expr), "GuardrailResult { ..Default::default() }");
  });

  it("renders optional field with Some() wrapper", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [
        { propertyName: "allowed", value: { kind: "boolean", value: false }, isOptional: false },
        { propertyName: "reason", value: { kind: "param", name: "reason", paramType: "string" }, isOptional: true },
      ],
    };
    assert.equal(
      v.visitExpr(expr),
      "GuardrailResult { allowed: false, reason: Some(reason.into()), ..Default::default() }",
    );
  });

  it("renders VariantConstruct", () => {
    const expr: Expr = {
      kind: "variant",
      baseTypeName: { namespace: "Test", name: "ContentPart" },
      discriminator: "kind",
      discriminatorValue: "text",
      variantTypeName: { namespace: "Test", name: "TextPart" },
      fields: [
        { propertyName: "value", value: { kind: "param", name: "val", paramType: "string" }, isOptional: false },
      ],
    };
    assert.equal(
      v.visitExpr(expr),
      "ContentPart { kind: ContentPartKind::TextPart { value: val.into() }, ..Default::default() }",
    );
  });

  it("renders ArrayLiteral", () => {
    const expr: Expr = {
      kind: "array",
      elementTypeName: { namespace: "Test", name: "ContentPart" },
      items: [{ kind: "string", value: "hello" }],
    };
    assert.equal(v.visitExpr(expr), 'vec!["hello".to_string()]');
  });

  it("renders empty ArrayLiteral", () => {
    const expr: Expr = {
      kind: "array",
      elementTypeName: { namespace: "Test", name: "ContentPart" },
      items: [],
    };
    assert.equal(v.visitExpr(expr), "vec![]");
  });

  it("renders snake_case field names in constructs", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "Model" },
      fields: [
        { propertyName: "apiType", value: { kind: "string", value: "chat" }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), 'Model { api_type: "chat".to_string(), ..Default::default() }');
  });
});

// ============================================================================
// Visitor tests — TypeScript
// ============================================================================

describe("TypeScriptExprVisitor", () => {
  const v = new TypeScriptExprVisitor();

  it("renders string literal", () => {
    assert.equal(v.visitExpr({ kind: "string", value: "hello" }), '"hello"');
  });

  it("renders boolean literal", () => {
    assert.equal(v.visitExpr({ kind: "boolean", value: true }), "true");
    assert.equal(v.visitExpr({ kind: "boolean", value: false }), "false");
  });

  it("renders null as undefined", () => {
    assert.equal(v.visitExpr({ kind: "null" }), "undefined");
  });

  it("renders param ref as camelCase (unchanged)", () => {
    assert.equal(
      v.visitExpr({ kind: "param", name: "reason", paramType: "string" }),
      "reason",
    );
  });

  it("renders Construct", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [
        { propertyName: "allowed", value: { kind: "boolean", value: true }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "new GuardrailResult({ allowed: true })");
  });

  it("renders empty Construct", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [],
    };
    assert.equal(v.visitExpr(expr), "new GuardrailResult({})");
  });

  it("renders VariantConstruct as child class construction", () => {
    const expr: Expr = {
      kind: "variant",
      baseTypeName: { namespace: "Test", name: "ContentPart" },
      discriminator: "kind",
      discriminatorValue: "text",
      variantTypeName: { namespace: "Test", name: "TextPart" },
      fields: [
        { propertyName: "value", value: { kind: "param", name: "val", paramType: "string" }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "new TextPart({ value: val })");
  });

  it("renders ArrayLiteral", () => {
    const expr: Expr = {
      kind: "array",
      elementTypeName: { namespace: "Test", name: "string" },
      items: [{ kind: "string", value: "a" }, { kind: "string", value: "b" }],
    };
    assert.equal(v.visitExpr(expr), '["a", "b"]');
  });
});

// ============================================================================
// Visitor tests — Python
// ============================================================================

describe("PythonExprVisitor", () => {
  const v = new PythonExprVisitor();

  it("renders string literal", () => {
    assert.equal(v.visitExpr({ kind: "string", value: "hello" }), '"hello"');
  });

  it("renders boolean with capital letters", () => {
    assert.equal(v.visitExpr({ kind: "boolean", value: true }), "True");
    assert.equal(v.visitExpr({ kind: "boolean", value: false }), "False");
  });

  it("renders null as None", () => {
    assert.equal(v.visitExpr({ kind: "null" }), "None");
  });

  it("renders param ref as snake_case", () => {
    assert.equal(
      v.visitExpr({ kind: "param", name: "maxTokens", paramType: "integer" }),
      "max_tokens",
    );
  });

  it("renders Construct with snake_case fields", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [
        { propertyName: "allowed", value: { kind: "boolean", value: true }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "GuardrailResult(allowed=True)");
  });

  it("renders VariantConstruct", () => {
    const expr: Expr = {
      kind: "variant",
      baseTypeName: { namespace: "Test", name: "ContentPart" },
      discriminator: "kind",
      discriminatorValue: "text",
      variantTypeName: { namespace: "Test", name: "TextPart" },
      fields: [
        { propertyName: "value", value: { kind: "param", name: "val", paramType: "string" }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "TextPart(value=val)");
  });

  it("renders ArrayLiteral", () => {
    const expr: Expr = {
      kind: "array",
      elementTypeName: { namespace: "Test", name: "string" },
      items: [{ kind: "string", value: "a" }],
    };
    assert.equal(v.visitExpr(expr), '["a"]');
  });
});

// ============================================================================
// Visitor tests — C#
// ============================================================================

describe("CSharpExprVisitor", () => {
  const v = new CSharpExprVisitor();

  it("renders string literal", () => {
    assert.equal(v.visitExpr({ kind: "string", value: "hello" }), '"hello"');
  });

  it("renders boolean lowercase", () => {
    assert.equal(v.visitExpr({ kind: "boolean", value: true }), "true");
  });

  it("renders null", () => {
    assert.equal(v.visitExpr({ kind: "null" }), "null");
  });

  it("renders Construct with PascalCase fields", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [
        { propertyName: "allowed", value: { kind: "boolean", value: true }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "new GuardrailResult { Allowed = true }");
  });

  it("renders empty Construct", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [],
    };
    assert.equal(v.visitExpr(expr), "new GuardrailResult()");
  });

  it("renders VariantConstruct with PascalCase", () => {
    const expr: Expr = {
      kind: "variant",
      baseTypeName: { namespace: "Test", name: "ContentPart" },
      discriminator: "kind",
      discriminatorValue: "text",
      variantTypeName: { namespace: "Test", name: "TextPart" },
      fields: [
        { propertyName: "value", value: { kind: "param", name: "val", paramType: "string" }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "new TextPart { Value = val }");
  });

  it("renders ArrayLiteral with explicit type", () => {
    const expr: Expr = {
      kind: "array",
      elementTypeName: { namespace: "Test", name: "ContentPart" },
      items: [{ kind: "string", value: "a" }],
    };
    assert.equal(v.visitExpr(expr), 'new List<ContentPart> { "a" }');
  });
});

// ============================================================================
// Visitor tests — Go
// ============================================================================

describe("GoExprVisitor", () => {
  const v = new GoExprVisitor();

  it("renders string literal", () => {
    assert.equal(v.visitExpr({ kind: "string", value: "hello" }), '"hello"');
  });

  it("renders boolean", () => {
    assert.equal(v.visitExpr({ kind: "boolean", value: true }), "true");
  });

  it("renders null as nil", () => {
    assert.equal(v.visitExpr({ kind: "null" }), "nil");
  });

  it("renders Construct with PascalCase fields", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [
        { propertyName: "allowed", value: { kind: "boolean", value: true }, isOptional: false },
      ],
    };
    assert.equal(v.visitExpr(expr), "GuardrailResult{ Allowed: true }");
  });

  it("renders ArrayLiteral with type prefix", () => {
    const expr: Expr = {
      kind: "array",
      elementTypeName: { namespace: "Test", name: "ContentPart" },
      items: [{ kind: "string", value: "a" }],
    };
    assert.equal(v.visitExpr(expr), '[]ContentPart{"a"}');
  });

  it("renders empty struct", () => {
    const expr: Expr = {
      kind: "construct",
      typeName: { namespace: "Test", name: "GuardrailResult" },
      fields: [],
    };
    assert.equal(v.visitExpr(expr), "GuardrailResult{}");
  });
});

// ============================================================================
// getVisitor registry tests
// ============================================================================

describe("getVisitor", () => {
  it("returns visitors for all supported languages", () => {
    for (const lang of ["rust", "typescript", "python", "csharp", "go"]) {
      const visitor = getVisitor(lang);
      assert.ok(visitor, `No visitor for ${lang}`);
      // Smoke test — every visitor can render a string literal
      assert.equal(typeof visitor.visitExpr({ kind: "string", value: "x" }), "string");
    }
  });

  it("throws for unknown language", () => {
    assert.throws(
      () => getVisitor("java"),
      /No ExprVisitor for language 'java'/,
    );
  });
});

// ============================================================================
// Integration tests — resolve → render, verified against known output
// ============================================================================

describe("Integration: GuardrailResult factories", () => {
  const registry = buildTestRegistry();

  it("allow() → Rust", () => {
    const expr = resolveFactoryExpr({ allowed: true }, {}, guardrailResult, registry);
    const code = new RustExprVisitor().visitExpr(expr);
    assert.equal(code, "GuardrailResult { allowed: true, ..Default::default() }");
  });

  it("allow() → TypeScript", () => {
    const expr = resolveFactoryExpr({ allowed: true }, {}, guardrailResult, registry);
    const code = new TypeScriptExprVisitor().visitExpr(expr);
    assert.equal(code, "new GuardrailResult({ allowed: true })");
  });

  it("allow() → Python", () => {
    const expr = resolveFactoryExpr({ allowed: true }, {}, guardrailResult, registry);
    const code = new PythonExprVisitor().visitExpr(expr);
    assert.equal(code, "GuardrailResult(allowed=True)");
  });

  it("allow() → C#", () => {
    const expr = resolveFactoryExpr({ allowed: true }, {}, guardrailResult, registry);
    const code = new CSharpExprVisitor().visitExpr(expr);
    assert.equal(code, "new GuardrailResult { Allowed = true }");
  });

  it("deny(reason) → Rust", () => {
    const expr = resolveFactoryExpr({ allowed: false }, { reason: "string" }, guardrailResult, registry);
    const code = new RustExprVisitor().visitExpr(expr);
    assert.equal(code, "GuardrailResult { allowed: false, reason: Some(reason.into()), ..Default::default() }");
  });

  it("deny(reason) → TypeScript", () => {
    const expr = resolveFactoryExpr({ allowed: false }, { reason: "string" }, guardrailResult, registry);
    const code = new TypeScriptExprVisitor().visitExpr(expr);
    assert.equal(code, "new GuardrailResult({ allowed: false, reason: reason })");
  });

  it("deny(reason) → Python", () => {
    const expr = resolveFactoryExpr({ allowed: false }, { reason: "string" }, guardrailResult, registry);
    const code = new PythonExprVisitor().visitExpr(expr);
    assert.equal(code, "GuardrailResult(allowed=False, reason=reason)");
  });

  it("deny(reason) → C#", () => {
    const expr = resolveFactoryExpr({ allowed: false }, { reason: "string" }, guardrailResult, registry);
    const code = new CSharpExprVisitor().visitExpr(expr);
    assert.equal(code, "new GuardrailResult { Allowed = false, Reason = reason }");
  });
});

describe("Integration: nested factory — ToolResult.text(val)", () => {
  const registry = buildTestRegistry();

  it("text(val) → Rust", () => {
    const expr = resolveFactoryExpr(
      { parts: [{ kind: "text", value: "{val}" }] },
      { val: "string" },
      toolResult,
      registry,
    );
    const code = new RustExprVisitor().visitExpr(expr);
    assert.equal(
      code,
      "ToolResult { parts: vec![ContentPart { kind: ContentPartKind::TextPart { value: val.into() }, ..Default::default() }], ..Default::default() }",
    );
  });

  it("text(val) → TypeScript", () => {
    const expr = resolveFactoryExpr(
      { parts: [{ kind: "text", value: "{val}" }] },
      { val: "string" },
      toolResult,
      registry,
    );
    const code = new TypeScriptExprVisitor().visitExpr(expr);
    assert.equal(code, "new ToolResult({ parts: [new TextPart({ value: val })] })");
  });

  it("text(val) → Python", () => {
    const expr = resolveFactoryExpr(
      { parts: [{ kind: "text", value: "{val}" }] },
      { val: "string" },
      toolResult,
      registry,
    );
    const code = new PythonExprVisitor().visitExpr(expr);
    assert.equal(code, "ToolResult(parts=[TextPart(value=val)])");
  });

  it("text(val) → C#", () => {
    const expr = resolveFactoryExpr(
      { parts: [{ kind: "text", value: "{val}" }] },
      { val: "string" },
      toolResult,
      registry,
    );
    const code = new CSharpExprVisitor().visitExpr(expr);
    assert.equal(code, "new ToolResult { Parts = new List<ContentPart> { new TextPart { Value = val } } }");
  });

  it("text(val) → Go", () => {
    const expr = resolveFactoryExpr(
      { parts: [{ kind: "text", value: "{val}" }] },
      { val: "string" },
      toolResult,
      registry,
    );
    const code = new GoExprVisitor(registry).visitExpr(expr);
    assert.equal(code, 'ToolResult{ Parts: []interface{}{TextPart{ Kind: "text", Value: val }} }');
  });
});

describe("Integration: coercion — Model from string", () => {
  const registry = buildTestRegistry();

  it("Model coercion → Rust", () => {
    const expr = resolveCoerceExpr({ id: "{value}" }, "string", modelType, registry);
    const code = new RustExprVisitor().visitExpr(expr);
    assert.equal(code, 'Model { id: value.into(), ..Default::default() }');
  });

  it("Model coercion → TypeScript", () => {
    const expr = resolveCoerceExpr({ id: "{value}" }, "string", modelType, registry);
    const code = new TypeScriptExprVisitor().visitExpr(expr);
    assert.equal(code, "new Model({ id: value })");
  });

  it("Model coercion → Python", () => {
    const expr = resolveCoerceExpr({ id: "{value}" }, "string", modelType, registry);
    const code = new PythonExprVisitor().visitExpr(expr);
    assert.equal(code, "Model(id=value)");
  });

  it("Model coercion → C#", () => {
    const expr = resolveCoerceExpr({ id: "{value}" }, "string", modelType, registry);
    const code = new CSharpExprVisitor().visitExpr(expr);
    assert.equal(code, "new Model { Id = value }");
  });
});

describe("Integration: Message.user(text) nested factory", () => {
  const registry = buildTestRegistry();

  it("user(text) → all 5 languages", () => {
    const expr = resolveFactoryExpr(
      { role: "user", parts: [{ kind: "text", value: "{text}" }] },
      { text: "string" },
      message,
      registry,
    );

    // Verify IR structure first
    assert.equal(expr.kind, "construct");
    assert.equal(expr.fields.length, 2);
    assert.equal(expr.fields[0].propertyName, "role");
    assert.deepStrictEqual(expr.fields[0].value, { kind: "string", value: "user" });
    assert.equal(expr.fields[1].propertyName, "parts");
    assert.equal(expr.fields[1].value.kind, "array");

    // Verify each language
    const expected: Record<string, string> = {
      rust: 'Message { role: "user".to_string(), parts: vec![ContentPart { kind: ContentPartKind::TextPart { value: text.into() }, ..Default::default() }], ..Default::default() }',
      typescript: 'new Message({ role: "user", parts: [new TextPart({ value: text })] })',
      python: 'Message(role="user", parts=[TextPart(value=text)])',
      csharp: 'new Message { Role = "user", Parts = new List<ContentPart> { new TextPart { Value = text } } }',
      go: 'Message{ Role: "user", Parts: []interface{}{TextPart{ Kind: "text", Value: text }} }',
    };

    for (const [lang, expectedCode] of Object.entries(expected)) {
      const code = getVisitor(lang, registry).visitExpr(expr);
      assert.equal(code, expectedCode, `${lang} output mismatch`);
    }
  });
});

// ============================================================================
// FieldRead tests — wire format field access per language
// ============================================================================

describe("FieldRead visitor output", () => {
  const fieldRead: Expr = {
    kind: "field_read",
    objectName: "opts",
    fieldName: "maxOutputTokens",
    fieldType: "int32",
    isOptional: true,
  };

  it("Rust → snake_case field access", () => {
    const code = new RustExprVisitor().visitExpr(fieldRead);
    assert.equal(code, "opts.max_output_tokens");
  });

  it("TypeScript → camelCase field access", () => {
    const code = new TypeScriptExprVisitor().visitExpr(fieldRead);
    assert.equal(code, "opts.maxOutputTokens");
  });

  it("Python → snake_case field access", () => {
    const code = new PythonExprVisitor().visitExpr(fieldRead);
    assert.equal(code, "opts.max_output_tokens");
  });

  it("C# → PascalCase field access", () => {
    const code = new CSharpExprVisitor().visitExpr(fieldRead);
    assert.equal(code, "opts.MaxOutputTokens");
  });

  it("Go → PascalCase field access", () => {
    const code = new GoExprVisitor().visitExpr(fieldRead);
    assert.equal(code, "opts.MaxOutputTokens");
  });

  it("simple non-camelCase field", () => {
    const simple: Expr = {
      kind: "field_read",
      objectName: "model",
      fieldName: "id",
      fieldType: "string",
      isOptional: false,
    };
    assert.equal(new RustExprVisitor().visitExpr(simple), "model.id");
    assert.equal(new TypeScriptExprVisitor().visitExpr(simple), "model.id");
    assert.equal(new PythonExprVisitor().visitExpr(simple), "model.id");
    assert.equal(new CSharpExprVisitor().visitExpr(simple), "model.Id");
    assert.equal(new GoExprVisitor().visitExpr(simple), "model.Id");
  });
});

describe("getVisitor with registry", () => {
  it("passes registry to visitor", () => {
    const registry = new TypeRegistry();
    const visitor = getVisitor("rust", registry);
    assert.equal(visitor.registry, registry);
  });

  it("works without registry", () => {
    const visitor = getVisitor("rust");
    assert.equal(visitor.registry, undefined);
  });
});
