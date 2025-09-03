import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { enumerateTypes, resolveModel } from "./ast.js";
import { PromptyEmitterOptions } from "./lib.js";
import { generateMarkdown } from "./markdown.js";
import { generatePython } from "./python.js";
import { generateCsharp } from "./csharp.js";


export async function $onEmit(context: EmitContext<PromptyEmitterOptions>) {
  // resolving top level Prompty model
  // this is the "Model" entry point for the emitter
  const m = context.program.resolveTypeReference("Prompty.Core.Prompty");
  if (!m[0] || m[0].kind !== "Model") {
    throw new Error(
      "Prompty.Core.Prompty model not found or is not a model type."
    );
  }

  const options = {
    emitterOutputDir: context.emitterOutputDir,
    ...context.options,
  }

  const model = resolveModel(context.program, m[0], new Set(), options["root-namespace"] || "Prompty");
  model.isRoot = true;
  if(options["root-object"]){
    model.typeName = {
      namespace: model.typeName.namespace,
      name: options["root-object"],
      fullName: `${model.typeName.namespace}.${options["root-object"]}`
    }
  }
  const ast = Array.from(enumerateTypes(model));


  const targets = options["emit-targets"] || [];
  const targetNames = targets.map(t => t.type.toLowerCase().trim());


  if (targetNames.includes("markdown")) {
    const idx = targetNames.indexOf("markdown");
    const target = targets[idx];
    // emit markdown
    await generateMarkdown(context, ast, target["output-dir"]);
  }

  if (targetNames.includes("python")) {
    const idx = targetNames.indexOf("python");
    const target = targets[idx];
    // emit python
    await generatePython(context, ast, target["output-dir"]);
  }

  if (targetNames.includes("csharp")) {
    const idx = targetNames.indexOf("csharp");
    const target = targets[idx];
    // emit csharp
    await generateCsharp(context, ast, target["output-dir"]);
  }

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json-ast", "model.json"),
    content: JSON.stringify(model.getSanitizedObject(), null, 2),
  });
}
