import { getDiscriminator, getDoc, getEntityName, getNamespaceFullName, getPropertyType, getTypeName, isTemplateInstance, Model, ModelProperty, Program, Scalar, Type, Union } from "@typespec/compiler";
import { Node } from "@typespec/compiler/ast";
import { AlternateEntry, getStateValue, SampleEntry } from "./decorators.js";
import { StateKeys } from "./lib.js";


export interface TypeName {
  namespace: string;
  name: string;
  fullName: string
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
    name: getTypeName(model, {
      nameOnly: true,
      printable: true,
    }),
    fullName: getEntityName(model),
  };
};


export interface Alternative {
  simple: any;
  complex: {
    [key: string]: any;
  };
}


export class TypeNode {
  public typeName: TypeName = {
    namespace: "",
    name: "",
    fullName: "",
  };
  public description: string;
  public base: TypeName | null = null;
  public childTypes: TypeNode[] = [];
  public alternatives: Alternative[] = [];
  public properties: PropertyNode[] = [];

  constructor(public model: Model, description: string) {
    this.model = model;
    this.description = description;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      typeName: this.typeName,
      description: this.description,
      base: this.base || {},
      childTypes: this.childTypes.map(ct => ct.getSanitizedObject()),
      alternatives: this.alternatives,
      properties: this.properties.map(prop => prop.getSanitizedObject()),
    };
  }
}

export class PropertyNode {
  public name: string;
  public typeName: TypeName = {
    namespace: "",
    name: "",
    fullName: "",
  };
  public description: string;

  public samples: SampleEntry[] = [];
  public alternatives: AlternateEntry[] = [];

  public isScalar: boolean = false;
  public isOptional: boolean = false;
  public isCollection: boolean = false;
  public isAny: boolean = false;


  public defaultValue: string | number | boolean | null = null;
  public allowedValues: string[] = [];

  public property: ModelProperty;
  public type: TypeNode[] = [];

  constructor(property: ModelProperty, description: string) {
    this.name = property.name;
    this.description = description;
    this.property = property;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      name: this.name,
      typeName: this.typeName,
      description: this.description,
      samples: this.samples,
      alternatives: this.alternatives,

      isScalar: this.isScalar,
      isOptional: this.isOptional,
      isCollection: this.isCollection,
      isAny: this.isAny,

      defaultValue: this.defaultValue || "null",
      allowedValues: this.allowedValues,
      type: this.type.map(t => t.getSanitizedObject()),
    };
  }
}


export const enumerateTypes = function* (node: TypeNode, visited: Set<string> = new Set()): IterableIterator<TypeNode> {
  for (const prop of node.properties) {
    if (prop.type && prop.type.length > 0) {
      for (const t of prop.type) {
        for (const subNode of enumerateTypes(t, visited)) {
          if (!visited.has(subNode.typeName.fullName)) {
            yield subNode;
            visited.add(subNode.typeName.fullName);
          }
        }
      }
    }
  }

  if (!visited.has(node.typeName.fullName)) {
    yield node;
    visited.add(node.typeName.fullName);
  }
};


export const resolveModel = (program: Program, model: Model, visited: Set<string> = new Set()): TypeNode => {

  const node = new TypeNode(model, getDoc(program, model) || "");

  if (model.name === "Named") {
    // Use Named<T> for actual model props, but innerModel for naming and docs
    const innerModel = getTemplateType(model);
    if (!innerModel || innerModel.kind !== "Model") {
      throw new Error(`Invalid Named<T> model: ${model.name}`);
    }
    node.typeName = getModelType(innerModel);
    node.childTypes = resolveModelChildren(program, innerModel, visited);
    visited.add(innerModel.name);
  } else {
    node.typeName = getModelType(model);
    visited.add(model.name);
  }

  if (model.baseModel) {
    node.base = getModelType(model.baseModel);
  }

  // resolve properties if model
  if (model.kind === "Model") {
    const properties: PropertyNode[] = [];
    for (const [_, value] of model.properties) {
      const prop = resolveProperty(program, value, visited);
      // samples
      prop.samples = getStateValue<SampleEntry>(program, StateKeys.samples, value);
      
      // alternatives
      //prop.alternatives = getStateValue<AlternateEntry>(program, StateKeys.alternates, value);
      // allowed values
      //prop.allowedValues = getStateValue<string>(program, StateKeys.allowedValues, value);
      properties.push(prop);
    }
    node.properties = properties;
  }

  return node;
};

export const resolveModelChildren = (program: Program, model: Model, visited: Set<string>): TypeNode[] => {
  return model.derivedModels.filter(derived => !visited.has(derived.name)).map(derived => resolveModel(program, derived, visited));
};

export const resolveProperty = (program: Program, property: ModelProperty, visited: Set<string>): PropertyNode => {
  switch (property.type.kind) {
    case "Scalar":
      return resolveScalarProperty(program, property, property.type);
    case "Model":
      return resolveModelProperty(program, property, property.type, visited);
    case "Union":
      return resolveUnionProperty(program, property, property.type, visited);
    case "Intrinsic":
      return resolveIntrinsicProperty(program, property, property.type, visited);
    case "String":
      // this is for default values in discriminated types
      // TODO: perhaps handle string-specific logic here
      const prop = new PropertyNode(
        property,
        getDoc(program, property) || ""
      );

      prop.defaultValue = property.type.value;
      prop.typeName = {
        namespace: "",
        name: "string",
        fullName: "string"
      };

      prop.isScalar = true;
      prop.isAny = false;
      prop.isOptional = property.optional;
      prop.isCollection = false;

      return prop;

    default:
      throw new Error(`Unsupported property type: ${property.type.kind}`);
  }
};

export const resolveScalarProperty = (program: Program, property: ModelProperty, scalar: Scalar): PropertyNode => {
  const prop = new PropertyNode(
    property,
    getDoc(program, property) || ""
  );

  prop.typeName = {
    namespace: "",
    name: getTypeName(scalar, { nameOnly: true }),
    fullName: getEntityName(scalar)
  };

  prop.isScalar = true;
  prop.isAny = false;
  prop.isOptional = property.optional;
  prop.isCollection = false;

  // defaults
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
        prop.defaultValue = "unspecified";
        break;
    }
  }

  return prop;
};

export const resolveIntrinsicProperty = (program: Program, property: ModelProperty, intrinsic: Type, visited: Set<string>): PropertyNode => {
  const prop = new PropertyNode(
    property,
    getDoc(program, property) || ""
  );

  prop.typeName = {
    namespace: "",
    name: getTypeName(intrinsic, { nameOnly: true }),
    fullName: getEntityName(intrinsic)
  };

  prop.isScalar = true;
  prop.isAny = true;
  prop.isOptional = property.optional;
  prop.isCollection = prop.typeName.name.includes("[") && prop.typeName.name.includes("]");

  // defaults
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
        break;
    }
  }

  return prop;
};

export const resolveModelProperty = (program: Program, property: ModelProperty, model: Model, visited: Set<string>): PropertyNode => {
  const prop = new PropertyNode(
    property,
    getDoc(program, property) || ""
  );

  prop.isScalar = false;
  prop.isAny = false;
  prop.isOptional = property.optional;
  prop.isCollection = false;

  prop.typeName = getModelType(model);
  if (!visited.has(model.name)) {
    prop.type = [resolveModel(program, model, visited)];
  } else {
    prop.type = [];
  }
  return prop;
};

export const resolveUnionProperty = (program: Program, property: ModelProperty, union: Union, visited: Set<string>): PropertyNode => {
  const prop = new PropertyNode(
    property,
    getDoc(program, property) || ""
  );

  prop.isScalar = false;
  prop.isAny = false;
  prop.isOptional = property.optional;
  prop.isCollection = false;

  const variants = Array.from(union.variants).map(([, v]) => v.type);
  const models = variants.filter(v => v.kind === "Model");

  if (models.length === 1) {
    if (!visited.has(models[0].name)) {
      prop.type = [resolveModel(program, models[0], visited)];
    } else {
      prop.type = [];
    }
  } else if (models.length === 2) {
    const modelNames = models.map(m => m.name);
    // collection situation
    if (modelNames.includes("Record") && modelNames.includes("Array")) {
      // Should be Record<T> -> T
      const recordType = getTemplateType(models[modelNames.indexOf("Record")]);
      // Should be Array<Named<T>> -> Named<T>
      const namedType = getTemplateType(models[modelNames.indexOf("Array")]);
      // Should be Named<T> -> T
      const arrayType = getTemplateType(namedType);

      if (recordType && arrayType && namedType && recordType.name === arrayType.name) {
        prop.isCollection = true;
        // Use T as actual class model for naming purposes
        prop.typeName = getModelType(arrayType);
        // Use Named<T> for actual model props
        if (!visited.has(arrayType.name)) {
          prop.type = [resolveModel(program, namedType, visited)];
        } else {
          prop.type = [];
        }
      }
      else {
        throw new Error(`Unsupported union types for Record/Array: ${recordType?.name} / ${arrayType?.name} - they should match.`);
      }

    } else if (modelNames.includes("Named")) {
      const namedIdx = modelNames.indexOf("Named");
      const namedModel = getTemplateType(models[namedIdx]);
      const mainModel = models[(namedIdx + 1) % 2];
      if (namedModel && namedModel.name === mainModel.name) {
        prop.typeName = getModelType(namedModel);
        if (!visited.has(mainModel.name)) {
          prop.type = [resolveModel(program, namedModel, visited)];
        } else {
          prop.type = [];
        }
      } else {
        throw new Error(`Named model union types must match! (${models.map(m => m.name).join(", ")})`)
      }
    } else {
      throw new Error(`Unsupported union type: ${union.kind}`);
    }
  } else {
    throw new Error(`Unable to resolve ${union.name} - too many variants: (${models.map(m => m.name).join(", ")})`);
  }
  return prop;
};

export const resolvePropertyDecorators = (program: Program, property: ModelProperty, prop: PropertyNode) => {
  // samples
  prop.samples = getStateValue<SampleEntry>(program, StateKeys.samples, property);

  // alternatives
  prop.alternatives = getStateValue<AlternateEntry>(program, StateKeys.alternates, property);

  // allowed values
  prop.allowedValues = getStateValue<string>(program, StateKeys.allowedValues, property);
}

/*** OLD */


export interface Variant {
  kind: string;
  value: string | number | boolean | null;
}


export class TypeNodeEx {
  public name: TypeName;
  public base: TypeName | null = null;
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

export const enumerateTypesEx = function* (node: TypeNodeEx, visited: Set<string> = new Set()): IterableIterator<TypeNodeEx> {
  for (const prop of node.properties) {
    if (prop.type && prop.type.length > 0) {
      for (const t of prop.type) {
        for (const subNode of enumerateTypesEx(t, visited)) {
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

export const resolveTypeEx = (program: Program, model: Model, visited: Set<string>): TypeNodeEx => {

  const node = new TypeNodeEx(model, getDoc(program, model) || "");

  /****** REMOVE **************/
  const { name, fullName } = getModelType(model);
  node.namespace = "";
  node.typeName = name;
  node.fullTypeName = fullName;
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

const getTemplateType = (type: Type | undefined): Model | undefined => {
  if (!type) return undefined;
  if (isTemplateInstance(type)) {
    const t = type.templateMapper?.args.at(0);
    if (t && t.entityKind === "Type" && t.kind === "Model") {
      return t;
    }
  }
  return undefined;
};