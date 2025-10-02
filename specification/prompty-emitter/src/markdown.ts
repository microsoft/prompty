import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeName, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import * as YAML from 'yaml';
import path from "path";

function deepMerge<T extends Record<string, any>>(...objects: T[]): T {
  return objects.reduce((acc, obj) => {
    Object.keys(obj).forEach((key) => {
      const accValue = acc[key as keyof T];
      const objValue = obj[key as keyof T];

      if (typeof accValue === "object" && typeof objValue === "object") {
        acc[key as keyof T] = deepMerge(accValue, objValue);
      } else {
        acc[key as keyof T] = objValue;
      }
    });
    return acc;
  }, {} as T);
}

export const generateMarkdown = async (context: EmitContext<PromptyEmitterOptions>, templateDir: string, node: TypeNode, emitTarget: EmitTarget) => {

  const rootObject = context.options["root-alias"] || "Prompty";
  // set up template environment
  const templatePath = path.resolve(templateDir, 'markdown');
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(templatePath));
  const template = env.getTemplate('markdown.njk', true);
  const readme = env.getTemplate('readme.njk', true);

  const nodes = Array.from(enumerateTypes(node));

  const childTypes: { source: string, target: string }[] = nodes.map(n => {
    return n.childTypes.map(c => {
      return { source: n.typeName.name, target: c.typeName.name };
    });
  }).flat();

  const compositionTypes: { source: string, target: string }[] = nodes.map(n => {
    return n.properties.filter(p => !p.isScalar).map(c => {
      return { source: n.typeName.name, target: c.typeName.name };
    });
  }).flat();

  const readmeContent = readme.render({
    types: nodes,
    rootObject: rootObject,
    childTypes: childTypes,
    compositionTypes: compositionTypes
  });

  await emitMarkdownFile(context, "README", readmeContent, emitTarget["output-dir"]);

  const findNodeByName = (name: TypeName): TypeNode | undefined => {
    return nodes.find(n => n.typeName.name === name.name && n.typeName.namespace === name.namespace);
  }

  for (const node of nodes) {
    const sample = node.properties.filter(p => p.samples.length > 0).map(p => p.samples[0].sample);
    let yml: string | undefined = undefined;
    let md: string | undefined = undefined;
    if (sample.length > 0) {
      const s = deepMerge(...sample);
      yml = YAML.stringify(s, { indent: 2 });
      if ("instructions" in s) {
        const instructions = s.instructions;
        delete s.instructions;
        md = `---\n${YAML.stringify(s, { indent: 2 })}---\n${instructions}`;
      }
    }
    const markdown = template.render({
      node: node,
      yml: yml,
      md: md,
      renderType: renderType,
      renderChildTypes: renderChildTypes,
      compositionTypes: getCompositionTypes(node),
      alternateCtors: generateAlternates(node),
      parent: node.base ? findNodeByName(node.base): undefined,
    });

    await emitMarkdownFile(context, node.typeName.name, markdown, emitTarget["output-dir"]);
  }
}

export const renderType = (prop: PropertyNode) => {
  const arrayString = prop.isCollection ? "[]" : "";
  if (prop.isScalar) {
    return prop.typeName.name + arrayString;
  } else {
    return `[${prop.typeName.name + arrayString}](${prop.typeName.name}.md)`;
  }
};

export const renderChildTypes = (node: PropertyNode) => {
  if (!node.isScalar && node.type) {
    const childTypes = node.type.childTypes.map(c => {
      return `[${c.typeName.name}](${c.typeName.name}.md)`;
    });

    if (childTypes.length === 0) {
      return "";
    }

    return `(Related Types: ${childTypes.join(", ")})`;
  }
  return "";
};

export const getChildTypes = (node: TypeNode): { source: string, target: string }[] => {
  return node.childTypes.flatMap(c => [{
    source: node.typeName.name,
    target: c.typeName.name
  }, ...getChildTypes(c)]);
};

export const getCompositionTypes = (node: TypeNode): TypeNode[] => {
  const nonScalars = node.properties.filter(p => !p.isScalar);
  return nonScalars.flatMap(c => c.type ? [c.type] : []);
};

const typeExampleMapper: Record<string, string> = {
  "string": "\"example\"",
  "number": "5",
  "boolean": "true",
  "int64": "5",
  "int32": "5",
  "float64": "3.14",
  "float32": "3.14",
  "integer": "5",
  "float": "3.14",
  "numeric": "3.14",
};

export const generateAlternates = (node: TypeNode): { title: string; description: string; scalar: string; simple: string, expanded: string }[] => {
  if (node.alternates && node.alternates.length > 0) {
    const alts: { title: string; description: string; scalar: string; simple: string, expanded: string }[] = [];
    for (const alt of node.alternates) {
      const scalar = alt.scalar;
      const sample = typeExampleMapper[scalar] ? typeExampleMapper[scalar] : "example";

      const simple: { [key: string]: any } = {};
      simple[alt.title || "value"] = "\"{value}\"";
      const expansion: { [key: string]: any } = {};
      expansion[alt.title || "value"] = alt.expansion;

      alts.push({
        title: alt.title || "",
        description: alt.description || "",
        scalar: scalar,
        simple: YAML.stringify(simple, { indent: 2 }).replace("\"{value}\"", sample).replaceAll("'", ""),
        expanded: YAML.stringify(expansion, { indent: 2 }).replace("\"{value}\"", sample)
      });
    }
    return alts;
  } else {
    return [];
  }
};

const emitMarkdownFile = async (context: EmitContext<PromptyEmitterOptions>, name: string, markdown: string, outputDir?: string) => {
  const dir = outputDir || `${context.emitterOutputDir}/markdown`;
  await emitFile(context.program, {
    path: resolvePath(dir, `${name}.md`),
    content: markdown,
  });
}
