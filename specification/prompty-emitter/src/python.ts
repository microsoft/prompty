import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import { text } from "stream/consumers";

const pythonTypeMapper: Record<string, string> = {
  "string": "str",
  "number": "float",
  "array": "list",
  "object": "dict",
  "boolean": "bool"
}


export const generatePython = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNode) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/python'));
  const preambleTemplate = env.getTemplate('preamble.njk', true);
  const classTemplate = env.getTemplate('dataclass.njk', true);

  emitPython(context, preambleTemplate, classTemplate, node, false);
}

const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');

const emitPython = async (context: EmitContext<PromptyEmitterOptions>,
  preambleTemplate: nunjucks.Template,
  classTemplate: nunjucks.Template,
  node: TypeNode, inline: boolean = false): Promise<string> => {
  const markdown = classTemplate.render({
    node: node,
    renderType: renderType,
  });

  if (inline) {
    const props = await Promise.all(node.properties.flatMap(async (p) => {
      return await Promise.all(p.type.map(async (t) => { return await emitPython(context, preambleTemplate, classTemplate, t, true) }));
    }));

    const content = markdown + props.flatMap(p => p).filter(p => p && p.length > 0).join("\n");
    return content;

  } else {
    // emit preamble
    const rootPreamble = preambleTemplate.render({
      node: node,
      renderType: renderType,
    });
    // return root
    await emitPythonFile(context, node.typeName, rootPreamble + markdown);
    // emit file for prop (since not inline)
    for (const prop of node.properties.filter(p => p.type.length > 0)) {
      const props = await Promise.all(prop.type.map(async (t) =>
        await emitPython(context, preambleTemplate, classTemplate, t, true)
      ));
      const preamble = preambleTemplate.render({
        node: node,
        renderType: renderType,
      });
      await emitPythonFile(context, prop.name, preamble + props.join("\n"));
    }

    return markdown;
  }

}

const renderType = (prop: PropertyNode): string => {
  if (prop.kind === "Scalar") {
    return renderOptionalList(`${pythonTypeMapper[prop.typeName]}`, prop.isCollection, prop.isOptional);
  } else {
    if (prop.typeName.includes('"')) {
      return `Literal[${prop.typeName.replaceAll(" | ", ", ")}]`;
    } else {
      return renderOptionalList(`"${prop.typeName}"`, prop.isCollection, prop.isOptional);
    }
  }
};

const renderOptionalList = (name: string, isCollection: boolean, isOptional: boolean): string => {
  const optional = isOptional ? `Optional[` : ``;
  const collection = isCollection ? `list[` : ``;
  return `${optional}${collection}${name.includes("unknown") ? "Any" : name}${collection ? `]` : ``}${optional ? `]` : ``}`;
};

const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, name: string, python: string) => {
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "python", `${typeLink(name)}.py`),
    content: python,
  });
}
