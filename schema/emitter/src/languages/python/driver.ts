import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import {
  enumerateTypes,
  PropertyNode,
  TypeNode,
  PythonClassContext,
  PythonFileContext,
  PythonInitContext,
  PythonLoadContextContext,
  BaseTestContext
} from "../../ir/ast.js";
import { resolveFactoryExpr, resolveCoerceExpr, TypeRegistry, collectExprTypeRefs } from "../../ir/expansion.js";
import { ExprVisitor, renderObjectLiteral } from "../../ir/visitor.js";
import { PythonExprVisitor } from "./visitor.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import { toSnakeCase } from "../../ir/utilities.js";
import { buildBaseTestContext, pythonTestOptions } from "../../testing/test-context.js";
import { lowerFile, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { emitPythonFile as emitPythonFileDecl } from "./emitter.js";
import { emitPythonContext, emitPythonInit } from "./scaffolding.js";
import { emitPythonTest, emitPythonTestContext } from "./test-emitter.js";

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
 * Prepares data contexts and delegates rendering to inline emitter functions.
 */
export const generatePython = async (
  context: EmitContext<PromptyEmitterOptions>,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
): Promise<void> => {
  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Build the expression IR infrastructure
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = new PythonExprVisitor(registry);

  // Determine package name from root node namespace (e.g., "Prompty" -> "prompty")
  const packageName = node.typeName.namespace.toLowerCase();

  // Import path for test files — defaults to packageName, can be overridden via import-path config
  const importPath = emitTarget["import-path"] || packageName;

  // Emit py.typed marker for PEP 561 compliance
  await emitPythonFile(context, 'py.typed', '', emitTarget["output-dir"]);

  // Render LoadContext file
  const contextContext = buildLoadContextContext();
  const contextContent = emitPythonContext(contextContext.header);
  await emitPythonFile(context, '_context.py', contextContent, emitTarget["output-dir"]);

  // Render LoadContext tests
  if (emitTarget["test-dir"]) {
    const testContextContext = buildLoadContextContext(importPath);
    const testContextContent = emitPythonTestContext(testContextContext.header, importPath);
    await emitPythonFile(context, 'test_context.py', testContextContent, emitTarget["test-dir"]);
  }

  // Render init file
  const initContext = buildInitContext(nodes);
  const initContent = emitPythonInit(initContext.baseTypes, initContext.types);
  await emitPythonFile(context, '__init__.py', initContent, emitTarget["output-dir"]);

  // Collect polymorphic type names once for the full type graph
  const polymorphicTypeNames = new Set<string>();
  for (const n of allTypes) {
    for (const name of collectPolymorphicTypeNames(n, registry)) {
      polymorphicTypeNames.add(name);
    }
  }

  // Render each base type and its children as a single file
  for (const n of nodes) {
    // Skip child types - they're rendered with their parent
    if (!n.base) {
      const fileDecl = lowerFile(n, registry, polymorphicTypeNames);
      const fileContent = emitPythonFileDecl(fileDecl, visitor);
      await emitPythonFile(context, `_${n.typeName.name}.py`, fileContent, emitTarget["output-dir"]);
    }

    // Render test file for each type (skip protocols — they have no data to test)
    if (emitTarget["test-dir"] && !n.isProtocol) {
      const testContext = buildTestContext(n, importPath);
      const testContent = emitPythonTest(testContext);
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
 * Format Python files using ruff linter and formatter.
 * Runs formatters via uv from the Python project root (where pyproject.toml is located).
 * CI enforces `ruff check` and `ruff format --check`, so both must pass.
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
    // Run ruff check with auto-fix (linting)
    try {
      execFileSync("uv", ["run", "ruff", "check", "--fix", dir], {
        cwd: projectRoot,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: ruff check failed for ${dir}. You may need to install ruff or run it manually.`);
    }

    // Run ruff format (formatting — matches CI's `ruff format --check`)
    try {
      execFileSync("uv", ["run", "ruff", "format", dir], {
        cwd: projectRoot,
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: ruff format failed for ${dir}. You may need to install ruff or run it manually.`);
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
  const factoryTypeRefs: string[] = [];
  const renderedFactories = (registry && visitor) ? (node.factories || []).map(f => {
    const expr = resolveFactoryExpr(f.sets, f.params, node, registry);
    for (const ref of collectExprTypeRefs(expr)) {
      factoryTypeRefs.push(ref.name);
    }
    return {
      name: f.name,
      safeName: factoryNameMap[f.name],
      params: f.params,
      body: visitor.visitExpr(expr),
    };
  }) : [];

  // Resolve coercions via expression IR
  const renderedCoercions = (registry && visitor) ? (node.coercions || []).map(c => {
    const expr = resolveCoerceExpr(c.expansion, c.scalar, node, registry, "data");
    return {
      scalar: pythonTypeMapper[c.scalar] || c.scalar,
      expression: renderObjectLiteral(expr, visitor, "py"),
    };
  }) : [];

  // Keep factory-referenced types for file-level import resolution
  // Don't merge into class imports — the file template handles imports
  const baseImports = getUniqueImportTypes(node);

  return {
    node,
    typeMapper: pythonTypeMapper,
    coercions: prepareCoercions(node),
    polymorphicTypes: node.retrievePolymorphicTypes(),
    imports: baseImports,
    collectionTypes: getCollectionTypes(node),
    coercionProperty: getCoercionProperty(node),
    factoryNameMap,
    renderedFactories,
    renderedCoercions,
    factoryTypeRefs,
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
  const classes: PythonClassContext[] = [
    buildClassContext(node, registry, visitor),
    ...node.childTypes.map(ct => buildClassContext(ct, registry, visitor))
  ];

  // Build grouped imports: module → set of type names to import from that module
  // This handles both base types (module == type) and child types (module == parent type)
  const childTypeNames = new Set([node.typeName.name, ...node.childTypes.map(ct => ct.typeName.name)]);
  const importMap = new Map<string, Set<string>>();

  const addImport = (typeName: string) => {
    if (childTypeNames.has(typeName)) return; // Skip types defined in this file
    // Find which module this type lives in
    const refNode = registry.get(typeName);
    const module = refNode?.base ? refNode.base.name : typeName;
    if (!importMap.has(module)) importMap.set(module, new Set());
    importMap.get(module)!.add(typeName);
  };

  // Property-based imports (base types referenced by properties)
  for (const name of getUniqueImportTypes(node)) {
    addImport(name);
  }

  // Factory-referenced imports (may include child types like TextPart)
  for (const cls of classes) {
    for (const ref of cls.factoryTypeRefs) {
      addImport(ref);
    }
  }

  const imports = Array.from(importMap.entries())
    .map(([module, names]) => ({ module, names: Array.from(names).sort() }))
    .sort((a, b) => a.module.localeCompare(b.module));

  return {
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
    typings: ["Any", "Callable", "Optional"],
    imports,
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

