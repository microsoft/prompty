import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { EmitTarget, AgentSchemaEmitterOptions } from "./lib.js";
import {
  BaseTestContext,
  enumerateTypes,
  PropertyNode,
  TypeNode,
} from "./ast.js";
import { GeneratorOptions, filterNodes } from "./emitter.js";
import { createTemplateEngine } from "./template-engine.js";
import { buildBaseTestContext, rustTestOptions } from "./test-context.js";
import { toSnakeCase } from "./utilities.js";

/**
 * Type mapping from TypeSpec scalar types to Rust types.
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
 * Rust context interfaces for template rendering
 */
interface RustClassContext {
  node: TypeNode;
  typeMapper: Record<string, string>;
  alternates: Array<{ scalar: string; alternate: string }>;
  polymorphicTypes: any;
  imports: string[];
  collectionTypes: Array<{ prop: PropertyNode; type: string[] }>;
  shorthandProperty: string | null;
}

interface RustFileContext {
  containsAbstract: boolean;
  imports: string[];
  classes: RustClassContext[];
  typeMapper: Record<string, string>;
  polymorphicTypeNames: string[];
}

interface RustContextContext {
  header: string;
}

interface RustLibContext {
  modules: string[];
}

/**
 * Main entry point for Rust code generation.
 */
export const generateRust = async (
  context: EmitContext<AgentSchemaEmitterOptions>,
  templateDir: string,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  const engine = createTemplateEngine(templateDir, 'rust');
  const nodes = filterNodes(Array.from(enumerateTypes(node)), options);

  // Collect all polymorphic type names across all nodes
  const polymorphicTypeNames = new Set<string>();
  for (const n of nodes) {
    const polyTypes = n.retrievePolymorphicTypes();
    if (polyTypes) {
      polymorphicTypeNames.add(n.typeName.name);
    }
  }

  // Render context.rs
  const contextContext = buildContextContext();
  const contextContent = engine.render('context.rs.njk', contextContext);
  await emitRustFile(context, 'context.rs', contextContent, emitTarget["output-dir"]);

  // Render each base type and its children as a single file
  const moduleNames: string[] = ['context'];
  for (const n of nodes) {
    if (!n.base) {
      const fileContext = buildFileContext(n, polymorphicTypeNames);
      const fileContent = engine.render('file.rs.njk', fileContext);
      const fileName = toSnakeCase(n.typeName.name) + '.rs';
      await emitRustFile(context, fileName, fileContent, emitTarget["output-dir"]);
      moduleNames.push(toSnakeCase(n.typeName.name));
    }

    // Render test file
    if (emitTarget["test-dir"]) {
      const testContext = buildTestContext(n);
      const testContent = engine.render('test.rs.njk', testContext);
      const testFileName = toSnakeCase(n.typeName.name) + '_test.rs';
      await emitRustFile(context, testFileName, testContent, emitTarget["test-dir"]);
    }
  }

  // Render lib.rs
  const libContext: RustLibContext = { modules: moduleNames };
  const libContent = engine.render('lib.rs.njk', libContext);
  await emitRustFile(context, 'lib.rs', libContent, emitTarget["output-dir"]);

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
      execSync(`cargo fmt --manifest-path "${cargoToml}"`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: cargo fmt failed. You may need to install Rust.`);
    }
  }
}

/**
 * Build context for rendering a single Rust struct.
 */
function buildClassContext(node: TypeNode, polymorphicTypeNames: Set<string>): RustClassContext {
  return {
    node,
    typeMapper: rustTypeMapper,
    alternates: prepareAlternates(node),
    polymorphicTypes: node.retrievePolymorphicTypes(),
    imports: getUniqueImportTypes(node, polymorphicTypeNames),
    collectionTypes: getCollectionTypes(node),
    shorthandProperty: getShorthandProperty(node),
  };
}

/**
 * Build context for rendering a Rust file with a base type and its children.
 */
function buildFileContext(node: TypeNode, polymorphicTypeNames: Set<string>): RustFileContext {
  const classes: RustClassContext[] = [
    buildClassContext(node, polymorphicTypeNames),
    ...node.childTypes.map(ct => buildClassContext(ct, polymorphicTypeNames))
  ];

  // Collect unique imports from all classes, excluding types defined in this file
  const definedInFile = new Set([node.typeName.name, ...node.childTypes.map(c => c.typeName.name)]);
  const allImports = new Set<string>();
  for (const cls of classes) {
    for (const imp of cls.imports) {
      if (!definedInFile.has(imp)) {
        allImports.add(imp);
      }
    }
  }

  return {
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
    imports: Array.from(allImports).sort(),
    classes,
    typeMapper: rustTypeMapper,
    polymorphicTypeNames: Array.from(polymorphicTypeNames),
  };
}

/**
 * Build context for rendering a test file.
 */
function buildTestContext(node: TypeNode): BaseTestContext {
  return buildBaseTestContext(node, undefined, rustTestOptions);
}

/**
 * Build context for rendering the context.rs file.
 */
function buildContextContext(): RustContextContext {
  return { header: "AgentSchema Context" };
}

/**
 * Prepare alternate representations for template rendering.
 */
function prepareAlternates(node: TypeNode): Array<{ scalar: string; alternate: string }> {
  if (!node.alternates || node.alternates.length === 0) {
    return [];
  }

  return node.alternates.map(alt => ({
    scalar: rustTypeMapper[alt.scalar] || alt.scalar,
    alternate: JSON.stringify(alt.expansion, null, '')
      .replaceAll('\n', '')
      .replaceAll('"{value}"', 'value'),
  }));
}

/**
 * Get the shorthand property name from alternates.
 */
function getShorthandProperty(node: TypeNode): string | null {
  if (!node.alternates || node.alternates.length === 0) {
    return null;
  }
  for (const alt of node.alternates) {
    for (const [key, value] of Object.entries(alt.expansion)) {
      if (value === "{value}") {
        return key;
      }
    }
  }
  return null;
}

/**
 * Get collection properties with their nested type info.
 */
function getCollectionTypes(node: TypeNode): Array<{ prop: PropertyNode; type: string[] }> {
  return node.properties
    .filter(p => p.isCollection && !p.isScalar && !p.isDict)
    .map(p => ({
      prop: p,
      type: p.type?.properties.filter(t => t.name !== "name").map(t => t.name) || [],
    }));
}

/**
 * Get unique import types needed from other modules.
 * Excludes polymorphic types that are not collection fields (stored as serde_json::Value
 * with no typed accessor method).
 */
function getUniqueImportTypes(node: TypeNode, polymorphicTypeNames: Set<string>): string[] {
  const imports = [
    node.properties
      .filter(p => !p.isScalar && !p.isDict)
      // For polymorphic types: only import if it's a collection (needed for typed accessor)
      .filter(p => !polymorphicTypeNames.has(p.typeName.name) || p.isCollection)
      .map(p => p.typeName.name),
    ...node.childTypes.flatMap(c =>
      c.properties
        .filter(p => !p.isScalar && !p.isDict)
        .filter(p => !polymorphicTypeNames.has(p.typeName.name) || p.isCollection)
        .map(p => p.typeName.name)
    )
  ].flat().filter(n => n !== node.typeName.name && node.base?.name !== n);

  return Array.from(new Set(imports)).sort();
}

/**
 * Write generated Rust content to file.
 */
async function emitRustFile(
  context: EmitContext<AgentSchemaEmitterOptions>,
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
