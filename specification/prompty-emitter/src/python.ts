import { EmitContext, emitFile, isUnknownType, resolvePath, Type } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import path from "path";

const pythonTypeMapper: Record<string, string> = {
  "string": "str",
  "number": "float",
  "array": "list",
  "object": "dict",
  "boolean": "bool",
  "int64": "int",
  "int32": "int",
  "float64": "float",
  "float32": "float",
  "integer": "int",
  "float": "float",
  "numeric": "float",
  "any": "Any",
  "dictionary": "dict[str, Any]",
};


export const generatePython = async (context: EmitContext<PromptyEmitterOptions>, templateDir: string, nodes: TypeNode[], outputDir?: string) => {
  // set up template environment
  const templatePath = path.resolve(templateDir, 'python');
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath));
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
      renderDefault: renderDefault,
      renderSetInstance: renderSetInstance,
      loader: generateLoader(node),
      alternates: generateAlternates(node),
      polymorphicTypes: retrievePolymorphicInstances(node),
      collectionTypes: node.properties.filter(p => p.isCollection && !p.isScalar),
    });
    await emitPythonFile(context, node, python, `_${node.typeName.name}.py`, outputDir);
  }
}

const retrievePolymorphicInstances = (node: TypeNode): any => {
  let instances: any[] = [];
  if (node.discriminator && node.childTypes.length > 0) {
    instances = node.childTypes.map(child => ({
      discriminator: node.discriminator,
      value: child.properties.find(p => p.name === node.discriminator)?.defaultValue || "*",
      instance: child,
    }));

    if (!node.isAbstract) {
      instances = [...instances, { discriminator: node.discriminator, value: "*", instance: node }];
    }

    const filteredInstances = instances.filter(instance => instance.value !== "*");
    const defaultInstance = instances.filter(i => i.value === "*")[0];
    return {
      first: filteredInstances[0],
      others: filteredInstances.slice(1),
      default: defaultInstance,
    };
  }
  return undefined;
};

const generateLoader = (node: TypeNode): any => {
  const typeGuards: string[] = [];
  if (node.alternates && node.alternates.length > 0) {
    node.alternates.forEach(alt => {
      typeGuards.push(pythonTypeMapper[alt.scalar] || "Any");
    });
  }
  if (typeGuards.length > 0) {
    return `def load(data: Union[${["dict", ...typeGuards].join(", ")}]) -> "${node.typeName.name}":`
  } else {
    return `def load(data: dict) -> "${node.typeName.name}":`
  }
};


const generateAlternates = (node: TypeNode): { scalar: string; alternate: string }[] => {
  if (node.alternates && node.alternates.length > 0) {
    return node.alternates.map(alt => ({
      scalar: pythonTypeMapper[alt.scalar],
      alternate: JSON.stringify(alt.expansion, null, ``).replaceAll('\n', '').replace("\"{value}\"", " data"),
    }));
  } else {
    return [];
  }
};

const renderType = (prop: PropertyNode): string => {
  let type = prop.isScalar ? (pythonTypeMapper[prop.typeName.name] || "Any") : pythonTypeMapper[prop.typeName.name] || prop.typeName.name;
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
      return ` = field(default=${prop.defaultValue === true ? "True" : "False"})`;
    } else if (prop.typeName.name === "string") {
      return ` = field(default="${prop.defaultValue ?? ""}")`;
    } else if (prop.typeName.name === "number" || prop.typeName.name === "numeric") {
      return ` = field(default=${prop.defaultValue ?? "0.0"})`;
    } else if (prop.typeName.name === "dictionary") {
      return " = field(default_factory=dict)";
    } else if (prop.typeName.name === "int64" || prop.typeName.name === "int32" || prop.typeName.name === "integer") {
      return ` = field(default=${prop.defaultValue ?? "0"})`;
    } else if (prop.typeName.name === "float64" || prop.typeName.name === "float32" || prop.typeName.name === "float") {
      return ` = field(default=${prop.defaultValue ?? "0.0"})`;
    } else {
      return ` = field(default=${prop.defaultValue ?? "None"})`;
    }
  } else if (prop.isOptional) {
    return ` = field(default=${prop.defaultValue ?? "None"})`;
  } else {
    return ` = field(default_factory=${prop.typeName.name})`;
  }
}

const renderSetInstance = (node: TypeNode, prop: PropertyNode, variable: string, dictArg: string): string => {
  const setter = `${variable}.${prop.name} = `;
  if (prop.isScalar) {
    return `${setter}${dictArg}["${prop.name}"]`;
  } else {
    if (prop.isCollection) {
      return `${setter}${node.typeName.name}.load_${prop.name}(${dictArg}["${prop.name}"])`;
    } else {
      return `${setter}${prop.typeName.name}.load(${dictArg}["${prop.name}"])`;
    }
  }
}

const importIncludes = (node: TypeNode): string[] => {
  const includes = new Set<string>();
  for (const prop of node.properties) {
    if (prop.isOptional) {
      includes.add("Optional");
    }
    if (prop.isAny) {
      includes.add("Any");
    }
    if (prop.isCollection) {
      includes.add("List");
    }
    if (prop.isDict) {
      includes.add("Any");
    }
  }
  if (node.alternates && node.alternates.length > 0) {
    includes.add("Union");
  }
  return Array.from(includes);
};

const importTypes = (node: TypeNode): string[] => {
  const imports = new Set<string>(node.properties.filter(p => !p.isScalar).map(p => p.typeName.name));
  if (node.base) {
    imports.add(node.base.name);
  }
  if (node.childTypes.length > 0) {
    node.childTypes.forEach(child => {
      imports.add(child.typeName.name);
    });
  }
  return Array.from(imports);
};

const typeLink = (name: string) =>
  name.toLowerCase().replaceAll(' ', '-');


const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/python`;
  const typePath = type.typeName.namespace.split(".").map(part => typeLink(part));
  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, ...typePath);
  await emitFile(context.program, {
    path: resolvePath(path),
    content: python,
  });
}
