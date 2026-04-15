import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import { existsSync, unlinkSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { EmitContext, emitFile, resolvePath, Namespace } from "@typespec/compiler";
import { resolveModel, TypeNode, enumerateTypes } from "./ir/ast.js";
import { PromptyEmitterOptions, EmitTarget } from "./lib.js";
import { generateMarkdown } from "./languages/markdown/driver.js";
import { generatePython } from "./languages/python/driver.js";
import { generateCsharp } from "./languages/csharp/driver.js";
import { generateTypeScript } from "./languages/typescript/driver.js";
import { generateGo } from "./languages/go/driver.js";
import { generateRust } from "./languages/rust/driver.js";

// Generator options passed to each generator
export interface GeneratorOptions {
  omitModels?: string[];
  additionalModels?: TypeNode[];
}

/**
 * Filter nodes based on omit-models option.
 * Matches against model name (e.g., "AgentManifest") or fully qualified name (e.g., "Prompty.AgentManifest")
 */
export function filterNodes(nodes: TypeNode[], options?: GeneratorOptions): TypeNode[] {
  const omitModels = options?.omitModels || [];

  // Include additional root models and their type trees
  const additionalModels = options?.additionalModels || [];
  if (additionalModels.length > 0) {
    const existingNames = new Set(nodes.map(n => `${n.typeName.namespace}.${n.typeName.name}`));
    const visited = new Set(existingNames);
    for (const additionalModel of additionalModels) {
      for (const subNode of enumerateTypes(additionalModel, new Set())) {
        const fullName = `${subNode.typeName.namespace}.${subNode.typeName.name}`;
        if (!visited.has(fullName)) {
          nodes.push(subNode);
          visited.add(fullName);
        }
      }
    }
  }

  if (omitModels.length === 0) return nodes;

  return nodes.filter(node => {
    const name = node.typeName.name;
    const fullName = `${node.typeName.namespace}.${name}`;
    return !omitModels.includes(name) && !omitModels.includes(fullName);
  });
}

// Generator function type for code emitters
type GeneratorFn = (
  context: EmitContext<PromptyEmitterOptions>,
  templateDir: string,
  model: TypeNode,
  target: EmitTarget,
  options?: GeneratorOptions
) => Promise<void>;

// Registry of available code generators
const generators: Record<string, GeneratorFn> = {
  markdown: generateMarkdown,
  python: generatePython,
  csharp: generateCsharp,
  typescript: generateTypeScript,
  go: generateGo,
  rust: generateRust,
};


export async function $onEmit(context: EmitContext<PromptyEmitterOptions>) {

  const options = {
    emitterOutputDir: context.emitterOutputDir,
    templateDir: path.resolve(__dirname, 'templates'),
    ...context.options,
  }


  // resolving top level Prompty model
  // this is the "Model" entry point for the emitter
  const rootObject = options["root-object"];
  const m = context.program.resolveTypeReference(rootObject);
  if (!m[0] || m[0].kind !== "Model") {
    throw new Error(
      `${rootObject} model not found or is not a model type.`
    );
  }

  const model = resolveModel(context.program, m[0], new Set(), options["root-namespace"] || "Prompty", options["root-alias"] || "Prompty");
  if (options["root-alias"]) {
    model.typeName = {
      namespace: model.typeName.namespace,
      name: options["root-alias"]
    }
  }

  // Discover additional models not reachable from the root.
  // If root-namespace is specified, resolve all models in that namespace
  // so new types are automatically emitted without manual additional-roots.
  const rootNamespace = options["root-namespace"] || "Prompty";
  const additionalModels: TypeNode[] = [];
  const visited = new Set<string>();

  // Collect names already in the main model tree to avoid duplicates
  const collectNames = (node: TypeNode) => {
    visited.add(`${node.typeName.namespace}.${node.typeName.name}`);
    for (const child of node.childTypes) {
      collectNames(child);
    }
    for (const prop of node.properties) {
      if (prop.type) {
        collectNames(prop.type);
        for (const child of prop.type.childTypes) {
          collectNames(child);
        }
      }
    }
  };
  collectNames(model);

  // Resolve the namespace and iterate all models
  const nsRef = context.program.resolveTypeReference(rootNamespace);
  if (nsRef[0] && nsRef[0].kind === "Namespace") {
    const ns = nsRef[0] as Namespace;
    for (const [, nsModel] of ns.models) {
      const fullName = `${rootNamespace}.${nsModel.name}`;
      if (visited.has(fullName)) continue;

      // Skip uninstantiated template declarations (e.g., Named<T>, Id<T>)
      if (nsModel.node && 'templateParameters' in nsModel.node &&
          nsModel.node.templateParameters.length > 0 && !nsModel.templateMapper) {
        continue;
      }

      const additionalNode = resolveModel(
        context.program, nsModel, new Set(),
        rootNamespace,
        options["root-alias"] || "Prompty"
      );
      additionalModels.push(additionalNode);
      visited.add(fullName);
    }
  }

  // Also process any explicit additional-roots (for types outside the namespace)
  const additionalRoots = options["additional-roots"] || [];
  for (const rootName of additionalRoots) {
    if (visited.has(rootName)) continue;
    const ref = context.program.resolveTypeReference(rootName);
    if (!ref[0] || ref[0].kind !== "Model") {
      console.warn(`Warning: additional-root '${rootName}' not found or is not a model type. Skipping.`);
      continue;
    }
    const additionalNode = resolveModel(
      context.program, ref[0], new Set(),
      rootNamespace,
      options["root-alias"] || "Prompty"
    );
    additionalModels.push(additionalNode);
    visited.add(rootName);
  }

  const targets = options["emit-targets"] || [];
  const generatorOptions: GeneratorOptions = {
    omitModels: options["omit-models"] || [],
    additionalModels: additionalModels,
  };

  // Dispatch to registered generators
  for (const target of targets) {
    const generatorName = target.type.toLowerCase().trim();
    const generator = generators[generatorName];
    if (generator) {
      await generator(context, options.templateDir, model, target, generatorOptions);
    }
  }

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json-ast", "model.json"),
    content: JSON.stringify(model.getSanitizedObject(), null, 2),
  });

  // Clean up omitted models from schema directory if specified
  const schemaDir = options["schema-output-dir"];
  const omitModels = options["omit-models"] || [];
  if (schemaDir && omitModels.length > 0) {
    const resolvedSchemaDir = resolvePath(context.emitterOutputDir, schemaDir);
    if (existsSync(resolvedSchemaDir)) {
      for (const model of omitModels) {
        // Try both .yaml and .json extensions
        for (const ext of [".yaml", ".json"]) {
          const schemaFile = path.join(resolvedSchemaDir, `${model}${ext}`);
          if (existsSync(schemaFile)) {
            unlinkSync(schemaFile);
          }
        }
      }
    }
  }
}
