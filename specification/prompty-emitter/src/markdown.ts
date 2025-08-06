import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { PromptyNode } from "./ast.js";
import * as nunjucks from "nunjucks";



export const generateMarkdown = async (context: EmitContext<PromptyEmitterOptions>, node: PromptyNode) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates'));
  const template = env.getTemplate('markdown.njk', true);

  emitMarkdown(context, template, node, 0, false);
}

const emitMarkdown = async (context: EmitContext<PromptyEmitterOptions>, template: nunjucks.Template, node: PromptyNode, depth: number = 0, inline: boolean = false) => {
  const markdown = template.render({
    node: node,
    depth: depth,
    renderType: renderType(inline),
  });

  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "markdown", `${node.name}.md`),
    content: markdown,
  });

}

const renderType = (inline: boolean) => (child: PromptyNode): string => {
  const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');
  if (child.kind === 'Scalar') {
    return child.typeName;
  } else if (child.kind === 'Model') {
    return (inline ? `[${child.typeName}](#${typeLink(child.typeName)})` : `[${child.typeName}](${child.name}.md)`);
  } else if (child.kind === 'Union') {
    return child.siblings
      .filter(sibling => sibling.docsOnly === false)
      .map(sibling => inline ? `[${sibling.typeName}](#${typeLink(sibling.typeName)})` : `[${sibling.typeName}](${child.name}.md#${typeLink(sibling.typeName)})`)
      .join(' / ');
  }
  return `${child.typeName} ${child.kind}`;
}