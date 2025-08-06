import { EmitContext, getDoc, getEntityName, getPropertyType, getTypeName, isTemplateInstance, Model, Program, Type } from "@typespec/compiler";
import { getUnionResolution } from "./decorators.js";
import { PromptyEmitterOptions } from "./lib.js";


export class PromptyNode {
  public children: PromptyNode[] = [];
  public siblings: PromptyNode[] = [];
  public fullTypeName: string = "";
  public typeName: string = "";
  public kind: string = "";
  public docsOnly: boolean = false;
  public description: string = "";
  constructor(public name: string, public model: Type, docsOnly?: boolean) {
    this.name = name;
    this.model = model;
    this.docsOnly = docsOnly || false;
  }

  addChild(child: PromptyNode) {
    this.children.push(child);
  }

  addChildren(children: PromptyNode[]) {
    this.children.push(...children);
  }

  addSibling(sibling: PromptyNode) {
    this.siblings.push(sibling);
  }

  addSiblings(siblings: PromptyNode[]) {
    this.siblings.push(...siblings);
  }

  appendDescription(description: string) {
    this.description += description;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      //model: this.model,
      description: this.description,
      fullTypeName: this.fullTypeName,
      kind: this.kind,
      typeName: this.typeName,
      children: this.children.map(child => child.getSanitizedObject()),
      siblings: this.siblings.map(sibling => sibling.getSanitizedObject()),
      docsOnly: this.docsOnly,
    };
  }
}


export const generateAst = (context: EmitContext<PromptyEmitterOptions>, model: Model): PromptyNode => {
  const ast = new PromptyNode("Prompty", model);
  ast.appendDescription(getDoc(context.program, model) || "");
  const children = resolveProperties(context.program, ast);
  ast.typeName = getTypeName(model, {
    nameOnly: true,
    printable: true,
  });
  ast.fullTypeName = getTypeName(model);
  ast.kind = model.kind;
  ast.addChildren(children);
  return ast;
}

const resolveProperties = (program: Program, node: PromptyNode): PromptyNode[] => {
  const properties: PromptyNode[] = [];
  // can only operate on Model types
  if (node.model.kind !== "Model") {
    return properties;
  }

  for (const [_, value] of node.model.properties) {
    const type = getPropertyType(value);
    const child = new PromptyNode(value.name, type);
    child.appendDescription(getDoc(program, value) || "");
    child.kind = type.kind;
    if (type.kind === "Model") {
      // recurse
      child.addChildren(resolveProperties(program, child));
      child.fullTypeName = getTypeName(type);
      child.typeName = getTypeName(type, {
        nameOnly: true,
        printable: true,
      });
    } else if (type.kind === "Union") {
      // handle union types
      const resolutions = getUnionResolution(program, value);
      for (const resolution of resolutions) {
        const resolutionNode = new PromptyNode(resolution.name, resolution.type, resolution.onlyDocs);
        if (isTemplateInstance(resolution.type)) {
          const templateType = resolution.type.templateMapper?.args.at(0);
          if (
            resolution.type.templateMapper?.args.length === 1 &&
            templateType !== undefined &&
            templateType.entityKind === "Type"
          ) {
            resolutionNode.appendDescription(getDoc(program, templateType) || "");
            resolutionNode.fullTypeName = getEntityName(templateType);
            resolutionNode.typeName = getTypeName(templateType, {
              nameOnly: true,
              printable: true,
            });
          }
        } else {
          resolutionNode.appendDescription(getDoc(program, resolution.type) || "");
        }
        // add the resolution node as a sibling
        child.addSibling(resolutionNode);
        // resolve properties of the type
        resolutionNode.addChildren(resolveProperties(program, resolutionNode));
      }
    } else {
      child.fullTypeName = getTypeName(type);
      child.typeName = getTypeName(type, {
        nameOnly: true,
        printable: true,
      });
    }
    properties.push(child);
  }

  return properties;
}
