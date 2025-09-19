import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import path from "path";

const csharpTypeMapper: Record<string, string> = {
  "string": "string",
  "number": "float",
  "array": "[]",
  "object": "object",
  "boolean": "bool",
  "int64": "int",
  "int32": "int",
  "float64": "double",
  "float32": "float",
  "integer": "int",
  "float": "float",
  "numeric": "float",
  "dictionary": "IDictionary<string, object>",
};

const numberTypes = [
  "float32",
  "float64",
  "number",
  "int32",
  "int64",
  "numeric",
  "integer",
  "float",
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
    namespace: rootNode.typeName.namespace,
  });

  await emitCsharpFile(context, rootNode, utils, "Utils.cs", outputDir);

  const findType = (typeName: string): TypeNode | undefined => {
    return nodes.find(n => n.typeName.name === typeName);
  }

  for (const node of nodes) {
    const polymorphicTypes = node.retrievePolymorphicTypes();

    const csharp = classTemplate.render({
      node: node,
      renderPropertyName: renderPropertyName,
      renderType: renderType,
      renderDefault: renderDefault,
      renderSetInstance: renderSetInstance,
      renderSummary: renderSummary,
      renderPropertyModifier: renderPropertyModifier(findType, node),
      renderNullCoalescing: renderNullCoalescing,
      polymorphicTypes: polymorphicTypes,
      collectionTypes: node.properties.filter(p => p.isCollection && !p.isScalar),
      alternates: generateAlternates(node),
    });

    //const className = getClassName(node.typeName.name);
    await emitCsharpFile(context, node, csharp, `${node.typeName.name}.cs`, outputDir);
  }
};

const renderPropertyName = (prop: PropertyNode): string => {
  // convert snake_case to PascalCase
  const pascal = prop.name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  // capitalize the first letter
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
};

/**
 * Renders the property modifier for a given property (e.g. override, virtual or even nothing)
 * @param node TypeNode
 * @returns function that takes a PropertyNode and returns the property modifier string
 */
const renderPropertyModifier = (findType: (typeName: string) => TypeNode | undefined, node: TypeNode) => (prop: PropertyNode): string => {
  // has children and children have the same property name - need to make virtual
  if (node.childTypes.length > 0 && node.childTypes.some(ct => ct.properties.some(p => p.name === prop.name))) {
    // if the property is required and is a complex type, make it virtual to allow for mocking
    return "virtual ";
  }
  // has a parent and parent has the same property name - need to override
  if (node.base && findType(node.base.name)?.properties.some(p => p.name === prop.name)) {
    return "override ";
  }
  return "";
};
/*
        if (props is bool)
        {
            data = new Dictionary<string, object> { { "kind", "boolean" }, { "default", (bool)props } };
        }
        else if (props is int || props is long || props is float || props is double || props is decimal)
        {
            data = new Dictionary<string, object> { { "kind", "number" }, { "default", props } };
        }
        else if (props is string)
        {
            data = new Dictionary<string, object> { { "kind", "string" }, { "default", props } };
        }
        else
        {
            data = props.ToParamDictionary();
        }
*/

const recursiveExpand = (obj: any): any => {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(item => recursiveExpand(item));
    } else {
      const expanded: any = {};
      for (const key in obj) {
        expanded[key] = recursiveExpand(obj[key]);
      }
      return expanded;
    }
  }
  return obj;
};

const generateAlternates = (node: TypeNode): { scalar: string; alternate: string }[] => {
  if (node.alternates && node.alternates.length > 0) {
    const alternates: { scalar: string; alternate: string }[] = [];
    for (const alt of node.alternates) {
      const scalar = csharpTypeMapper[alt.scalar] || "object";

      // Process each alternate
      const expansion: string[] = [];
      for (const key in alt.expansion) {
        const value = alt.expansion[key];
        // check if valu is a string
        if (value === "{value}") {
          expansion.push(`{"${key}", ${scalar}Value}`);
        } else {
          if (typeof value === 'string') {
            expansion.push(`{"${key}", "${value}"}`);
          } else {
            expansion.push(`{"${key}", ${value}}`);
          }
        }
      }
      alternates.push({
        scalar: scalar,
        alternate: expansion.join(", ")
      });
    }
    return alternates;
  } else {
    return [];
  }
};

const isNonNullableValueType = (typeName: string): boolean => {
  return ["int", "float", "double", "bool"].includes(typeName);
};

const renderType = (prop: PropertyNode): string => {
  return `${renderSimpleType(prop)}${prop.isOptional ? "?" : ""}`;
};

const renderSimpleType = (prop: PropertyNode): string => {
  let type = prop.isScalar ? csharpTypeMapper[prop.typeName.name] || "object" : prop.typeName.name;
  type = prop.isCollection ? `IList<${type}>` : type;
  return type;
};

const renderDefault = (prop: PropertyNode): string => {
  if (!prop.isOptional) {
    if (prop.isCollection) {
      return " = [];";
    } else if (prop.isScalar) {
      return renderDefaultType(prop.typeName.name, prop.defaultValue);
    } else {
      return " = new " + prop.typeName.name + "();";
    }
  } else {
    return "";
  }
};

const renderDefaultType = (typeName: string, defaultValue: string | number | boolean | null = null): string => {
  if (typeName === "string") {
    if (defaultValue && defaultValue === "*") {
      return " = string.Empty;";
    }
    return defaultValue ? " = \"" + defaultValue + "\";" : " = string.Empty;";
  }
  if (typeName === "boolean") {
    return defaultValue ? " = " + defaultValue + ";" : " = false;";
  }
  if (typeName === "number") {
    return defaultValue ? " = " + defaultValue + ";" : " = 0;";
  }
  if (typeName === "object") {
    return " = new " + typeName + "();";
  }
  if (typeName === "dictionary") {
    return " = new Dictionary<string, object>();";
  }
  return "";
};

const renderSetInstance = (prop: PropertyNode, variable: string, dictArg: string): string => {
  //instance.{{ renderPropertyName(prop) }} = props.GetValueOrDefault<{{ renderType(prop) | safe }}>("{{prop.name}}"){{ renderNullCoalescing(prop) | safe }};
  const propertyName = renderPropertyName(prop);
  const propertyType = renderSimpleType(prop);
  const setter = `${variable}.${propertyName}`;
  if (prop.isScalar) {
    if (isNonNullableValueType(propertyType)) {
      return `${setter} = (${propertyType})${prop.name}Value;`;
    } else {
      return `${setter} = ${prop.name}Value as ${propertyType}${renderNullCoalescing(prop)};`;
    }
  } else {
    if (prop.isCollection) {
      return `${setter} = Load${propertyName}(${prop.name}Value);`;
    } else {
      return `${setter} = ${prop.typeName.name}.Load(${prop.name}Value.ToParamDictionary());`;
    }
  }
}

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

const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/CSharp`;
  const typePath = type.typeName.namespace.split(".");

  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, filename);
  await emitFile(context.program, {
    path,
    content: python,
  });
}
