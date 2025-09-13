import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import path from "path";

const csharpTypeMapper: Record<string, string> = {
  "string": "string",
  "String": "string",
  "array": "[]",
  "object": "object",
  "boolean": "bool",
  "float32": "float",
  "unknown": "object",
  "unknown[]": "object[]",
}

const csharpTypeNameMapper: Record<string, string> = {
  "Input": "AgentInput",
  "Output": "AgentOutput",
  "Metadata": "AgentMetadata",
  "Record<unknown>": "Dictionary<string, object>",
}

const csharpSkipTypes = [
  "ArrayOutput",
  "ArrayParameter",
  "ObjectOutput",
  "ObjectParameter"
]

const numberTypes = [
  "int64",
  "float32"
]

export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, templateDir: string, nodes: TypeNode[], outputDir?: string) => {
  // set up template environment
  const templatePath = path.resolve(templateDir, 'csharp');
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const utilsTemplate = env.getTemplate('utils.njk', true);

  const rootNode = nodes.find(n => n.isRoot);
  if (!rootNode) {
    throw new Error("Root node not found");
  }

  const utils = utilsTemplate.render({
    namespace: getNamespace(rootNode),
  });

  await emitCsharpFile(context, rootNode, utils, "Utils.cs", outputDir);

  for (const node of nodes) {
    if (csharpSkipTypes.includes(node.typeName.name) || (node.base && csharpSkipTypes.includes(node.base.name))) {
      continue;
    }

    const csharp = classTemplate.render({
      node: node,
      renderPropertyName: renderPropertyName,
      renderType: renderType,
      renderDefault: renderDefault,
      renderSummary: renderSummary,
      renderNullCoalescing: renderNullCoalescing,
      getClassName: getClassName,
      isOverride: isOverride,
      isUrlLike: isUrlLike,
    });

    const className = getClassName(node.typeName.name);
    await emitCsharpFile(context, node, csharp, `${className}.cs`, outputDir);
  }
}

const getClassName = (name: string): string => {
  return csharpTypeNameMapper[name] || name;
};

const isOverride = (type: TypeNode, prop: PropertyNode): boolean => {
  // type.base needs to be a TypeNode so that I can check is a property being overridden
  // for now just hardcode the property types that do need to be overridden
  if (type.base && type.base.name === "Tool" && prop.name === "type") {
    return true;
  }
  return false;
};

const isUrlLike = (prop: PropertyNode): boolean => {
  return prop.name === "url" || prop.name.endsWith("Url");
};

const renderPropertyName = (prop: PropertyNode): string => {
  // convert snake_case to PascalCase
  const pascal = prop.name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  // capitalize the first letter
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
};

const renderType = (prop: PropertyNode): string => {
  let type = prop.isScalar ? (csharpTypeMapper[prop.typeName.name] || "object") : getClassName(prop.typeName.name);
  type = prop.isCollection ? `IList<${type}>` : type;
  type = `${type}${prop.isOptional ? "?" : ""}`;
  return type;
};

const renderDefault = (prop: PropertyNode): string => {
  if (!prop.isOptional) {
    if (prop.isCollection) {
      return " = [];";
    } else if (prop.isScalar) {
      return renderDefaultType(prop.typeName.name, prop.defaultValue);
    } else {
      return " = new " + getClassName(prop.typeName.name) + "();";
    }
  } else {
    return "";
  }
};

const renderDefaultType = (typeName: string, defaultValue: string | number | boolean | null = null): string => {
  if (typeName === "string") {
    return defaultValue ? " = \"" + defaultValue + "\";" : " = string.Empty;";
  }
  if (typeName === "boolean") {
    return defaultValue ? " = " + defaultValue + ";" : " = false;";
  }
  if (typeName === "number") {
    return defaultValue ? " = " + defaultValue + ";" : " = 0;";
  }
  if (typeName === "object") {
    return " = new " + getClassName(typeName) + "();";
  }
  return "";
};

const renderSummary = (prop: PropertyNode): string => {
  return "/// <summary>\n    /// " + prop.description + "\n    /// </summary>";
};

const renderNullCoalescing = (prop: PropertyNode): string => {
  if (!prop.isOptional && !isNumber(prop)) {
    return " ?? throw new ArgumentException(\"Properties must contain a property named: " + prop.name + "\", nameof(props))";
  }
  return "";
};

const isNumber = (prop: PropertyNode): boolean => {
  return numberTypes.includes(prop.typeName.name);
};

const getNamespace = (node: TypeNode): string => {
  const parts = node.typeName.namespace.split(".");
  return parts.join(".");
};

const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/CSharp`;
  const typePath = type.typeName.namespace.split(".");

  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, ...typePath);
  await emitFile(context.program, {
    path,
    content: python,
  });
}
