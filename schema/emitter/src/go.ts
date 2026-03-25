import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { EmitTarget, AgentSchemaEmitterOptions } from "./lib.js";
import {
  BaseTestContext,
  enumerateTypes,
  PropertyNode,
  TypeNode,
} from "./ast.js";
import { GeneratorOptions, filterNodes } from "./emitter.js";

import { createTemplateEngine } from "./template-engine.js";
import { buildBaseTestContext, goTestOptions } from "./test-context.js";
import { toSnakeCase } from "./utilities.js";


/**
 * Type mapping from TypeSpec scalar types to Go types.
 */
export const goTypeMapper: Record<string, string> = {
  "string": "string",
  "number": "float64",
  "array": "[]",
  "object": "map[string]interface{}",
  "boolean": "bool",
  "int64": "int64",
  "int32": "int32",
  "float64": "float64",
  "float32": "float32",
  "integer": "int",
  "float": "float64",
  "numeric": "float64",
  "any": "interface{}",
  "dictionary": "map[string]interface{}",
};

/**
 * Go context interfaces for template rendering
 */
interface GoClassContext {
  node: TypeNode;
  typeMapper: Record<string, string>;
  alternates: Array<{ scalar: string; alternate: string }>;
  polymorphicTypes: any;
  imports: string[];
  collectionTypes: Array<{ prop: PropertyNode; type: string[] }>;
  shorthandProperty: string | null;
}

interface GoFileContext {
  containsAbstract: boolean;
  imports: string[];
  classes: GoClassContext[];
  typeMapper: Record<string, string>;
  packageName: string;
  polymorphicTypeNames: string[];
}

interface GoContextContext {
  header: string;
  packageName: string;
}

/**
 * Main entry point for Go code generation.
 */
export const generateGo = async (
  context: EmitContext<AgentSchemaEmitterOptions>,
  templateDir: string,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  // Create template engine with Go templates + shared macros
  const engine = createTemplateEngine(templateDir, 'go');

  const nodes = filterNodes(Array.from(enumerateTypes(node)), options);

  // Determine package name from root node namespace (e.g., "AgentSchema" -> "agentschema")
  const packageName = node.typeName.namespace.toLowerCase().replace(/\./g, '');

  // Collect all polymorphic type names across all nodes
  const polymorphicTypeNames = new Set<string>();
  for (const n of nodes) {
    const polyTypes = n.retrievePolymorphicTypes();
    if (polyTypes) {
      polymorphicTypeNames.add(n.typeName.name);
    }
  }

  // Render context file (LoadContext/SaveContext utilities)
  const contextContext = buildContextContext(packageName);
  const contextContent = engine.render('context.go.njk', contextContext);
  await emitGoFile(context, 'context.go', contextContent, emitTarget["output-dir"]);

  // Render each base type and its children as a single file
  for (const n of nodes) {
    // Skip child types - they're rendered with their parent
    if (!n.base) {
      const fileContext = buildFileContext(n, packageName, polymorphicTypeNames);
      const fileContent = engine.render('file.go.njk', fileContext);
      const fileName = toSnakeCase(n.typeName.name) + '.go';
      await emitGoFile(context, fileName, fileContent, emitTarget["output-dir"]);
    }

    // Render test file for each type
    if (emitTarget["test-dir"]) {
      const testContext = buildTestContext(n, packageName);
      const testContent = engine.render('test.go.njk', testContext);
      const testFileName = toSnakeCase(n.typeName.name) + '_test.go';
      await emitGoFile(context, testFileName, testContent, emitTarget["test-dir"]);
    }
  }

  // Format emitted files if format option is enabled (default: true)
  if (emitTarget.format !== false) {
    const outputDir = emitTarget["output-dir"]
      ? resolve(process.cwd(), emitTarget["output-dir"])
      : context.emitterOutputDir;
    const testDir = emitTarget["test-dir"]
      ? resolve(process.cwd(), emitTarget["test-dir"])
      : undefined;

    formatGoFiles(outputDir, testDir);
  }
};

/**
 * Format Go files using gofmt and goimports.
 */
function formatGoFiles(outputDir: string, testDir?: string): void {
  const dirs = [outputDir, ...(testDir ? [testDir] : [])];

  for (const dir of dirs) {
    // Run gofmt
    try {
      execSync(`gofmt -w "${dir}"`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: gofmt formatting failed for ${dir}. You may need to install Go.`);
    }

    // Run goimports if available
    try {
      execSync(`goimports -w "${dir}"`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      // goimports is optional, don't warn if not available
    }
  }
}

/**
 * Build context for rendering a single Go struct.
 */
function buildClassContext(node: TypeNode): GoClassContext {
  return {
    node,
    typeMapper: goTypeMapper,
    alternates: prepareAlternates(node),
    polymorphicTypes: node.retrievePolymorphicTypes(),
    imports: getUniqueImportTypes(node),
    collectionTypes: getCollectionTypes(node),
    shorthandProperty: getShorthandProperty(node),
  };
}

/**
 * Build context for rendering a Go file with a base type and its children.
 */
function buildFileContext(node: TypeNode, packageName: string, polymorphicTypeNames: Set<string>): GoFileContext {
  const classes: GoClassContext[] = [
    buildClassContext(node),
    ...node.childTypes.map(ct => buildClassContext(ct))
  ];

  return {
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
    imports: getUniqueImportTypes(node),
    classes,
    typeMapper: goTypeMapper,
    packageName,
    polymorphicTypeNames: Array.from(polymorphicTypeNames),
  };
}

/**
 * Build context for rendering a test file.
 */
function buildTestContext(node: TypeNode, packageName: string): BaseTestContext {
  return buildBaseTestContext(node, packageName, goTestOptions);
}

/**
 * Build context for rendering the context.go file.
 */
function buildContextContext(packageName: string): GoContextContext {
  return {
    header: "AgentSchema Context",
    packageName,
  };
}

/**
 * Prepare alternate representations for template rendering.
 */
function prepareAlternates(node: TypeNode): Array<{ scalar: string; alternate: string }> {
  if (!node.alternates || node.alternates.length === 0) {
    return [];
  }

  return node.alternates.map(alt => ({
    scalar: goTypeMapper[alt.scalar],
    alternate: JSON.stringify(alt.expansion, null, '')
      .replaceAll('\n', '')
      .replaceAll('"{value}"', 'v'),
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
 */
function getUniqueImportTypes(node: TypeNode): string[] {
  const imports = [
    node.properties.filter(p => !p.isScalar && !p.isDict).map(p => p.typeName.name),
    ...node.childTypes.flatMap(c =>
      c.properties.filter(p => !p.isScalar && !p.isDict).map(p => p.typeName.name)
    )
  ].flat().filter(n => n !== node.typeName.name && node.base?.name !== n);

  return Array.from(new Set(imports)).sort();
}

/**
 * Write generated Go content to file.
 */
async function emitGoFile(
  context: EmitContext<AgentSchemaEmitterOptions>,
  filename: string,
  content: string,
  outputDir?: string
): Promise<void> {
  outputDir = outputDir || `${context.emitterOutputDir}/go`;
  const filePath = resolvePath(outputDir, filename);

  await emitFile(context.program, {
    path: filePath,
    content,
  });
}
