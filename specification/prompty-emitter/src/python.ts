import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";

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
  const classTemplate = env.getTemplate('dataclass.njk', true);

  const types = Array.from(enumerateTypes(node));

  for (const type of types) {
    const includes: string[] = [];
    if(type.properties.some(prop => prop.typeName.includes("|"))) {
      includes.push("Literal");
    }
    if(type.properties.some(prop => prop.isOptional)) {
      includes.push("Optional");
    }
    const python = classTemplate.render({
      node: type,
      typingIncludes: includes,
      formatFile: typeLink,
      renderType: renderType,
      renderDefault: renderDefault,
    });

    await emitPythonFile(context, type.typeName, python);
  }
}

const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');


const renderType = (prop: PropertyNode): string => {
  if (prop.kind === "Scalar") {
    return renderOptionalList(`${pythonTypeMapper[prop.typeName]}`, prop.isCollection, prop.isOptional);
  } else {
    if (prop.typeName.includes('"')) {
      return `Literal[${prop.typeName.replaceAll(" | ", ", ")}]`;
    } else {
      return renderOptionalList(prop.typeName, prop.isCollection, prop.isOptional);
    }
  }
};

const renderDefault = (prop: PropertyNode): string => {
  if (prop.isCollection) {
    return ' = field(default_factory=list)';
  } else if (prop.kind === "Intrinsic") {
    return ' = field(default=None)';
  } else if (prop.kind === "Model" || prop.kind === "Union") {
    if (prop.typeName.includes("|")) {
      const props = prop.typeName.split("|");
      return ` = field(default=${props[0].trim()})`;
    } else {
      return ` = field(default_factory=${prop.typeName})`;
    }
  } else if (prop.kind === "Scalar") {
    if (prop.typeName === "string") {
      return ' = field(default="")';
    } else if (prop.typeName === "number") {
      return ' = field(default=0)';
    } else if (prop.typeName === "boolean") {
      return ' = field(default=False)';
    }
  }
  return "";
};

const renderOptionalList = (name: string, isCollection: boolean, isOptional: boolean): string => {
  const optional = isOptional ? `Optional[` : ``;
  const collection = isCollection ? `list[` : ``;
  return `${optional}${collection}${name.includes("unknown") ? "Any" : name}${collection ? `]` : ``}${optional ? `]` : ``}`;
};

const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, name: string, python: string) => {
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "python", `_${typeLink(name)}.py`),
    content: python,
  });
}
