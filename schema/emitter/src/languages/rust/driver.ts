import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { resolve } from "path";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import {
  BaseTestContext,
  enumerateTypes,
  TypeNode,
} from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import { TypeRegistry } from "../../ir/expansion.js";
import { RustExprVisitor } from "./visitor.js";
import { buildBaseTestContext, rustTestOptions } from "../../testing/test-context.js";
import { toSnakeCase } from "../../ir/utilities.js";
import { lowerFile, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { emitRustFile as emitRustFileDecl } from "./emitter.js";

/**
 * Type mapping from TypeSpec scalar types to Rust types.
 * Retained for use by the test template context.
 */
export const rustTypeMapper: Record<string, string> = {
  "string": "String",
  "number": "f64",
  "array": "Vec<serde_json::Value>",
  "object": "serde_json::Value",
  "boolean": "bool",
  "int64": "i64",
  "int32": "i32",
  "float64": "f64",
  "float32": "f32",
  "integer": "i64",
  "float": "f64",
  "numeric": "f64",
  "any": "serde_json::Value",
  "dictionary": "serde_json::Value",
};


/**
 * Remove stale flat type files from `relDir` that now live in group subdirectories.
 */
function cleanupFlatTypeFiles(relDir: string | undefined, isTypeFile: (name: string) => boolean): void {
  if (!relDir) return;
  const absDir = resolve(process.cwd(), relDir);
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const absPath = resolve(absDir, name);
    if (statSync(absPath).isFile() && isTypeFile(name)) {
      try { unlinkSync(absPath); } catch { /* ignore — file may be locked */ }
    }
  }
}

/**
 * Main entry point for Rust code generation.
 */
export const generateRust = async (
  context: EmitContext<PromptyEmitterOptions>,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Remove stale flat type files from root output dir (they now live in group subdirs)
  cleanupFlatTypeFiles(emitTarget["output-dir"], name =>
    name.endsWith(".rs") && name !== "context.rs" && name !== "mod.rs" && name !== "lib.rs"
  );
  cleanupFlatTypeFiles(emitTarget["test-dir"], name =>
    name.endsWith(".rs") && name !== "mod.rs" && name !== "main.rs"
  );

  // Build the expression IR infrastructure for this compilation
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = new RustExprVisitor(registry);

  // Collect all polymorphic type names across all nodes
  const polymorphicTypeNames = new Set<string>();
  for (const n of nodes) {
    for (const name of collectPolymorphicTypeNames(n, registry)) {
      polymorphicTypeNames.add(name);
    }
  }
  // Build a map from polymorphic child type names to their parent type names.
  // In Rust, child types become enum variants, not standalone structs.
  // When importing a child type, we need to import ParentKind instead.
  const childToParent = new Map<string, string>();
  for (const n of nodes) {
    if (n.discriminator && n.childTypes.length > 0) {
      for (const child of n.childTypes) {
        childToParent.set(child.typeName.name, n.typeName.name);
      }
    }
  }

  // Render context.rs
  const contextContent = emitRustContext("Prompty Context");
  await emitRustFile(context, 'context.rs', contextContent, emitTarget["output-dir"]);

  // Group root nodes by semantic group folder
  const groupMap = new Map<string, TypeNode[]>();
  for (const n of nodes) {
    if (!n.base) {
      const g = n.group || "";
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g)!.push(n);
    }
  }

  // Render each base type and its children as a single file, into group subfolder
  const groupModuleNames = new Map<string, string[]>(); // group → module names
  const testGroupModuleNames = new Map<string, string[]>(); // group → test module names
  for (const n of nodes) {
    if (!n.base) {
      const group = n.group || "";
      const fileDecl = lowerFile(n, registry, polymorphicTypeNames);
      const fileContent = emitRustFileDecl(fileDecl, visitor, polymorphicTypeNames, childToParent);
      const fileName = toSnakeCase(n.typeName.name) + '.rs';
      const outDir = group ? `${emitTarget["output-dir"]}/${group}` : emitTarget["output-dir"];
      await emitRustFile(context, fileName, fileContent, outDir);

      if (!groupModuleNames.has(group)) groupModuleNames.set(group, []);
      groupModuleNames.get(group)!.push(toSnakeCase(n.typeName.name));
    }

    // Render test file — skip children of polymorphic hierarchies (they're enum variants now) and protocols
    if (emitTarget["test-dir"] && !childToParent.has(n.typeName.name) && !n.isProtocol) {
      const importPath = emitTarget["import-path"] || "crate";
      const testContext = buildTestContext(n);
      const isPolymorphicBase = !!(n.discriminator && n.childTypes.length > 0);
      const testContent = emitRustTest({
        ...testContext,
        importPath,
        isPolymorphicBase,
      });
      const testFileName = toSnakeCase(n.typeName.name) + '_test.rs';
      const testGroup = n.group || "";
      const testDir = testGroup ? `${emitTarget["test-dir"]}/${testGroup}` : emitTarget["test-dir"];
      await emitRustFile(context, testFileName, testContent, testDir);
      if (!testGroupModuleNames.has(testGroup)) testGroupModuleNames.set(testGroup, []);
      testGroupModuleNames.get(testGroup)!.push(toSnakeCase(n.typeName.name) + '_test');
    }
  }

  // Render per-group mod.rs files (source)
  for (const [group, modules] of groupModuleNames) {
    if (!group) continue; // Root-level types handled in root mod.rs
    const groupModContent = emitRustGroupMod(modules);
    await emitRustFile(context, 'mod.rs', groupModContent, `${emitTarget["output-dir"]}/${group}`);
  }

  // Render test group mod.rs files and test main.rs
  if (emitTarget["test-dir"]) {
    // Emit per-group mod.rs (test)
    const testGroups: string[] = [];
    for (const [group, testMods] of testGroupModuleNames) {
      if (group) {
        const groupModContent = '// Code generated by AgentSchema emitter; DO NOT EDIT.\n\n'
          + testMods.map(m => `mod ${m};`).join('\n') + '\n';
        await emitRustFile(context, 'mod.rs', groupModContent, `${emitTarget["test-dir"]}/${group}`);
        testGroups.push(group);
      }
    }
    // Emit root-level test files (no group)
    const rootTestMods = testGroupModuleNames.get("") || [];
    const allTopLevel = [...rootTestMods.map(m => `mod ${m};`), ...testGroups.sort().map(g => `mod ${g};`)];
    const mainContent = '// Code generated by AgentSchema emitter; DO NOT EDIT.\n\n'
      + allTopLevel.join('\n') + '\n';
    await emitRustFile(context, 'main.rs', mainContent, emitTarget["test-dir"]);
  }

  // Render root mod.rs
  const rootModules = groupModuleNames.get("") || [];
  const groups = Array.from(groupModuleNames.keys()).filter(g => g !== "").sort();
  const libContent = emitRustLib(['context', ...rootModules], groups);
  await emitRustFile(context, 'mod.rs', libContent, emitTarget["output-dir"]);

  // Format emitted files
  if (emitTarget.format !== false) {
    const outputDir = emitTarget["output-dir"]
      ? resolve(process.cwd(), emitTarget["output-dir"])
      : context.emitterOutputDir;
    formatRustFiles(outputDir);
  }
};

/**
 * Format Rust files using cargo fmt.
 */
function formatRustFiles(outputDir: string): void {
  // Run cargo fmt if Cargo.toml exists in parent
  const cargoToml = resolve(outputDir, '../Cargo.toml');
  if (existsSync(cargoToml)) {
    try {
      execFileSync("cargo", ["fmt", "--manifest-path", cargoToml], {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: cargo fmt failed. You may need to install Rust.`);
    }
  }
}

/**
 * Build context for rendering a test file.
 */
function buildTestContext(node: TypeNode): BaseTestContext {
  return buildBaseTestContext(node, undefined, rustTestOptions);
}

/**
 * Write generated Rust content to file.
 */
async function emitRustFile(
  context: EmitContext<PromptyEmitterOptions>,
  filename: string,
  content: string,
  outputDir?: string
): Promise<void> {
  outputDir = outputDir || `${context.emitterOutputDir}/rust`;
  const filePath = resolvePath(outputDir, filename);
  await emitFile(context.program, {
    path: filePath,
    content,
  });
}

/**
 * Emit the context.rs file content (LoadContext/SaveContext structs).
 */
function emitRustContext(header: string): string {
  return `// Code generated by AgentSchema emitter; DO NOT EDIT.
// ${header}

/// Callback type for pre-processing input data before parsing.
pub type PreProcessFn = Box<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>;

/// Callback type for post-processing the result after instantiation.
pub type PostProcessFn = Box<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>;

/// Callback type for pre-processing an object before serialization.
pub type PreSaveFn = Box<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>;

/// Callback type for post-processing a dictionary after serialization.
pub type PostSaveFn = Box<dyn Fn(serde_json::Value) -> serde_json::Value + Send + Sync>;

/// Context for customizing the loading process of agent definitions.
///
/// Provides hooks for pre-processing input data before parsing and
/// post-processing output data after instantiation.
pub struct LoadContext {
    /// Optional callback to transform input data before parsing.
    pub pre_process: Option<PreProcessFn>,
    /// Optional callback to transform the result after instantiation.
    pub post_process: Option<PostProcessFn>,
}

impl std::fmt::Debug for LoadContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoadContext")
            .field("pre_process", &self.pre_process.as_ref().map(|_| "..."))
            .field("post_process", &self.post_process.as_ref().map(|_| "..."))
            .finish()
    }
}

impl Default for LoadContext {
    fn default() -> Self {
        Self {
            pre_process: None,
            post_process: None,
        }
    }
}

impl LoadContext {
    /// Create a new empty LoadContext.
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply pre-processing to input data if a pre_process callback is set.
    ///
    /// # Arguments
    /// * \`data\` - The raw input value to process.
    ///
    /// # Returns
    /// The processed value, or the original if no callback is set.
    pub fn process_input(&self, data: serde_json::Value) -> serde_json::Value {
        if let Some(ref f) = self.pre_process {
            f(data)
        } else {
            data
        }
    }

    /// Apply post-processing to the result if a post_process callback is set.
    ///
    /// # Arguments
    /// * \`result\` - The instantiated value to process.
    ///
    /// # Returns
    /// The processed result, or the original if no callback is set.
    pub fn process_output(&self, result: serde_json::Value) -> serde_json::Value {
        if let Some(ref f) = self.post_process {
            f(result)
        } else {
            result
        }
    }
}

/// Context for customizing the serialization process of agent definitions.
///
/// Provides hooks for pre-processing the object before serialization and
/// post-processing the dictionary after serialization.
pub struct SaveContext {
    /// Optional callback to transform the object before serialization.
    pub pre_save: Option<PreSaveFn>,
    /// Optional callback to transform the dictionary after serialization.
    pub post_save: Option<PostSaveFn>,
    /// Output format for collections: "object" (name as key) or "array" (list of dicts).
    /// Defaults to "object".
    pub collection_format: String,
    /// Use shorthand scalar representation when possible.
    /// Defaults to true.
    pub use_shorthand: bool,
}

impl std::fmt::Debug for SaveContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SaveContext")
            .field("pre_save", &self.pre_save.as_ref().map(|_| "..."))
            .field("post_save", &self.post_save.as_ref().map(|_| "..."))
            .field("collection_format", &self.collection_format)
            .field("use_shorthand", &self.use_shorthand)
            .finish()
    }
}

impl Default for SaveContext {
    fn default() -> Self {
        Self {
            pre_save: None,
            post_save: None,
            collection_format: "object".to_string(),
            use_shorthand: true,
        }
    }
}

impl SaveContext {
    /// Create a new SaveContext with defaults.
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply pre-processing to the object if a pre_save callback is set.
    ///
    /// # Arguments
    /// * \`obj\` - The value to process before serialization.
    ///
    /// # Returns
    /// The processed value, or the original if no callback is set.
    pub fn process_object(&self, obj: serde_json::Value) -> serde_json::Value {
        if let Some(ref f) = self.pre_save {
            f(obj)
        } else {
            obj
        }
    }

    /// Apply post-processing to the dictionary if a post_save callback is set.
    ///
    /// # Arguments
    /// * \`data\` - The serialized value to process.
    ///
    /// # Returns
    /// The processed value, or the original if no callback is set.
    pub fn process_dict(&self, data: serde_json::Value) -> serde_json::Value {
        if let Some(ref f) = self.post_save {
            f(data)
        } else {
            data
        }
    }

    /// Convert a value to a YAML string.
    pub fn to_yaml(&self, data: &serde_json::Value) -> Result<String, serde_yaml::Error> {
        serde_yaml::to_string(data)
    }

    /// Convert a value to a JSON string.
    pub fn to_json(&self, data: &serde_json::Value, indent: bool) -> Result<String, serde_json::Error> {
        if indent {
            serde_json::to_string_pretty(data)
        } else {
            serde_json::to_string(data)
        }
    }
}
`;
}

/**
 * Emit the root mod.rs file content (module declarations).
 *
 * @param rootModules - Module names emitted directly in the root (e.g. ["context"])
 * @param groups - Group subfolder names (e.g. ["connection", "tools"])
 */
function emitRustLib(rootModules: string[], groups: string[] = []): string {
  let out = '// Code generated by AgentSchema emitter; DO NOT EDIT.\n';
  for (const module of rootModules) {
    out += `\npub mod ${module};\npub use ${module}::*;\n`;
  }
  for (const group of groups) {
    out += `\npub mod ${group};\npub use ${group}::*;\n`;
  }
  return out;
}

/**
 * Emit a per-group mod.rs file that declares and re-exports all modules in that group.
 */
function emitRustGroupMod(moduleNames: string[]): string {
  let out = '// Code generated by AgentSchema emitter; DO NOT EDIT.\n';
  for (const module of moduleNames) {
    out += `\npub mod ${module};\npub use ${module}::*;\n`;
  }
  return out;
}

/**
 * Map a factory parameter type string to a Rust test value literal.
 */
function factoryParamTestValue(typeStr: string): string {
  switch (typeStr) {
    case "string": return '"test".to_string()';
    case "boolean": return "true";
    case "integer":
    case "int32": return "42";
    case "int64": return "42i64";
    case "float":
    case "float64": return "3.14";
    case "unknown": return 'serde_json::json!("test")';
    default: return 'serde_json::json!("test")';
  }
}

interface RustTestContext extends BaseTestContext {
  importPath: string;
  isPolymorphicBase: boolean;
}

/**
 * Emit an integration test file for a TypeSpec model type.
 */
function emitRustTest(ctx: RustTestContext): string {
  const { node, isAbstract, examples, coercions, factories, importPath, isPolymorphicBase } = ctx;
  const typeName = node.typeName.name;
  const snakeName = toSnakeCase(typeName);
  let out = '';

  // Collect enum types referenced in properties (for use imports)
  const enumImports = new Set<string>();
  for (const prop of node.properties) {
    if (prop.enumName && node.discriminator !== prop.name) {
      enumImports.add(prop.enumName);
    }
  }

  out += '// Code generated by AgentSchema emitter; DO NOT EDIT.\n';
  out += '\n';
  out += `use ${importPath}::${typeName};\n`;
  for (const enumName of [...enumImports].sort()) {
    if (enumName !== typeName) {
      out += `use ${importPath}::${enumName};\n`;
    }
  }
  out += `use ${importPath}::context::{LoadContext, SaveContext};\n`;
  out += '\n';

  // Example tests (load JSON, load YAML, roundtrip)
  for (let i = 0; i < examples.length; i++) {
    const sample = examples[i];
    const suffix = i === 0 ? '' : `_${i}`;

    // JSON load test
    out += '#[test]\n';
    out += `fn test_${snakeName}_load_json${suffix}() {\n`;
    out += '    let json = r####"\n';
    for (const line of sample.json) {
      out += `${line}\n`;
    }
    out += '"####;\n';
    out += '    let ctx = LoadContext::default();\n';
    out += `    let result = ${typeName}::from_json(json, &ctx);\n`;
    out += '    assert!(result.is_ok(), "Failed to load from JSON: {:?}", result.err());\n';
    if (!isAbstract) {
      out += '    let instance = result.unwrap();\n';
      if (sample.validations.length > 0) {
        for (const v of sample.validations) {
          if (v.isOptional) {
            out += `    assert!(instance.${v.key}.is_some(), "Expected ${v.key} to be Some");\n`;
            out += `    assert_eq!(instance.${v.key}.as_ref().unwrap(), &${v.delimiter}${v.value}${v.delimiter});\n`;
          } else if (isPolymorphicBase && v.key === "kind") {
            out += `    assert_eq!(instance.kind_str(), ${v.delimiter}${v.value}${v.delimiter});\n`;
          } else {
            out += `    assert_eq!(instance.${v.key}, ${v.delimiter}${v.value}${v.delimiter});\n`;
          }
        }
      } else {
        out += '    let _ = instance; // load succeeded, no scalar properties to validate\n';
      }
    }
    out += '}\n';
    out += '\n';

    // YAML load test
    out += '#[test]\n';
    out += `fn test_${snakeName}_load_yaml${suffix}() {\n`;
    out += '    let yaml = r####"\n';
    for (const line of sample.yaml) {
      out += `${line}\n`;
    }
    out += '"####;\n';
    out += '    let ctx = LoadContext::default();\n';
    out += `    let result = ${typeName}::from_yaml(yaml, &ctx);\n`;
    out += '    assert!(result.is_ok(), "Failed to load from YAML: {:?}", result.err());\n';
    if (!isAbstract) {
      out += '    let instance = result.unwrap();\n';
      if (sample.validations.length > 0) {
        for (const v of sample.validations) {
          if (v.isOptional) {
            out += `    assert!(instance.${v.key}.is_some(), "Expected ${v.key} to be Some");\n`;
          } else if (isPolymorphicBase && v.key === "kind") {
            out += `    assert_eq!(instance.kind_str(), ${v.delimiter}${v.value}${v.delimiter});\n`;
          } else {
            out += `    assert_eq!(instance.${v.key}, ${v.delimiter}${v.value}${v.delimiter});\n`;
          }
        }
      } else {
        out += '    let _ = instance; // load succeeded, no scalar properties to validate\n';
      }
    }
    out += '}\n';
    out += '\n';

    // Roundtrip test
    out += '#[test]\n';
    out += `fn test_${snakeName}_roundtrip${suffix}() {\n`;
    out += '    let json = r####"\n';
    for (const line of sample.json) {
      out += `${line}\n`;
    }
    out += '"####;\n';
    out += '    let load_ctx = LoadContext::default();\n';
    out += `    let result = ${typeName}::from_json(json, &load_ctx);\n`;
    out += '    assert!(result.is_ok(), "Failed to load: {:?}", result.err());\n';
    if (!isAbstract) {
      out += '    let instance = result.unwrap();\n';
      out += '    let save_ctx = SaveContext::default();\n';
      out += '    let json_output = instance.to_json(&save_ctx);\n';
      out += '    assert!(json_output.is_ok(), "Failed to serialize to JSON: {:?}", json_output.err());\n';
    }
    out += '}\n';
    out += '\n';
  }

  // Coercion tests
  for (let i = 0; i < coercions.length; i++) {
    const alt = coercions[i];
    const suffix = i === 0 ? '' : `_${i + 1}`;

    out += '#[test]\n';
    out += `fn test_${snakeName}_from_${alt.title.toLowerCase()}${suffix}() {\n`;
    out += `    let value = serde_json::json!(${alt.value});\n`;
    out += '    let ctx = LoadContext::default();\n';
    out += `    let instance = ${typeName}::load_from_value(&value, &ctx);\n`;
    if (!isAbstract) {
      if (alt.validations.length > 0) {
        for (const item of alt.validations) {
          if (item.isOptional) {
            out += `    assert!(instance.${item.key}.is_some());\n`;
          } else if (isPolymorphicBase && item.key === "kind") {
            out += `    assert_eq!(instance.kind_str(), ${item.delimiter}${item.value}${item.delimiter});\n`;
          } else {
            out += `    assert_eq!(instance.${item.key}, ${item.delimiter}${item.value}${item.delimiter});\n`;
          }
        }
      } else {
        out += '    let _ = instance; // load succeeded, no scalar properties to validate\n';
      }
    } else {
      out += '    let _ = instance; // abstract type, load succeeded\n';
    }
    out += '}\n';
    out += '\n';
  }

  // Factory tests
  for (const factory of factories) {
    const factorySnake = toSnakeCase(factory.name);
    const paramEntries = Object.entries(factory.params);
    const paramValues = paramEntries.map(([, pType]) => factoryParamTestValue(pType)).join(', ');

    out += '#[test]\n';
    out += `fn test_${snakeName}_factory_${factorySnake}() {\n`;
    out += `    let instance = ${typeName}::${factorySnake}(${paramValues});\n`;

    for (const [propName, value] of Object.entries(factory.sets)) {
      if (value === true) {
        out += `    assert!(instance.${toSnakeCase(propName)});\n`;
      } else if (value === false) {
        out += `    assert!(!instance.${toSnakeCase(propName)});\n`;
      }
    }

    for (const [pName] of paramEntries) {
      const prop = node.properties.find(p => p.name === pName);
      if (prop && prop.isOptional) {
        out += `    assert!(instance.${toSnakeCase(pName)}.is_some());\n`;
      }
    }

    out += '}\n';
    out += '\n';
  }

  return out;
}
