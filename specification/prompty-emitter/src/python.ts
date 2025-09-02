import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";

const pythonTypeMapper: Record<string, string> = {
  "string": "str",
  "number": "float",
  "array": "list",
  "object": "dict",
  "boolean": "bool",
  "int64": "int",
  "int32": "int",
  "float64": "float",
  "float32": "float"
}


export const generatePython = async (context: EmitContext<PromptyEmitterOptions>, nodes: TypeNode[], outputDir?: string) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/python'));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const initTemplate = env.getTemplate('init.njk', true);

  const rootNode = nodes.filter(n => n.isRoot)[0];

  const init = initTemplate.render({
    types: nodes,
  });

  await emitPythonFile(context, rootNode, init, `__init__.py`, outputDir);

  for (const node of nodes) {
    const includes = importIncludes(node);
    const python = classTemplate.render({
      node: node,
      typings: includes,
      imports: importTypes(node),
      renderType: renderType,
      renderDefault: renderDefault
    });
    await emitPythonFile(context, node, python, `_${node.typeName.name}.py`, outputDir);
  }

}

const renderType = (prop: PropertyNode): string => {
  let type = prop.isScalar ? (pythonTypeMapper[prop.typeName.name] || "Any") : prop.typeName.name;
  if (prop.isCollection) {
    type = `List[${type}]`;
  }
  if (prop.isOptional) {
    type = `Optional[${type}]`;
  }
  return type;
}

const renderDefault = (prop: PropertyNode): string => {
  if (prop.isCollection) {
    return " = field(default_factory=list)";
  } else if (prop.isScalar) {
    if (prop.typeName.name === "boolean") {
      return " = field(default=False)";
    } else if (prop.typeName.name === "string") {
      return " = field(default=\"\")";
    } else if (prop.typeName.name === "number") {
      return " = field(default=0)";
    } else {
      return " = field(default=None)";
    }
  } else if (prop.isOptional) {
    return " = field(default=None)";
  } else {
    return ` = field(default_factory=${prop.typeName.name})`;
  }
}

const importIncludes = (node: TypeNode): string[] => {
  const includes = new Set<string>();
  // always add Optional for loaders
  includes.add("Optional");
  for (const prop of node.properties) {
    if (prop.isAny) {
      includes.add("Any");
    }
    if (prop.isCollection) {
      includes.add("List");
    }
  }
  return Array.from(includes);
};

const importTypes = (node: TypeNode): string[] => {
  const imports = new Set<string>(node.properties.filter(p => !p.isScalar).map(p => p.typeName.name));
  if (node.base) {
    imports.add(node.base.name);
  }
  return Array.from(imports);
};

const typeLink = (name: string) =>
  name.toLowerCase().replaceAll(' ', '-');


const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/python`;
  const typePath = type.typeName.fullName.split(".").map(part => typeLink(part));
  // remove typename
  typePath.pop();
  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, ...typePath);
  await emitFile(context.program, {
    path: resolvePath(path),
    content: python,
  });
}
