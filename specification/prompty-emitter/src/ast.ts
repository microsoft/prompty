import { Model, ModelProperty, Type } from "@typespec/compiler";


export class PromptyNode {
  public children: PromptyNode[] = [];
  public siblings: PromptyNode[] = [];
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
      children: this.children.map(child => child.getSanitizedObject()),
      siblings: this.siblings.map(sibling => sibling.getSanitizedObject()),
      docsOnly: this.docsOnly,
    };
  }
}