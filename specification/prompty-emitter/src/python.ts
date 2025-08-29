import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";

const pythonTypeMapper: Record<string, string> = {
  "string": "str",
  "number": "float",
  "array": "list",
  "object": "dict",
  "boolean": "bool"
}


export const generatePython = async (context: EmitContext<PromptyEmitterOptions>, nodes: TypeNode[]) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/python'));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const initTemplate = env.getTemplate('init.njk', true);

  const init = initTemplate.render({
    types: nodes,
    formatFile: typeLink,
  });

  //await emitPythonFile(context, node, init, `__init__.py`);

}

const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');


const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string) => {
  const typePath = type.typeName.fullName.split(".").map(part => typeLink(part));
  // remove typename
  typePath.pop();
  // replace typename with file
  typePath.push(filename);
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "python", ...typePath),
    content: python,
  });
}
