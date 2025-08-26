import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { enumerateTypes, resolveType, resolveTypeEx } from "./ast.js";
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
  const model = m[0];
  const ast = resolveTypeEx(context.program, model, new Set());

  const alt = resolveType(context.program, model, new Set());

  const options = {
    emitterOutputDir: context.emitterOutputDir,
    ...context.options,
  }

  console.log(`OPTIONS: ${JSON.stringify(options)}`);


  await generateMarkdown(context, ast);

  await generatePython(context, ast);

  await generateCsharp(context, ast);

  const flat = Array.from(enumerateTypes(ast.getSanitizedObject() as any));

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json", "output_flat_redefined.json"),
    content: JSON.stringify(flat, null, 2),
  });
}


