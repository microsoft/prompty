import { getDiscriminator, getDoc, getEntityName, getNamespaceFullName, getPropertyType, getTypeName, isTemplateInstance, Model, ModelProperty, Program, Type } from "@typespec/compiler";


export interface TypeName {
  namespace: string;
  typeName: string;
  fullTypeName: string
}

const getModelType = (model: Model, rootNamespace: string = "Prompty"): TypeName => {
  let namespace = model.namespace ? getNamespaceFullName(model.namespace) : "";
  if (namespace.includes(".")) {
    const parts = namespace.split(".");
    parts[0] = rootNamespace.trim();
    namespace = parts.join(".");
  }
  return {
    namespace: namespace === "" ? rootNamespace : namespace,
    typeName: getTypeName(model, {
      nameOnly: true,
      printable: true,
    }),
    fullTypeName: getEntityName(model),
  };
};


export interface Alternative {
  simple: any;
  complex: {
    [key: string]: any;
  };
}


export class TypeNode {
  public name: TypeName;
  public description: string;
  public base: { namespace: string; typeName: string; fullTypeName: string } | null = null;
  public childTypes: { name: string; fullName: string; discriminator: string; value: string | number | boolean | null }[] = [];
  public alternatives: Alternative[] = [];
  public properties: PropertyNode[] = [];

  constructor(public model: Model, description: string) {
    this.model = model;
    this.name = getModelType(model);
    this.description = description;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      description: this.description,
      base: this.base || {},
      childTypes: this.childTypes,
      alternatives: this.alternatives,
      properties: this.properties.map(prop => prop.getSanitizedObject()),
    };
  }
}

export class PropertyNode {
  public name: string;
  public type: TypeName;

  
  public description: string;

  public samples: { title?: string; description?: string; sample: any }[] = [];
  public alternatives: Alternative[] = []; 

  public isScalar: boolean = false;
  public isOptional: boolean = false;
  public isCollection: boolean = false;


  public defaultValue: string | number | boolean | null = null;
  public allowedValues: string[] = [];
  public model: ModelProperty;

  constructor(modelProperty: ModelProperty, description: string) {
    this.name = modelProperty.name;
    this.description = description;
    this.model = modelProperty;
    if(modelProperty.type.kind === "Model") {
      this.type = getModelType(modelProperty.type);
    } else {
      this.type = {
        namespace: "",
        typeName: getTypeName(modelProperty.type, { nameOnly: true }),
        fullTypeName: getEntityName(modelProperty.type),
      };
    }
    
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      description: this.description,
      isCollection: this.isCollection,
      isOptional: this.isOptional,
      defaultValue: this.defaultValue,
      type: this.type,
    };
  }
}

export interface Variant {
  kind: string;
  value: string | number | boolean | null;
}


export class TypeNodeEx {
  public name: TypeName;
  public base: { namespace: string; typeName: string; fullTypeName: string } | null = null;
  public description: string = "";
  public childTypes: { name: string; fullName: string; discriminator: string; value: string | number | boolean | null }[] = [];
  public alternatives: Alternative[] = [];
  public properties: PropertyNodeEx[] = [];




  public namespace: string = "";
  public typeName: string = "";
  public fullTypeName: string = "";
  public baseType: string = "";
  public fullBaseType: string = "";
  public hasSimpleConstructor: boolean = false;
  public constructorTypes: string[] = [];
  public kind: string = "";

  constructor(public model: Model, description: string) {
    this.model = model;
    this.name = getModelType(model);
    this.kind = model.kind;
    this.description = description;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      base: this.base || {},
      namespace: this.namespace,
      typeName: this.typeName,
      fullTypeName: this.fullTypeName,
      baseType: this.baseType,
      fullBaseType: this.fullBaseType,
      description: this.description,
      alternatives: this.alternatives,
      childTypes: this.childTypes,
      properties: this.properties.map(prop => prop.getSanitizedObject()),


      kind: this.kind,
      hasSimpleConstructor: this.hasSimpleConstructor,
      constructorTypes: this.constructorTypes,
    };
  }
}


export class PropertyNodeEx {
  public name: string;
  public typeName: string;
  public fullTypeName: string;
  public description: string;

  public samples: { title?: string; description?: string; sample: any }[] = [];
  public alternatives: Alternative[] = [];

  public isScalar: boolean = false;
  public isOptional: boolean = false;
  public isCollection: boolean = false;
  public defaultValue: string | number | boolean | null = null;
  public allowedValues: (string | number | boolean | null)[] = [];



  public isVariant: boolean = false;
  public variants: Variant[] = [];
  public type: TypeNodeEx[];
  public kind: string;
  public model?: Type;

  constructor(name: string, kind: string, typeName: string, description: string, fullTypeName: string, model?: Type, type?: TypeNodeEx[]) {
    this.name = name;
    this.typeName = typeName;
    this.fullTypeName = fullTypeName;
    this.description = description;
    this.kind = kind;
    this.type = type || [];
    this.model = model;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      typeName: this.typeName,
      fullTypeName: this.fullTypeName,
      description: this.description,
      isCollection: this.isCollection,
      isOptional: this.isOptional,
      isVariant: this.isVariant,
      defaultValue: this.defaultValue,
      variants: this.variants,
      type: this.type ? this.type.map(t => t.getSanitizedObject()) : [],
      kind: this.kind,
    };
  }
}

export const enumerateTypes = function* (node: TypeNodeEx, visited: Set<string> = new Set()): IterableIterator<TypeNodeEx> {
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

  const node = new TypeNode(model, getDoc(program, model) || "");
  if (model.baseModel) {
    node.base = getModelType(model.baseModel);
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



export const resolveProperty = (program: Program, property: ModelProperty, visited: Set<string>): PropertyNode => {
  return new PropertyNode(
    property,
    getDoc(program, property) || ""
  );
}

export const resolveTypeEx = (program: Program, model: Model, visited: Set<string>): TypeNodeEx => {

  const node = new TypeNodeEx(model, getDoc(program, model) || "");

  /****** REMOVE **************/
  const { namespace, typeName, fullTypeName } = getModelType(model);
  node.namespace = namespace;
  node.typeName = typeName;
  node.fullTypeName = fullTypeName;
  /****** REMOVE **************/

  if (model.baseModel) {
    node.base = getModelType(model.baseModel);
  }

  if (model.name !== "Named" && model.name !== "Options") {
    visited.add(model.name);
  }
  // resolve properties if model
  if (model.kind === "Model") {
    const properties: PropertyNodeEx[] = [];
    for (const [_, value] of model.properties) {
      properties.push(resolvePropertEx(program, value, visited));
    }
    node.properties = properties;
  }

  return node;
};

const resolvePropertEx = (program: Program, property: ModelProperty, visited: Set<string>): PropertyNodeEx => {
  const type = getPropertyType(property);
  const description = getDoc(program, property) || "";
  const kind = type.kind;
  const fullTypeName = getTypeName(type);
  const typeName = getTypeName(type, {
    nameOnly: true,
    printable: true,
  });
  const prop = new PropertyNodeEx(property.name, kind, typeName, description, fullTypeName);
  prop.model = type;
  prop.isOptional = property.optional;

  if (property.defaultValue) {
    // only handle these things
    switch (property.defaultValue.valueKind) {
      case "StringValue":
        prop.defaultValue = property.defaultValue.value;
        break;
      case "BooleanValue":
        prop.defaultValue = property.defaultValue.value;
        break;
      case "NumericValue":
        prop.defaultValue = property.defaultValue.value.asNumber();
        break;
      default:
        prop.defaultValue = null;
    }
  }

  // sneaky default type
  if (prop.kind !== "Union" && typeName.includes('"')) {
    prop.isVariant = true;
    prop.variants = [{
      kind: "String",
      value: typeName.replace(/"/g, ''),
    }];
  }

  if (type.kind === "Model" && !visited.has(type.name) && !typeName.includes("unknown") && !typeName.includes('"')) {
    prop.type = [resolveTypeEx(program, type, visited)];
  } else if (type.kind === "Union") {
    const variants = Array.from(type.variants).map(([, v]) => v.type);

    // check for Record/Array types for collections
    // check for Model/Named for single items
    if (variants && variants.length === 2) {
      if (variants.every(v => v.kind === "Model")) {
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
                const mainType = resolveTypeEx(program, arrayType, visited);
                mainType.typeName = subTypeName;
                mainType.fullTypeName = subFullTypeName;
                mainType.description = getDoc(program, arraySubType) || "";
                visited.add(subTypeName);
                prop.type = [mainType];
                if (arraySubType.derivedModels.length > 0) {
                  const derivedTypes = arraySubType.derivedModels.map(m => resolveTypeEx(program, m, visited));
                  prop.type.push(...derivedTypes);

                  // add child types
                  mainType.childTypes.push(...derivedTypes.map(d => ({
                    name: d.typeName,
                    fullName: d.fullTypeName,
                    discriminator: "type",
                    value: "",
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
      } else if (variants.filter(v => v.kind === "Model").length === 1 && variants.filter(v => v.kind === "Scalar").length === 1) {
        // if only one Model, then we can use that as the type
        const modelType = variants.find(v => v.kind === "Model");
        if (modelType) {
          const subFullTypeName = getTypeName(modelType);
          const subTypeName = getTypeName(modelType, {
            nameOnly: true,
            printable: true,
          });
          prop.fullTypeName = subFullTypeName;
          prop.typeName = subTypeName;
          const typeNode = resolveTypeEx(program, modelType, visited);
          typeNode.hasSimpleConstructor = true;
          typeNode.constructorTypes.push(getTypeName(variants.filter(v => v.kind === "Scalar")[0]));
          prop.type = [typeNode];
        }
      }
    }
    else {
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