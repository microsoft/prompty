import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execSync } from "child_process";
import { resolve } from "path";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import {
  BaseTestContext,
  enumerateTypes,
  TypeNode,
} from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";

import { buildBaseTestContext, goTestOptions } from "../../testing/test-context.js";
import { toSnakeCase } from "../../ir/utilities.js";
import { TypeRegistry } from "../../ir/expansion.js";
import { GoExprVisitor } from "./visitor.js";
import { lowerFile, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { emitGoFileContent } from "./emitter.js";
import { emitGoContext } from "./scaffolding.js";
import { emitGoTest } from "./test-emitter.js";


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
 * Main entry point for Go code generation.
 */
export const generateGo = async (
  context: EmitContext<PromptyEmitterOptions>,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Build the expression IR infrastructure
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = new GoExprVisitor(registry);

  // Determine package name from root node namespace (e.g., "Prompty" -> "prompty")
  const packageName = node.typeName.namespace.toLowerCase().replace(/\./g, '');

  // Collect all polymorphic type names across all nodes
  const polymorphicTypeNames = new Set<string>();
  for (const n of nodes) {
    const polyTypes = n.retrievePolymorphicTypes();
    if (polyTypes) {
      polymorphicTypeNames.add(n.typeName.name);
    }
  }

  // Emit context file (LoadContext/SaveContext utilities)
  const contextContent = emitGoContext({ header: "Prompty Context", packageName });
  await emitGoFile(context, 'context.go', contextContent, emitTarget["output-dir"]);

  // Emit each base type and its children as a single file
  for (const n of nodes) {
    // Skip child types - they're rendered with their parent
    if (!n.base) {
      const fileDecl = lowerFile(n, registry, polymorphicTypeNames);
      const fileContent = emitGoFileContent(fileDecl.types, packageName, visitor, polymorphicTypeNames);
      const fileName = toSnakeCase(n.typeName.name) + '.go';
      await emitGoFile(context, fileName, fileContent, emitTarget["output-dir"]);
    }

    // Emit test file for each type (skip protocols — they have no data to test)
    if (emitTarget["test-dir"] && !n.isProtocol) {
      const importPath = emitTarget["import-path"] || packageName;
      const testContext = { ...buildTestContext(n, packageName), importPath };
      const testContent = emitGoTest(testContext);
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
 * Build context for rendering a test file.
 */
function buildTestContext(node: TypeNode, packageName: string): BaseTestContext {
  return buildBaseTestContext(node, packageName, goTestOptions);
}

/**
 * Write generated Go content to file.
 */
async function emitGoFile(
  context: EmitContext<PromptyEmitterOptions>,
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
