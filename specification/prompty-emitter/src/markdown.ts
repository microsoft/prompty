import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PropertyNodeEx, TypeNodeEx } from "./ast.js";
import * as nunjucks from "nunjucks";



export const generateMarkdown = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNodeEx) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates/markdown'));
  const template = env.getTemplate('markdown.njk', true);

  emitMarkdown(context, template, node, false);
}

const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');

const emitMarkdown = async (context: EmitContext<PromptyEmitterOptions>,
  template: nunjucks.Template,
  node: TypeNodeEx, inline: boolean = false): Promise<string> => {
  const markdown = template.render({
    node: node,
    renderType: renderType(inline),
  });

  if (inline) {
    const props = await Promise.all(node.properties.flatMap(async (p) => {
      return await Promise.all(p.type.map(async (t) => { return await emitMarkdown(context, template, t, true) }));
    }));

    const content = markdown + props.flatMap(p => p).filter(p => p && p.length > 0).join("\n");
    return content;

  } else {
    // return root
    await emitMarkdownFile(context, node.typeName, markdown);
    // emit file for prop (since not inline)
    for (const prop of node.properties.filter(p => p.type.length > 0)) {
      const props = await Promise.all(prop.type.map(async (t) =>
        await emitMarkdown(context, template, t, true)
      ));
      await emitMarkdownFile(context, prop.name, props.join("\n"));
    }

    return markdown;
  }

}

const renderType = (inline: boolean) => (prop: PropertyNodeEx): string => {
  const text = `${prop.typeName}${prop.isCollection ? " Collection" : ""}`.replaceAll(" | ", ", ");
  if (prop.kind !== "Scalar" && !prop.typeName.includes("unknown") && !prop.typeName.includes('"')) {
    if (inline) {
      return `[${text}](#${typeLink(prop.typeName)})`
    } else {
      return `[${text}](${typeLink(prop.name)}.md)`;
    }
  }
  return text;
};

const emitMarkdownFile = async (context: EmitContext<PromptyEmitterOptions>, name: string, markdown: string) => {
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "markdown", `${typeLink(name)}.md`),
    content: markdown,
  });
}
