import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import { existsSync, unlinkSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { resolveModel, TypeNode } from "./ast.js";
import { AgentSchemaEmitterOptions, EmitTarget } from "./lib.js";
import { generateMarkdown } from "./markdown.js";
import { generatePython } from "./python.js";
import { generateCsharp } from "./csharp.js";
import { generateTypeScript } from "./typescript.js";
import { generateGo } from "./go.js";
import { generateRust } from "./rust.js";

// Generator options passed to each generator
export interface GeneratorOptions {
  omitModels?: string[];
}

/**
 * Filter nodes based on omit-models option.
 * Matches against model name (e.g., "AgentManifest") or fully qualified name (e.g., "AgentSchema.AgentManifest")
 */
export function filterNodes(nodes: TypeNode[], options?: GeneratorOptions): TypeNode[] {
  const omitModels = options?.omitModels || [];
  if (omitModels.length === 0) return nodes;

  return nodes.filter(node => {
    const name = node.typeName.name;
    const fullName = `${node.typeName.namespace}.${name}`;
    return !omitModels.includes(name) && !omitModels.includes(fullName);
  });
}

// Generator function type for code emitters
type GeneratorFn = (
  context: EmitContext<AgentSchemaEmitterOptions>,
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


export async function $onEmit(context: EmitContext<AgentSchemaEmitterOptions>) {

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

  const model = resolveModel(context.program, m[0], new Set(), options["root-namespace"] || "AgentSchema", options["root-alias"] || "AgentSchema");
  if (options["root-alias"]) {
    model.typeName = {
      namespace: model.typeName.namespace,
      name: options["root-alias"]
    }
  }

  const targets = options["emit-targets"] || [];
  const generatorOptions: GeneratorOptions = {
    omitModels: options["omit-models"] || [],
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
