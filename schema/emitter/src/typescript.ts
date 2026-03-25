import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, AgentSchemaEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeNode, BaseTestContext } from "./ast.js";
import { GeneratorOptions, filterNodes } from "./emitter.js";
import * as nunjucks from "nunjucks";
import { buildBaseTestContext, typescriptTestOptions } from "./test-context.js";
import { toKebabCase } from "./utilities.js";
import path from "path";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";

/**
 * TypeScript type mapper - converts TypeSpec types to TypeScript types.
 */
const typescriptTypeMapper: Record<string, string> = {
  "string": "string",
  "number": "number",
  "array": "[]",
  "object": "object",
  "boolean": "boolean",
  "int64": "number",
  "int32": "number",
  "float64": "number",
  "float32": "number",
  "integer": "number",
  "dictionary": "Record<string, unknown>",
  "unknown": "unknown",
};

/**
 * TypeScript file context for rendering.
 */
interface TypeScriptClassContext {
  node: TypeNode;
  typeMapper: Record<string, string>;
  alternates: Array<{ scalar: string; alternate: string }>;
  polymorphicTypes: any;
  imports: string[];
  collectionTypes: Array<{ prop: PropertyNode; type: string[] }>;
  shorthandProperty: string | null;
}

interface TypeScriptFileContext {
  containsAbstract: boolean;
  imports: string[];
  classes: TypeScriptClassContext[];
  typeMapper: Record<string, string>;
}

interface TypeScriptIndexContext {
  baseTypes: TypeNode[];
  types: TypeNode[];
}

interface TypeScriptContextContext {
  header: string;
  package?: string;
}

/**
 * Generate TypeScript code from TypeSpec models.
 */
export const generateTypeScript = async (
  context: EmitContext<AgentSchemaEmitterOptions>,
  templateDir: string,
  node: TypeNode,
  emitTarget: EmitTarget,
  options?: GeneratorOptions
) => {
  // Set up template environment
  const templatePath = path.resolve(templateDir, "typescript");
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath), {
    autoescape: false, // Disable HTML auto-escaping for code generation
  });

  // Add custom filters
  env.addFilter("isFloat", function (value: any) {
    return value.toString().includes(".");
  });

  // Load templates
  const fileTemplate = env.getTemplate("file.ts.njk", true);
  const contextTemplate = env.getTemplate("context.ts.njk", true);
  const indexTemplate = env.getTemplate("index.ts.njk", true);
  const testTemplate = env.getTemplate("test.ts.njk", true);
  const eslintConfigTemplate = env.getTemplate("eslint.config.js.njk", true);

  const nodes = filterNodes(Array.from(enumerateTypes(node)), options);

  // Determine namespace: use override or default
  const originalNamespace = node.typeName.namespace;
  const tsNamespace = emitTarget.namespace ?? originalNamespace.replace(/\.Core$/, "");

  // Emit context classes (LoadContext, SaveContext)
  const contextCode = contextTemplate.render(buildContextContext(tsNamespace));
  await emitTypeScriptFile(context, "context.ts", contextCode, emitTarget["output-dir"]);

  // Emit each base type file (includes children in the same file)
  for (const n of nodes) {
    // Skip child types - they're rendered with their parent
    if (n.base) {
      continue;
    }

    const fileContext = buildFileContext(n);
    const code = fileTemplate.render({
      ...fileContext,
      namespace: tsNamespace,
      renderPropertyName,
      renderName,
      renderType,
      renderSimpleType,
      renderDefault,
      renderLoadProperty: renderLoadProperty(nodes),
      renderSaveProperty,
      toKebabCase,
    });
    await emitTypeScriptFile(context, `${toKebabCase(n.typeName.name)}.ts`, code, emitTarget["output-dir"]);
  }

  // Emit test files for all types
  if (emitTarget["test-dir"]) {
    for (const n of nodes) {
      const testContext = buildTestContext(n);
      const testCode = testTemplate.render({
        ...testContext,
        renderName,
        namespace: tsNamespace,
        toKebabCase,
      });
      await emitTypeScriptFile(context, `${toKebabCase(n.typeName.name)}.test.ts`, testCode, emitTarget["test-dir"]);
    }
  }

  // Emit index.ts file
  const indexContext = buildIndexContext(nodes);
  const indexCode = indexTemplate.render({
    ...indexContext,
    toKebabCase,
  });
  await emitTypeScriptFile(context, "index.ts", indexCode, emitTarget["output-dir"]);

  // Emit eslint.config.js to project root (parent of output-dir)
  if (emitTarget["output-dir"]) {
    const projectRoot = resolve(process.cwd(), emitTarget["output-dir"], "..");
    const eslintConfigCode = eslintConfigTemplate.render({});
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
 * Build context for rendering a single TypeScript class.
 */
function buildClassContext(node: TypeNode): TypeScriptClassContext {
  return {
    node,
    typeMapper: typescriptTypeMapper,
    alternates: prepareAlternates(node),
    polymorphicTypes: node.retrievePolymorphicTypes(),
    imports: getUniqueImportTypes(node),
    collectionTypes: getCollectionTypes(node),
    shorthandProperty: getShorthandProperty(node),
  };
}

/**
 * Build context for rendering a TypeScript file with a base type and its children.
 */
function buildFileContext(node: TypeNode): TypeScriptFileContext {
  const classes: TypeScriptClassContext[] = [
    buildClassContext(node),
    ...node.childTypes.map((ct) => buildClassContext(ct)),
  ];

  return {
    containsAbstract: node.isAbstract || node.childTypes.some((c) => c.isAbstract),
    imports: getUniqueImportTypes(node),
    classes,
    typeMapper: typescriptTypeMapper,
  };
}

/**
 * Build context for rendering the index.ts file.
 */
function buildIndexContext(nodes: TypeNode[]): TypeScriptIndexContext {
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
 * Build context for rendering the context.ts file.
 */
function buildContextContext(namespace?: string): TypeScriptContextContext {
  return {
    header: "AgentSchema Context",
    package: namespace,
  };
}

/**
 * Prepare alternate representations for template rendering.
 */
function prepareAlternates(node: TypeNode): Array<{ scalar: string; alternate: string }> {
  if (!node.alternates || node.alternates.length === 0) {
    return [];
  }

  return node.alternates.map((alt) => ({
    scalar: typescriptTypeMapper[alt.scalar] || alt.scalar,
    alternate: JSON.stringify(alt.expansion, null, "")
      .replaceAll("\n", "")
      .replaceAll('"{value}"', "data"),
  }));
}

/**
 * Get shorthand property name from alternates.
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
function getCollectionTypes(node: TypeNode): Array<{ prop: PropertyNode; type: string[]; hasNameProperty: boolean }> {
  return node.properties
    .filter((p) => p.isCollection && !p.isScalar && !p.isDict)
    .map((p) => ({
      prop: p,
      type: p.type?.properties.filter((t) => t.name !== "name").map((t) => t.name) || [],
      hasNameProperty: p.type?.properties.some((t) => t.name === "name") || false,
    }));
}

/**
 * Get unique import types needed from other modules.
 */
function getUniqueImportTypes(node: TypeNode): string[] {
  const imports = [
    node.properties.filter((p) => !p.isScalar && !p.isDict).map((p) => p.typeName.name),
    ...node.childTypes.flatMap((c) =>
      c.properties.filter((p) => !p.isScalar && !p.isDict).map((p) => p.typeName.name)
    ),
  ]
    .flat()
    .filter((n) => n !== node.typeName.name && node.base?.name !== n);

  return Array.from(new Set(imports)).sort();
}

/**
 * Write generated TypeScript content to file.
 */
async function emitTypeScriptFile(
  context: EmitContext<AgentSchemaEmitterOptions>,
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

/**
 * Render property name (camelCase).
 */
function renderPropertyName(prop: PropertyNode): string {
  return prop.name;
}

/**
 * Render name in PascalCase.
 */
function renderName(name: string): string {
  const pascal = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
}

/**
 * Render TypeScript type for a property.
 */
function renderType(prop: PropertyNode): string {
  const baseType = renderSimpleType(prop);
  return prop.isOptional ? `${baseType} | undefined` : baseType;
}

/**
 * Render simple TypeScript type without optional modifier.
 */
function renderSimpleType(prop: PropertyNode): string {
  let type = prop.isScalar ? typescriptTypeMapper[prop.typeName.name] || "unknown" : prop.typeName.name;
  if (prop.isDict) {
    type = "Record<string, unknown>";
  }
  type = prop.isCollection ? `${type}[]` : type;
  return type;
}

/**
 * Render default value for a property.
 */
function renderDefault(prop: PropertyNode): string {
  if (!prop.isOptional) {
    if (prop.isCollection) {
      return " = []";
    } else if (prop.isScalar) {
      return renderDefaultType(prop.typeName.name, prop.defaultValue);
    } else if (prop.isDict) {
      return " = {}";
    }
  }
  return "";
}

/**
 * Render default value based on type.
 */
function renderDefaultType(typeName: string, defaultValue: any): string {
  if (defaultValue !== undefined && defaultValue !== null) {
    if (typeof defaultValue === "string") {
      return ` = "${defaultValue}"`;
    }
    return ` = ${defaultValue}`;
  }

  switch (typeName) {
    case "string":
      return ' = ""';
    case "boolean":
      return " = false";
    case "number":
    case "int32":
    case "int64":
    case "float32":
    case "float64":
    case "integer":
      return " = 0";
    default:
      return "";
  }
}

/**
 * Render load property logic.
 */
function renderLoadProperty(nodes: TypeNode[]) {
  return (prop: PropertyNode): string => {
    const propName = prop.name;
    const varName = `${propName}Value`;

    if (prop.isCollection && !prop.isScalar && !prop.isDict) {
      return `instance.${propName} = ${prop.typeName.name}.loadCollection(${varName}, context);`;
    }

    if (prop.isDict) {
      return `instance.${propName} = ${varName} as Record<string, unknown>;`;
    }

    if (!prop.isScalar) {
      return `instance.${propName} = ${prop.typeName.name}.load(${varName} as Record<string, unknown>, context);`;
    }

    // Scalar types
    const tsType = typescriptTypeMapper[prop.typeName.name] || "unknown";
    switch (tsType) {
      case "string":
        return `instance.${propName} = String(${varName});`;
      case "number":
        return `instance.${propName} = Number(${varName});`;
      case "boolean":
        return `instance.${propName} = Boolean(${varName});`;
      default:
        return `instance.${propName} = ${varName} as ${tsType};`;
    }
  };
}

/**
 * Render save property logic.
 */
function renderSaveProperty(prop: PropertyNode): string {
  const propName = prop.name;

  if (prop.isCollection && !prop.isScalar && !prop.isDict) {
    return `result["${propName}"] = ${prop.typeName.name}.saveCollection(this.${propName}, context);`;
  }

  if (!prop.isScalar && !prop.isDict) {
    return `result["${propName}"] = this.${propName}?.save(context);`;
  }

  return `result["${propName}"] = this.${propName};`;
}
