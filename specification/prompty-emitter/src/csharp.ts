import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import { getCombinations, scalarValue } from "./utilities.js";
import * as YAML from "yaml";
import path from "path";

const csharpTypeMapper: Record<string, string> = {
  "string": "string",
  "number": "float",
  "array": "[]",
  "object": "object",
  "boolean": "bool",
  "int64": "long",
  "int32": "int",
  "float64": "double",
  "float32": "float",
  "integer": "int",
  "dictionary": "IDictionary<string, object>",
};

const jsonConverterMapper: Record<string, string> = {
  "string": "GetString",
  // this is smarter about numbers
  "number": "GetScalarValue",
  "unknown": "GetScalarValue",
  "boolean": "GetBoolean",
  "int64": "GetInt64",
  "int32": "GetInt32",
  "float64": "GetDouble",
  "float32": "GetSingle",
  "integer": "GetInt32",
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

export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, templateDir: string, node: TypeNode, emitTarget: EmitTarget) => {
  // set up template environment
  const templatePath = path.resolve(templateDir, 'csharp');
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath));
  const classTemplate = env.getTemplate('dataclass.njk', true);
  const utilsTemplate = env.getTemplate('utils.njk', true);
  const testTemplate = env.getTemplate('test.njk', true);

  const nodes = Array.from(enumerateTypes(node));

  const utils = utilsTemplate.render({
    namespace: node.typeName.namespace,
  });

  await emitCsharpFile(context, node, utils, "Utils.cs", emitTarget["output-dir"]);



  for (const node of nodes) {
    //const className = getClassName(node.typeName.name);
    await emitCsharpFile(context, node, renderCSharp(nodes, node, classTemplate), `${node.typeName.name}.cs`, emitTarget["output-dir"]);
    if (emitTarget["test-dir"]) {
      await emitCsharpFile(context, node, renderTests(node, testTemplate), `${node.typeName.name}ConversionTests.cs`, emitTarget["test-dir"]);
    }
  }
};

const renderCSharp = (nodes: TypeNode[], node: TypeNode, classTemplate: nunjucks.Template): string => {
  const polymorphicTypes = node.retrievePolymorphicTypes();
  const findType = (typeName: string): TypeNode | undefined => {
    return nodes.find(n => n.typeName.name === typeName);
  }

  const csharp = classTemplate.render({
    node: node,
    renderPropertyName: renderPropertyName,
    renderName: renderName,
    renderType: renderType,
    renderDefault: renderDefault,
    renderSetInstance: renderSetInstance,
    renderSummary: renderSummary,
    renderPropertyModifier: renderPropertyModifier(findType, node),
    renderNullCoalescing: renderNullCoalescing,
    converterMapper: (s: string) => jsonConverterMapper[s] || `Get${s.charAt(0).toUpperCase() + s.slice(1)}`,
    polymorphicTypes: polymorphicTypes,
    collectionTypes: node.properties.filter(p => p.isCollection && !p.isScalar),
    alternates: generateAlternates(node),
  });

  return csharp;
}

const renderTests = (node: TypeNode, testTemplate: nunjucks.Template): string => {
  const samples = node.properties.filter(p => p.samples && p.samples.length > 0).map(p => {
    return p.samples?.map(s => ({
      ...s.sample,
    }));
  });

  const combinations =
    samples.length > 0 ?
      getCombinations(samples) :
      [];

  const examples = combinations.map(c => {
    const sample = Object.assign({}, ...c);
    return {
      json: JSON.stringify(sample, null, 2).split('\n'),
      yaml: YAML.stringify(sample, { indent: 2 }).split('\n'),
      // get all scalars in the sample
      validation: Object.keys(sample).filter(key => typeof sample[key] !== 'object').map(key => ({
        key: renderName(key),
        value: typeof sample[key] === 'boolean' ? (sample[key] ? "True" : "False") : sample[key],
        startDelim: typeof sample[key] === 'string' ? (sample[key].includes('\n') ? '@"' : '"') : '',
        endDelim: typeof sample[key] === 'string' ? (sample[key].includes('\n') ? '"' : '"') : '',
      })),
    };
  });

  const alternates = node.alternates.map(alt => {
    return {
      title: alt.title || alt.scalar,
      scalar: alt.scalar,
      value: scalarValue[alt.scalar] || "None",
      validation: Object.keys(alt.expansion).filter(key => typeof alt.expansion[key] !== 'object').map(key => {
        const value = alt.expansion[key] === "{value}" ? (scalarValue[alt.scalar] || "None") : alt.expansion[key];
        return {
          key: key,
          value: value,
          delimeter: typeof value === 'string' && !value.includes('"') && alt.expansion[key] !== "{value}" ? '"' : '',
        };
      }),
    };
  });

  const test = testTemplate.render({
    node: node,
    // replace control characters in samples
    examples: examples,
    alternates: alternates,
    renderName: renderName,
  });
  return test;
};

const renderPropertyName = (prop: PropertyNode): string => {
  return renderName(prop.name);
};

const renderName = (name: string): string => {
  // convert snake_case to PascalCase
  const pascal = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
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

const generateAlternates = (node: TypeNode): { scalar: string; expansion: { property: string, value: string }[] }[] => {
  if (node.alternates && node.alternates.length > 0) {
    const alternates: { scalar: string; expansion: { property: string, value: string }[] }[] = [];
    for (const alt of node.alternates) {
      const scalar = csharpTypeMapper[alt.scalar] || "object";

      // Process each alternate
      const expansion: { property: string, value: string }[] = [];
      for (const key in alt.expansion) {
        const value = alt.expansion[key];
        // check if value is a string
        if (value === "{value}") {
          expansion.push({ property: renderName(key), value: `${scalar}Value` });
        } else {
          if (typeof value === 'string') {
            expansion.push({ property: renderName(key), value: `"${value}"` });
          } else {
            expansion.push({ property: renderName(key), value: `${value}` });
          }
        }
      }
      alternates.push({
        scalar: scalar,
        expansion: expansion,
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
      //if (!prop.type?.isAbstract) {
      //  return " = new " + prop.typeName.name + "();";
      //}
      return "";
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
    return " ?? throw new ArgumentException(\"Properties must contain a property named: " + prop.name + "\")";
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
