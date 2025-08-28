import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { enumerateTypesEx, PropertyNodeEx, TypeNodeEx } from "./ast.js";
import * as nunjucks from "nunjucks";

const csharpTypeMapper: Record<string, string> = {
  "string": "string",
  "String": "string",
  "array": "[]",
  "object": "object",
  "boolean": "bool",
  "unknown": "object",
  "unknown[]": "object[]",
}


export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNodeEx) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/csharp'));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const utilsTemplate = env.getTemplate('utils.njk', true);

  const utils = utilsTemplate.render({
    namespace: getNamespace(node),
  });

  await emitCsharpFile(context, node, utils, "Utils.cs");

  const types = Array.from(enumerateTypesEx(node));

  for (const type of types) {
    const csharp = classTemplate.render({
      node: type,
      namespace: getNamespace(type),
      renderPropertyName: renderPropertyName,
      renderType: renderType,
      renderDefault: renderDefault,
    });

    await emitCsharpFile(context, type, csharp, `${type.typeName}.cs`);
  }
}

const renderPropertyName = (prop: PropertyNodeEx): string => {
  // convert snake_case to PascalCase
  const pascal = prop.name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  // capitalize the first letter
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
};

const renderType = (prop: PropertyNodeEx): string => {
  const nameRender = (name: string): string => {
    return `${name}${prop.isOptional && !prop.isCollection ? "?" : ""}${prop.isCollection ? "[]" : ""}`;
  };
  if (prop.kind === "Scalar" || prop.kind === "Intrinsic") {
    return nameRender(csharpTypeMapper[prop.typeName]);
  } else if (prop.kind === "Model") {
    if (prop.typeName === "unknown") {
      return nameRender("object");
    } else {
      return nameRender(prop.typeName);
    }
  } else if (prop.kind === "Union") {
    if (prop.variants.length > 0) {
      return nameRender(csharpTypeMapper[prop.variants[0].kind]);
    } else {
      return nameRender(prop.typeName);
    }
  } else {
    return nameRender(csharpTypeMapper[prop.kind]);
  }
};

const renderDefault = (prop: PropertyNodeEx): string => {
  if (prop.isCollection) {
    return " = [];";
  }
  return "";
};

const getNamespace = (node: TypeNodeEx): string => {
  const parts = node.fullTypeName.split(".");
  parts.pop(); // remove the last part (the type name)
  return parts.join(".");
};



const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNodeEx, python: string, filename: string) => {
  const typePath = type.fullTypeName.split(".");
  // remove typename
  typePath.pop();
  // replace typename with file
  typePath.push(filename);
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "csharp", ...typePath),
    content: python,
  });
}
