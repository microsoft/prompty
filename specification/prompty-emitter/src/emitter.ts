import { EmitContext, emitFile, resolveModule, resolvePath } from "@typespec/compiler";
import { enumerateTypes, resolveModel, TypeName, TypeNode } from "./ast.js";
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

  const model = resolveModel(context.program, m[0], new Set());
  model.isRoot = true;
  const ast = Array.from(enumerateTypes(model));

  const options = {
    emitterOutputDir: context.emitterOutputDir,
    ...context.options,
  }

  const renamedAst: TypeNode[] = [];
  if (options["root-namespace"] || options["root-object"]) {
    const rootNamespace = options["root-namespace"] || "Prompty";
    for (const node of ast) {
      if (options["root-object"] && node.isRoot) {
        node.typeName.name = options["root-object"];
      }
      // replace first place of dotted namespace with rootNamespace
      node.typeName = resolveNamespace(node, rootNamespace);
      renamedAst.push(node);
    }
  }

  const targets = options["emit-targets"] || [];
  const targetNames = targets.map(t => t.type.toLowerCase());

  //console.log(`OPTIONS: ${JSON.stringify(options)}`);

  if (targetNames.includes("markdown")) {
    const idx = targetNames.indexOf("markdown");
    const target = targets[idx];
    // emit markdown
    await generateMarkdown(context, renamedAst.length > 0 ? renamedAst : ast, target["output-dir"]);
  }

  //await generatePython(context, ast);

  //await generateCsharp(context, ast);

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json", "model.json"),
    content: JSON.stringify(model.getSanitizedObject(), null, 2),
  });
}

const resolveNamespace = (node: TypeNode, rootNamespace: string): TypeName => {
  const parts = node.typeName.namespace.split(".");
  parts[0] = rootNamespace;
  return {
    namespace: parts.join("."),
    name: node.typeName.name,
    fullName: `${parts.join(".")}.${node.typeName.name}`,
  };
};
