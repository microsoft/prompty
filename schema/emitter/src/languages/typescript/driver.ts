import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import { enumerateTypes, TypeNode, BaseTestContext } from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import { TypeRegistry } from "../../ir/expansion.js";
import { TypeScriptExprVisitor } from "./visitor.js";
import { emitTypeScriptFile as emitTypeScriptFileDecl } from "./emitter.js";
import { lowerFile, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { buildBaseTestContext, typescriptTestOptions } from "../../legacy/test-context.js";
import { toKebabCase } from "../../ir/utilities.js";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";

/**
 * Generate TypeScript code from TypeSpec models.
 */
export const generateTypeScript = async (
  context: EmitContext<PromptyEmitterOptions>,
  _templateDir: string,
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

/**
 * Render name in PascalCase (used by test template).
 */
function renderName(name: string): string {
  const pascal = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
}

/**
 * Emit static TypeScript context classes (LoadContext, SaveContext).
 */
function emitTypeScriptContext(): string {
  return `// Copyright (c) Microsoft. All rights reserved.
// WARNING: This is an auto-generated file. DO NOT EDIT THIS FILE DIRECTLY.

import * as yaml from "yaml";

/**
 * Context for customizing the loading process of agent definitions.
 *
 * Provides hooks for pre-processing input data before parsing and
 * post-processing output data after instantiation.
 */
export class LoadContext {
  /**
   * Optional callback to transform input data before parsing.
   */
  preProcess?: (data: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Optional callback to transform the result after instantiation.
   */
  postProcess?: (result: unknown) => unknown;

  constructor(init?: Partial<LoadContext>) {
    if (init?.preProcess) {
      this.preProcess = init.preProcess;
    }
    if (init?.postProcess) {
      this.postProcess = init.postProcess;
    }
  }

  /**
   * Apply pre-processing to input data if a preProcess callback is set.
   * @param data - The raw input dictionary to process.
   * @returns The processed dictionary, or the original if no callback is set.
   */
  processInput(data: Record<string, unknown>): Record<string, unknown> {
    if (this.preProcess) {
      return this.preProcess(data);
    }
    return data;
  }

  /**
   * Apply post-processing to the result if a postProcess callback is set.
   * @param result - The instantiated object to process.
   * @returns The processed result, or the original if no callback is set.
   */
  processOutput<T>(result: T): T {
    if (this.postProcess) {
      return this.postProcess(result) as T;
    }
    return result;
  }
}

/**
 * Context for customizing the serialization process of agent definitions.
 *
 * Provides hooks for pre-processing the object before serialization and
 * post-processing the dictionary after serialization.
 */
export class SaveContext {
  /**
   * Optional callback to transform the object before serialization.
   */
  preSave?: (obj: unknown) => unknown;

  /**
   * Optional callback to transform the dictionary after serialization.
   */
  postSave?: (data: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Output format for collections: "object" (name as key) or "array" (list of dicts).
   * Defaults to "object".
   */
  collectionFormat: "object" | "array" = "object";

  /**
   * Use shorthand scalar representation when possible.
   * Defaults to true.
   */
  useShorthand: boolean = true;

  constructor(init?: Partial<SaveContext>) {
    if (init?.preSave) {
      this.preSave = init.preSave;
    }
    if (init?.postSave) {
      this.postSave = init.postSave;
    }
    if (init?.collectionFormat) {
      this.collectionFormat = init.collectionFormat;
    }
    if (init?.useShorthand !== undefined) {
      this.useShorthand = init.useShorthand;
    }
  }

  /**
   * Apply pre-processing to the object if a preSave callback is set.
   * @param obj - The object to process before serialization.
   * @returns The processed object, or the original if no callback is set.
   */
  processObject<T>(obj: T): T {
    if (this.preSave) {
      return this.preSave(obj) as T;
    }
    return obj;
  }

  /**
   * Apply post-processing to the dictionary if a postSave callback is set.
   * @param data - The serialized dictionary to process.
   * @returns The processed dictionary, or the original if no callback is set.
   */
  processDict(data: Record<string, unknown>): Record<string, unknown> {
    if (this.postSave) {
      return this.postSave(data);
    }
    return data;
  }

  /**
   * Convert a dictionary to a YAML string.
   * @param data - The dictionary to convert.
   * @returns The YAML string representation.
   */
  toYaml(data: Record<string, unknown>): string {
    return yaml.stringify(data, { indent: 2 });
  }

  /**
   * Convert a dictionary to a JSON string.
   * @param data - The dictionary to convert.
   * @param indent - Number of spaces for indentation.
   * @returns The JSON string representation.
   */
  toJson(data: Record<string, unknown>, indent: number = 2): string {
    return JSON.stringify(data, null, indent);
  }
}
`;
}

/**
 * Emit the barrel export index.ts file.
 */
function emitTypeScriptIndex(baseTypes: TypeNode[], _types: TypeNode[]): string {
  const lines: string[] = [];
  lines.push("// Copyright (c) Microsoft. All rights reserved.");
  lines.push("// WARNING: This is an auto-generated file. DO NOT EDIT THIS FILE DIRECTLY.");
  lines.push("");
  lines.push('export { LoadContext, SaveContext } from "./context";');

  for (const type of baseTypes) {
    if (type.childTypes.length > 0) {
      const exports = [type.typeName.name, ...type.childTypes.map((c) => c.typeName.name)];
      lines.push("");
      lines.push("export {");
      for (const name of exports) {
        lines.push(`  ${name},`);
      }
      lines.push(`} from "./${toKebabCase(type.typeName.name)}";`);
    } else {
      lines.push(`export { ${type.typeName.name} } from "./${toKebabCase(type.typeName.name)}";`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Emit the static ESLint configuration file.
 */
function emitEslintConfig(): string {
  return `// ESLint configuration for auto-generated AgentSchema TypeScript code
// This file is auto-generated by the AgentSchema emitter
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // Allow unused vars prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow explicit any in generated code
      "@typescript-eslint/no-explicit-any": "off",
      // Allow non-null assertions in generated code
      "@typescript-eslint/no-non-null-assertion": "off",
      // Allow require() for dynamic YAML imports in generated code
      "@typescript-eslint/no-require-imports": "off",
      // Allow empty blocks in generated shorthand parsing patterns
      "no-empty": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Allow explicit any in test code
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars in generated tests
      "@typescript-eslint/no-unused-vars": "off",
      // Allow require() for dynamic YAML imports
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.config.*"],
  }
);
`;
}

/**
 * Map a factory parameter type string to a TypeScript test value literal.
 */
function factoryParamTestValue(typeStr: string): string {
  switch (typeStr) {
    case "string":
      return '"test"';
    case "boolean":
      return "true";
    case "integer":
    case "int32":
    case "int64":
      return "42";
    case "float":
    case "float64":
    case "float32":
      return "3.14";
    case "unknown":
    default:
      return '"test"';
  }
}

/**
 * Emit a vitest test file for a TypeNode.
 */
function emitTypeScriptTest(ctx: BaseTestContext & { importPath: string; namespace: string }): string {
  const { node, isAbstract, examples, coercions, factories, importPath } = ctx;
  const typeName = node.typeName.name;

  const lines: string[] = [];
  lines.push("// Copyright (c) Microsoft. All rights reserved.");
  lines.push("// WARNING: This is an auto-generated file. DO NOT EDIT THIS FILE DIRECTLY.");
  lines.push("");
  lines.push(`import { ${typeName} } from "${importPath}";`);
  lines.push("");
  lines.push(`describe("${typeName}", () => {`);
  lines.push(`  describe("construction", () => {`);
  lines.push(`    it("should create a new instance with defaults", () => {`);
  lines.push(`      const instance = new ${typeName}();`);
  lines.push(`      expect(instance).toBeDefined();`);
  lines.push(`    });`);
  lines.push("");
  lines.push(`    it("should create a new instance with partial initialization", () => {`);
  lines.push(`      const instance = new ${typeName}({});`);
  lines.push(`      expect(instance).toBeDefined();`);
  lines.push(`    });`);
  lines.push(`  });`);

  if (examples.length > 0) {
    lines.push("");
    lines.push(`  describe("JSON serialization", () => {`);
    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      const exampleNum = i + 1;
      lines.push(`    it("should load from JSON - example ${exampleNum}", () => {`);
      lines.push("      const json = `" + example.json.join("\\n") + "`;");
      lines.push(`      const instance = ${typeName}.fromJson(json);`);
      lines.push(`      expect(instance).toBeDefined();`);
      for (const val of example.validations) {
        lines.push(`      expect(instance.${val.key}).toEqual(${val.delimiter}${val.value}${val.delimiter});`);
      }
      lines.push(`    });`);
      lines.push("");
      lines.push(`    it("should round-trip JSON - example ${exampleNum}", () => {`);
      lines.push("      const json = `" + example.json.join("\\n") + "`;");
      lines.push(`      const instance = ${typeName}.fromJson(json);`);
      lines.push(`      const output = instance.toJson();`);
      lines.push(`      const reloaded = ${typeName}.fromJson(output);`);
      for (const val of example.validations) {
        lines.push(`      expect(reloaded.${val.key}).toEqual(instance.${val.key});`);
      }
      lines.push(`    });`);
    }
    lines.push(`  });`);
    lines.push("");
    lines.push(`  describe("YAML serialization", () => {`);
    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      const exampleNum = i + 1;
      lines.push(`    it("should load from YAML - example ${exampleNum}", () => {`);
      lines.push("      const yaml = `" + example.yaml.join("\\n") + "`;");
      lines.push(`      const instance = ${typeName}.fromYaml(yaml);`);
      lines.push(`      expect(instance).toBeDefined();`);
      for (const val of example.validations) {
        lines.push(`      expect(instance.${val.key}).toEqual(${val.delimiter}${val.value}${val.delimiter});`);
      }
      lines.push(`    });`);
      lines.push("");
      lines.push(`    it("should round-trip YAML - example ${exampleNum}", () => {`);
      lines.push("      const yaml = `" + example.yaml.join("\\n") + "`;");
      lines.push(`      const instance = ${typeName}.fromYaml(yaml);`);
      lines.push(`      const output = instance.toYaml();`);
      lines.push(`      const reloaded = ${typeName}.fromYaml(output);`);
      for (const val of example.validations) {
        lines.push(`      expect(reloaded.${val.key}).toEqual(instance.${val.key});`);
      }
      lines.push(`    });`);
    }
    lines.push(`  });`);
  }

  if (coercions.length > 0) {
    lines.push("");
    lines.push(`  describe("alternate representations", () => {`);
    for (const alt of coercions) {
      lines.push(`    it("should handle ${alt.title} alternate representation", () => {`);
      lines.push(`      const value = ${alt.value};`);
      lines.push(`      const json = JSON.stringify(value);`);
      lines.push(`      const instance = ${typeName}.fromJson(json);`);
      lines.push(`      expect(instance).toBeDefined();`);
      for (const val of alt.validations) {
        const coercionKey = renderName(val.key).toLowerCase().replace(/\./g, "");
        lines.push(`      expect(instance.${coercionKey}).toEqual(${val.delimiter}${val.value}${val.delimiter});`);
      }
      lines.push(`    });`);
    }
    lines.push(`  });`);
  }

  if (factories.length > 0) {
    lines.push("");
    lines.push(`  describe("factory methods", () => {`);
    for (const factory of factories) {
      const paramValues = Object.values(factory.params)
        .map((pType) => factoryParamTestValue(pType))
        .join(", ");
      lines.push(`    it("should create instance via ${factory.name}() factory", () => {`);
      lines.push(`      const instance = ${typeName}.${factory.name}(${paramValues});`);
      lines.push(`      expect(instance).toBeDefined();`);
      lines.push(`      expect(instance).toBeInstanceOf(${typeName});`);
      for (const [propName, value] of Object.entries(factory.sets)) {
        if (value === true) {
          lines.push(`      expect(instance.${propName}).toBe(true);`);
        } else if (value === false) {
          lines.push(`      expect(instance.${propName}).toBe(false);`);
        } else if (typeof value === "number") {
          lines.push(`      expect(instance.${propName}).toBe(${value});`);
        } else if (typeof value === "string") {
          lines.push(`      expect(instance.${propName}).toBe("${value}");`);
        }
      }
      lines.push(`    });`);
    }
    lines.push(`  });`);
  }

  lines.push("");
  if (!(isAbstract && node.isAbstract)) {
    lines.push(`  describe("load and save", () => {`);
    if (!isAbstract) {
      lines.push(`    it("should load from dictionary", () => {`);
      lines.push(`      const data: Record<string, unknown> = {};`);
      lines.push(`      const instance = ${typeName}.load(data);`);
      lines.push(`      expect(instance).toBeDefined();`);
      lines.push(`    });`);
    }
    lines.push("");
    if (!node.isAbstract) {
      lines.push(`    it("should save to dictionary", () => {`);
      lines.push(`      const instance = new ${typeName}();`);
      lines.push(`      const data = instance.save();`);
      lines.push(`      expect(data).toBeDefined();`);
      lines.push(`      expect(typeof data).toBe("object");`);
      lines.push(`    });`);
    }
    lines.push(`  });`);
  }
  lines.push("});");
  lines.push("");

  return lines.join("\n");
}
