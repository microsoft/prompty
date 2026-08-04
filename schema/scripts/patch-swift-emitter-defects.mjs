// Temporary post-generation shim for @typra/emitter@0.4.2 Swift defects.
//
// The Swift generator emits code that does not compile. Every defect below has
// been reported upstream; this script applies the exact fixes the emitter should
// produce so `runtime/swift` stays buildable in the meantime. It runs as part of
// `npm run generate`, immediately after Typra writes its output, so the Swift
// model package remains fully machine-generated — no file is ever hand-edited.
//
// Each patch is asserted. If a `find` pattern stops matching and the `replace`
// text is not already present, generation fails loudly: that is the signal that
// a new emitter release changed behaviour and this shim should be re-checked or
// deleted.
//
// Upstream defects covered:
//   1. Polymorphic enums emit a wildcard `load` branch without declaring the
//      corresponding case (`Tool.customTool`) or a `save` branch, and emit
//      `.unknown([:])` field defaults for enums that never declare `unknown`
//      (`Connection`).
//   2. Self-recursive polymorphic enums are not marked `indirect` (`Property`).
//   3. Convenience factories pass raw literals where enum values are required
//      (`Message.user/system/assistant`, `ToolResult.text`).
//   4. Protocol signatures leak unmapped placeholder type names (`Unknown`,
//      `RecordUnknown`) instead of `Any` / `[String: Any]`.
//   5. Protocol signatures drop `[]` (array) and `?` (optional) type suffixes.
//  10. Fields inherited via `extends` are dropped from derived structs, so
//      `ArrayProperty` / `ObjectProperty` / `UnionProperty` silently lose every
//      base `Property` field (`name`, `description`, `required`, `nullable`,
//      `default`, `example`, `enumValues`) and every `Tool` subtype loses
//      `name` / `description` / `bindings`, on both load and save.
//
// Known limitation: injected base fields are added as properties and wired into
// `load` / `save`, but not into the generated memberwise `init`. Constructing a
// subtype in Swift therefore requires assigning those fields after `init`. That
// is deliberate — rewriting initializer signatures would change the emitter's
// public API surface far more invasively than restoring lossless round-trips,
// which is the only part the spec vectors depend on.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const swiftSources = join("..", "runtime", "swift", "prompty-model", "Sources", "PromptyModel");

// --- Defect 10: base fields dropped from derived subtypes ------------------
// The TypeSpec model declares `ArrayProperty`/`ObjectProperty`/`UnionProperty`
// as `extends Property`, and the five tool models as `extends Tool`, so each
// must carry the base fields. Every other generated language emits them; Swift
// does not. These are applied structurally (locate the struct, insert at its
// declaration / load / save anchors) rather than via literal find-and-replace,
// because the surrounding emitter output differs for every subtype.
const propertyBase = {
  decls:
    '  public var name: String = ""\n' +
    "  public var description: String? = nil\n" +
    "  public var required: Bool? = nil\n" +
    "  public var nullable: Bool? = nil\n" +
    "  public var `default`: Any? = nil\n" +
    "  public var example: Any? = nil\n" +
    "  public var enumValues: [Any]? = nil\n",
  load:
    '    if let value = object["name"] {\n' +
    '      instance.name = try TypraRuntime.string(value, field: "name")\n' +
    "    }\n" +
    '    if let value = object["description"], !(value is NSNull) {\n' +
    '      instance.description = try TypraRuntime.string(value, field: "description")\n' +
    "    }\n" +
    '    if let value = object["required"], !(value is NSNull) {\n' +
    '      instance.required = try TypraRuntime.bool(value, field: "required")\n' +
    "    }\n" +
    '    if let value = object["nullable"], !(value is NSNull) {\n' +
    '      instance.nullable = try TypraRuntime.bool(value, field: "nullable")\n' +
    "    }\n" +
    '    if let value = object["default"], !(value is NSNull) {\n' +
    "      instance.default = value\n" +
    "    }\n" +
    '    if let value = object["example"], !(value is NSNull) {\n' +
    "      instance.example = value\n" +
    "    }\n" +
    '    if let value = object["enumValues"], !(value is NSNull) {\n' +
    '      instance.enumValues = try TypraRuntime.array(value, field: "enumValues")\n' +
    "    }\n",
  save:
    '    if !self.name.isEmpty { result["name"] = self.name }\n' +
    '    if let value = self.description { result["description"] = value }\n' +
    '    if let value = self.required { result["required"] = value }\n' +
    '    if let value = self.nullable { result["nullable"] = value }\n' +
    '    if let value = self.default { result["default"] = value }\n' +
    '    if let value = self.example { result["example"] = value }\n' +
    '    if let value = self.enumValues { result["enumValues"] = value }\n',
};

// `bindings` accepts either the `Record<Binding>` map form or the
// `Named<Binding>[]` list form; the map key supplies the binding name.
const toolBase = {
  decls:
    '  public var name: String = ""\n' +
    "  public var description: String? = nil\n" +
    "  public var bindings: [Binding]? = nil\n",
  load:
    '    if let value = object["name"] {\n' +
    '      instance.name = try TypraRuntime.string(value, field: "name")\n' +
    "    }\n" +
    '    if let value = object["description"], !(value is NSNull) {\n' +
    '      instance.description = try TypraRuntime.string(value, field: "description")\n' +
    "    }\n" +
    '    if let value = object["bindings"], !(value is NSNull) {\n' +
    "      if let mapping = value as? [String: Any] {\n" +
    "        instance.bindings = try mapping.keys.sorted().map { key in\n" +
    "          var binding = try Binding.load(mapping[key] as Any, context: context)\n" +
    "          binding.name = key\n" +
    "          return binding\n" +
    "        }\n" +
    "      } else {\n" +
    '        instance.bindings = try TypraRuntime.array(value, field: "bindings").map {\n' +
    "          try Binding.load($0, context: context)\n" +
    "        }\n" +
    "      }\n" +
    "    }\n",
  save:
    '    if !self.name.isEmpty { result["name"] = self.name }\n' +
    '    if let value = self.description { result["description"] = value }\n' +
    "    if let value = self.bindings {\n" +
    '      result["bindings"] = try value.map { try $0.save(context) }\n' +
    "    }\n",
};

const baseFieldInjections = [
  {
    file: join("core", "property.swift"),
    structs: ["ArrayProperty", "ObjectProperty", "UnionProperty"],
    base: propertyBase,
  },
  {
    file: join("tools", "tool.swift"),
    structs: ["FunctionTool", "CustomTool", "McpTool", "OpenApiTool", "PromptyTool"],
    base: toolBase,
  },
];

/**
 * Insert `base` fields into one generated struct.
 *
 * Returns `{ changed }` on success, or throws when an anchor is missing — the
 * signal that the emitter's Swift output shape changed.
 */
function injectBaseFields(content, structName, base) {
  const header = `public struct ${structName}: TypraModel {\n`;
  const start = content.indexOf(header);
  if (start < 0) {
    throw new Error(`struct ${structName} not found`);
  }
  const end = content.indexOf("\n}\n", start);
  if (end < 0) {
    throw new Error(`struct ${structName} has no closing brace`);
  }

  let body = content.slice(start, end);

  // Treat the three insertions as one unit. A partially-applied struct means
  // the emitter changed shape mid-flight and the shim can no longer be trusted.
  const present = [base.decls, base.load, base.save].filter((part) => body.includes(part));
  if (present.length === 3) {
    return { content, changed: false };
  }
  if (present.length !== 0) {
    throw new Error(
      `struct ${structName} is partially patched (${present.length}/3 base-field blocks present) — ` +
        "the emitter output shape changed; re-check this shim",
    );
  }

  for (const [label, anchor, insert] of [
    ["declarations", "\n\n  public init(", base.decls],
    ["load", "    return instance\n", base.load],
    ["save", "    return result\n", base.save],
  ]) {
    const at = body.indexOf(anchor);
    if (at < 0) {
      throw new Error(`struct ${structName} is missing its ${label} anchor ${JSON.stringify(anchor)}`);
    }
    // Anchors must be unambiguous — a second `return instance` (or `public
    // init(`) would mean we are guessing which site to patch.
    if (body.indexOf(anchor, at + anchor.length) >= 0) {
      throw new Error(
        `struct ${structName} has multiple ${label} anchors ${JSON.stringify(anchor)} — ` +
          "cannot determine the insertion point",
      );
    }
    // Declarations append after the emitted vars; load/save prepend before the
    // trailing `return`, so both cases insert at the anchor's start offset + 1
    // for declarations (past the first newline) and at the anchor for the rest.
    const offset = label === "declarations" ? at + 1 : at;
    body = body.slice(0, offset) + insert + body.slice(offset);
  }

  return { content: content.slice(0, start) + body + content.slice(end), changed: true };
}

const patches = [
  // --- Defect 2: recursive polymorphic enum needs boxing -------------------
  {
    file: join("core", "property.swift"),
    find: "public enum Property: TypraModel {",
    replace: "public indirect enum Property: TypraModel {",
  },

  // --- Defect 1: missing wildcard cases on polymorphic enums ---------------
  {
    file: join("tools", "tool.swift"),
    find: "  case promptyTool(PromptyTool)\n",
    replace: "  case promptyTool(PromptyTool)\n  case customTool(CustomTool)\n",
  },
  {
    file: join("tools", "tool.swift"),
    find: "    case .promptyTool(let value): return try value.save(context)\n",
    replace:
      "    case .promptyTool(let value): return try value.save(context)\n" +
      "    case .customTool(let value): return try value.save(context)\n",
  },
  {
    file: join("connection", "connection.swift"),
    find: "  case foundryConnection(FoundryConnection)\n",
    replace: "  case foundryConnection(FoundryConnection)\n  case unknown([String: Any])\n",
  },
  {
    file: join("connection", "connection.swift"),
    find:
      "    default:\n" +
      "      throw TypraRuntimeError.unknownDiscriminator(\n" +
      '        type: "Connection", field: "kind", value: discriminator)\n',
    replace:
      "    default:\n" +
      "      // Defect 1 (continued): the emitter references `.unknown` in generated\n" +
      "      // defaults but never makes it reachable from load. Connection has no\n" +
      "      // wildcard subtype in TypeSpec, yet the Rust runtime tolerates unknown\n" +
      "      // kinds (falls back to a default kind, retaining the raw fields), so\n" +
      "      // throwing here breaks cross-runtime parity on forward-compatible files.\n" +
      "      return .unknown(object)\n",
  },
  {
    file: join("connection", "connection.swift"),
    find: "    case .foundryConnection(let value): return try value.save(context)\n",
    replace:
      "    case .foundryConnection(let value): return try value.save(context)\n" +
      "    case .unknown(let value): return value\n",
  },

  // --- Defect 3: convenience factories must use enum constructors ----------
  {
    file: join("conversation", "message.swift"),
    find: 'Message(role: "assistant", parts: [TextPart(kind: "text", value: text)])',
    replace: 'Message(role: .assistant, parts: [.textPart(TextPart(kind: "text", value: text))])',
  },
  {
    file: join("conversation", "message.swift"),
    find: 'Message(role: "system", parts: [TextPart(kind: "text", value: text)])',
    replace: 'Message(role: .system, parts: [.textPart(TextPart(kind: "text", value: text))])',
  },
  {
    file: join("conversation", "message.swift"),
    find: 'Message(role: "user", parts: [TextPart(kind: "text", value: text)])',
    replace: 'Message(role: .user, parts: [.textPart(TextPart(kind: "text", value: text))])',
  },
  {
    file: join("conversation", "tool_result.swift"),
    find: 'ToolResult(parts: [TextPart(kind: "text", value: value)])',
    replace: 'ToolResult(parts: [.textPart(TextPart(kind: "text", value: value))])',
  },

  // --- Defects 4 + 5: protocol signature type mapping and arity ------------
  {
    file: join("pipeline", "parser.swift"),
    find: "  func preRender(template: String) throws -> Unknown\n" +
      "  func parse(agent: Prompty, rendered: String, context: RecordUnknown) async throws -> Message\n",
    replace: "  func preRender(template: String) throws -> Any?\n" +
      "  func parse(agent: Prompty, rendered: String, context: [String: Any]?) async throws\n" +
      "    -> [Message]\n",
  },
  {
    file: join("pipeline", "renderer.swift"),
    find: "  func render(agent: Prompty, template: String, inputs: RecordUnknown) async throws -> String\n",
    replace: "  func render(agent: Prompty, template: String, inputs: [String: Any]) async throws -> String\n",
  },
  {
    file: join("pipeline", "executor.swift"),
    find: "  func execute(agent: Prompty, messages: Message) async throws -> Any\n" +
      "  func executeStream(agent: Prompty, messages: Message) async throws -> Any\n" +
      "  func formatToolMessages(\n" +
      "    rawResponse: Any, toolCalls: ToolCall, toolResults: String, textContent: String\n" +
      "  ) throws -> Message\n",
    replace: "  func execute(agent: Prompty, messages: [Message]) async throws -> Any\n" +
      "  func executeStream(agent: Prompty, messages: [Message]) async throws -> Any\n" +
      "  func formatToolMessages(\n" +
      "    rawResponse: Any, toolCalls: [ToolCall], toolResults: [String], textContent: String?\n" +
      "  ) throws -> [Message]\n",
  },
  {
    file: join("model", "model_lister.swift"),
    find: "  func listModels(connection: Any) async throws -> ModelInfo\n",
    replace: "  func listModels(connection: Any) async throws -> [ModelInfo]\n",
  },
  {
    file: join("pipeline", "checkpoint_store.swift"),
    find: "  func load(sessionId: String, checkpointId: String) async throws -> Checkpoint\n" +
      "  func listCheckpoints(sessionId: String) async throws -> Checkpoint\n",
    replace: "  func load(sessionId: String, checkpointId: String) async throws -> Checkpoint?\n" +
      "  func listCheckpoints(sessionId: String) async throws -> [Checkpoint]\n",
  },
  {
    file: join("pipeline", "event_journal_writer.swift"),
    find: "  func close(summary: SessionSummary) throws -> Bool\n",
    replace: "  func close(summary: SessionSummary?) throws -> Bool\n",
  },
];

/// The emitter release this shim was written against. Every patch below encodes
/// the exact byte sequences that version emits, so a different version must not
/// be silently patched — it needs a re-review (and is quite possibly fixed).
const PINNED_EMITTER_VERSION = "0.4.2";

function assertPinnedEmitterVersion() {
  const manifestPath = join("node_modules", "@typra", "emitter", "package.json");
  if (!existsSync(manifestPath)) return;
  const { version } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (version !== PINNED_EMITTER_VERSION) {
    throw new Error(
      `Swift emitter shim is pinned to @typra/emitter@${PINNED_EMITTER_VERSION} but ` +
        `@typra/emitter@${version} is installed. Re-verify every patch in ` +
        "schema/scripts/patch-swift-emitter-defects.mjs against the new output, then update the pin " +
        "(or delete the shim if the defects are fixed upstream).",
    );
  }
}

export function patchSwiftEmitterDefects(root = swiftSources) {
  assertPinnedEmitterVersion();

  if (!existsSync(root)) {
    // Swift is a configured emit target, so a missing output tree means the
    // emitter silently produced nothing — never treat that as success.
    throw new Error(
      `Swift emitter shim found no generated output at ${root}. ` +
        "Check the Swift emit target in schema/tspconfig.yaml.",
    );
  }

  let applied = 0;
  let alreadyApplied = 0;
  const failures = [];

  for (const patch of patches) {
    const path = join(root, patch.file);
    if (!existsSync(path)) {
      failures.push(`${patch.file}: generated file is missing`);
      continue;
    }

    const content = readFileSync(path, "utf8");
    // `replace` is checked first because several patches are insertions whose
    // replacement text still contains the `find` anchor; checking `find` first
    // would re-apply them on every run.
    if (content.includes(patch.replace)) {
      alreadyApplied += 1;
    } else if (content.includes(patch.find)) {
      writeFileSync(path, content.split(patch.find).join(patch.replace));
      applied += 1;
    } else {
      failures.push(
        `${patch.file}: neither the expected emitter output nor the patched form was found. ` +
          `The Swift emitter output changed — re-verify this shim.\n  expected: ${JSON.stringify(patch.find)}`,
      );
    }
  }

  for (const injection of baseFieldInjections) {
    const path = join(root, injection.file);
    if (!existsSync(path)) {
      failures.push(`${injection.file}: generated file is missing`);
      continue;
    }

    let content = readFileSync(path, "utf8");
    let dirty = false;
    for (const structName of injection.structs) {
      try {
        const result = injectBaseFields(content, structName, injection.base);
        content = result.content;
        if (result.changed) {
          applied += 1;
          dirty = true;
        } else {
          alreadyApplied += 1;
        }
      } catch (error) {
        failures.push(`${injection.file}: ${error.message}`);
      }
    }
    if (dirty) {
      writeFileSync(path, content);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Swift emitter shim is stale:\n  - ${failures.join("\n  - ")}\n` +
        "If @typra/emitter now emits correct Swift, delete schema/scripts/patch-swift-emitter-defects.mjs " +
        "and its call in normalize-typra-output.mjs.",
    );
  }

  return { applied, alreadyApplied, skipped: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = patchSwiftEmitterDefects();
  console.log(
    `swift emitter shim: ${result.applied} patched, ${result.alreadyApplied} already applied`,
  );
}
