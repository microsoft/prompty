import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { EmitTarget, AgentSchemaEmitterOptions } from "./lib.js";
import {
  enumerateTypes,
  PropertyNode,
  TypeNode,
  PythonClassContext,
  PythonFileContext,
  PythonInitContext,
  PythonLoadContextContext,
  BaseTestContext
} from "./ast.js";
import { GeneratorOptions, filterNodes } from "./emitter.js";
import { getCombinations, scalarValue, toSnakeCase } from "./utilities.js";
import { createTemplateEngine } from "./template-engine.js";
import { buildBaseTestContext, pythonTestOptions } from "./test-context.js";
import * as YAML from "yaml";

/**
 * Type mapping from TypeSpec scalar types to Python types.
 * This is passed as data to templates, not used for inline rendering.
 */
export const pythonTypeMapper: Record<string, string> = {
  "string": "str",
  "number": "float",
  "array": "list",
  "object": "dict",
  "boolean": "bool",
  "int64": "int",
  "int32": "int",
  "float64": "float",
  "float32": "float",
  "integer": "int",
  "float": "float",
  "numeric": "float",
  "any": "Any",
  "dictionary": "dict[str, Any]",
};

/**
 * Main entry point for Python code generation.
 * Prepares pure data contexts and delegates rendering to Nunjucks templates.
 */
export const generatePython = async (
  context: EmitContext<AgentSchemaEmitterOptions>,
  templateDir: string,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  // Create template engine with Python templates + shared macros
  const engine = createTemplateEngine(templateDir, 'python');

  const nodes = filterNodes(Array.from(enumerateTypes(node)), options);

  // Determine package name from root node namespace (e.g., "AgentSchema" -> "agentschema")
  const packageName = node.typeName.namespace.toLowerCase();

  // Emit py.typed marker for PEP 561 compliance
  await emitPythonFile(context, 'py.typed', '', emitTarget["output-dir"]);

  // Render LoadContext file
  const contextContext = buildLoadContextContext();
  const contextContent = engine.render('context.py.njk', contextContext);
  await emitPythonFile(context, '_context.py', contextContent, emitTarget["output-dir"]);

  // Render LoadContext tests
  if (emitTarget["test-dir"]) {
    const testContextContext = buildLoadContextContext(packageName);
    const testContextContent = engine.render('test_context.py.njk', testContextContext);
    await emitPythonFile(context, 'test_context.py', testContextContent, emitTarget["test-dir"]);
  }

  // Render init file
  const initContext = buildInitContext(nodes);
  const initContent = engine.render('init.py.njk', initContext);
  await emitPythonFile(context, '__init__.py', initContent, emitTarget["output-dir"]);

  // Render each base type and its children as a single file
  for (const n of nodes) {
    // Skip child types - they're rendered with their parent
    if (!n.base) {
      const fileContext = buildFileContext(n);
      const fileContent = engine.render('file.py.njk', fileContext);
      await emitPythonFile(context, `_${n.typeName.name}.py`, fileContent, emitTarget["output-dir"]);
    }

    // Render test file for each type
    if (emitTarget["test-dir"]) {
      const testContext = buildTestContext(n, packageName);
      const testContent = engine.render('test.py.njk', testContext);
      await emitPythonFile(context, `test_${toSnakeCase(n.typeName.name)}.py`, testContent, emitTarget["test-dir"]);
    }
  }

  // Format emitted files if format option is enabled (default: true)
  if (emitTarget.format !== false) {
    // Resolve output paths relative to current working directory (where tsp compile was run)
    const outputDir = emitTarget["output-dir"]
      ? resolve(process.cwd(), emitTarget["output-dir"])
      : context.emitterOutputDir;
    const testDir = emitTarget["test-dir"]
      ? resolve(process.cwd(), emitTarget["test-dir"])
      : undefined;

    formatPythonFiles(outputDir, testDir);
  }
};

/**
 * Format Python files using ruff and black formatters.
 * Runs formatters via uv from the Python project root (where pyproject.toml is located).
 */
function formatPythonFiles(outputDir: string, testDir?: string): void {
  // Find the Python project root by looking for pyproject.toml
  const projectRoot = findPythonProjectRoot(outputDir);
  if (!projectRoot) {
    console.warn(`Warning: Could not find pyproject.toml. Skipping formatting.`);
    return;
  }

  const dirs = [outputDir, ...(testDir ? [testDir] : [])];

  for (const dir of dirs) {
    // Run ruff check with auto-fix
    try {
      execSync(`uv run ruff check --fix "${dir}"`, {
        cwd: projectRoot,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: ruff formatting failed for ${dir}. You may need to install ruff or run it manually.`);
    }

    // Run black formatter
    try {
      execSync(`uv run black "${dir}"`, {
        cwd: projectRoot,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: black formatting failed for ${dir}. You may need to install black or run it manually.`);
    }
  }
}

/**
 * Find the Python project root by traversing up from the output directory
 * looking for pyproject.toml.
 */
function findPythonProjectRoot(startDir: string): string | undefined {
  let currentDir = resolve(startDir);
  const root = resolve('/');

  // On Windows, also check for drive root (e.g., "C:\")
  while (currentDir !== root && currentDir !== dirname(currentDir)) {
    const pyprojectPath = resolve(currentDir, 'pyproject.toml');
    if (existsSync(pyprojectPath)) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return undefined;
}

/**
 * Build context for rendering a single Python class.
 */
function buildClassContext(node: TypeNode): PythonClassContext {
  return {
    node,
    typeMapper: pythonTypeMapper,
    alternates: prepareAlternates(node),
    polymorphicTypes: node.retrievePolymorphicTypes(),
    imports: getUniqueImportTypes(node),
    collectionTypes: getCollectionTypes(node),
    shorthandProperty: getShorthandProperty(node),
  };
}

/**
 * Build context for rendering a Python file with a base type and its children.
 */
function buildFileContext(node: TypeNode): PythonFileContext {
  // Build class contexts for this node and all its children
  const classes: PythonClassContext[] = [
    buildClassContext(node),
    ...node.childTypes.map(ct => buildClassContext(ct))
  ];

  return {
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
    typings: ["Any", "Callable", "Optional"],
    imports: getUniqueImportTypes(node),
    classes,
    typeMapper: pythonTypeMapper,
  };
}

/**
 * Build context for rendering the __init__.py file.
 */
function buildInitContext(nodes: TypeNode[]): PythonInitContext {
  return {
    baseTypes: nodes.filter(n => !n.base),
    types: nodes,
  };
}

/**
 * Build context for rendering a test file using the standardized shared helper.
 */
function buildTestContext(node: TypeNode, packageName: string): BaseTestContext {
  return buildBaseTestContext(node, packageName, pythonTestOptions);
}

/**
 * Build context for rendering the LoadContext file.
 */
function buildLoadContextContext(packageName?: string): PythonLoadContextContext {
  return {
    header: "AgentSchema LoadContext",
    package: packageName,
  };
}

/**
 * Prepare alternate representations for template rendering.
 * Converts alternates to Python-specific format with JSON stringification.
 */
function prepareAlternates(node: TypeNode): Array<{ scalar: string; alternate: string }> {
  if (!node.alternates || node.alternates.length === 0) {
    return [];
  }

  return node.alternates.map(alt => ({
    scalar: pythonTypeMapper[alt.scalar],
    alternate: JSON.stringify(alt.expansion, null, '')
      .replaceAll('\n', '')
      .replaceAll('"{value}"', ' data'),
  }));
}

/**
 * Get the shorthand property name from alternates.
 * The shorthand property is the one that receives "{value}" in the expansion.
 */
function getShorthandProperty(node: TypeNode): string | null {
  if (!node.alternates || node.alternates.length === 0) {
    return null;
  }

  // Look for a property that has "{value}" as its expansion value
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
 * Get collection properties with their nested type info for load_* methods.
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
 * Excludes self-references and parent types.
 */
function getUniqueImportTypes(node: TypeNode): string[] {
  const imports = [
    node.properties.filter(p => !p.isScalar && !p.isDict).map(p => p.typeName.name),
    ...node.childTypes.flatMap(c =>
      c.properties.filter(p => !p.isScalar && !p.isDict).map(p => p.typeName.name)
    )
  ].flat().filter(n => n !== node.typeName.name && node.base?.name !== n);

  // Remove duplicates and sort
  return Array.from(new Set(imports)).sort();
}

/**
 * Write generated Python content to file using TypeSpec's emitFile API.
 */
async function emitPythonFile(
  context: EmitContext<AgentSchemaEmitterOptions>,
  filename: string,
  content: string,
  outputDir?: string
): Promise<void> {
  outputDir = outputDir || `${context.emitterOutputDir}/python`;
  const filePath = resolvePath(outputDir, filename);

  await emitFile(context.program, {
    path: filePath,
    content,
  });
}

