import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { PromptyEmitterOptions } from "./lib.js";
import { TypeNode } from "./ast.js";
import * as nunjucks from "nunjucks";



export const generateMarkdown = async (context: EmitContext<PromptyEmitterOptions>, node: TypeNode) => {
  // set up template environment
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('./src/templates'));
  const template = env.getTemplate('markdown.njk', true);

  //emitMarkdown(context, template, node, false);
}

/*
const emitMarkdown = async (context: EmitContext<PromptyEmitterOptions>, template: nunjucks.Template, node: TypeNode, inline: boolean = false) => {

  const markdown = template.render({
    node: node,
    renderType: renderType(inline),
  });

  const children: Record<string, string> = {};
  
  for (const child of node.children) {
    if (child.kind === "Model") {
      const prop = await emitMarkdown(context, template, child, true);
      children[child.name] = prop;
    }
  }
    

  if (inline) {
    const props = Object.entries(children).map(([_, value]) => `${value}`).join('\n');
    return markdown + "\n" + props;
  } else {
    await emitMarkdownFile(context, node.name, markdown);
    // emit file for each child
    for (const [name, markdown] of Object.entries(children)) {
      await emitMarkdownFile(context, name, markdown);
    }

    return markdown;
  }
}

const renderType = (inline: boolean) => (child: TypeNode): string => {
  const typeLink = (name: string) => name.toLowerCase().replaceAll(' ', '-');
  if (child.kind === 'Scalar') {
    return child.typeName;
  } else if (child.kind === 'Model') {
    return (inline ? `[${child.typeName}](#${typeLink(child.typeName)})` : `[${child.typeName}](${child.name}.md)`);
  } else if (child.kind === 'Union') {
    const items = child.siblings
      .filter(sibling => sibling.docsOnly === false)
      .map(sibling => inline ? `[${sibling.typeName}](#${typeLink(sibling.typeName)})` : `[${sibling.typeName}](${child.name}.md#${typeLink(sibling.typeName)})`)
      .join(' / ');

    return `${items}`;
  }
  return `${child.typeName} ${child.kind}`;
}

const emitMarkdownFile = async (context: EmitContext<PromptyEmitterOptions>, name: string, markdown: string) => {
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "markdown", `${name.toLowerCase().replaceAll(' ', '-')}.md`),
    content: markdown,
  });
}
*/