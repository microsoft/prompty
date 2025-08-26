import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNodeEx, TypeNodeEx } from "./ast.js";
import * as nunjucks from "nunjucks";

const pythonTypeMapper: Record<string, string> = {
  "string": "str",
  "number": "float",
  "array": "list",
  "object": "dict",
  "boolean": "bool"
}


export const generatePython = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNodeEx) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/python'));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const initTemplate = env.getTemplate('init.njk', true);

  const types = Array.from(enumerateTypes(node));

  const init = initTemplate.render({
    types: types,
    formatFile: typeLink,
  });

  await emitPythonFile(context, node, init, `__init__.py`);

  for (const type of types) {
    const includes: string[] = ["Optional"]; // all classes have option .ctor dict
    if (type.properties.some(prop => prop.isVariant)) {
      includes.push("Literal");
    }
    if (type.properties.some(prop => prop.typeName.includes("unknown"))) {
      includes.push("Any");
    }
    const python = classTemplate.render({
      node: type,
      imports: getImports(type),
      typingIncludes: includes,
      formatFile: typeLink,
      renderType: renderType(types),
      renderDefault: renderDefault(types),
    });

    await emitPythonFile(context, type, python, `_${typeLink(type.typeName)}.py`);
  }
}

const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');


const getImports = (node: TypeNodeEx): string[] => {
  const imports: string[] = [];
  if (node.baseType.length > 0) {
    imports.push(node.baseType);
  }
  for (const prop of node.properties) {
    if (prop.kind !== "Scalar" && !prop.isVariant && !prop.typeName.includes("unknown") && !imports.includes(prop.typeName)) {
      imports.push(prop.typeName);
    }
  }
  return imports.map(name => `from ._${typeLink(name)} import ${name}`);
};

const renderType = (types: TypeNodeEx[]) => (node: TypeNodeEx, prop: PropertyNodeEx): string => {
  if (prop.kind === "Scalar") {
    return renderOptionalList(`${pythonTypeMapper[prop.typeName]}`, prop.isCollection, prop.isOptional);
  } else {
    if (prop.isVariant) {
      if (prop.variants.length === 1) {
        // if single variant and has base type, should override
        const parent = types.find(t => t.typeName === node.baseType);
        if (parent) {
          // get same parent prop
          const parentProp = parent.properties.find(p => p.name === prop.name);
          const parentVariants = parentProp?.variants || [];
          if (parentVariants.length === 0) {
            return renderOptionalList(pythonTypeMapper[prop.variants[0].kind.toLowerCase()], prop.isCollection, prop.isOptional);
          } else {
            return `Literal[${parentVariants.map(v => v.kind === "String" ? `"${v.value}"` : v.value).join(", ")}]`;
          }
        } else {
          return renderOptionalList(pythonTypeMapper[prop.variants[0].kind.toLowerCase()], prop.isCollection, prop.isOptional);
        }
      } else {
        // full variant listing
        return `Literal[${prop.variants.map(v => v.kind === "String" ? `"${v.value}"` : v.value).join(", ")}]`;
      }
    } else {
      return renderOptionalList(prop.typeName, prop.isCollection, prop.isOptional);
    }
  }
};

const renderDefault = (types: TypeNodeEx[]) => (node: TypeNodeEx, prop: PropertyNodeEx): string => {
  if (prop.isCollection) {
    return ' = field(default_factory=list)';
  } else if (prop.kind === "Intrinsic") {
    return ' = field(default=None)';
  } else if (prop.kind === "Model" || prop.kind === "Union") {
    if (prop.isVariant) {
      return ` = field(default=${prop.variants[0].kind === "String" ? `"${prop.variants[0].value}"` : prop.variants[0].value})`;
    } else {
      return ` = field(default_factory=${prop.typeName})`;
    }
  } else if (prop.kind === "Scalar") {
    if (prop.typeName === "string") {
      return ` = field(default="${prop.defaultValue || ''}")`;
    } else if (prop.typeName === "number") {
      return ` = field(default=${prop.defaultValue || 0})`;
    } else if (prop.typeName === "boolean") {
      return ` = field(default=${prop.defaultValue ? "True" : "False"})`;
    }
  } else if (prop.isVariant) {
    return ` = field(default=${prop.variants[0].kind === "String" ? `"${prop.variants[0].value}"` : prop.variants[0].value})`;
  }
  return "";
};

const renderOptionalList = (name: string, isCollection: boolean, isOptional: boolean): string => {
  const optional = isOptional ? `Optional[` : ``;
  const collection = isCollection ? `list[` : ``;
  return `${optional}${collection}${name.includes("unknown") ? "Any" : name}${collection ? `]` : ``}${optional ? `]` : ``}`;
};

const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNodeEx, python: string, filename: string) => {
  const typePath = type.fullTypeName.split(".").map(part => typeLink(part));
  // remove typename
  typePath.pop();
  // replace typename with file
  typePath.push(filename);
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "python", ...typePath),
    content: python,
  });
}
