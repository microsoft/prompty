import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, AgentSchemaEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeNode } from "./ast.js";
import { GeneratorOptions, filterNodes } from "./emitter.js";
import * as nunjucks from "nunjucks";
import { getCombinations, scalarValue } from "./utilities.js";
import * as YAML from "yaml";
import path from "path";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";

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

// Maps C# types to Convert.ToXXX method suffixes
const convertMethodMapper: Record<string, string> = {
  "bool": "Boolean",
  "int": "Int32",
  "long": "Int64",
  "float": "Single",
  "double": "Double",
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

export const generateCsharp = async (context: EmitContext<AgentSchemaEmitterOptions>, templateDir: string, node: TypeNode, emitTarget: EmitTarget, options?: GeneratorOptions) => {
  // set up template environment
  const templatePath = path.resolve(templateDir, 'csharp');
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath));
  env.addFilter('isFloat', function (value: any) {
    const isFloat = value.toString().includes('.');
    return isFloat;
  });
  const classTemplate = env.getTemplate('file.cs.njk', true);
  const utilsTemplate = env.getTemplate('utils.cs.njk', true);
  const testTemplate = env.getTemplate('test.cs.njk', true);
  const contextTemplate = env.getTemplate('context.cs.njk', true);

  const nodes = filterNodes(Array.from(enumerateTypes(node)), options);

  // Determine namespace: use override, or default to removing '.Core' suffix
  const originalNamespace = node.typeName.namespace;
  const csharpNamespace = emitTarget.namespace ?? originalNamespace.replace(/\.Core$/, '');

  // Emit context classes (LoadContext, SaveContext)
  const contextCode = contextTemplate.render({
    namespace: csharpNamespace,
  });
  await emitCsharpFile(context, node, contextCode, "Context.cs", emitTarget["output-dir"]);

  const utils = utilsTemplate.render({
    namespace: csharpNamespace,
  });

  await emitCsharpFile(context, node, utils, "Utils.cs", emitTarget["output-dir"]);

  for (const n of nodes) {
    await emitCsharpFile(context, n, renderCSharp(nodes, n, classTemplate, csharpNamespace), `${n.typeName.name}.cs`, emitTarget["output-dir"]);
    if (emitTarget["test-dir"]) {
      await emitCsharpFile(context, n, renderTests(n, testTemplate, csharpNamespace), `${n.typeName.name}ConversionTests.cs`, emitTarget["test-dir"]);
    }
  }

  // Format emitted files if format option is enabled (default: true)
  if (emitTarget.format !== false) {
    const outputDir = emitTarget["output-dir"]
      ? resolve(process.cwd(), emitTarget["output-dir"])
      : context.emitterOutputDir;
    const testDir = emitTarget["test-dir"]
      ? resolve(process.cwd(), emitTarget["test-dir"])
      : undefined;

    formatCSharpFiles(outputDir, testDir);
  }
};


const renderCSharp = (nodes: TypeNode[], node: TypeNode, classTemplate: nunjucks.Template, namespace: string): string => {
  const polymorphicTypes = node.retrievePolymorphicTypes();
  const findType = (typeName: string): TypeNode | undefined => {
    return nodes.find(n => n.typeName.name === typeName);
  }
  const alternates = generateAlternates(node).filter(alt => alt.scalar !== "float" && alt.scalar !== "int");
  const numericAlternates = generateAlternates(node).filter(alt => alt.scalar === "float" || alt.scalar === "int");

  // Separate int and float alternates for proper long/double mapping
  const intAlternate = numericAlternates.find(alt => alt.scalar === "int") || null;
  const floatAlternate = numericAlternates.find(alt => alt.scalar === "float") || null;

  // Determine shorthand property (first property in first alternate expansion)
  let shorthandProperty: string | null = null;
  if (node.alternates && node.alternates.length > 0) {
    const firstAlt = node.alternates[0];
    if (firstAlt.expansion) {
      const keys = Object.keys(firstAlt.expansion);
      // Find the key that uses {value}
      for (const key of keys) {
        if (firstAlt.expansion[key] === "{value}") {
          shorthandProperty = key;
          break;
        }
      }
    }
  }

  // Collection types with their primary property for shorthand
  // Filter out dictionary collections since they don't have Load methods
  const collectionTypes = node.properties.filter(p => p.isCollection && !p.isScalar && !p.isDict).map(p => {
    const itemType = findType(p.typeName.name);
    let primaryProp: string | null = null;
    let hasNameProperty = false;

    if (itemType) {
      // Check if item type has a 'name' property (supports object format)
      hasNameProperty = itemType.properties.some(prop => prop.name === "name");

      if (itemType.alternates && itemType.alternates.length > 0) {
        const firstAlt = itemType.alternates[0];
        if (firstAlt.expansion) {
          for (const key of Object.keys(firstAlt.expansion)) {
            if (firstAlt.expansion[key] === "{value}") {
              primaryProp = key;
              break;
            }
          }
        }
      }
    }
    return {
      prop: p,
      type: primaryProp ? [primaryProp] : [],
      hasNameProperty: hasNameProperty,
    };
  });

  const csharp = classTemplate.render({
    node: node,
    renderPropertyName: renderPropertyName,
    renderName: renderName,
    renderType: renderType,
    renderSimpleType: renderSimpleType,
    renderDefault: renderDefault,
    renderSetInstance: renderSetInstance,
    renderSummary: renderSummary,
    renderPropertyModifier: renderPropertyModifier(findType, node),
    renderNullCoalescing: renderNullCoalescing,
    renderLoadProperty: renderLoadProperty(findType),
    renderSaveProperty: renderSaveProperty,
    converterMapper: (s: string) => jsonConverterMapper[s] || `Get${s.charAt(0).toUpperCase() + s.slice(1)}`,
    polymorphicTypes: polymorphicTypes,
    collectionTypes: collectionTypes,
    alternates: alternates,
    numericAlternates: numericAlternates,
    intAlternate: intAlternate,
    floatAlternate: floatAlternate,
    shorthandProperty: shorthandProperty,
    namespace: namespace,
  });

  return csharp;
}

const renderTests = (node: TypeNode, testTemplate: nunjucks.Template, namespace: string): string => {
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
    // Create YAML document and customize string scalar style for values with special chars
    const doc = new YAML.Document(sample);
    YAML.visit(doc, {
      Scalar(key, node) {
        // Only quote string values that contain special characters requiring escaping
        if (typeof node.value === 'string') {
          const str = node.value as string;
          if (str.includes('\n') || str.includes('\t') || str.includes('#') || str.includes(':') || str.includes('"')) {
            node.type = 'QUOTE_DOUBLE';
          }
        }
      }
    });
    return {
      json: JSON.stringify(sample, null, 2).split('\n'),
      yaml: doc.toString({ indent: 2, lineWidth: 0 }).split('\n'),
      // get all scalars in the sample - using 'validations' (plural) for consistency across languages
      validations: Object.keys(sample).filter(key => typeof sample[key] !== 'object').map(key => ({
        key: renderName(key),
        value: typeof sample[key] === 'boolean' ? (sample[key] ? "True" : "False") : sample[key],
        startDelim: typeof sample[key] === 'string' ? (sample[key].includes('\n') ? '@"' : '"') : '',
        endDelim: typeof sample[key] === 'string' ? (sample[key].includes('\n') ? '"' : '"') :
          typeof sample[key] === 'number' && !Number.isInteger(sample[key]) ? 'f' : '',
      })),
    };
  });

  const alternates = node.alternates.map(alt => {
    const example = alt.example ? (typeof (alt.example) === "string" ? '"' + alt.example + '"' : alt.example.toString()) : scalarValue[alt.scalar] || "None";
    return {
      title: alt.title || alt.scalar,
      scalar: alt.scalar,
      value: example,
      // using 'validations' (plural) for consistency across languages
      validations: Object.keys(alt.expansion).filter(key => typeof alt.expansion[key] !== 'object').map(key => {
        const value = alt.expansion[key] === "{value}" ? example : alt.expansion[key];
        return {
          key: renderName(key),
          value: value,
          delimiter: typeof value === 'string' && !value.includes('"') && alt.expansion[key] !== "{value}" ? '"' : '',
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
    namespace: namespace,
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

const renderType = (prop: PropertyNode, removeOptional: boolean = false): string => {
  return `${renderSimpleType(prop)}${prop.isOptional && !removeOptional ? "?" : ""}`;
};

const renderSimpleType = (prop: PropertyNode): string => {
  let type = prop.isScalar ? csharpTypeMapper[prop.typeName.name] || "object" : prop.typeName.name;
  if (prop.isDict) {
    type = `IDictionary<string, object>`;
  }
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

/**
 * Renders the property loading code for the Load() method
 */
const renderLoadProperty = (findType: (typeName: string) => TypeNode | undefined) => (prop: PropertyNode): string => {
  const propertyName = renderPropertyName(prop);
  const propertyType = renderSimpleType(prop);

  if (prop.isScalar) {
    if (prop.isDict) {
      if (prop.isCollection) {
        // Dictionary collection - convert each item to proper dictionary type
        return `instance.${propertyName} = (${prop.name}Value as IEnumerable<object>)?.Select(x => x.GetDictionary()).Cast<IDictionary<string, object>>().ToList() ?? [];`;
      }
      return `instance.${propertyName} = ${prop.name}Value.GetDictionary()!;`;
    }
    const csharpType = csharpTypeMapper[prop.typeName.name] || "object";

    // Handle scalar collections (e.g., IList<string>)
    if (prop.isCollection) {
      if (csharpType === "string") {
        return `instance.${propertyName} = (${prop.name}Value as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];`;
      } else if (isNonNullableValueType(csharpType)) {
        const convertMethod = convertMethodMapper[csharpType] || "ToString";
        return `instance.${propertyName} = (${prop.name}Value as IEnumerable<object>)?.Select(x => Convert.To${convertMethod}(x)).ToList() ?? [];`;
      } else {
        return `instance.${propertyName} = (${prop.name}Value as IEnumerable<object>)?.ToList() ?? [];`;
      }
    }

    if (isNonNullableValueType(csharpType)) {
      const convertMethod = convertMethodMapper[csharpType] || "ToString";
      return `instance.${propertyName} = Convert.To${convertMethod}(${prop.name}Value);`;
    } else if (csharpType === "string") {
      return `instance.${propertyName} = ${prop.name}Value?.ToString()!;`;
    } else {
      return `instance.${propertyName} = ${prop.name}Value;`;
    }
  } else if (prop.isCollection) {
    if (prop.isDict) {
      // Dictionary collection - convert each item to proper dictionary type
      return `instance.${propertyName} = (${prop.name}Value as IEnumerable<object>)?.Select(x => x.GetDictionary()).Cast<IDictionary<string, object>>().ToList() ?? [];`;
    }
    return `instance.${propertyName} = Load${propertyName}(${prop.name}Value, context);`;
  } else {
    return `instance.${propertyName} = ${prop.typeName.name}.Load(${prop.name}Value.GetDictionary(), context);`;
  }
};

/**
 * Renders the property saving code for the Save() method
 */
const renderSaveProperty = (prop: PropertyNode): string => {
  const propertyName = renderPropertyName(prop);

  if (prop.isScalar || prop.isDict) {
    return `result["${prop.name}"] = obj.${propertyName};`;
  } else if (prop.isCollection) {
    return `result["${prop.name}"] = Save${propertyName}(obj.${propertyName}, context);`;
  } else {
    return `result["${prop.name}"] = obj.${propertyName}?.Save(context);`;
  }
};

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

const emitCsharpFile = async (context: EmitContext<AgentSchemaEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
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

/**
 * Format C# files using dotnet format.
 * Runs formatter from the .NET project root (where .csproj or .sln is located).
 */
function formatCSharpFiles(outputDir: string, testDir?: string): void {
  // Find the .NET project root by looking for .csproj or .sln
  const projectRoot = findDotNetProjectRoot(outputDir);
  if (!projectRoot) {
    console.warn(`Warning: Could not find .csproj or .sln file. Skipping formatting.`);
    return;
  }

  try {
    execSync(`dotnet format "${projectRoot}"`, {
      cwd: dirname(projectRoot),
      stdio: 'pipe',
      encoding: 'utf-8'
    });
  } catch (error) {
    console.warn(`Warning: dotnet format failed. You may need to run it manually.`);
  }
}

/**
 * Find the .NET project root by traversing up from the output directory
 * looking for .csproj or .sln files.
 */
function findDotNetProjectRoot(startDir: string): string | undefined {
  let currentDir = resolve(startDir);
  const root = resolve('/');

  // On Windows, also check for drive root (e.g., "C:\")
  while (currentDir !== root && currentDir !== dirname(currentDir)) {
    // First check for .csproj (more specific)
    const files = existsSync(currentDir) ? readdirSync(currentDir) : [];
    const csprojFile = files.find((f: string) => f.endsWith('.csproj'));
    if (csprojFile) {
      return resolve(currentDir, csprojFile);
    }

    // Then check for .sln
    const slnFile = files.find((f: string) => f.endsWith('.sln'));
    if (slnFile) {
      return resolve(currentDir, slnFile);
    }

    currentDir = dirname(currentDir);
  }

  return undefined;
}
