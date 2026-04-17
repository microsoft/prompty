import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import { enumerateTypes, TypeNode } from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import { getCombinations, scalarValue } from "../../ir/utilities.js";
import * as YAML from "yaml";
import { resolve, dirname } from "path";
import { execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { TypeRegistry } from "../../ir/expansion.js";
import { CSharpExprVisitor } from "./visitor.js";
import { lowerType, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { emitCSharpClass } from "./emitter.js";
import { emitCSharpContext, emitCSharpUtils } from "./scaffolding.js";
import { emitCSharpTest } from "./test-emitter.js";

export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNode, emitTarget: EmitTarget, options?: GeneratorOptions) => {
  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Build the expression IR infrastructure
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = new CSharpExprVisitor(registry);

  // Determine namespace: use explicit override from config, or fall back to TypeSpec namespace
  const originalNamespace = node.typeName.namespace;
  const csharpNamespace = emitTarget.namespace ?? originalNamespace;

  // Emit context classes (LoadContext, SaveContext)
  const contextCode = emitCSharpContext(csharpNamespace);
  await emitCsharpFile(context, node, contextCode, "Context.cs", emitTarget["output-dir"]);

  const utils = emitCSharpUtils(csharpNamespace);

  await emitCsharpFile(context, node, utils, "Utils.cs", emitTarget["output-dir"]);

  // Build Declaration IR once (loop-invariant)
  const polyNames = collectPolymorphicTypeNames(allTypes[0], registry);
  const allTypeDecls = nodes.map(nd => lowerType(nd, registry, polyNames));
  const findTypeDecl = (name: string) => allTypeDecls.find(t => t.typeName.name === name);

  for (const n of nodes) {
    const typeDecl = lowerType(n, registry, polyNames);
    const classCode = emitCSharpClass(typeDecl, csharpNamespace, visitor, allTypeDecls, findTypeDecl);
    await emitCsharpFile(context, n, classCode, `${n.typeName.name}.cs`, emitTarget["output-dir"]);
    if (emitTarget["test-dir"] && !n.isProtocol) {
      await emitCsharpFile(context, n, renderTests(n, csharpNamespace), `${n.typeName.name}ConversionTests.cs`, emitTarget["test-dir"]);
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

    formatCSharpFiles(outputDir, testDir);
  }
};


// --- Test-rendering helpers ---

const renderTests = (node: TypeNode, namespace: string): string => {
  const samples = node.properties.filter(p => p.samples && p.samples.length > 0).map(p => {
    return p.samples?.map(s => ({
      ...s.sample,
    }));
  });

  const combinations =
    samples.length > 0 ?
      getCombinations(samples) :
      [];

  const examples = combinations.map(c => {
    const sample = Object.assign({}, ...c);
    // Create YAML document and customize string scalar style for values with special chars
    const doc = new YAML.Document(sample);
    YAML.visit(doc, {
      Scalar(key, node) {
        // Only quote string values that contain special characters requiring escaping
        if (typeof node.value === 'string') {
          const str = node.value as string;
          if (str.includes('\n') || str.includes('\t') || str.includes('#') || str.includes(':') || str.includes('"')) {
            node.type = 'QUOTE_DOUBLE';
          }
        }
      }
    });
    return {
      json: JSON.stringify(sample, null, 2).split('\n'),
      yaml: doc.toString({ indent: 2, lineWidth: 0 }).split('\n'),
      // get all scalars in the sample - using 'validations' (plural) for consistency across languages
      validations: Object.keys(sample).filter(key => typeof sample[key] !== 'object').map(key => {
        const val = sample[key];
        const needsVerbatim = typeof val === 'string' && (val.includes('\n') || val.includes('"'));
        return {
          key: renderName(key),
          value: typeof val === 'boolean' ? (val ? "True" : "False") :
            (needsVerbatim ? (val as string).replace(/"/g, '""') : val),
          startDelim: typeof val === 'string' ? (needsVerbatim ? '@"' : '"') : '',
          endDelim: typeof val === 'string' ? '"' :
            typeof val === 'number' && !Number.isInteger(val) ? 'f' : '',
        };
      }),
    };
  });

  const coercions = node.coercions.map(alt => {
    const example = alt.example ? (typeof (alt.example) === "string" ? '"' + alt.example + '"' : alt.example.toString()) : scalarValue[alt.scalar] || "None";
    return {
      title: alt.title || alt.scalar,
      scalar: alt.scalar,
      value: example,
      // using 'validations' (plural) for consistency across languages
      validations: Object.keys(alt.expansion).filter(key => typeof alt.expansion[key] !== 'object').map(key => {
        const value = alt.expansion[key] === "{value}" ? example : alt.expansion[key];
        return {
          key: renderName(key),
          value: value,
          delimiter: typeof value === 'string' && !value.includes('"') && alt.expansion[key] !== "{value}" ? '"' : '',
        };
      }),
    };
  });

  return emitCSharpTest({
    node,
    namespace,
    examples,
    coercions,
    factories: node.factories,
    renderName,
    renderCsharpFactoryMethodName: (factoryName: string) => renderCsharpFactoryMethodName(factoryName, node),
    renderCsharpFactoryTestValue,
  });
};

const renderName = (name: string): string => {
  // convert snake_case to PascalCase
  const pascal = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  // capitalize the first letter
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
};

const renderCsharpFactoryParamType = (typeStr: string): string => {
  switch (typeStr) {
    case "string": return "string";
    case "boolean": return "bool";
    case "integer": case "int32": return "int";
    case "int64": return "long";
    case "float": case "float32": return "float";
    case "float64": return "double";
    case "unknown": return "object?";
    default: return "object?";
  }
};

// Returns a factory method name that won't clash with C# property names on the same type.
// If the capitalized factory name matches a property name, prefix with "Create".
const renderCsharpFactoryMethodName = (factoryName: string, node: TypeNode): string => {
  const methodName = factoryName.charAt(0).toUpperCase() + factoryName.slice(1);
  const propertyNames = node.properties.map(p => renderName(p.name));
  if (propertyNames.includes(methodName)) {
    return `Create${methodName}`;
  }
  return methodName;
};

const renderCsharpFactoryTestValue = (typeStr: string): string => {
  switch (typeStr) {
    case "string": return '"test"';
    case "boolean": return "true";
    case "integer": case "int32": return "42";
    case "int64": return "42L";
    case "float": case "float32": return "3.14f";
    case "float64": return "3.14";
    case "unknown": return '"test"';
    default: return '"test"';
  }
};


const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/CSharp`;
  const typePath = type.typeName.namespace.split(".");

  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, filename);
  await emitFile(context.program, {
    path,
    content: python,
  });
}

/**
 * Format C# files using dotnet format.
 * Runs formatter from the .NET project root (where .csproj or .sln is located).
 */
function formatCSharpFiles(outputDir: string, testDir?: string): void {
  const dirs = [outputDir, ...(testDir ? [testDir] : [])];
  const formatted = new Set<string>();

  for (const dir of dirs) {
    const projectRoot = findDotNetProjectRoot(dir);
    if (!projectRoot) {
      console.warn(`Warning: Could not find .csproj or .sln file for ${dir}. Skipping formatting.`);
      continue;
    }

    // Avoid formatting the same project twice
    if (formatted.has(projectRoot)) {
      continue;
    }
    formatted.add(projectRoot);

    try {
      execFileSync("dotnet", ["format", projectRoot], {
        cwd: dirname(projectRoot),
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: dotnet format failed for ${projectRoot}. You may need to run it manually.`);
    }
  }
}

/**
 * Find the .NET project root by traversing up from the output directory
 * looking for .csproj or .sln files.
 */
function findDotNetProjectRoot(startDir: string): string | undefined {
  let currentDir = resolve(startDir);
  const root = resolve('/');

  // On Windows, also check for drive root (e.g., "C:\")
  while (currentDir !== root && currentDir !== dirname(currentDir)) {
    // First check for .csproj (more specific)
    const files = existsSync(currentDir) ? readdirSync(currentDir) : [];
    const csprojFile = files.find((f: string) => f.endsWith('.csproj'));
    if (csprojFile) {
      return resolve(currentDir, csprojFile);
    }

    // Then check for .sln
    const slnFile = files.find((f: string) => f.endsWith('.sln'));
    if (slnFile) {
      return resolve(currentDir, slnFile);
    }

    currentDir = dirname(currentDir);
  }

  return undefined;
}
