import { EmitContext, emitFile, getDoc, getEntityName, getPropertyType, getTypeName, isTemplateInstance, Program, resolvePath } from "@typespec/compiler";
import { PromptyNode } from "./ast.js";
import { getUnionResolution } from "./decorators.js";
import { PromptyEmitterOptions } from "./lib.js";
import * as nunjucks from "nunjucks";

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
  const ast = new PromptyNode("Prompty", model);
  ast.appendDescription(getDoc(context.program, model) || "");
  const children = resolveProperties(context.program, ast);
  ast.addChildren(children);

  console.log(`OPTIONS: ${JSON.stringify(context.options)}`);

  // set up template environment
  var env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates'));

  // markdown output
  if (true) {
    const markdown = env.render('markdown.njk', {
      node: ast,
      depth: 0,
    });
    await emitFile(context.program, {
      path: resolvePath(context.emitterOutputDir, "markdown", "output.md"),
      content: markdown,
    });
  }

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "json", "output.json"),
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
      child.fullTypeName = getTypeName(type);
      child.typeName = getTypeName(type, {
        nameOnly: true,
        printable: true,
      });
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
            resolutionNode.fullTypeName = getEntityName(templateType);
            resolutionNode.typeName = getTypeName(templateType, {
              nameOnly: true,
              printable: true,
            });
          }
        } else {
          resolutionNode.appendDescription(getDoc(program, resolution.type) || "");
        }
        //resolutionNode.typeName = value.name;
        // add the resolution node as a sibling
        child.addSibling(resolutionNode);
        // resolve properties of the type
        resolutionNode.addChildren(resolveProperties(program, resolutionNode));
      }
    } else {
      child.fullTypeName = getTypeName(type);
      child.typeName = getTypeName(type, {
        nameOnly: true,
        printable: true,
      });
    }
    properties.push(child);
  }


  return properties;
}
