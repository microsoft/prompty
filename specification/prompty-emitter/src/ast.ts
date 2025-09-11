import {
  Type,
  Model,
  Scalar,
  Union,
  Program,
  getDoc,
  getTypeName,
  ModelProperty,
  getEntityName,
  isTemplateInstance,
  getNamespaceFullName,
  getDiscriminator,
  Discriminator,
} from "@typespec/compiler";
import { AlternateEntry, getStateScalar, getStateValue, SampleEntry } from "./decorators.js";
import { StateKeys } from "./lib.js";


export interface TypeName {
  namespace: string;
  name: string;
  fullName: string
}

const getModelType = (model: Model, rootNamespace: string): TypeName => {
  let namespace = model.namespace ? getNamespaceFullName(model.namespace) : rootNamespace || "";
  if (rootNamespace.includes('.'))
    namespace = rootNamespace;
  else
  {
    const parts = namespace.split(".");
    parts[0] = rootNamespace;
    namespace = parts.join(".");
  }
  const name = getTypeName(model, {
    nameOnly: true,
    printable: true,
  });

  return {
    namespace: namespace,
    name: name,
    fullName: `${namespace}.${name}`,
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
  public isRoot: boolean = false;
  public base: TypeName | null = null;
  public childTypes: TypeNode[] = [];
  public alternatives: Alternative[] = [];
  public properties: PropertyNode[] = [];
  public isAbstract: boolean = false;
  public discriminator: string | undefined = undefined;

  constructor(public model: Model, description: string) {
    this.model = model;
    this.description = description;
  }

  getSanitizedObject(): Record<string, any> {
    return {
      typeName: this.typeName,
      description: this.description,
      base: this.base || {},
      isAbstract: this.isAbstract,
      discriminator: this.discriminator,
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
  public isDict: boolean = false;

  public defaultValue: string | number | boolean | null = null;
  public allowedValues: string[] = [];

  public property: ModelProperty;
  public type: TypeNode | undefined = undefined;

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
      isDict: this.isDict,

      defaultValue: this.defaultValue || "null",
      allowedValues: this.allowedValues,
      type: this.type ? this.type.getSanitizedObject() : undefined,
    };
  }
}


export const enumerateTypes = function* (node: TypeNode, visited: Set<string> = new Set()): IterableIterator<TypeNode> {
  for (const prop of node.properties) {
    if (prop.type) {
      // enumerate
      for (const subNode of enumerateTypes(prop.type, visited)) {
        if (!visited.has(subNode.typeName.fullName)) {
          yield subNode;
          visited.add(subNode.typeName.fullName);
        }
      }
      for (const child of prop.type.childTypes) {
        for (const subNode of enumerateTypes(child, visited)) {
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
    for (const child of node.childTypes) {
      for (const subNode of enumerateTypes(child, visited)) {
        if (!visited.has(subNode.typeName.fullName)) {
          yield subNode;
          visited.add(subNode.typeName.fullName);
        }
      }
    }
    visited.add(node.typeName.fullName);
  }
};

export const resolveModel = (program: Program, model: Model, visited: Set<string> = new Set(), rootNamespace: string): TypeNode => {

  const node = new TypeNode(model, getDoc(program, model) || "");

  if (model.name === "Named") {
    // Use Named<T> for actual model props, but innerModel for naming and docs
    const innerModel = getTemplateModel(model);
    if (!innerModel || innerModel.kind !== "Model") {
      throw new Error(`Invalid Named<T> model: ${model.name}`);
    }
    node.typeName = getModelType(innerModel, rootNamespace);
    node.childTypes = resolveModelChildren(program, innerModel, visited, rootNamespace);
    node.description = getDoc(program, innerModel) || "";
    node.isAbstract = getStateScalar<boolean>(program, StateKeys.abstracts, innerModel) || false;
    const discriminator = getDiscriminator(program, innerModel);
    node.discriminator = discriminator ? discriminator.propertyName : undefined;
    visited.add(innerModel.name);
  } else {
    node.typeName = getModelType(model, rootNamespace);
    node.childTypes = resolveModelChildren(program, model, visited, rootNamespace);
    node.isAbstract = getStateScalar<boolean>(program, StateKeys.abstracts, model) || false;
    const discriminator = getDiscriminator(program, model);
    node.discriminator = discriminator ? discriminator.propertyName : undefined;
    visited.add(model.name);
  }

  if (model.baseModel) {
    node.base = getModelType(model.baseModel, rootNamespace);
  }

  // resolve properties if model
  if (model.kind === "Model") {
    const properties: PropertyNode[] = [];
    for (const [_, value] of model.properties) {
      const prop = resolveProperty(program, value, visited, rootNamespace);
      // samples
      prop.samples = getStateValue<SampleEntry>(program, StateKeys.samples, value);
      // alternatives
      prop.alternatives = getStateValue<AlternateEntry>(program, StateKeys.alternates, value);
      properties.push(prop);
    }
    node.properties = properties;
  }

  return node;
};

export const resolveModelChildren = (program: Program, model: Model, visited: Set<string>, rootNamespace: string): TypeNode[] => {
  return model.derivedModels.filter(derived => !visited.has(derived.name)).flatMap(derived => {
    return [resolveModel(program, derived, visited, rootNamespace), ...resolveModelChildren(program, derived, visited, rootNamespace)];
  });
};

export const resolveProperty = (program: Program, property: ModelProperty, visited: Set<string>, rootNamespace: string): PropertyNode => {
  switch (property.type.kind) {
    case "Scalar":
      return resolveScalarProperty(program, property, property.type);
    case "Model":
      return resolveModelProperty(program, property, property.type, visited, rootNamespace);
    case "Union":
      return resolveUnionProperty(program, property, property.type, visited, rootNamespace);
    case "Intrinsic":
      return resolveIntrinsicProperty(program, property, property.type, visited);
    case "String":
      // this is for default values in discriminated types
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
      program.reportDiagnostic({
        code: "prompty-emitter-unsupported-property-type",
        message: `Unsupported property type: ${property.type.kind}`,
        severity: "error",
        target: property
      });
      return new PropertyNode(property, getDoc(program, property) || "");
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

export const resolveModelProperty = (program: Program, property: ModelProperty, model: Model, visited: Set<string>, rootNamespace: string): PropertyNode => {
  const prop = new PropertyNode(
    property,
    getDoc(program, property) || ""
  );

  if (model.name === "Array") {

    const innerModel = getTemplateModel(model);
    if (innerModel) {
      // Use innerModel for naming and docs
      prop.isScalar = false;
      prop.isAny = false;
      prop.isOptional = property.optional;
      prop.isCollection = true;
      prop.typeName = getModelType(innerModel, rootNamespace);
      if (!visited.has(model.name)) {
        prop.type = resolveModel(program, innerModel, visited, rootNamespace);
      }
    } else {
      // check for Scalar Arrays
      const innerType = getTemplateType(model);
      if (innerType && innerType.kind === "Scalar") {
        prop.isScalar = true;
        prop.isAny = false;
        prop.isOptional = property.optional;
        prop.isCollection = true;
        prop.typeName = {
          namespace: "",
          name: getTypeName(innerType, { nameOnly: true }),
          fullName: getEntityName(innerType)
        };
      } else if (innerType && innerType.kind === "Intrinsic") {
        prop.isScalar = true;
        prop.isAny = true;
        prop.isOptional = property.optional;
        prop.isCollection = true;
        prop.typeName = {
          namespace: "",
          name: "unknown",
          fullName: "unknown"
        };
      } else {
        program.reportDiagnostic({
          code: "prompty-emitter-unsupported-array-type",
          message: `Unsupported array type: ${getTypeName(model)}`,
          severity: "error",
          target: property
        });
      }
    }
  } else {
    prop.isScalar = false;
    prop.isAny = false;
    prop.isOptional = property.optional;
    prop.isCollection = false;
    
    prop.typeName = getModelType(model, rootNamespace);
    if(prop.typeName.name === "Record<unknown>") {
      prop.isScalar = true;
      prop.isDict = true;
      prop.typeName = {
        namespace: "",
        name: "dictionary",
        fullName: "dictionary"
      };
      // need to clear this out as a model type
      prop.type = undefined;
    }
    if (!visited.has(model.name) && prop.typeName.name !== "dictionary") {
      prop.type = resolveModel(program, model, visited, rootNamespace);
    }
  }
  return prop;
};

export const resolveUnionProperty = (program: Program, property: ModelProperty, union: Union, visited: Set<string>, rootNamespace: string): PropertyNode => {
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
      prop.type = resolveModel(program, models[0], visited, rootNamespace);
      prop.typeName = getModelType(models[0], rootNamespace);
    }
  } else if (models.length === 2) {
    const modelNames = models.map(m => m.name);
    // collection situation
    if (modelNames.includes("Record") && modelNames.includes("Array")) {
      // Should be Record<T> -> T
      const recordType = getTemplateModel(models[modelNames.indexOf("Record")]);
      // Should be Array<Named<T>> -> Named<T>
      const namedType = getTemplateModel(models[modelNames.indexOf("Array")]);
      // Should be Named<T> -> T
      const arrayType = getTemplateModel(namedType);

      if (recordType && arrayType && namedType && recordType.name === arrayType.name) {
        prop.isCollection = true;
        // Use T as actual class model for naming purposes
        prop.typeName = getModelType(arrayType, rootNamespace);
        // Use Named<T> for actual model props
        if (!visited.has(arrayType.name)) {
          prop.type = resolveModel(program, namedType, visited, rootNamespace);
        }
      }
      else {
        program.reportDiagnostic({
          code: "prompty-emitter-unsupported-union-types",
          message: `Unsupported union types for Record/Array: ${recordType?.name} / ${arrayType?.name} - they should match.`,
          severity: "error",
          target: property
        });
        return prop;
      }

    } else if (modelNames.includes("Named")) {
      const namedIdx = modelNames.indexOf("Named");
      const namedModel = getTemplateModel(models[namedIdx]);
      const mainModel = models[(namedIdx + 1) % 2];
      if (namedModel && namedModel.name === mainModel.name) {
        prop.typeName = getModelType(namedModel, rootNamespace);
        if (!visited.has(mainModel.name)) {
          prop.type = resolveModel(program, namedModel, visited, rootNamespace);
        }
      } else {
        program.reportDiagnostic({
          code: "prompty-emitter-named-model-union-types",
          message: `Named model union types must match! (${models.map(m => m.name).join(", ")})`,
          severity: "error",
          target: property
        });
        return prop;
      }
    } else {
      program.reportDiagnostic({
        code: "prompty-emitter-unsupported-union-types",
        message: `Unsupported union type: ${union.kind}`,
        severity: "error",
        target: property
      });
      return prop;
    }
  } else {
    // only accept unions for defining string variants
    const acceptableVariants = variants.filter(v => v.kind === "String" || (v.kind === "Scalar" && v.name === "string")).length;
    if (acceptableVariants === variants.length) {
      prop.typeName = {
        "namespace": "",
        "name": "string",
        "fullName": "string"
      };
      prop.isScalar = true;
      prop.allowedValues = variants.filter(v => v.kind === "String").map(v => v.value)
      const s = 1;
    } else {
      program.reportDiagnostic({
        code: "prompty-emitter-unsupported-union-types",
        message: `Unable to resolve ${union.name} - too many variants: (${models.map(m => m.name).join(", ")})`,
        severity: "error",
        target: property
      });
    }
    return prop;
  }
  return prop;
};

const getTemplateModel = (type: Type | undefined): Model | undefined => {
  if (!type) return undefined;
  if (isTemplateInstance(type)) {
    const t = type.templateMapper?.args.at(0);
    if (t && t.entityKind === "Type" && t.kind === "Model") {
      return t;
    }
  }
  return undefined;
};

const getTemplateType = (type: Type | undefined): Type | undefined => {
  if (!type) return undefined;
  if (isTemplateInstance(type)) {
    const t = type.templateMapper?.args.at(0);
    if (t && t.entityKind === "Type") {
      return t;
    }
  }
  return undefined;
};
