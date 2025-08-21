import { getDoc, getPropertyType, getTypeName, isTemplateInstance, Model, ModelProperty, Program, Type } from "@typespec/compiler";


export interface Variant {
  kind: string;
  value: string | number | boolean | null;
}

export class PropertyNode {
  public name: string;
  public kind: string;
  public typeName: string;
  public description: string;
  public fullTypeName: string;
  public isCollection: boolean = false;
  public isOptional: boolean = false;
  public isVariant: boolean = false;
  public variants: Variant[] = [];
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
      isOptional: this.isOptional,
      isCollection: this.isCollection,
      isVariant: this.isVariant,
      variants: this.variants,
      type: this.type ? this.type.map(t => t.getSanitizedObject()) : [],
    };
  }
}

export class TypeNode {
  public properties: PropertyNode[] = [];
  public fullTypeName: string = "";
  public typeName: string = "";
  public kind: string = "";
  public baseType: string = "";
  public fullBaseType: string = "";
  public childTypes: { name: string; fullName: string }[] = [];

  public description: string = "";
  constructor(public model: Type) {
    this.model = model;
    this.baseType = "";
    this.fullBaseType = "";
  }

  getSanitizedObject(): Record<string, any> {
    return {
      kind: this.kind,
      typeName: this.typeName,
      fullTypeName: this.fullTypeName,
      baseType: this.baseType,
      fullBaseType: this.fullBaseType,
      childTypes: this.childTypes,
      description: this.description,
      properties: this.properties.map(prop => prop.getSanitizedObject()),
    };
  }
}

export const enumerateTypes = function* (node: TypeNode, visited: Set<string> = new Set()): IterableIterator<TypeNode> {
  for (const prop of node.properties) {
    if (prop.type && prop.type.length > 0) {
      for (const t of prop.type) {
        for (const subNode of enumerateTypes(t, visited)) {
          if (!visited.has(subNode.typeName)) {
            yield subNode;
            visited.add(subNode.typeName);
          }
        }
      }
    }
  }

  if (!visited.has(node.typeName)) {
    yield node;
    visited.add(node.typeName);
  }
};

export const resolveType = (program: Program, model: Model, visited: Set<string>): TypeNode => {
  const node = new TypeNode(model);
  node.description = getDoc(program, model) || "";
  node.typeName = getTypeName(model, {
    nameOnly: true,
    printable: true,
  });
  node.fullTypeName = getTypeName(model);
  node.kind = model.kind;
  if (model.baseModel) {
    node.baseType = getTypeName(model.baseModel, {
      nameOnly: true,
      printable: true,
    });
    node.fullBaseType = getTypeName(model.baseModel);
  }

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
  prop.isOptional = property.optional;

  // TODO: need to account for default values

  // sneaky variant
  if (typeName.includes('"')) {
    prop.isVariant = true;
    prop.variants = [{
      kind: "String",
      value: typeName.replace(/"/g, ''),
    }];
  }

  if (type.kind === "Model" && !visited.has(type.name) && !typeName.includes("unknown") && !typeName.includes('"')) {
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

                // add child types
                mainType.childTypes.push(...derivedTypes.map(d => ({
                  name: d.typeName,
                  fullName: d.fullTypeName,
                })));
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
    } else {
      prop.isVariant = true;
      prop.variants = variants.map((v: { [key: string]: any }) => {
        return {
          kind: v.kind,
          value: v.value,
        };
      });
    }
  } else if (typeName.includes("unknown")) {
    prop.isCollection = typeName.includes("[") && typeName.includes("]");
    prop.typeName = "unknown";
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