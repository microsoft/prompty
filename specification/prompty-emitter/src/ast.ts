import { EmitContext, getDoc, getEntityName, getPropertyType, getTypeName, isTemplateInstance, Model, ModelProperty, Program, Type } from "@typespec/compiler";
import { getUnionResolution } from "./decorators.js";
import { PromptyEmitterOptions } from "./lib.js";

export class PropertyNode {
  public name: string;
  public kind: string;
  public typeName: string;
  public description: string;
  public fullTypeName: string;
  public isCollection: boolean = false;
  public model?: Type;
  public type: TypeNode[];

  constructor(name: string, kind: string, typeName: string, description: string, fullTypeName: string, model?: Type, type?: TypeNode[]) {
    this.name = name;
    this.kind = kind;
    this.typeName = typeName;
    this.description = description;
    this.fullTypeName = fullTypeName;
    this.type = type || [];
    this.model = model;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      kind: this.kind,
      typeName: this.typeName,
      description: this.description,
      fullTypeName: this.fullTypeName,
      isCollection: this.isCollection,
      type: this.type ? this.type.map(t => t.getSanitizedObject()) : [],
    };
  }
}

export class TypeNode {
  public properties: PropertyNode[] = [];
  public fullTypeName: string = "";
  public typeName: string = "";
  public kind: string = "";
  public abstract: boolean = false;

  public description: string = "";
  constructor(public model: Type) {
    this.model = model;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      kind: this.kind,
      typeName: this.typeName,
      fullTypeName: this.fullTypeName,
      description: this.description,
      abstract: this.abstract,
      properties: this.properties.map(prop => prop.getSanitizedObject()),
    };
  }
}

export const resolveType = (program: Program, model: Model, visited: Set<string>): TypeNode => {
  const node = new TypeNode(model);
  node.description = getDoc(program, model) || "";
  node.typeName = getTypeName(model, {
    nameOnly: true,
    printable: true,
  });
  node.fullTypeName = getTypeName(model);
  node.kind = model.kind;

  if (model.name !== "Named" && model.name !== "Options") {
    visited.add(model.name);
  }
  // resolve properties if model
  if (model.kind === "Model") {
    const properties: PropertyNode[] = [];
    for (const [_, value] of model.properties) {
      properties.push(resolveProperty(program, value, visited));
    }
    node.properties = properties;
  }

  return node;
};

const resolveProperty = (program: Program, property: ModelProperty, visited: Set<string>): PropertyNode => {
  const type = getPropertyType(property);
  const description = getDoc(program, property) || "";
  const kind = type.kind;
  const fullTypeName = getTypeName(type);
  const typeName = getTypeName(type, {
    nameOnly: true,
    printable: true,
  });
  const prop = new PropertyNode(property.name, kind, typeName, description, fullTypeName);
  prop.model = type;
  //prop.isCollection = property.defaultValue?.valueKind === "ArrayValue";

  if (type.kind === "Model" && !visited.has(type.name)) {
    prop.type = [resolveType(program, type, visited)];
  } else if (type.kind === "Union") {
    const variants = Array.from(type.variants).map(([, v]) => v.type);

    // check for Record/Array types for collections
    // check for Model/Named for single items
    if (variants && variants.length === 2 && variants.every(v => v.kind === "Model")) {
      const typeNames = variants.map(v => v.name);
      if (typeNames.includes("Record") && typeNames.includes("Array")) {

        const recordType = getTemplateType(variants[typeNames.indexOf("Record")]);
        const arrayType = getTemplateType(variants[typeNames.indexOf("Array")]);
        if (recordType && arrayType) {
          const arraySubType = getTemplateType(arrayType);
          // Named type and record Type need to be the same
          if (arraySubType && arraySubType.name === recordType.name) {
            // subtype names
            const subFullTypeName = getTypeName(arraySubType);
            const subTypeName = getTypeName(arraySubType, {
              nameOnly: true,
              printable: true,
            });
            prop.typeName = subTypeName;
            prop.fullTypeName = subFullTypeName;
            prop.isCollection = true;

            if (!visited.has(arraySubType.name)) {
              const mainType = resolveType(program, arrayType, visited);
              mainType.typeName = subTypeName;
              mainType.fullTypeName = subFullTypeName;
              mainType.description = getDoc(program, arraySubType) || "";
              visited.add(subTypeName);
              prop.type = [mainType];
              if (arraySubType.derivedModels.length > 0) {
                const derivedTypes = arraySubType.derivedModels.map(m => resolveType(program, m, visited));
                prop.type.push(...derivedTypes);
              }
            }
          }
        }
      } else {
        prop.isCollection = false;
        if (typeNames.includes("Named")) {
          const namedIdx = typeNames.indexOf("Named");
          const namedType = getTemplateType(variants[namedIdx]);
          if (namedType && namedType.name === variants[(namedIdx + 1) % 2].name) {
            const subFullTypeName = getTypeName(namedType);
            const subTypeName = getTypeName(namedType, {
              nameOnly: true,
              printable: true,
            });
            prop.fullTypeName = subFullTypeName;
            prop.typeName = subTypeName;
          }
        }
      }
    }
  }

  return prop;
};


const getTemplateType = (type: Type): Model | undefined => {
  if (isTemplateInstance(type)) {
    const t = type.templateMapper?.args.at(0);
    if (t && t.entityKind === "Type" && t.kind === "Model") {
      return t;
    }
  }
  return undefined;
};

/*
export const generateAst = (context: EmitContext<PromptyEmitterOptions>, model: Model): TypeNode => {
  const ast = new TypeNode("Prompty", model);
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
*/

/*
const resolveTypePropertiesN = (program: Program, node: TypeNode): TypeNode[] => {
  const properties: TypeNode[] = [];
  // can only operate on Model types
  if (node.model.kind !== "Model") {
    return properties;
  }

  for (const [_, value] of node.model.properties) {
    const type = getPropertyType(value);
    const child = new TypeNode(value.name, type);
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
        const resolutionNode = new TypeNode(resolution.name, resolution.type, resolution.onlyDocs);
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
*/