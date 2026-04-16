import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import { enumerateTypes, PropertyNode, TypeName, TypeNode } from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import * as YAML from 'yaml';

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

function emitIndexMarkdown(
  types: TypeNode[],
  rootObject: string,
  childTypes: { source: string; target: string }[],
  compositionTypes: { source: string; target: string }[],
): string {
  let out = `---
title: "AgentSchema"
description: "Overview of declarative agent types in AgentSchema."
slug: "reference/index"
sidebar:
  order: 1
---

The following diagram illustrates the classes and their relationships for declarative agents.
The root [object](${rootObject.toLowerCase()}/) represents the main entry point for the system.

\`\`\`mermaid
---
title: ${rootObject} and Related Types
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram`;
  for (const type of types) {
    out += `\n    class ${type.typeName.name} {`;
    if (type.isAbstract) {
      out += `\n      <<abstract>>`;
    }
    for (const prop of type.properties) {
      out += `\n        +${prop.typeName.name}${prop.isCollection ? "[]" : ""} ${prop.name}`;
    }
    out += `\n    }`;
  }
  for (const child of childTypes) {
    out += `\n    ${child.source} <|-- ${child.target}`;
  }
  for (const comp of compositionTypes) {
    out += `\n    ${comp.source} *-- ${comp.target}`;
  }
  out += `\n\`\`\`\n`;
  return out;
}

function emitFileMarkdown(
  node: TypeNode,
  yml: string | undefined,
  md: string | undefined,
  compositionTypes: TypeNode[],
  alternateCtors: { title: string; description: string; scalar: string; simple: string; expanded: string }[],
  parent: TypeNode | undefined,
): string {
  let out = `---
title: "${node.typeName.name}"
description: "Documentation for the ${node.typeName.name} type."
slug: "reference/${node.typeName.name.toLowerCase()}"
---

${node.description}

## Class Diagram

\`\`\`mermaid
---
title: ${node.typeName.name}
config:
  look: handDrawn
  theme: colorful
  class:
    hideEmptyMembersBox: true
---
classDiagram`;

  if (parent) {
    out += `\n    class ${parent.typeName.name} {`;
    for (const prop of parent.properties) {
      out += `\n        +${prop.typeName.name}${prop.isCollection ? "[]" : ""} ${prop.name}`;
    }
    out += `\n    }`;
    out += `\n    ${parent.typeName.name} <|-- ${node.typeName.name}`;
  }

  out += `\n    class ${node.typeName.name} {`;
  if (node.isAbstract) {
    out += `\n      <<abstract>>`;
  }
  for (const prop of node.properties) {
    out += `\n        +${prop.typeName.name}${prop.isCollection ? "[]" : ""} ${prop.name}`;
  }
  out += `\n    }`;

  for (const type of node.childTypes) {
    out += `\n    class ${type.typeName.name} {`;
    for (const prop of type.properties) {
      out += `\n        +${prop.typeName.name}${prop.isCollection ? "[]" : ""} ${prop.name}`;
    }
    out += `\n    }`;
    out += `\n    ${node.typeName.name} <|-- ${type.typeName.name}`;
  }

  for (const type of compositionTypes) {
    out += `\n    class ${type.typeName.name} {`;
    for (const prop of type.properties) {
      out += `\n        +${prop.typeName.name}${prop.isCollection ? "[]" : ""} ${prop.name}`;
    }
    out += `\n    }`;
    out += `\n    ${node.typeName.name} *-- ${type.typeName.name}`;
  }

  out += `\n\`\`\``;

  if (md) {
    out += `\n\n## Markdown Example\n\n\`\`\`markdown\n${md.trim()}\n\`\`\``;
  }

  if (yml) {
    out += `\n\n## Yaml Example\n\n\`\`\`yaml\n${yml.trim()}\n\`\`\``;
  }

  if (node.properties.length > 0) {
    out += `\n\n## Properties\n\n| Name | Type | Description |\n| ---- | ---- | ----------- |`;
    for (const prop of node.properties) {
      out += `\n| ${prop.name} | ${renderType(prop)} | ${prop.description.trim()}${renderChildTypes(prop)} |`;
    }
  }

  if (node.childTypes.length > 0) {
    out += `\n\n## Child Types\n\nThe following types extend \`${node.typeName.name}\`:\n`;
    for (const type of node.childTypes) {
      out += `\n- [${type.typeName.name}](../${type.typeName.name.toLowerCase()}/)`;
    }
  }

  if (compositionTypes.length > 0) {
    out += `\n\n## Composed Types\n\nThe following types are composed within \`${node.typeName.name}\`:\n`;
    for (const type of compositionTypes) {
      out += `\n- [${type.typeName.name}](../${type.typeName.name.toLowerCase()}/)`;
    }
  }

  if (alternateCtors.length > 0) {
    out += `\n\n## Alternate Constructions\n\nThe following alternate constructions are available for \`${node.typeName.name}\`.\nThese allow for simplified creation of instances using a single property.`;
    for (const ctor of alternateCtors) {
      out += `\n\n### ${ctor.scalar}`;
      if (ctor.title) {
        out += ` ${ctor.title}`;
      }
      out += `\n`;
      if (ctor.description) {
        out += `\n${ctor.description}\n`;
      }
      out += `\nThe following simplified representation can be used:\n\n\`\`\`yaml\n${ctor.simple.trim()}\n\`\`\`\n\nThis is equivalent to the full representation:\n\n\`\`\`yaml\n${ctor.expanded.trim()}\n\`\`\``;
    }
  }

  out += `\n`;
  return out;
}

export const generateMarkdown = async (context: EmitContext<PromptyEmitterOptions>, _templateDir: string, node: TypeNode, emitTarget: EmitTarget, options?: GeneratorOptions) => {

  const rootObject = context.options["root-alias"] || "AgentDefinition";

  const nodes = filterNodes(Array.from(enumerateTypes(node)), options);

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

  const readmeContent = emitIndexMarkdown(nodes, rootObject, childTypes, compositionTypes);
  await emitMarkdownFile(context, "index", readmeContent, emitTarget["output-dir"]);

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
    const markdown = emitFileMarkdown(
      node,
      yml,
      md,
      getCompositionTypes(node),
      generateCoercions(node),
      node.base ? findNodeByName(node.base) : undefined,
    );

    await emitMarkdownFile(context, node.typeName.name, markdown, emitTarget["output-dir"]);
  }
}

export const renderType = (prop: PropertyNode) => {
  const arrayString = prop.isCollection ? "[]" : "";
  if (prop.isScalar) {
    return prop.typeName.name + arrayString;
  } else if (prop.isDict) {
    return `${prop.typeName.name + arrayString}`;
  } else {
    return `[${prop.typeName.name + arrayString}](../${prop.typeName.name.toLowerCase()}/)`;
  }
};

export const renderChildTypes = (node: PropertyNode) => {
  if (!node.isScalar && node.type) {
    const childTypes = node.type.childTypes.map(c => {
      return `[${c.typeName.name}](../${c.typeName.name.toLowerCase()}/)`;
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
  const nonScalars = node.properties.filter(p => !p.isScalar && !p.isDict);
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

export const generateCoercions = (node: TypeNode): { title: string; description: string; scalar: string; simple: string, expanded: string }[] => {
  if (node.coercions && node.coercions.length > 0) {
    const alts: { title: string; description: string; scalar: string; simple: string, expanded: string }[] = [];
    for (const alt of node.coercions) {
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
