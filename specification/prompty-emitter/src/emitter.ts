import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { enumerateTypes, resolveModel } from "./ast.js";
import { PromptyEmitterOptions } from "./lib.js";
import { generateMarkdown } from "./markdown.js";
import { generatePython } from "./python.js";
import { generateCsharp } from "./csharp.js";


export async function $onEmit(context: EmitContext<PromptyEmitterOptions>) {

  const options = {
    emitterOutputDir: context.emitterOutputDir,
    templateDir: path.resolve(__dirname, 'templates'),
    ...context.options,
  }

  
  // resolving top level Prompty model
  // this is the "Model" entry point for the emitter
  const m = context.program.resolveTypeReference(options["root-object"]);
  if (!m[0] || m[0].kind !== "Model") {
    throw new Error(
      `${options["root-object"]} model not found or is not a model type.`
    );
  }



  const model = resolveModel(context.program, m[0], new Set(), options["root-namespace"] || "Prompty");
  model.isRoot = true;
  if(options["root-alias"]){
    model.typeName = {
      namespace: model.typeName.namespace,
      name: options["root-alias"],
      fullName: `${model.typeName.namespace}.${options["root-alias"]}`
    }
  }
  const ast = Array.from(enumerateTypes(model));


  const targets = options["emit-targets"] || [];
  const targetNames = targets.map(t => t.type.toLowerCase().trim());


  if (targetNames.includes("markdown")) {
    const idx = targetNames.indexOf("markdown");
    const target = targets[idx];
    // emit markdown
    await generateMarkdown(context, options.templateDir, ast, target["output-dir"]);
  }

  if (targetNames.includes("python")) {
    const idx = targetNames.indexOf("python");
    const target = targets[idx];
    // emit python
    await generatePython(context, options.templateDir, ast, target["output-dir"]);
  }

  if (targetNames.includes("csharp")) {
    const idx = targetNames.indexOf("csharp");
    const target = targets[idx];
    // emit csharp
    await generateCsharp(context, options.templateDir, ast, target["output-dir"]);
  }

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json-ast", "model.json"),
    content: JSON.stringify(model.getSanitizedObject(), null, 2),
  });
}
