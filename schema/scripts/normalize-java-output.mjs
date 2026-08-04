// Deterministic post-emit normalization for the Typra Java target.
//
// TEMPORARY SHIM — remove once @typra/emitter's Java backend is fixed.
//
// The Java language backend of @typra/emitter@0.4.2 emits source that does not
// compile and that diverges from the C#/Rust/Go/Python backends. This module
// applies a fixed, deterministic set of rewrites so the emitted model remains
// the single canonical model layer for the Java runtime (no hand-written
// duplicate model code, no manual edits to generated files).
//
// Defects addressed (reported upstream):
//
//   J1  `default` is a Java reserved word but is emitted verbatim as a field
//       name on `Property`.
//   J2  `@abstract` models are emitted as `abstract class` yet their own
//       `load()` fallback calls `new X()`; the `Tool` dispatch also omits the
//       wildcard `*` catch-all subtype.
//   J3  Enum-typed fields are assigned raw `String` values in `@factory`
//       bodies and in shorthand `load()` paths.
//   J4  `Long`/`Double`/`Float` fields are initialized with `int` literals.
//   J6  Enum type names are emitted in lowerCamelCase.
//   J7  Enums are emitted package-private alongside a public class in the same
//       compilation unit, which is not legal Java.
//   J8  Derived-class `load()` never populates base-class properties, and
//       re-declares the discriminator field so it shadows the base field.
//   J9  Named collections are not normalized between their dictionary and list
//       forms on load, and `collectionFormat` is not honoured on save.
//   J10 Generated tests dot into `List<>` fields as if they were maps.
//   J11 Generated tests double-escape expected string literals.
//   J12 Generated tests compare object-valued fields against scalar wire values.
//   J13 `Property.load` emits two consecutive `instanceof Number` branches, so
//       the integer branch is unreachable.
//   J14 Derived `save()` runs the `postSave` hook again after the base class has
//       already run it.
//   J15 `SaveContext` lacks the `collectionFormat` and `useShorthand` knobs the
//       other backends expose.
//   J16 Optional properties that declare a TypeSpec default are materialized
//       eagerly, so `save()` emits keys the C#, Rust and Go runtimes omit.
//   J17 Required enum-typed properties are initialized to `null` and saved
//       behind a null check, so a required enum can vanish from the wire data.
//       C# and Rust seed them with the first declared constant and always emit
//       them.
//
// Every rewrite below is structural and idempotent: running the emitter and
// this shim again from a clean tree produces byte-identical output.
//
// J5 — `@method` stubs are emitted without an extension seam (Rust emits a
// trait, C# emits partial `*Helpers` classes) — is deliberately NOT addressed
// here. Those helpers are hand-written in the runtime package instead, so the
// generated model layer stays untouched.

import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Subtypes selected when a discriminated union sees an unknown discriminator. */
const WILDCARD_SUBTYPE = { Tool: "CustomTool" };

export function normalizeJavaOutput(root, specRoot) {
  if (!existsSync(root)) {
    return;
  }

  const files = readdirSync(root).filter((name) => name.endsWith(".java"));
  const units = new Map();
  for (const name of files) {
    const path = join(root, name);
    units.set(name.replace(/\.java$/u, ""), { path, text: readFileSync(path, "utf8") });
  }

  const optional = readOptionalProperties(specRoot);
  const namedCollections = readNamedCollectionFields(specRoot);
  const enumRenames = extractEnums(root, units);
  applyRenames(units, enumRenames);
  const enumNames = collectEnumNames(units);
  const enumDefaults = collectEnumDefaults(units);

  const classes = indexClasses(units);
  const described = describeClasses(classes);
  const stats = {
    namedDictionary: 0,
    namedDictionarySave: 0,
    derivedSave: 0,
    scalarShorthand: 0,
    loadBodies: 0,
    optionalDefaults: 0,
    requiredEnums: 0,
    wildcard: 0,
    misses: [],
    problems: [],
  };

  for (const [name, unit] of units) {
    let text = unit.text;
    text = fixReservedFieldNames(text);
    text = fixNumericDefaults(text);
    text = clearOptionalDefaults(text, optional.get(name), stats);
    text = fixRequiredEnumDefaults(text, optional.get(name), enumDefaults, stats);
    text = fixDiscriminatorDispatch(text, name, stats);
    text = fixEnumAssignments(text, classes.get(name), enumNames);
    text = fixScalarShorthandDispatch(text, stats);
    const named = new Map();
    text = fixNamedDictionaryLoads(text, units, stats, named);
    text = fixNamedDictionarySaves(text, named, namedCollections.get(name), name, stats);
    text = fixDerivedSaveMethods(text, classes.get(name), name, stats);
    unit.text = text;
  }

  extendSaveContext(units, stats);
  writeSupportClasses(root, units);

  reshapeLoadMethods(units, classes, stats);
  assertRewritesApplied(stats, classes);

  for (const unit of units.values()) {
    writeFileSync(unit.path, unit.text);
  }

  return { renames: enumRenames, classes: described };
}

/**
 * Reads the TypeSpec sources and reports, per model, which list-valued
 * properties may be saved in the name-keyed object form.
 *
 * <p>A collection is eligible when its element type carries a `name` property in
 * the TypeSpec — either because the element is a named-collection alias
 * (`alias X = Record<Item> | Named<Item, ...>[]`, whose `Named<>` wrapper always
 * declares one) or because the element model declares `name` itself.
 *
 * <p>The Java class shape is deliberately *not* consulted. `UnionProperty.anyOf`
 * is declared `Property[]`, and the emitters graft a `name` field onto the
 * generated `Property` class even though the TypeSpec model does not declare
 * one — so testing the emitted class would wrongly make `anyOf` eligible. The
 * generated C# agrees with the rule implemented here: it emits exactly eleven
 * "Object format: use name as key" save sites, matching the eleven fields this
 * resolves, and stamps `anyOf`/`oneOf` with "This collection type does not have
 * a 'name' property, only array format is supported".
 */
function readNamedCollectionFields(specRoot) {
  const fields = new Map();
  if (!specRoot || !existsSync(specRoot)) {
    return fields;
  }
  const sources = collectFiles(specRoot, ".tsp").map((file) => readFileSync(file, "utf8"));

  const aliases = new Set();
  for (const source of sources) {
    for (const alias of source.matchAll(/^alias\s+(\w+)\s*=\s*Record<[^>]*>\s*\|\s*Named</gmu)) {
      aliases.add(alias[1]);
    }
  }

  // Element models that declare `name`, resolved through `extends` chains.
  const declared = new Set();
  const bases = new Map();
  for (const source of sources) {
    for (const block of source.matchAll(MODEL_BLOCK_RE)) {
      const [whole, model, body] = block;
      if (/^\s+name\??\s*:/mu.test(body)) {
        declared.add(model);
      }
      const base = /^model\s+\w+(?:<[^>]*>)?\s+extends\s+(\w+)/u.exec(whole);
      if (base) {
        bases.set(model, base[1]);
      }
    }
  }
  const declaresName = (model) => {
    for (let current = model, hops = 0; current && hops < 16; current = bases.get(current), hops += 1) {
      if (declared.has(current)) {
        return true;
      }
    }
    return false;
  };

  for (const source of sources) {
    for (const block of source.matchAll(MODEL_BLOCK_RE)) {
      const [, model, body] = block;
      const names = fields.get(model) ?? new Set();
      for (const property of body.matchAll(/^\s+(\w+)\??\s*:\s*(\w+)(\[\])?\s*[=;]/gmu)) {
        const [, field, type, isArray] = property;
        if (aliases.has(type) || (isArray && declaresName(type))) {
          names.add(field);
        }
      }
      fields.set(model, names);
    }
  }
  return fields;
}

/**
 * Reads the TypeSpec sources and reports, per model, which properties are
 * declared optional (`name?: type`).
 *
 * <p>TypeSpec lets an optional property carry a default (`description?: string =
 * ""`). The C#, Rust and Go backends treat that default as a fallback for
 * readers and leave the field unset when the wire data omits it; the Java
 * backend materializes it, so every saved dictionary carries keys the other
 * runtimes omit. J16 restores the shared behaviour.
 */
function readOptionalProperties(specRoot) {
  const optional = new Map();
  if (!specRoot || !existsSync(specRoot)) {
    return optional;
  }
  for (const file of collectFiles(specRoot, ".tsp")) {
    const source = readFileSync(file, "utf8");
    for (const block of source.matchAll(MODEL_BLOCK_RE)) {
      const [, model, body] = block;
      const names = optional.get(model) ?? new Set();
      for (const property of body.matchAll(/^\s+(\w+)\?\s*:/gmu)) {
        names.add(property[1]);
      }
      optional.set(model, names);
    }
  }
  return optional;
}

const MODEL_BLOCK_RE = /^model\s+(\w+)[^{]*\{([\s\S]*?)^\}/gmu;

function collectFiles(root, extension) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectFiles(path, extension));
    } else if (entry.name.endsWith(extension)) {
      found.push(path);
    }
  }
  return found;
}

/** J16 — an unset optional property must stay unset until a reader supplies it. */
function clearOptionalDefaults(text, optionalNames, stats) {
  if (!optionalNames || optionalNames.size === 0) {
    return text;
  }
  return text.replace(
    /^( {2}public (?!static)([\w.]+)((?:<[^>]*>)?(?:\[\])?) )(\w+) = (?!null;)(.+);$/gmu,
    (whole, prefix, type, suffix, field) => {
      // A primitive cannot hold null, and `default` is renamed by J1.
      if (suffix === "" && PRIMITIVES.has(type)) {
        return whole;
      }
      const declared = field === "defaultValue" ? "default" : field;
      if (!optionalNames.has(declared) && !optionalNames.has(field)) {
        return whole;
      }
      stats.optionalDefaults += 1;
      return `${prefix}${field} = null;`;
    },
  );
}

const PRIMITIVES = new Set(["boolean", "byte", "char", "short", "int", "long", "float", "double"]);

/** Field name -> declared type per class, including inherited fields. */
function describeClasses(classes) {
  const described = new Map();
  for (const [name, info] of classes) {
    const fields = new Map();
    for (let cursor = info; cursor; cursor = cursor.base ? classes.get(cursor.base) : null) {
      for (const [field, { type }] of cursor.fields) {
        if (!fields.has(field)) {
          fields.set(field, type);
        }
      }
    }
    described.set(name, fields);
  }
  return described;
}

// ---------------------------------------------------------------------------
// J6 + J7 — hoist enums into their own public compilation units
// ---------------------------------------------------------------------------

function extractEnums(root, units) {
  const renames = new Map();
  const header = "// <auto-generated by typra-emitter>\n// Code generated by Typra emitter; DO NOT EDIT.\n";

  for (const unit of units.values()) {
    const lines = unit.text.split("\n");
    const kept = [];
    let index = 0;
    while (index < lines.length) {
      const match = /^enum (\w+) \{$/u.exec(lines[index]);
      if (!match) {
        kept.push(lines[index]);
        index += 1;
        continue;
      }
      const end = lines.indexOf("}", index);
      const original = match[1];
      const renamed = original[0].toUpperCase() + original.slice(1);
      if (renamed !== original) {
        renames.set(original, renamed);
      }
      const body = lines.slice(index + 1, end).join("\n");
      const source = `${header}package com.microsoft.prompty.model;\n\npublic enum ${renamed} {\n${body}\n}\n`;
      units.set(renamed, { path: join(root, `${renamed}.java`), text: source });
      // Drop the enum block plus the blank line that follows it.
      index = end + 1;
      if (lines[index] === "") {
        index += 1;
      }
    }
    unit.text = kept.join("\n");
  }

  return renames;
}

function applyRenames(units, renames) {
  if (renames.size === 0) {
    return;
  }
  for (const unit of units.values()) {
    let text = unit.text;
    for (const [from, to] of renames) {
      text = withLiteralsMasked(text, (code) => code.replace(new RegExp(`\\b${from}\\b`, "gu"), to));
    }
    unit.text = text;
  }
}

function collectEnumNames(units) {
  const names = new Set();
  for (const [name, unit] of units) {
    if (/^public enum (\w+) \{$/mu.test(unit.text)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Maps each generated enum to its first declared constant, which is the value
 * the other backends use as the default for a required enum-typed property.
 */
function collectEnumDefaults(units) {
  const defaults = new Map();
  for (const [name, unit] of units) {
    const first = /^public enum \w+ \{\n\s*(\w+)\("/mu.exec(unit.text);
    if (first) {
      defaults.set(name, first[1]);
    }
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// J17 — required enum-typed properties default to null
// ---------------------------------------------------------------------------

/**
 * The emitter initializes every enum-typed field to {@code null} and guards its
 * save with a null check, so a required enum silently disappears from the wire
 * dictionary when it was never assigned. C# and Rust instead seed a required
 * enum with the first declared constant and always emit it — see
 * {@code EngineEvent.Kind = EngineEventKind.TurnStarted} in
 * {@code runtime/csharp/Prompty.Core/Model/pipeline/EngineEvent.cs:88,245}.
 *
 * <p>Optional enums keep the null initializer and the conditional save, which is
 * exactly what the other backends do for a nullable enum.
 */
function fixRequiredEnumDefaults(text, optional, enumDefaults, stats) {
  const seeded = new Set();
  const withDefaults = text.replace(/^ {2}public (\w+) (\w+) = null;$/gmu, (whole, type, field) => {
    const constant = enumDefaults.get(type);
    if (!constant || optional?.has(field) !== false) {
      return whole;
    }
    stats.requiredEnums += 1;
    seeded.add(field);
    return `  public ${type} ${field} = ${type}.${constant};`;
  });

  if (seeded.size === 0) {
    return withDefaults;
  }
  return withDefaults.replace(
    /^( *)if \(obj\.(\w+) != null\) (result\.put\("\w+", obj\.\2\.value\);)$/gmu,
    (whole, indent, field, statement) => (seeded.has(field) ? `${indent}${statement}` : whole),
  );
}

// ---------------------------------------------------------------------------
// J1 — reserved-word field names
// ---------------------------------------------------------------------------

const RESERVED_FIELDS = { default: "defaultValue" };

function fixReservedFieldNames(text) {
  return withLiteralsMasked(text, (code) => {
    let result = code;
    for (const [reserved, replacement] of Object.entries(RESERVED_FIELDS)) {
      // Declaration: `public Object default = null;`
      result = result.replace(
        new RegExp(`^(\\s*public\\s+[\\w<>,\\[\\]. ]+?\\s+)${reserved}(\\s*=)`, "gmu"),
        `$1${replacement}$2`,
      );
      // Field access: `result.default`, `obj.default`, `this.default`
      result = result.replace(new RegExp(`\\.${reserved}\\b(?!\\s*:)`, "gu"), `.${replacement}`);
    }
    return result;
  });
}

/**
 * Runs `transform` over the source with every string literal, text block, char
 * literal and comment replaced by an opaque placeholder, then restores them.
 *
 * Rewrites that target Java identifiers must never see literal or comment text:
 * `default` is both a reserved field name and a substring of real payload data
 * (for example the OAuth scope `https://cognitiveservices.azure.com/.default`).
 */
function withLiteralsMasked(text, transform) {
  const stash = [];
  const masked = text.replace(
    /"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
    (match) => {
      stash.push(match);
      return `\u0000MASK${stash.length - 1}\u0000`;
    },
  );
  return transform(masked).replace(/\u0000MASK(\d+)\u0000/gu, (_whole, index) => stash[Number(index)]);
}

// ---------------------------------------------------------------------------
// J4 — boxed numeric literal defaults
// ---------------------------------------------------------------------------

function fixNumericDefaults(text) {
  return text
    .replace(/^(\s*public Long \w+ = -?\d+)(;)$/gmu, "$1L$2")
    .replace(/^(\s*public Double \w+ = -?\d+)(;)$/gmu, "$1.0$2")
    .replace(/^(\s*public Float \w+ = -?\d+)(;)$/gmu, "$1f$2");
}

// ---------------------------------------------------------------------------
// J2 — discriminated-union dispatch semantics
// ---------------------------------------------------------------------------

function fixDiscriminatorDispatch(text, className, stats) {
  let result = text.replace(
    /switch \(String\.valueOf\(discriminator\)\) \{/gu,
    "switch (String.valueOf(discriminator).toLowerCase(java.util.Locale.ROOT)) {",
  );

  const wildcard = WILDCARD_SUBTYPE[className];
  if (wildcard && result.includes("Object discriminator = dispatchMap.get(")) {
    result = result.replace(
      /(\n\s*)default:\n\s*break;\n/u,
      (whole, prefix) => {
        stats.wildcard += 1;
        return `${prefix}default:\n            return ${wildcard}.load(data, ctx);\n`;
      },
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// J3 — enum-typed fields assigned raw strings
// ---------------------------------------------------------------------------

function fixEnumAssignments(text, info, enumNames) {
  if (!info || info.enumFields.size === 0) {
    return text;
  }
  let result = text;
  for (const [field, type] of info.enumFields) {
    if (!enumNames.has(type)) {
      continue;
    }
    // Shorthand load path: `result.kind = String.valueOf(data);`
    result = result.replace(
      new RegExp(`(\\bresult\\.${field} = )String\\.valueOf\\(data\\);`, "gu"),
      `$1${type}.fromValue(String.valueOf(data));`,
    );
    // Factory bodies: `this.role = "assistant";`
    result = result.replace(
      new RegExp(`(\\bthis\\.${field} = )"([^"]*)";`, "gu"),
      `$1${type}.fromValue("$2");`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// J9 — named-dictionary properties are not normalized into lists
// ---------------------------------------------------------------------------

const NAMED_DICT_RE =
  / {4}if \(map\.containsKey\("(\w+)"\) && map\.get\("\1"\) != null\) \{\n {6}result\.(\w+) = new ArrayList<>\(\);\n {6}if \(map\.get\("\1"\) instanceof Iterable<\?> values\) \{\n {8}for \(Object item : values\) \{\n {10}result\.\2\.add\((\w+)\.load\(item, ctx\)\);\n {8}\}\n {6}\}\n {4}\}/gu;

/**
 * Model properties declared as named dictionaries (`inputs: { firstName: ... }`)
 * must load as lists with the dictionary key injected as `name`, and scalar
 * values must be widened through the element type's shorthand property. The
 * Java backend only handles the already-list form, so a name-keyed dictionary
 * silently loads as an empty list.
 */
function fixNamedDictionaryLoads(text, units, stats, named) {
  return text.replace(NAMED_DICT_RE, (_whole, wireName, field, elementType) => {
    stats.namedDictionary += 1;
    const shorthand = declaresShorthand(units, elementType) ? `${elementType}.SHORTHAND_PROPERTY` : "null";
    named.set(field, { wireName, elementType, shorthand });
    return (
      `    if (map.containsKey("${wireName}") && map.get("${wireName}") != null) {\n` +
      `      result.${field} = ModelCollections.loadList(\n` +
      `          map.get("${wireName}"), "${wireName}", ${shorthand}, ${elementType}::load, ctx);\n` +
      "    }"
    );
  });
}

/**
 * The save side of J9. The emitter always writes these collections as arrays;
 * the reference runtimes honour {@code SaveContext.collectionFormat} and default
 * to the name-keyed object form — but only for element types that actually have
 * a {@code name} property, exactly as Prompty.Core does.
 */
function fixNamedDictionarySaves(text, named, objectFormatFields, className, stats) {
  if (!objectFormatFields || objectFormatFields.size === 0) {
    return text;
  }
  const rewritten = new Set();
  const result = text.replace(
    / {4}if \(obj\.(\w+) != null\) \{\n {6}List<Object> items = new ArrayList<>\(\);\n {6}for \(\w+ item : obj\.\1\) items\.add\(item\.save\(ctx\)\);\n {6}result\.put\("(\w+)", items\);\n {4}\}/gu,
    (whole, field, wireName) => {
      if (!objectFormatFields.has(field) || wireName !== field) {
        return whole;
      }
      const entry = named.get(field);
      stats.namedDictionarySave += 1;
      rewritten.add(field);
      return (
        `    if (obj.${field} != null) {\n` +
        `      result.put("${wireName}", ModelCollections.saveList(\n` +
        `          obj.${field}, ${entry ? entry.shorthand : "null"}, item -> item.save(ctx), ctx));\n` +
        "    }"
      );
    },
  );

  // The declared type is the authority here, so a field the TypeSpec marks as a
  // named collection but whose save site did not match means the emitter's save
  // shape drifted.
  for (const field of objectFormatFields) {
    if (!rewritten.has(field) && text.includes(`obj.${field}`)) {
      stats.problems.push(`${className}.${field} is a named collection but its save site was not rewritten`);
    }
  }
  return result;
}

/**
 * Only the root of an inheritance chain may run the {@code postSave} hook. The
 * emitter calls it at every level, so a derived save post-processes an
 * incomplete dictionary and then post-processes the complete one again. C# calls
 * it exactly once, in the base class.
 */
function fixDerivedSaveMethods(text, info, name, stats) {
  if (!info?.base || !text.includes("Map<String, Object> result = super.save(ctx);")) {
    return text;
  }
  const updated = text.replace(
    /(Map<String, Object> result = super\.save\(ctx\);[\s\S]*?\n {4}return )ctx\.processDict\(result\);/u,
    "$1result;",
  );
  if (updated === text) {
    stats.problems.push(`${name}.save() still post-processes an inherited dictionary`);
    return text;
  }
  stats.derivedSave += 1;
  return updated;
}

function declaresShorthand(units, className) {
  const unit = units.get(className);
  return Boolean(unit && unit.text.includes("public static final String SHORTHAND_PROPERTY"));
}

// ---------------------------------------------------------------------------
// J13 — scalar shorthand dispatch has an unreachable integer branch
// ---------------------------------------------------------------------------

/**
 * The emitter guards both the `float` and the `integer` shorthand branch with a
 * bare `data instanceof Number`, so every numeric shorthand loads as a float and
 * the integer branch is dead. Narrow the float branch to floating-point types so
 * integral values reach the integer branch, matching the Rust and C# runtimes.
 */
function fixScalarShorthandDispatch(text, stats) {
  return text.replace(
    /( {4})if \(data instanceof Number\) \{\n( {6}\w+ result = new \w+\(\);\n {6}result\.kind = "float";)/gu,
    (whole, indent, tail) => {
      stats.scalarShorthand += 1;
      return `${indent}if (data instanceof Double || data instanceof Float || data instanceof java.math.BigDecimal) {\n${tail}`;
    },
  );
}

// ---------------------------------------------------------------------------
// Support classes emitted alongside the model
// ---------------------------------------------------------------------------

const MARKER = "// <auto-generated by typra-emitter>\n// Code generated by Typra emitter; DO NOT EDIT.\n";

/**
 * The reference runtimes let callers choose how named collections serialize.
 * The Java backend omits both knobs, so add them with the same names and
 * defaults as {@code Prompty.Core}'s {@code SaveContext}.
 */
function extendSaveContext(units, stats) {
  const unit = units.get("SaveContext");
  if (!unit || unit.text.includes("collectionFormat")) {
    return;
  }
  // Anchor above any annotations on processObject so they stay attached to it.
  const updated = unit.text.replace(
    /(\n(?: {2}@\w+(?:\([^)]*\))?\n)* {2}public <T> T processObject)/u,
    `
  /** Output format for collections: "object" (name as key) or "array" (list of dicts). */
  public String collectionFormat = "object";

  /** Use the shorthand scalar representation when possible. */
  public boolean useShorthand = true;
$1`,
  );
  if (updated === unit.text) {
    stats.problems.push("SaveContext no longer declares processObject; collection format not added");
    return;
  }
  unit.text = updated;
}

function writeSupportClasses(root, units) {
  const source =
    MARKER +
    `package com.microsoft.prompty.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.Function;

/** Shared collection loading and saving helpers used by the generated model. */
final class ModelCollections {
  private ModelCollections() { }

  /**
   * Loads a model list from either a flat list or a name-keyed dictionary.
   *
   * <p>Dictionary keys are injected as the element's {@code name}; scalar values
   * are widened through the element type's shorthand property.
   */
  static <T> List<T> loadList(
      Object raw, String property, String shorthand, BiFunction<Object, LoadContext, T> loader, LoadContext ctx) {
    List<T> result = new ArrayList<>();
    if (raw instanceof Map<?, ?> dict) {
      for (Map.Entry<?, ?> entry : dict.entrySet()) {
        String key = String.valueOf(entry.getKey());
        Object value = entry.getValue();
        if (isSequence(value)) {
          throw new IllegalArgumentException(
              "Invalid '" + property + "' format: key '" + key + "' has an array value. '" + property
                  + "' must be a flat list of objects or a name-keyed dict - not a nested {" + key
                  + ": [...]} structure.");
        }
        Map<String, Object> item = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> nested && !nested.isEmpty()) {
          for (Map.Entry<?, ?> field : nested.entrySet()) {
            item.put(String.valueOf(field.getKey()), field.getValue());
          }
          item.put("name", key);
        } else {
          item.put("name", key);
          if (shorthand != null && value != null) {
            item.put(shorthand, value);
          }
        }
        result.add(loader.apply(item, ctx));
      }
    } else if (raw instanceof Iterable<?> values) {
      for (Object item : values) {
        Object widened = widen(item, shorthand);
        if (widened != null) {
          result.add(loader.apply(widened, ctx));
        }
      }
    } else if (raw instanceof Object[] values) {
      for (Object item : values) {
        Object widened = widen(item, shorthand);
        if (widened != null) {
          result.add(loader.apply(widened, ctx));
        }
      }
    }
    return result;
  }

  /**
   * Saves a model list as either a name-keyed dictionary (the default) or a flat
   * array, honouring {@link SaveContext#collectionFormat} and
   * {@link SaveContext#useShorthand}.
   *
   * <p>The object form is only usable when every item carries a name, so a list
   * with an unnamed item falls back to the array form rather than collapsing
   * entries onto a shared key.
   *
   * <p>This is a deliberate, documented divergence: the C# runtime throws on an
   * unnamed item and the Rust runtime silently drops it. Both lose data for a
   * document that the load side accepts. Falling back to the array form is
   * lossless and reloads identically, and every well-formed document — where
   * each entry has a name — serializes the same way in all three runtimes.
   */
  static <T> Object saveList(List<T> items, String shorthand, Function<T, Map<String, Object>> saver, SaveContext ctx) {
    List<Map<String, Object>> saved = new ArrayList<>();
    for (T item : items) {
      saved.add(saver.apply(item));
    }
    if (!"object".equals(ctx.collectionFormat) || !allNamed(saved)) {
      return new ArrayList<Object>(saved);
    }
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map<String, Object> item : saved) {
      String key = String.valueOf(item.remove("name"));
      if (ctx.useShorthand && shorthand != null && item.size() == 1 && item.containsKey(shorthand)) {
        result.put(key, item.get(shorthand));
      } else {
        result.put(key, item);
      }
    }
    return result;
  }

  private static boolean allNamed(List<Map<String, Object>> items) {
    for (Map<String, Object> item : items) {
      if (!(item.get("name") instanceof String name) || name.isEmpty()) {
        return false;
      }
    }
    return true;
  }

  private static boolean isSequence(Object value) {
    return value instanceof Iterable<?> || value instanceof Object[];
  }

  /**
   * Widens a list element into a loadable map. Scalars go through the shorthand
   * property; empty and absent values are dropped, matching Prompty.Core's
   * {@code GetDictionary} + {@code Count > 0} guard.
   */
  private static Object widen(Object item, String shorthand) {
    if (item instanceof Map<?, ?> map) {
      return map.isEmpty() ? null : map;
    }
    if (item == null || shorthand == null) {
      return null;
    }
    Map<String, Object> wrapped = new LinkedHashMap<>();
    wrapped.put(shorthand, item);
    return wrapped;
  }
}
`;
  units.set("ModelCollections", { path: join(root, "ModelCollections.java"), text: source });
}

// ---------------------------------------------------------------------------
// Guards — fail loudly when a rewrite stops matching emitter output
// ---------------------------------------------------------------------------

/**
 * Every rewrite here targets a specific emitter code shape. If the emitter
 * changes, a silent no-op would produce Java that still compiles but no longer
 * matches the reference runtimes. Assert the expected shapes were found.
 */
function assertRewritesApplied(stats, classes) {
  const problems = [];
  if (stats.misses.length > 0) {
    problems.push(
      `these classes declare load() but their field-population block was not recognised: ${stats.misses.join(", ")}`,
    );
  }
  problems.push(...stats.problems);
  for (const [key, minimum] of Object.entries(EXPECTED_MINIMUMS)) {
    if (stats[key] < minimum) {
      problems.push(`rewrite '${key}' matched ${stats[key]} sites, expected at least ${minimum}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      "Java normalization no longer matches emitter output:\n  - " +
        problems.join("\n  - ") +
        "\nThe @typra/emitter Java backend changed; review schema/scripts/normalize-java-output.mjs.",
    );
  }
}

// Floors that guard against a pass silently matching nothing. The exact counts
// for the save-side rewrites are self-checked against the model shape above, so
// these only need to be low enough to survive ordinary schema additions.
const EXPECTED_MINIMUMS = {
  namedDictionary: 40,
  // Eleven fields carry a named element type: Prompty.inputs/.outputs/.tools,
  // ObjectProperty.properties, Tool.bindings, FunctionTool.parameters,
  // EngineCheckpoint.pendingToolRequests/.completedToolResults,
  // ModelInvocationResponse.toolRequests, TurnEngineResult.toolResults and
  // AnthropicMessagesRequest.tools — matching the eleven "Object format: use
  // name as key" save sites in the generated C#. Each is also checked
  // individually against the TypeSpec, so this floor only catches a field
  // disappearing entirely.
  namedDictionarySave: 11,
  derivedSave: 10,
  scalarShorthand: 1,
  optionalDefaults: 12,
  // Eleven required enum-typed properties: EngineEvent.kind,
  // InvocationContextDecision.disposition, McpApprovalMode.kind,
  // ModelToolResult.outcome, RedactedField.mode, ReplayJournalRecord.kind,
  // ReplayVerificationResult.status, RunTurnResult.status, SessionEvent.type,
  // TurnCommit.status and TurnEvent.type.
  requiredEnums: 11,
  wildcard: 1,
  loadBodies: 100,
};

// ---------------------------------------------------------------------------
// J8 — base-property population and shadowed discriminator fields
// ---------------------------------------------------------------------------

const LOAD_BODY_RE =
  /(\n {4}if \(!\(data instanceof Map<\?, \?> map\)\) \{\n {6}return ctx\.processOutput\(new (\w+)\(\)\);\n {4}\}\n {4}\2 result = new \2\(\);\n)([\s\S]*?)(\n {4}return ctx\.processOutput\(result\);\n {2}\})/u;

function indexClasses(units) {
  const classes = new Map();
  for (const [name, unit] of units) {
    const decl = /^public (abstract )?class (\w+)(?: extends (\w+))? \{$/mu.exec(unit.text);
    if (!decl) {
      continue;
    }
    const enumFields = new Map();
    const fields = new Map();
    for (const match of unit.text.matchAll(/^ {2}public ([\w<>,\[\]. ]+?) (\w+) = (.+);$/gmu)) {
      const [, type, field, initializer] = match;
      fields.set(field, { type, initializer });
      if (/^[A-Z]\w*$/u.test(type)) {
        enumFields.set(field, type);
      }
    }
    classes.set(name, {
      name,
      isAbstract: Boolean(decl[1]),
      base: decl[3] ?? null,
      enumFields,
      fields,
    });
  }
  return classes;
}

function reshapeLoadMethods(units, classes, stats) {
  // Pass 1 — split each class's field-population block into `loadBaseInto`.
  for (const [name, info] of classes) {
    const unit = units.get(name);
    const match = LOAD_BODY_RE.exec(unit.text);
    if (!match) {
      if (unit.text.includes(`public static ${name} load(Object input, LoadContext context) {`)) {
        stats.misses.push(name);
      }
      continue;
    }
    const [whole, prologue, , body, epilogue] = match;
    info.hasLoadBody = true;
    stats.loadBodies += 1;

    const chain = info.base ? `    ${info.base}.loadBaseInto(result, map, ctx);\n` : "";

    const helper =
      `\n  static void loadBaseInto(${name} result, Map<?, ?> map, LoadContext ctx) {\n` +
      `${chain}${body.replace(/^\n/u, "")}\n  }\n`;

    let replacement;
    if (info.isAbstract) {
      replacement =
        `\n    throw new IllegalArgumentException(` +
        `"Missing ${name} discriminator property: 'kind'");\n  }`;
    } else {
      replacement =
        `${prologue}    ${name}.loadBaseInto(result, map, ctx);${epilogue}`;
    }

    unit.text = unit.text.replace(whole, `${replacement}${helper}`);
  }

  // Pass 2 — remove shadowed field declarations, seeding defaults in the ctor.
  for (const [name, info] of classes) {
    if (!info.base) {
      continue;
    }
    const baseInfo = classes.get(info.base);
    if (!baseInfo) {
      continue;
    }
    const unit = units.get(name);
    let text = unit.text;
    const seeds = [];
    for (const [field, { type, initializer }] of info.fields) {
      const baseField = baseInfo.fields.get(field);
      if (!baseField || baseField.type !== type) {
        continue;
      }
      text = text.replace(
        new RegExp(`^ {2}public ${escapeRe(type)} ${field} = .+;\\n`, "mu"),
        "",
      );
      if (initializer !== "null") {
        seeds.push(`    this.${field} = ${initializer};`);
      }
    }
    if (seeds.length > 0) {
      text = text.replace(
        new RegExp(`^ {2}public ${name}\\(\\) \\{ \\}$`, "mu"),
        `  public ${name}() {\n${seeds.join("\n")}\n  }`,
      );
    }
    unit.text = text;
  }
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

// ---------------------------------------------------------------------------
// Generated tests
// ---------------------------------------------------------------------------

/**
 * The Java backend emits example-driven test classes that expose a
 * package-private `run()` entry point rather than JUnit methods. Apply the same
 * structural renames used on the model, drop classes whose `run()` body is
 * empty, and emit a deterministic registry so a hand-written JUnit test can
 * execute every generated example as its own test case.
 */
export function normalizeJavaTests(root, model) {
  if (!existsSync(root)) {
    return;
  }
  const renames = model?.renames ?? new Map();
  const classes = model?.classes ?? new Map();
  const stats = { doubleEscaped: 0 };

  const runnable = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith("GeneratedTest.java")) {
      continue;
    }
    const path = join(root, name);
    let text = readFileSync(path, "utf8");

    for (const [from, to] of renames) {
      text = withLiteralsMasked(text, (code) => code.replace(new RegExp(`\\b${from}\\b`, "gu"), to));
    }
    text = fixReservedFieldNames(text);
    text = relaxEnumAssertions(text);
    text = fixDoubleEscapedExpectations(text, stats);
    text = dropStructuredAssertions(text, classes, name.replace(/GeneratedTest\.java$/u, ""));

    const body = /\n {2}static void run\(\) \{\n([\s\S]*?)\n {2}\}\n/u.exec(text);
    if (!body || body[1].trim() === "") {
      unlinkSync(path);
      continue;
    }

    writeFileSync(path, text);
    runnable.push(name.replace(/\.java$/u, ""));
  }

  runnable.sort();
  const entries = runnable.map((name) => `    cases.put("${name}", ${name}::run);`).join("\n");
  writeFileSync(
    join(root, `${REGISTRY_CLASS}.java`),
    "// <auto-generated by typra-emitter>\n" +
      "// Code generated by Typra emitter; DO NOT EDIT.\n" +
      "package com.microsoft.prompty.model;\n\n" +
      "import java.util.LinkedHashMap;\n" +
      "import java.util.Map;\n\n" +
      `public final class ${REGISTRY_CLASS} {\n` +
      `  private ${REGISTRY_CLASS}() { }\n\n` +
      "  public static Map<String, Runnable> all() {\n" +
      "    Map<String, Runnable> cases = new LinkedHashMap<>();\n" +
      `${entries}\n` +
      "    return cases;\n" +
      "  }\n" +
      "}\n",
  );

  // If the emitter ever stops double-escaping, this pass would start decoding
  // legitimate literals. Fail loudly rather than silently corrupting them.
  if (stats.doubleEscaped < MINIMUM_DOUBLE_ESCAPED) {
    throw new Error(
      `Java test normalization no longer matches emitter output:\n` +
        `  - collapsed ${stats.doubleEscaped} double-escaped expectations, expected at least ${MINIMUM_DOUBLE_ESCAPED}\n` +
        `  The @typra/emitter Java backend changed; review schema/scripts/normalize-java-output.mjs.`,
    );
  }
}

const MINIMUM_DOUBLE_ESCAPED = 5;

const REGISTRY_CLASS = "GeneratedModelExamples";

/**
 * Expected values passed to `assertEquals` are escaped twice: once for the wire
 * representation and once for the Java literal. Collapse the extra level so the
 * expectation matches the value the model actually loads.
 *
 * <p>Only literals that still contain a valid Java escape sequence *after* one
 * decode carry the double-escape signature, so an ordinary literal is left
 * untouched.
 *
 * <p>LIMITATION: a literal whose intended value genuinely contains a backslash
 * followed by an escape character (`"\\n"` meaning the two characters `\` and
 * `n`) is indistinguishable from a double-escaped newline. No such value exists
 * in the current examples, and the caller asserts the collapse count stays
 * above a floor, so if the emitter ever stops double-escaping this pass fails
 * loudly instead of silently corrupting expectations.
 */
function fixDoubleEscapedExpectations(text, stats) {
  return text.replace(/(\bassertEquals\()("(?:[^"\\\n]|\\.)*")/gu, (whole, prefix, literal) => {
    const once = javaUnescape(literal.slice(1, -1));
    if (!/\\(["'\\ntrbfs0]|u[0-9a-fA-F]{4})/u.test(once)) {
      return whole;
    }
    if (stats) {
      stats.doubleEscaped += 1;
    }
    return `${prefix}"${javaEscape(javaUnescape(once))}"`;
  });
}


function javaUnescape(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/gu, (whole, escape) => {
    switch (escape[0]) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "s":
        return " ";
      case "0":
        return "\0";
      case "\\":
      case '"':
      case "'":
        return escape;
      case "u":
        return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
      default:
        return whole;
    }
  });
}

function javaEscape(value) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t");
}

/**
 * Named-dictionary properties are modelled as `List<T>` in Java and nested
 * models as object references, but the emitter still generates assertions that
 * compare them against scalar wire values. Resolve each accessor chain against
 * the model and drop only the assertions whose target is not a scalar.
 */
function dropStructuredAssertions(text, classes, rootClass) {
  const fields = classes.get(rootClass);
  if (!fields) {
    return text;
  }
  return text
    .split("\n")
    .filter((line) => {
      if (!line.trimStart().startsWith("assert")) {
        return true;
      }
      const accessor = /\bassert\w*\([^,]*,\s*\w+\d*((?:\.\w+)+),/u.exec(line);
      if (!accessor) {
        return true;
      }
      return isScalarPath(classes, rootClass, accessor[1].slice(1).split("."));
    })
    .join("\n");
}

function isScalarPath(classes, className, path) {
  let fields = classes.get(className);
  for (let index = 0; index < path.length; index += 1) {
    if (!fields) {
      // Unknown owner: keep the assertion rather than silently dropping coverage.
      return true;
    }
    const type = fields.get(path[index]);
    if (type === undefined) {
      return true;
    }
    const last = index === path.length - 1;
    if (type.startsWith("List<") || type.startsWith("Map<")) {
      // Collections are never addressable with a dotted accessor, and comparing
      // one against a scalar wire value is always wrong.
      return false;
    }
    if (classes.has(type)) {
      if (last) {
        return false;
      }
      fields = classes.get(type);
      continue;
    }
    return last;
  }
  return true;
}

/**
 * Generated examples compare enum-typed fields against their raw wire strings.
 * Teach the emitted `assertEquals` helper to unwrap enum constants first.
 */
function relaxEnumAssertions(text) {
  return text.replace(
    /( {2}private static void assertEquals\(Object expected, Object actual, String message\) \{\n)/u,
    "$1    expected = unwrapEnum(expected);\n    actual = unwrapEnum(actual);\n",
  ).replace(
    /( {2}private static void assertEquals\(Object expected, Object actual, String message\) \{\n)/u,
    "  private static Object unwrapEnum(Object value) {\n" +
      "    if (value == null || !value.getClass().isEnum()) return value;\n" +
      "    try {\n" +
      "      return value.getClass().getField(\"value\").get(value);\n" +
      "    } catch (ReflectiveOperationException ignored) {\n" +
      "      return value;\n" +
      "    }\n" +
      "  }\n\n$1",
  );
}
