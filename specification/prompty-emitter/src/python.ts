import { EmitContext, emitFile, isUnknownType, resolvePath, Type } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import path from "path";
import { title } from "process";

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


export const generatePython = async (context: EmitContext<PromptyEmitterOptions>, templateDir: string, node: TypeNode, emitTarget: EmitTarget) => {
  // set up template environment
  const templatePath = path.resolve(templateDir, 'python');
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath));
  const fileTemplate = env.getTemplate('dataclass.njk', true);
  const classTemplate = env.getTemplate('class.njk', true);
  const initTemplate = env.getTemplate('init.njk', true);
  const testTemplate = env.getTemplate('test.njk', true);

  const nodes = Array.from(enumerateTypes(node));

  // render init file
  await emitPythonFile(context, node, renderInit(nodes, initTemplate), `__init__.py`, emitTarget["output-dir"]);

  for (const node of nodes) {
    // render each class

    // skip child types
    if (!node.base) {
      // render class file
      await emitPythonFile(context, node, renderPython(node, fileTemplate, classTemplate), `_${node.typeName.name}.py`, emitTarget["output-dir"]);
    }

    if (emitTarget["test-dir"]) {
      // render test file
      await emitPythonFile(context, node, renderTest(node, testTemplate), `test_load_${node.typeName.name.toLowerCase()}.py`, emitTarget["test-dir"]);
    }
  }
};

const getCombinations = (arrays: any[][]): any[][] => {
  if (arrays.length === 0) return [[]];

  const [firstArray, ...restArrays] = arrays;
  const combinationsOfRest = getCombinations(restArrays);

  return firstArray.flatMap(item =>
    combinationsOfRest.map(combination => [item, ...combination])
  );
}

const scalarValue: Record<string, string> = {
  "boolean": 'False',
  "float": "3.14",
  "integer": "3",
  "string": '"example"',
}

const renderTest = (node: TypeNode, testTemplate: nunjucks.Template): string => {
  const samples = node.properties.filter(p => p.samples && p.samples.length > 0).map(p => {
    return p.samples?.map(s => ({
      ...s.sample,
    }));
  });

  const combinations =
    samples.length > 0 ?
      getCombinations(samples) :
      [];

  const flattened = combinations.map(c => {
    const sample = Object.assign({}, ...c);
    return {
      example: JSON.stringify(sample, null, 2).split('\n'),
      // get all scalars in the sample
      validation: Object.keys(sample).filter(key => typeof sample[key] !== 'object').map(key => ({
        key: key,
        value: typeof sample[key] === 'boolean' ? (sample[key] ? "True" : "False") : sample[key],
        delimeter: typeof sample[key] === 'string' ? (sample[key].includes('\n') ? '"""' : '"') : '',
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
    examples: flattened,
    alternates: alternates,
  });
  return test;
};

const renderInit = (nodes: TypeNode[], initTemplate: nunjucks.Template): string => {
  const n = nodes.filter(n => !n.base);
  const init = initTemplate.render({
    baseTypes: n,
    types: nodes,
  });
  return init;
};

const renderPython = (node: TypeNode, fileTemplate: nunjucks.Template, classTemplate: nunjucks.Template): string => {
  // render a single class and its children

  const renderClass = (n: TypeNode) => {
    const collectionTypes = n.properties.filter(p => p.isCollection && !p.isScalar).map(
      p => ({ prop: p, type: p.type?.properties.filter(t => t.name !== "name").map(t => t.name) || [] })
    );
    return classTemplate.render({
      node: n,
      imports: importTypes(n),
      renderType: renderType,
      renderDefault: renderDefault,
      renderSetInstance: renderSetInstance(n),
      alternates: generateAlternates(n),
      polymorphicTypes: n.retrievePolymorphicTypes(),
      collectionTypes: collectionTypes,
    });
  };

  const classDef: string[] = [renderClass(node), ...node.childTypes.map(ct => renderClass(ct))];

  const typings = ["Any"];
  if (containsOptional(node)) {
    typings.push("Optional");
  }
  const python = fileTemplate.render({
    containsAbstract: node.isAbstract || node.childTypes.some(c => c.isAbstract),
    typings: typings,
    imports: importTypes(node),
    classes: classDef,
  });

  return python;
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
    type = `list[${type}]`;
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

const renderSetInstance = (node: TypeNode) => (prop: PropertyNode, variable: string, dictArg: string): string => {
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

const containsOptional = (node: TypeNode): boolean => {
  const optional = [
    node.properties.some(p => p.isOptional),
    ...node.childTypes.map(c => c.properties.some(p => p.isOptional))
  ];
  return optional.some(o => o);
};

const importTypes = (node: TypeNode): string[] => {
  const imports = [
    node.properties.filter(p => !p.isScalar).map(p => p.typeName.name),
    ...node.childTypes.flatMap(c => c.properties.filter(p => !p.isScalar).map(p => p.typeName.name))
  ].flat().filter(n => n !== node.typeName.name && node.base?.name !== n);

  // remove duplicates and self references


  return Array.from(imports);
};

const typeLink = (name: string) =>
  name.toLowerCase().replaceAll(' ', '-');


const emitPythonFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/python`;
  //const typePath = type.typeName.namespace.split(".").map(part => typeLink(part));
  // replace typename with file
  //typePath.push(filename);
  const path = resolvePath(outputDir, filename);
  await emitFile(context.program, {
    path: resolvePath(path),
    content: python,
  });
}
