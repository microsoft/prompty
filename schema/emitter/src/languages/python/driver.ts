import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import {
  enumerateTypes,
  PropertyNode,
  PropertyValidation,
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
import { getCombinations, scalarValue, toSnakeCase } from "../../ir/utilities.js";
import { buildBaseTestContext, pythonTestOptions } from "../../legacy/test-context.js";
import { lowerFile, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { emitPythonFile as emitPythonFileDecl } from "./emitter.js";
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
 * Prepares data contexts and delegates rendering to inline emitter functions.
 */
export const generatePython = async (
  context: EmitContext<PromptyEmitterOptions>,
  templateDir: string,
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

    // Render test file for each type
    if (emitTarget["test-dir"]) {
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

// ============================================================================
// Inline Template Emitters
// ============================================================================

/**
 * Get test value for a factory parameter type.
 * Replaces the factoryParamTestValue macro from _macros.njk.
 */
function factoryParamTestValue(typeStr: string): string {
  switch (typeStr) {
    case "string": return '"test"';
    case "boolean": return "True";
    case "integer":
    case "int32":
    case "int64": return "42";
    case "float":
    case "float64":
    case "float32": return "3.14";
    case "unknown":
    default: return '"test"';
  }
}

/**
 * Render a single validation assertion line for a Python test.
 */
function renderValidation(v: PropertyValidation, varName: string): string {
  if (v.value === "True") {
    return `    assert ${varName}.${v.key}`;
  } else if (v.value === "False") {
    return `    assert not ${varName}.${v.key}`;
  } else {
    return `    assert ${varName}.${v.key} == ${v.delimiter}${v.value}${v.delimiter}`;
  }
}

/**
 * Emit the _context.py file content (LoadContext + SaveContext classes).
 * Replaces context.py.njk template.
 */
function emitPythonContext(header: string): string {
  const headerLine = header ? `# ${header}\n` : '';
  return `${headerLine}import json
from dataclasses import dataclass
from typing import Any, Callable, Optional

import yaml


@dataclass
class LoadContext:
    """
    Context for customizing the loading process of agent definitions.

    Provides hooks for pre-processing input data before parsing and
    post-processing output data after instantiation.
    """

    pre_process: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None
    """Optional callback to transform input data before parsing."""

    post_process: Optional[Callable[[Any], Any]] = None
    """Optional callback to transform the result after instantiation."""

    def process_input(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Apply pre-processing to input data if a pre_process callback is set.

        Args:
            data: The raw input dictionary to process.

        Returns:
            The processed dictionary, or the original if no callback is set.
        """
        if self.pre_process is not None:
            return self.pre_process(data)
        return data

    def process_output(self, result: Any) -> Any:
        """
        Apply post-processing to the result if a post_process callback is set.

        Args:
            result: The instantiated object to process.

        Returns:
            The processed result, or the original if no callback is set.
        """
        if self.post_process is not None:
            return self.post_process(result)
        return result


@dataclass
class SaveContext:
    """
    Context for customizing the serialization process of agent definitions.

    Provides hooks for pre-processing the object before serialization and
    post-processing the dictionary after serialization.
    """

    pre_save: Optional[Callable[[Any], Any]] = None
    """Optional callback to transform the object before serialization."""

    post_save: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None
    """Optional callback to transform the dictionary after serialization."""

    collection_format: str = "object"
    """Output format for collections: 'object' (name as key) or 'array' (list of dicts)."""

    use_shorthand: bool = True
    """Use shorthand scalar representation when possible (e.g., {"myTool": "function"})."""

    def process_object(self, obj: Any) -> Any:
        """
        Apply pre-processing to the object if a pre_save callback is set.

        Args:
            obj: The object to process before serialization.

        Returns:
            The processed object, or the original if no callback is set.
        """
        if self.pre_save is not None:
            return self.pre_save(obj)
        return obj

    def process_dict(self, data: dict[str, Any]) -> dict[str, Any]:
        """
        Apply post-processing to the dictionary if a post_save callback is set.

        Args:
            data: The serialized dictionary to process.

        Returns:
            The processed dictionary, or the original if no callback is set.
        """
        if self.post_save is not None:
            return self.post_save(data)
        return data

    def to_yaml(self, data: dict[str, Any]) -> str:
        """
        Convert the dictionary to a YAML string.

        Args:
            data: The dictionary to convert.

        Returns:
            The YAML string representation.
        """
        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    def to_json(self, data: dict[str, Any], indent: int = 2) -> str:
        """
        Convert the dictionary to a JSON string.

        Args:
            data: The dictionary to convert.
            indent: Number of spaces for indentation.

        Returns:
            The JSON string representation.
        """
        return json.dumps(data, indent=indent)
`;
}

/**
 * Emit the test_context.py file content (tests for LoadContext + SaveContext).
 * Replaces test_context.py.njk template.
 */
function emitPythonTestContext(header: string, packageName: string): string {
  const headerLine = header ? `# ${header}\n` : '';
  return `${headerLine}from ${packageName}._context import LoadContext, SaveContext


class TestLoadContext:
    """Tests for LoadContext class."""

    def test_default_values(self) -> None:
        """Test that LoadContext has correct default values."""
        context = LoadContext()
        assert context.pre_process is None
        assert context.post_process is None

    def test_process_input_without_callback(self) -> None:
        """Test process_input returns original data when no callback set."""
        context = LoadContext()
        data = {"key": "value", "nested": {"a": 1}}
        result = context.process_input(data)
        assert result is data

    def test_process_input_with_callback(self) -> None:
        """Test process_input applies the pre_process callback."""
        def add_field(data: dict) -> dict:
            return {**data, "added": True}

        context = LoadContext(pre_process=add_field)
        data = {"key": "value"}
        result = context.process_input(data)
        assert result == {"key": "value", "added": True}
        assert result is not data

    def test_process_output_without_callback(self) -> None:
        """Test process_output returns original result when no callback set."""
        context = LoadContext()
        result = {"some": "result"}
        processed = context.process_output(result)
        assert processed is result

    def test_process_output_with_callback(self) -> None:
        """Test process_output applies the post_process callback."""
        def wrap_result(result: dict) -> dict:
            return {"wrapped": result}

        context = LoadContext(post_process=wrap_result)
        result = {"key": "value"}
        processed = context.process_output(result)
        assert processed == {"wrapped": {"key": "value"}}

    def test_both_callbacks(self) -> None:
        """Test using both pre_process and post_process callbacks."""
        def normalize_keys(data: dict) -> dict:
            return {k.lower(): v for k, v in data.items()}

        def add_metadata(result: dict) -> dict:
            return {**result, "_processed": True}

        context = LoadContext(pre_process=normalize_keys, post_process=add_metadata)

        input_data = {"Key": "value", "UPPER": "case"}
        processed_input = context.process_input(input_data)
        assert processed_input == {"key": "value", "upper": "case"}

        final_result = context.process_output(processed_input)
        assert final_result == {"key": "value", "upper": "case", "_processed": True}

    def test_pre_process_can_modify_structure(self) -> None:
        """Test that pre_process can fundamentally transform data structure."""
        def flatten_nested(data: dict) -> dict:
            result = {}
            for key, value in data.items():
                if isinstance(value, dict):
                    for nested_key, nested_value in value.items():
                        result[f"{key}_{nested_key}"] = nested_value
                else:
                    result[key] = value
            return result

        context = LoadContext(pre_process=flatten_nested)
        data = {"top": "level", "nested": {"a": 1, "b": 2}}
        result = context.process_input(data)
        assert result == {"top": "level", "nested_a": 1, "nested_b": 2}


class TestSaveContext:
    """Tests for SaveContext class."""

    def test_default_values(self) -> None:
        """Test that SaveContext has correct default values."""
        context = SaveContext()
        assert context.pre_save is None
        assert context.post_save is None

    def test_process_object_without_callback(self) -> None:
        """Test process_object returns original object when no callback set."""
        context = SaveContext()
        obj = {"key": "value"}
        result = context.process_object(obj)
        assert result is obj

    def test_process_object_with_callback(self) -> None:
        """Test process_object applies the pre_save callback."""
        def add_timestamp(obj: dict) -> dict:
            return {**obj, "timestamp": "2024-01-01"}

        context = SaveContext(pre_save=add_timestamp)
        obj = {"key": "value"}
        result = context.process_object(obj)
        assert result == {"key": "value", "timestamp": "2024-01-01"}

    def test_process_dict_without_callback(self) -> None:
        """Test process_dict returns original dict when no callback set."""
        context = SaveContext()
        data = {"key": "value"}
        result = context.process_dict(data)
        assert result is data

    def test_process_dict_with_callback(self) -> None:
        """Test process_dict applies the post_save callback."""
        def remove_internal_fields(data: dict) -> dict:
            return {k: v for k, v in data.items() if not k.startswith("_")}

        context = SaveContext(post_save=remove_internal_fields)
        data = {"key": "value", "_internal": "secret"}
        result = context.process_dict(data)
        assert result == {"key": "value"}

    def test_both_callbacks(self) -> None:
        """Test using both pre_save and post_save callbacks."""
        def mark_for_export(obj: dict) -> dict:
            return {**obj, "_exporting": True}

        def clean_markers(data: dict) -> dict:
            return {k: v for k, v in data.items() if not k.startswith("_")}

        context = SaveContext(pre_save=mark_for_export, post_save=clean_markers)

        obj = {"name": "test", "value": 42}
        processed_obj = context.process_object(obj)
        assert processed_obj == {"name": "test", "value": 42, "_exporting": True}

        final_dict = context.process_dict(processed_obj)
        assert final_dict == {"name": "test", "value": 42}

    def test_to_yaml(self) -> None:
        """Test to_yaml produces valid YAML string."""
        context = SaveContext()
        data = {"name": "test", "items": ["a", "b"]}
        result = context.to_yaml(data)
        assert "name: test" in result
        assert "items:" in result
        assert "- a" in result
        assert "- b" in result

    def test_to_json(self) -> None:
        """Test to_json produces valid JSON string."""
        import json
        context = SaveContext()
        data = {"name": "test", "items": ["a", "b"]}
        result = context.to_json(data)
        parsed = json.loads(result)
        assert parsed == data

    def test_to_json_custom_indent(self) -> None:
        """Test to_json respects custom indent."""
        context = SaveContext()
        data = {"name": "test"}
        result_2 = context.to_json(data, indent=2)
        result_4 = context.to_json(data, indent=4)
        # 4-space indent should have more characters
        assert len(result_4) > len(result_2)

    def test_collection_format_default(self) -> None:
        """Test that default collection_format is 'object'."""
        context = SaveContext()
        assert context.collection_format == "object"

    def test_collection_format_array(self) -> None:
        """Test collection_format can be set to 'array'."""
        context = SaveContext(collection_format="array")
        assert context.collection_format == "array"

    def test_use_shorthand_default(self) -> None:
        """Test that default use_shorthand is True."""
        context = SaveContext()
        assert context.use_shorthand is True

    def test_use_shorthand_disabled(self) -> None:
        """Test use_shorthand can be disabled."""
        context = SaveContext(use_shorthand=False)
        assert context.use_shorthand is False
`;
}

/**
 * Emit the __init__.py file content.
 * Replaces init.py.njk template.
 */
function emitPythonInit(baseTypes: TypeNode[], types: TypeNode[]): string {
  const lines: string[] = [];

  lines.push('##########################################');
  lines.push('# WARNING: This is an auto-generated file.');
  lines.push('# DO NOT EDIT THIS FILE DIRECTLY');
  lines.push('# ANY EDITS WILL BE LOST');
  lines.push('##########################################');
  lines.push('from ._context import LoadContext, SaveContext');

  for (const type of baseTypes) {
    if (type.childTypes.length > 0) {
      const names = [type.typeName.name, ...type.childTypes.map(c => c.typeName.name)];
      lines.push('');
      lines.push(`from ._${type.typeName.name} import (`);
      for (const name of names) {
        lines.push(`  ${name},`);
      }
      lines.push(')');
    } else {
      lines.push('');
      lines.push(`from ._${type.typeName.name} import ${type.typeName.name}`);
    }
  }

  lines.push('');
  lines.push('__all__ = [');
  lines.push('    "LoadContext",');
  lines.push('    "SaveContext",');
  for (const type of types) {
    lines.push(`    "${type.typeName.name}",`);
  }
  lines.push(']');

  return lines.join('\n') + '\n';
}

/**
 * Emit a pytest test file for a type.
 * Replaces test.py.njk template.
 */
function emitPythonTest(ctx: BaseTestContext & { classCtx: PythonClassContext }): string {
  const { node, examples, coercions, factories, classCtx } = ctx;
  const packageName = ctx.package || '';
  const typeName = node.typeName.name;
  const typeNameLower = typeName.toLowerCase();
  const lines: string[] = [];

  // Imports
  if (examples.length > 0) {
    lines.push('import json');
    lines.push('import yaml');
    lines.push('');
  }
  lines.push(`from ${packageName} import ${typeName}`);
  lines.push('');

  // Example tests: load_json, load_yaml, roundtrip_json, to_json, to_yaml
  for (let i = 0; i < examples.length; i++) {
    const sample = examples[i];
    const suffix = i === 0 ? '' : `_${i}`;
    const jsonBlock = sample.json.map(line => `    ${line}`).join('\n');
    const yamlBlock = sample.yaml.map(line => `    ${line}`).join('\n');

    // test_load_json
    lines.push(`def test_load_json_${typeNameLower}${suffix}():`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    assert instance is not None`);
    for (const v of sample.validations) {
      lines.push(renderValidation(v, 'instance'));
    }
    lines.push('');

    // test_load_yaml
    lines.push(`def test_load_yaml_${typeNameLower}${suffix}():`);
    lines.push(`    yaml_data = r'''`);
    lines.push(yamlBlock);
    lines.push(`    '''`);
    lines.push(`    data = yaml.load(yaml_data, Loader=yaml.FullLoader)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    assert instance is not None`);
    for (const v of sample.validations) {
      lines.push(renderValidation(v, 'instance'));
    }
    lines.push('');

    // test_roundtrip_json
    lines.push(`def test_roundtrip_json_${typeNameLower}${suffix}():`);
    lines.push(`    """Test that load -> save -> load produces equivalent data."""`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    original_data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(original_data)`);
    lines.push(`    saved_data = instance.save()`);
    lines.push(`    reloaded = ${typeName}.load(saved_data)`);
    lines.push(`    assert reloaded is not None`);
    for (const v of sample.validations) {
      lines.push(renderValidation(v, 'reloaded'));
    }
    lines.push('');

    // test_to_json
    lines.push(`def test_to_json_${typeNameLower}${suffix}():`);
    lines.push(`    """Test that to_json produces valid JSON."""`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    json_output = instance.to_json()`);
    lines.push(`    assert json_output is not None`);
    lines.push(`    parsed = json.loads(json_output)`);
    lines.push(`    assert isinstance(parsed, dict)`);
    lines.push('');

    // test_to_yaml
    lines.push(`def test_to_yaml_${typeNameLower}${suffix}():`);
    lines.push(`    """Test that to_yaml produces valid YAML."""`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    yaml_output = instance.to_yaml()`);
    lines.push(`    assert yaml_output is not None`);
    lines.push(`    parsed = yaml.safe_load(yaml_output)`);
    lines.push(`    assert isinstance(parsed, dict)`);
    lines.push('');
  }

  // Coercion tests
  if (coercions.length > 0) {
    for (const alt of coercions) {
      lines.push(`def test_load_${typeNameLower}_from_${alt.scalarType}():`);
      lines.push(`    instance = ${typeName}.load(${alt.value})`);
      lines.push(`    assert instance is not None`);
      for (const v of alt.validations) {
        lines.push(renderValidation(v, 'instance'));
      }
      lines.push('');
    }
  }

  // Factory tests
  if (factories.length > 0) {
    for (const factory of factories) {
      const safeName = classCtx.factoryNameMap[factory.name];
      const factorySnake = toSnakeCase(factory.name);
      const params = Object.entries(factory.params)
        .map(([_, pType]) => factoryParamTestValue(pType))
        .join(', ');

      lines.push(`def test_factory_${factorySnake}_${typeNameLower}():`);
      lines.push(`    """Test that ${factory.name}() factory creates a valid instance."""`);
      lines.push(`    instance = ${typeName}.${safeName}(${params})`);
      lines.push(`    assert instance is not None`);
      lines.push(`    assert isinstance(instance, ${typeName})`);

      for (const [propName, value] of Object.entries(factory.sets)) {
        const snakeProp = toSnakeCase(propName);
        if (value === true) {
          lines.push(`    assert instance.${snakeProp}`);
        } else if (value === false) {
          lines.push(`    assert not instance.${snakeProp}`);
        } else if (typeof value === 'number') {
          lines.push(`    assert instance.${snakeProp} == ${value}`);
        } else if (typeof value === 'string') {
          lines.push(`    assert instance.${snakeProp} == "${value}"`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
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

