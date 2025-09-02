import { EmitContext, emitFile, getTypeName, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeNode } from "./ast.js";
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

const csharpTypeNameMapper: Record<string, string> = {
  "Prompty": "AgentDefinition",
  "Input": "AgentInput",
  "Output": "AgentOutput",
  "Metadata": "AgentMetadata"
}

const csharpSkipTypes = [
  "ArrayOutput",
  "ArrayParameter",
  "ObjectOutput",
  "ObjectParameter",
  "FunctionTool",
  "ServerTool"
]

export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, nodes: TypeNode[], outputDir?: string) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/csharp'));
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


  for (const type of nodes) {
    if (csharpSkipTypes.includes(type.typeName.name) || (type.base && csharpSkipTypes.includes(type.base.name))) {
      continue;
    }

    const csharp = classTemplate.render({
      node: type,
      namespace: getNamespace(type),
      renderPropertyName: renderPropertyName,
      renderType: renderType,
      renderDefault: renderDefault,
      renderSummary: renderSummary,
      renderNullCoalescing: renderNullCoalescing,
      getClassName: getClassName,
      formatDescription: formatDescription,
    });

    const className = getClassName(type.typeName.name);
    await emitCsharpFile(context, type, csharp, `${className}.cs`, outputDir);
  }
}

const isClass = (node: TypeNode): boolean => {
  return false;
};

const getClassName = (name: string): string => {
  return csharpTypeNameMapper[name] || name;
};

const renderPropertyName = (prop: PropertyNode): string => {
  // convert snake_case to PascalCase
  const pascal = prop.name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  // capitalize the first letter
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
};

const renderType = (prop: PropertyNode): string => {
  let type = prop.isScalar ? (csharpTypeMapper[prop.typeName.name] || "Any") : prop.typeName.name;
  type = prop.isCollection ? `IList<${type}>` : type;
  type = `${type}${prop.isOptional ? "?" : ""}`;
  return type;
};

const renderDefault = (prop: PropertyNode): string => {
  /*
  if (prop.isCollection && !prop.isOptional) {
    return " = [];";
  }
  if (prop.typeName.name === "string" && !prop.isOptional) {
    return renderDefaultType(prop.typeName.name, prop.defaultValue);
  }
  if (prop.typeName.name === "boolean" && !prop.isOptional) {
    return renderDefaultType(prop.typeName.name, prop.defaultValue);
  }
  if (prop.typeName.name === "number" && !prop.isOptional) {
    return renderDefaultType(prop.typeName.name, prop.defaultValue);
  }
  if (prop.typeName.name === "object" && !prop.isOptional) {
    return " = new " + getClassName(prop.typeName.name) + "();";
  }
  if (prop.kind === "Union" && !prop.isOptional) {
    if (prop.variants.length > 0) {
      return renderDefaultType(prop.variants[0].kind.toLowerCase(), prop.defaultValue);
    }
  }
  if (!prop.isOptional) {
    return " = new " + getClassName(prop.typeName.name) + "();";
  }
  return "";
  */
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
  if (!prop.isOptional) {
    return " ?? throw new ArgumentException(\"Properties must contain a property named: " + prop.name + "\", nameof(props))";
  }
  return "";
};

const getNamespace = (node: TypeNode): string => {
  const parts = node.typeName.fullName.split(".");
  parts.pop(); // remove the last part (the type name)
  return parts.join(".");
};

const formatDescription = (input: string): string => {
  const lines = input.split('\n');
  const convertedLines = lines.map(line => `/// ${line}`);
  return convertedLines.join('\n');
}

const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/python`;
  const typePath = type.typeName.fullName.split(".");
  // remove typename
  typePath.pop();
  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, ...typePath);
  await emitFile(context.program, {
    path,
    content: python,
  });
}
