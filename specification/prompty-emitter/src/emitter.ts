import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { generateAst } from "./ast.js";
import { PromptyEmitterOptions } from "./lib.js";
import { generateMarkdown } from "./markdown.js";


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
  const ast = generateAst(context, model);

  console.log(`OPTIONS: ${JSON.stringify(context.options)}`);


  await generateMarkdown(context, ast);

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json", "output.json"),
    content: JSON.stringify(ast.getSanitizedObject(), null, 2),
  });
}

