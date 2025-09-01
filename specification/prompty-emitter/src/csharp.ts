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

export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNode) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/csharp'));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const utilsTemplate = env.getTemplate('utils.njk', true);

  const utils = utilsTemplate.render({
    namespace: getNamespace(node),
  });

  await emitCsharpFile(context, node, utils, "Utils.cs");

  const types = Array.from(enumerateTypes(node));

  for (const type of types) {
    if (csharpSkipTypes.includes(type.typeName)) {
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

    const className = getClassName(type.typeName);
    await emitCsharpFile(context, type, csharp, `${className}.cs`);
  }
}

const isClass = (node: TypeNode): boolean => {
  return node.kind === "Model" && node.properties.length > 0;
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
  const nameRender = (name: string): string => {
    name = prop.isCollection ? `IList<${name}>` : name;
    return `${name}${prop.isOptional ? "?" : ""}`;
  };
  if (prop.kind === "Scalar" || prop.kind === "Intrinsic") {
    return nameRender(csharpTypeMapper[prop.typeName]);
  } else if (prop.kind === "Model") {
    if (prop.typeName === "unknown") {
      return nameRender("object");
    } else {
      return nameRender(getClassName(prop.typeName));
    }
  } else if (prop.kind === "Union") {
    if (prop.variants.length > 0) {
      return nameRender(csharpTypeMapper[prop.variants[0].kind]);
    } else {
      return nameRender(getClassName(prop.typeName));
    }
  } else {
    return nameRender(csharpTypeMapper[prop.kind]);
  }
};

const renderDefault = (prop: PropertyNode): string => {
  if (prop.isCollection && !prop.isOptional) {
    return " = [];";
  }
  if (prop.typeName === "string" && !prop.isOptional) {
    return renderDefaultType(prop.typeName, prop.defaultValue);
  }
  if (prop.typeName === "boolean" && !prop.isOptional) {
    return renderDefaultType(prop.typeName, prop.defaultValue);
  }
  if (prop.typeName === "number" && !prop.isOptional) {
    return renderDefaultType(prop.typeName, prop.defaultValue);
  }
  if (prop.typeName === "object" && !prop.isOptional) {
    return " = new " + getClassName(prop.typeName) + "();";
  }
  if (prop.kind === "Union" && !prop.isOptional) {
    if (prop.variants.length > 0) {
      return renderDefaultType(prop.variants[0].kind.toLowerCase(), prop.defaultValue);
    }
  }
  if (!prop.isOptional)
  {
    return " = new " + getClassName(prop.typeName) + "();";
  }
  return "";
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
  const parts = node.fullTypeName.split(".");
  parts.pop(); // remove the last part (the type name)
  return parts.join(".");
};

const formatDescription = (input: string): string => {  
    const lines = input.split('\n');  
    const convertedLines = lines.map(line => `/// ${line}`);  
    return convertedLines.join('\n');  
}  

const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string) => {
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "csharp", "generated", "Definition", filename),
    content: python,
  });
}
