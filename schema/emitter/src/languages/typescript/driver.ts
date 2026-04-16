import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import { enumerateTypes, TypeNode, BaseTestContext } from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import { TypeRegistry } from "../../ir/expansion.js";
import { TypeScriptExprVisitor } from "./visitor.js";
import { emitTypeScriptFile as emitTypeScriptFileDecl } from "./emitter.js";
import { emitTypeScriptContext, emitTypeScriptIndex, emitEslintConfig } from "./scaffolding.js";
import { emitTypeScriptTest } from "./test-emitter.js";
import { lowerFile, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { buildBaseTestContext, typescriptTestOptions } from "../../testing/test-context.js";
import { toKebabCase } from "../../ir/utilities.js";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";

/**
 * Generate TypeScript code from TypeSpec models.
 */
export const generateTypeScript = async (
  context: EmitContext<PromptyEmitterOptions>,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
) => {
  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Build the expression IR infrastructure
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = new TypeScriptExprVisitor(registry);

  // Determine namespace: use override or default
  const originalNamespace = node.typeName.namespace;
  const tsNamespace = emitTarget.namespace ?? originalNamespace.replace(/\.Core$/, "");

  // Emit context classes (LoadContext, SaveContext)
  const contextCode = emitTypeScriptContext();
  await emitTypeScriptFile(context, "context.ts", contextCode, emitTarget["output-dir"]);

  // Collect polymorphic type names once for the full type graph
  const polymorphicTypeNames = new Set<string>();
  for (const n of allTypes) {
    for (const name of collectPolymorphicTypeNames(n, registry)) {
      polymorphicTypeNames.add(name);
    }
  }

  // Emit each base type file (includes children in the same file)
  for (const n of nodes) {
    // Skip child types - they're rendered with their parent
    if (n.base) {
      continue;
    }

    const fileDecl = lowerFile(n, registry, polymorphicTypeNames);
    const code = emitTypeScriptFileDecl(fileDecl, visitor, tsNamespace);
    await emitTypeScriptFile(context, `${toKebabCase(n.typeName.name)}.ts`, code, emitTarget["output-dir"]);
  }

  // Emit test files for all types
  if (emitTarget["test-dir"]) {
    const importPath = emitTarget["import-path"] || "../src/index";
    for (const n of nodes) {
      const testContext = buildTestContext(n);
      const testCode = emitTypeScriptTest({
        ...testContext,
        importPath,
        namespace: tsNamespace,
      });
      await emitTypeScriptFile(context, `${toKebabCase(n.typeName.name)}.test.ts`, testCode, emitTarget["test-dir"]);
    }
  }

  // Emit index.ts file
  const indexContext = buildIndexContext(nodes);
  const indexCode = emitTypeScriptIndex(indexContext.baseTypes, indexContext.types);
  await emitTypeScriptFile(context, "index.ts", indexCode, emitTarget["output-dir"]);

  // Emit eslint.config.js to project root (parent of output-dir)
  if (emitTarget["output-dir"]) {
    const projectRoot = resolve(process.cwd(), emitTarget["output-dir"], "..");
    const eslintConfigCode = emitEslintConfig();
    await emitTypeScriptFile(context, "eslint.config.js", eslintConfigCode, projectRoot);
  }

  // Format emitted files if format option is enabled (default: true)
  if (emitTarget.format !== false) {
    const outputDir = emitTarget["output-dir"]
      ? resolve(process.cwd(), emitTarget["output-dir"])
      : context.emitterOutputDir;
    const testDir = emitTarget["test-dir"]
      ? resolve(process.cwd(), emitTarget["test-dir"])
      : undefined;

    formatTypeScriptFiles(outputDir, testDir);
  }
};

/**
 * Format TypeScript files using prettier.
 */
function formatTypeScriptFiles(outputDir: string, testDir?: string): void {
  const projectRoot = findTypeScriptProjectRoot(outputDir);
  if (!projectRoot) {
    console.warn(`Warning: Could not find package.json. Skipping formatting.`);
    return;
  }

  const dirs = [outputDir, ...(testDir ? [testDir] : [])];

  for (const dir of dirs) {
    // Run prettier
    try {
      execSync(`npx prettier --write "${dir}/**/*.ts"`, {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch (error) {
      console.warn(`Warning: prettier formatting failed for ${dir}. You may need to install prettier.`);
    }

    // Run eslint fix
    try {
      execSync(`npx eslint --fix "${dir}/**/*.ts"`, {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch (error) {
      // ESLint errors are common, don't warn about them
    }
  }
}

/**
 * Find the TypeScript project root by looking for package.json.
 */
function findTypeScriptProjectRoot(startDir: string): string | undefined {
  let currentDir = resolve(startDir);
  const root = resolve("/");

  while (currentDir !== root && currentDir !== dirname(currentDir)) {
    const packageJsonPath = resolve(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return undefined;
}

/**
 * Build context for rendering the index.ts file.
 */
function buildIndexContext(nodes: TypeNode[]): { baseTypes: TypeNode[]; types: TypeNode[] } {
  return {
    baseTypes: nodes.filter((n) => !n.base),
    types: nodes,
  };
}

/**
 * Build context for rendering a test file.
 */
function buildTestContext(node: TypeNode): BaseTestContext {
  return buildBaseTestContext(node, undefined, typescriptTestOptions);
}

/**
 * Write generated TypeScript content to file.
 */
async function emitTypeScriptFile(
  context: EmitContext<PromptyEmitterOptions>,
  filename: string,
  content: string,
  outputDir?: string
): Promise<void> {
  outputDir = outputDir || `${context.emitterOutputDir}/typescript`;
  const filePath = resolvePath(outputDir, filename);

  await emitFile(context.program, {
    path: filePath,
    content,
  });
}
