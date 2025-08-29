import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { enumerateTypes, PropertyNode, TypeName, TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";
import { stringify } from 'yaml'
import { get } from "http";

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


export const generateMarkdown = async (context: EmitContext<PromptyEmitterOptions>, nodes: TypeNode[], outputDir?: string) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/markdown'));
  const template = env.getTemplate('markdown.njk', true);
  const readme = env.getTemplate('readme.njk', true);

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
    childTypes: childTypes,
    compositionTypes: compositionTypes
  });

  await emitMarkdownFile(context, "README", readmeContent, outputDir);

  for (const node of nodes) {
    const sample = node.properties.filter(p => p.samples.length > 0).map(p => p.samples[0].sample);
    const md = template.render({
      node: node,
      yml: sample.length > 0 ? stringify(deepMerge(...sample), { indent: 2 }) : undefined,
      renderType: renderType,
      renderChildTypes: renderChildTypes,
      getChildTypes: getChildTypes,
      getCompositionTypes: getCompositionTypes,
      enumerateTypes: enumerateTypes
    });

    await emitMarkdownFile(context, node.typeName.name, md, outputDir);
  }
}

export const renderType = (prop: PropertyNode) => {
  const arrayString = prop.isCollection ? " Collection" : "";
  if (prop.isScalar) {
    return prop.typeName.name + arrayString;
  } else {
    return `[${prop.typeName.name + arrayString}](${prop.typeName.name}.md)`;
  }
};

export const renderChildTypes = (node: PropertyNode) => {
  if (!node.isScalar && node.type) {
    const childTypes = node.type.childTypes.map(c => {
      return `<li>[${c.typeName.name}](${c.typeName.name}.md)</li>`;
    });

    if (childTypes.length === 0) {
      return "";
    }

    return `<p>Related Types:<ul>${childTypes.join("")}</ul></p>`;
  }
  return "";
};

export const getChildTypes = (node: TypeNode): { source: string, target: string }[] => {
  return node.childTypes.flatMap(c => [{
    source: node.typeName.name,
    target: c.typeName.name
  }, ...getChildTypes(c)]);
};

export const getCompositionTypes = (node: TypeNode): { source: string, target: string }[] => {
  return node.properties.filter(p => !p.isScalar).flatMap(c => [{
    source: node.typeName.name,
    target: c.typeName.name
  }, ...(c.type ? getChildTypes(c.type) : [])]);
};

const emitMarkdownFile = async (context: EmitContext<PromptyEmitterOptions>, name: string, markdown: string, outputDir?: string) => {
  const dir = outputDir || `${context.emitterOutputDir}/markdown`;
  await emitFile(context.program, {
    path: resolvePath(dir, `${name}.md`),
    content: markdown,
  });
}
