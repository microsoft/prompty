import { EmitContext, emitFile, getDoc, getPropertyType, isTemplateInstance, Model, Program, resolvePath, Type } from "@typespec/compiler";
import { PromptyNode } from "./ast.js";
import { getUnionResolution } from "./decorators.js";
import { StateKeys } from "./lib.js";

export async function $onEmit(context: EmitContext) {
  // resolving top level Prompty model
  // this is the "Model" entry point for the emitter
  const m = context.program.resolveTypeReference("Prompty.Core.Prompty");
  if (!m[0] || m[0].kind !== "Model") {
    throw new Error(
      "Prompty.Core.Prompty model not found or is not a model type."
    );
  }
  const model = m[0];
  const ast = new PromptyNode("Prompty", model);
  ast.appendDescription(getDoc(context.program, model) || "");
  const children = resolveProperties(context.program, ast);
  ast.addChildren(children);

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "output.json"),
    content: JSON.stringify(ast.getSanitizedObject(), null, 2),
  });
}


const resolveProperties = (program: Program, node: PromptyNode): PromptyNode[] => {
  const properties: PromptyNode[] = [];
  // can only operate on Model types
  if (node.model.kind !== "Model") {
    return properties;
  }

  for (const [_, value] of node.model.properties) {
    const type = getPropertyType(value);
    const child = new PromptyNode(value.name, type);
    child.appendDescription(getDoc(program, value) || "");
    if (type.kind === "Model") {
      // recurse
      child.addChildren(resolveProperties(program, child));
    } else if (type.kind === "Union") {
      // handle union types
      const resolutions = getUnionResolution(program, value);
      for (const resolution of resolutions) {
        const resolutionNode = new PromptyNode(resolution.name, resolution.type, resolution.onlyDocs);
        if (isTemplateInstance(resolution.type)) {
          const templateType = resolution.type.templateMapper?.args.at(0);
          if (
            resolution.type.templateMapper?.args.length === 1 &&
            templateType !== undefined &&
            templateType.entityKind === "Type"
          ) {
            resolutionNode.appendDescription(getDoc(program, templateType) || "");
          }
        } else {
          resolutionNode.appendDescription(getDoc(program, resolution.type) || "");
        }
        // add the resolution node as a sibling
        child.addSibling(resolutionNode);
        if (!resolution.onlyDocs) {
          // if not onlyDocs, resolve properties of the type
          resolutionNode.addChildren(resolveProperties(program, resolutionNode));
        }
      }
    }
    properties.push(child);
  }


  return properties;
}
