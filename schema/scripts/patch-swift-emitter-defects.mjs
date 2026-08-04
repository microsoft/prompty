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
//      base `Property` field (`description`, `required`, `nullable`,
//      `default`, `example`, `enumValues`) and every `Tool` subtype loses
//      `description` / `bindings`, on both load and save.
//
//      `name` is injected alongside those, but for a *different* reason: it is
//      not declared by `model Property` or `model Tool` at all. It arrives via
//      the `Named<...>` spread (`schema/model/core/core.tsp`), which the emitter
//      also drops. An upstream fix to `extends` inheritance therefore restores
//      everything listed above *except* `name` — do not remove the `name`
//      injection on the strength of an `extends` fix alone. Confirm it against
//      regenerated output first.
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
//
// `Connection` subtypes are hit by the same emitter defect but are deliberately
// out of scope: the runtime never reads their inherited fields, so no vector
// regresses without them. The generated tests do assert them, though
// (`ReferenceConnection.authenticationMode` / `.usageDescription`), so
// restoring `test-dir` needs the upstream `extends` fix — not more injections
// here.
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
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

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
// Note for whoever retires these: the `parser.swift` `replace` below is
// pre-wrapped to the width `swift-format` produces. A fixed emitter emits the
// same signature on one line, which matches neither `find` nor `replace`, so
// this patch reports "output changed" rather than "already applied". That is a
// false negative — compare the signatures, not the line breaks, before
// concluding the emitter still has the defect.
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
///
/// Releases evaluated and rejected so far, all because the emitter is shared
/// and a bump regenerates every runtime:
///   0.4.3 — fixes five Swift source-generator defects (Tool wildcard, indirect,
///           typed factories, placeholder types, suffix loss) and would cut this
///           shim to 345 lines, but reshapes the C# generated-test string
///           literals and breaks 16 `*Yaml*` tests in Prompty.Core.Tests.
///   0.4.5 — probed because it was announced as carrying the Swift
///           generated-test fixes. It predates 0.4.6 and 0.4.9, so it lacks the
///           inherited `extends` fields fix noted below and still omits
///           `Connection.unknown`: native output is 30 errors, all `Connection
///           has no member 'unknown'`, in tool.swift. Probe-patching only that
///           case makes the library compile and then yields 228 test-build
///           error lines, 57 unique, across six files, against 0.4.9's 180 and
///           45 across five. The sixth is tools/ToolTests.swift, whose eight
///           errors are all `FunctionTool` missing `name` and `description`.
///           `ReferenceConnection` likewise drops `authenticationMode` and
///           `usageDescription`, but silently, as defect 10 describes.
///           Re-probed patch by patch: of this shim's 24 patch sites, 13 are
///           fixed upstream (defects 2, 3, 4 and 5, plus defect 1 for `Tool`)
///           and 11 are residual — the three `Connection.unknown` patches and
///           all eight base-field injections. Applying only those 11 to native
///           0.4.5 output compiles the library, clears `ToolTests` entirely,
///           leaves 49 unique test-build errors across five files, and passes
///           all 76 runtime tests including live E2E. 0.4.5 would therefore
///           retire 13 of the 24 patch sites but not the shim itself: the eight
///           residual injections keep the structural machinery, which is the
///           bulk of the code here. Rejected on Swift alone, so the other
///           runtimes were not measured here.
///   0.4.6 — additionally fixes inherited `extends` fields, but carries the same
///           C# break plus dropped `= []` on 13 TypeScript fields that declare an
///           explicit `= #[]` default.
///   0.4.8 — Swift is close to clean: native output compiles to exactly 30
///           errors, all `Connection has no member 'unknown'`, all in tool.swift.
///           Probe-patching only that case makes the model package compile, so
///           this shim would likely collapse to a single patch — but "compiles"
///           is not "correct" (see defect 10 above: silently dropped fields
///           produce no diagnostics), so retiring any patch still requires
///           `swift build --build-tests` *and* `swift test` to confirm the
///           round-trip behaviour it guards. Rejected regardless: the C# break
///           below reproduces at 0.4.8 (verified locally). The 0.4.6 TypeScript
///           regression was not re-verified at 0.4.8.
///   0.4.9 — emits `Connection.unknown` in the requested shape, and
///           Prompty.Core.Tests reports 48 passed, 0 failed, beating the 0.4.2
///           baseline, which fails 16 `*Json*` tests locally due to a CRLF
///           artifact. Go has 17 `FAIL` lines, down from 44, and Rust is green
///           (4 + 33 + 6 passed, 0 failed). Rejected anyway: a new named-dict
///           collection helper — added so `inputs:`/`tools:` can be read as
///           name-keyed maps — is generated assuming a struct element type. For
///           the polymorphic enums `Property` and `Tool`, it emits
///           `item.name = name` and the corresponding `.shorthandProperty`,
///           although those enums declare only cases and `load`/`save`. That is
///           48 fresh compile errors (agent/prompty.swift 30, core/property.swift
///           10, tools/tool.swift 8) where 0.4.8 had 30, so the shim cannot
///           shrink, let alone be deleted. Routing the name through the
///           dictionary before `load` — mirroring the save path, which already
///           does `removeValue(forKey: "name")` — would make the helper agnostic
///           to struct-vs-enum elements. The generated `test-dir` is also no
///           better: after probe-patching those 48 source errors so the library
///           could compile, it produced the same 180 test errors as 0.4.8, so
///           restoring it stays blocked too. The 0.4.6 TypeScript `= []`
///           regression persists.
///  0.4.10 — the closest to adoptable so far: 23 of the 24 patch sites below are
///           fixed upstream, against 13 at 0.4.5. Every base-field injection is
///           fixed upstream — `ArrayProperty`, `ObjectProperty`, `UnionProperty`
///           carry the `Property` fields and all five `Tool` subtypes carry
///           `name`, `description`, `bindings` — and, unlike earlier attempts,
///           those fields appear in the memberwise `init`, which would also
///           settle the known limitation recorded at the top of this file. Note
///           that nothing here is retired today: this repo stays pinned to
///           0.4.2, so all 24 patches still apply. `Connection` gains
///           `case unknown([String: Any])` and its `save` arm. The lone residual
///           is `Connection.load`'s `default:`, which still throws
///           `unknownDiscriminator` instead of returning `.unknown`, leaving
///           that case declared but unreachable by the loader.
///           Rejected because the 0.4.9 named-dict defect persists, though much
///           reduced: `item.name = name` and `Property.shorthandProperty` are
///           still emitted against the polymorphic enums, now costing 10 errors
///           confined to agent/prompty.swift where 0.4.9 cost 48 across three
///           files. core/property.swift and tools/tool.swift no longer fail;
///           the probe did not establish why, so do not assume the base-field
///           fix is the cause. Hand-synthesising the enum-level forwarders, plus
///           the one-line `Connection` change, takes `swift build` from 10
///           errors to exit 0. That measures compilation only — the forwarders
///           are themselves a workaround, and with the generated tests still
///           unusable nothing here demonstrates behavioural correctness, so
///           deleting this shim needs both fixes upstream *and* a green
///           generated-test run. It is the first release where that outcome
///           looks reachable, which is why 0.4.10 is worth re-probing rather
///           than skipping. The generated `test-dir` remains unusable: 45
///           primary unique errors across five files (PromptyTests 16,
///           ModelTests 12, PropertyTests 8, McpApprovalModeTests 5,
///           ConnectionTests 4) against 0.4.5's 49 across five. Treat that as a
///           count, not a trend — failure identities were not diffed. ToolTests
///           is clean here, but it was already clean in the 0.4.5 49-error
///           measurement; its eight failures belong to a less-patched 0.4.5
///           probe and are not a 0.4.10 improvement. At least four of the
///           ModelTests failures are ours, not the emitter's — see the
///           `@sample` defect at schema/model/model/model.tsp L86/L93.
///           C# and TypeScript were not re-measured at 0.4.10.
///           Contract note: `Tool` now emits both `customTool(CustomTool)` and
///           `unknown([String: Any])`, but `load`'s `default:` routes to
///           `.customTool`, so `.unknown` is unreachable through `load` — it is
///           still manually constructible, but it forces any exhaustive
///           consumer `switch` without a catch-all arm to grow one.
/// Compare failing test *identities*, not counts: the 0.4.3, 0.4.6, and 0.4.8
/// releases evaluated against C# each leave its failure count at 16 while
/// swapping `*Json*` for `*Yaml*`. On Windows those are two unrelated causes —
/// the baseline `*Json*` failures are a local CRLF artifact, while the new
/// `*Yaml*` ones come from a trailing space at schema/model/agent/agent.tsp:166
/// that escaped expected-value literals preserve and verbatim input-YAML
/// literals drop. 0.4.9 resolves that asymmetry.
///
/// Confirm every "still residual" verdict by reading generated source, never by
/// matching the `find` anchors below. Those anchors are only a hypothesis about
/// a release: at 0.4.5 they were reliable, but at 0.4.10 they reported all eight
/// base-field injections as unfixed when the source proves otherwise, because
/// the structural anchors `injectBaseFields` keys off had moved. Two distinct
/// false-negative mechanisms are now known — shifted structural anchors, and the
/// pre-wrapped `replace` text described above the Defects 4 + 5 group.
const PINNED_EMITTER_VERSION = "0.4.2";

function assertPinnedEmitterVersion() {
  const manifestPath = join("node_modules", "@typra", "emitter", "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Cannot verify the emitter version: ${manifestPath} is missing. The Swift shim only ` +
        `applies to @typra/emitter@${PINNED_EMITTER_VERSION}; refusing to patch generated ` +
        "Swift against an unknown emitter. Run `npm install` in schema/ first.",
    );
  }
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
    const replaceCount = countOccurrences(content, patch.replace);
    if (replaceCount > 0) {
      if (replaceCount !== 1) {
        failures.push(
          `${patch.file}: the patched form appears ${replaceCount} times; expected exactly one. ` +
            `The Swift emitter output changed — re-verify this shim.`,
        );
        continue;
      }
      // Guard against a half-patched file: strip the patched occurrences and
      // confirm no raw anchor survives elsewhere.
      const residual = countOccurrences(content.split(patch.replace).join(""), patch.find);
      if (residual > 0) {
        failures.push(
          `${patch.file}: found the patched form plus ${residual} unpatched occurrence(s) of the anchor. ` +
            `Refusing to leave a half-patched file — re-verify this shim.`,
        );
        continue;
      }
      alreadyApplied += 1;
    } else {
      const findCount = countOccurrences(content, patch.find);
      if (findCount !== 1) {
        failures.push(
          findCount === 0
            ? `${patch.file}: neither the expected emitter output nor the patched form was found. ` +
                `The Swift emitter output changed — re-verify this shim.\n  expected: ${JSON.stringify(patch.find)}`
            : `${patch.file}: the anchor is ambiguous (${findCount} occurrences); expected exactly one. ` +
                `Refusing to patch — re-verify this shim.\n  anchor: ${JSON.stringify(patch.find)}`,
        );
        continue;
      }
      writeFileSync(path, content.split(patch.find).join(patch.replace));
      applied += 1;
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
