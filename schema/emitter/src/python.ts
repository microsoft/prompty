import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { EmitTarget, PromptyEmitterOptions } from "./lib.js";
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
import { resolveFactoryExpr, resolveCoerceExpr, TypeRegistry } from "./expansion.js";
import { getVisitor, ExprVisitor, renderObjectLiteral } from "./render-expr.js";
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
  context: EmitContext<PromptyEmitterOptions>,
  templateDir: string,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  // Create template engine with Python templates + shared macros
  const engine = createTemplateEngine(templateDir, 'python');

  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Build the expression IR infrastructure
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = getVisitor("python", registry);

  // Determine package name from root node namespace (e.g., "Prompty" -> "prompty")
  const packageName = node.typeName.namespace.toLowerCase();

  // Import path for test files — defaults to packageName, can be overridden via import-path config
  const importPath = emitTarget["import-path"] || packageName;

  // Emit py.typed marker for PEP 561 compliance
  await emitPythonFile(context, 'py.typed', '', emitTarget["output-dir"]);

  // Render LoadContext file
  const contextContext = buildLoadContextContext();
  const contextContent = engine.render('context.py.njk', contextContext);
  await emitPythonFile(context, '_context.py', contextContent, emitTarget["output-dir"]);

  // Render LoadContext tests
  if (emitTarget["test-dir"]) {
    const testContextContext = buildLoadContextContext(importPath);
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
      const fileContext = buildFileContext(n, registry, visitor);
      const fileContent = engine.render('file.py.njk', fileContext);
      await emitPythonFile(context, `_${n.typeName.name}.py`, fileContent, emitTarget["output-dir"]);
    }

    // Render test file for each type
    if (emitTarget["test-dir"]) {
      const testContext = buildTestContext(n, importPath);
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
 * Resolves factories and coercions via the expression IR when registry/visitor provided.
 */
function buildClassContext(
  node: TypeNode,
  registry?: TypeRegistry,
  visitor?: ExprVisitor,
): PythonClassContext {
  // Pre-compute safe factory method names to avoid field/classmethod collisions.
  const fieldNames = new Set(node.properties.map(p => toSnakeCase(p.name)));
  const factoryNameMap: Record<string, string> = {};
  for (const factory of node.factories) {
    const snakeName = toSnakeCase(factory.name);
    factoryNameMap[factory.name] = fieldNames.has(snakeName) ? `create_${snakeName}` : snakeName;
  }

  // Resolve factories via expression IR (when registry+visitor available)
  const renderedFactories = (registry && visitor) ? (node.factories || []).map(f => ({
    name: f.name,
    safeName: factoryNameMap[f.name],
    params: f.params,
    body: visitor.visitExpr(resolveFactoryExpr(f.sets, f.params, node, registry)),
  })) : [];

  // Resolve coercions via expression IR
  const renderedCoercions = (registry && visitor) ? (node.coercions || []).map(c => {
    const expr = resolveCoerceExpr(c.expansion, c.scalar, node, registry, "data");
    return {
      scalar: pythonTypeMapper[c.scalar] || c.scalar,
      expression: renderObjectLiteral(expr, visitor, "py"),
    };
  }) : [];

  return {
    node,
    typeMapper: pythonTypeMapper,
    coercions: prepareCoercions(node),
    polymorphicTypes: node.retrievePolymorphicTypes(),
    imports: getUniqueImportTypes(node),
    collectionTypes: getCollectionTypes(node),
    coercionProperty: getCoercionProperty(node),
    factoryNameMap,
    renderedFactories,
    renderedCoercions,
  };
}

/**
 * Build context for rendering a Python file with a base type and its children.
 */
function buildFileContext(
  node: TypeNode,
  registry: TypeRegistry,
  visitor: ExprVisitor,
): PythonFileContext {
  // Build class contexts for this node and all its children
  const classes: PythonClassContext[] = [
    buildClassContext(node, registry, visitor),
    ...node.childTypes.map(ct => buildClassContext(ct, registry, visitor))
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
function buildTestContext(node: TypeNode, packageName: string): BaseTestContext & { classCtx: PythonClassContext } {
  const base = buildBaseTestContext(node, packageName, pythonTestOptions);
  const classCtx = buildClassContext(node);
  return { ...base, classCtx };
}

/**
 * Build context for rendering the LoadContext file.
 */
function buildLoadContextContext(packageName?: string): PythonLoadContextContext {
  return {
    header: "Prompty LoadContext",
    package: packageName,
  };
}

/**
 * Prepare coercion representations for template rendering.
 * Converts coercions to Python-specific format with JSON stringification.
 */
function prepareCoercions(node: TypeNode): Array<{ scalar: string; alternate: string }> {
  if (!node.coercions || node.coercions.length === 0) {
    return [];
  }

  return node.coercions.map(alt => ({
    scalar: pythonTypeMapper[alt.scalar],
    alternate: JSON.stringify(alt.expansion, null, '')
      .replaceAll('\n', '')
      .replaceAll('"{value}"', ' data'),
  }));
}

/**
 * Get the coercion property name from coercions.
 * The coercion property is the one that receives "{value}" in the expansion.
 */
function getCoercionProperty(node: TypeNode): string | null {
  if (!node.coercions || node.coercions.length === 0) {
    return null;
  }

  // Look for a property that has "{value}" as its expansion value
  for (const alt of node.coercions) {
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
function getCollectionTypes(node: TypeNode): Array<{ prop: PropertyNode; type: string[]; hasNameProperty: boolean }> {
  return node.properties
    .filter(p => p.isCollection && !p.isScalar && !p.isDict)
    .map(p => ({
      prop: p,
      type: p.type?.properties.filter(t => t.name !== "name").map(t => t.name) || [],
      hasNameProperty: p.type?.properties.some(t => t.name === "name") || false,
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
  context: EmitContext<PromptyEmitterOptions>,
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

