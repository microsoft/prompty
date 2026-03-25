import {
  Type,
  Model,
  Scalar,
  Union,
  Program,
  getDoc,
  getTypeName,
  ModelProperty,
  isTemplateInstance,
  getNamespaceFullName,
  getDiscriminator,
} from "@typespec/compiler";
import { getStateScalar, getStateValue, SampleEntry } from "./decorators.js";
import { StateKeys } from "./lib.js";


export interface TypeName {
  namespace: string;
  name: string;
}

const getModelType = (model: Model, rootNamespace: string, rootAlias: string): TypeName => {
  let namespace = model.namespace ? getNamespaceFullName(model.namespace) : rootNamespace || "";
  if (rootNamespace.includes('.'))
    namespace = rootNamespace;
  else {
    const parts = namespace.split(".");
    parts[0] = rootNamespace;
    namespace = parts.join(".");
  }
  const name = getTypeName(model, {
    nameOnly: true,
    printable: true,
  });

  if (rootAlias) {
    return {
      namespace: namespace,
      name: name.replace("AgentSchema", rootAlias)
    };
  }

  return {
    namespace: namespace,
    name: name
  };
};

export interface Alternative {
  scalar: string;
  expansion: {
    [key: string]: any;
  };
  example?: any;
  title?: string;
  description?: string;
}


export class TypeNode {
  public typeName: TypeName = {
    namespace: "",
    name: ""
  };
  public description: string;
  public base: TypeName | null = null;
  public childTypes: TypeNode[] = [];
  public alternates: Alternative[] = [];
  public properties: PropertyNode[] = [];
  public isAbstract: boolean = false;
  public discriminator: string | undefined = undefined;

  constructor(public model: Model, description: string) {
    this.model = model;
    this.description = description;
  }

  retrievePolymorphicTypes(): any {
    let instances: any[] = [];
    if (this.discriminator && this.childTypes.length > 0) {
      instances = this.childTypes.map(child => ({
        discriminator: this.discriminator,
        value: child.properties.find(p => p.name === this.discriminator)?.defaultValue || "*",
        instance: child,
      }));

      if (!this.isAbstract) {
        instances = [...instances, { discriminator: this.discriminator, value: "*", instance: this }];
      }

      const filteredInstances = instances.filter(instance => instance.value !== "*");
      const defaultInstance = instances.filter(i => i.value === "*")[0];
      return {
        types: filteredInstances,
        default: defaultInstance,
      };
    }
    return undefined;
  };

  getSanitizedObject(): Record<string, any> {
    return {
      typeName: this.typeName,
      description: this.description,
      base: this.base || {},
      isAbstract: this.isAbstract,
      discriminator: this.discriminator,
      alternates: this.alternates,
      childTypes: this.childTypes.map(ct => ct.getSanitizedObject()),
      properties: this.properties.map(prop => prop.getSanitizedObject()),
    };
  }
}

export class PropertyNode {
  public name: string;
  public typeName: TypeName = {
    namespace: "",
    name: ""
  };
  public description: string;

  public samples: SampleEntry[] = [];

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
        if (!visited.has(`${subNode.typeName.namespace}.${subNode.typeName.name}`)) {
          yield subNode;
          visited.add(`${subNode.typeName.namespace}.${subNode.typeName.name}`);
        }
      }
      for (const child of prop.type.childTypes) {
        for (const subNode of enumerateTypes(child, visited)) {
          if (!visited.has(`${subNode.typeName.namespace}.${subNode.typeName.name}`)) {
            yield subNode;
            visited.add(`${subNode.typeName.namespace}.${subNode.typeName.name}`);
          }
        }
      }
    }
  }

  if (!visited.has(`${node.typeName.namespace}.${node.typeName.name}`)) {
    yield node;
    for (const child of node.childTypes) {
      for (const subNode of enumerateTypes(child, visited)) {
        if (!visited.has(`${subNode.typeName.namespace}.${subNode.typeName.name}`)) {
          yield subNode;
          visited.add(`${subNode.typeName.namespace}.${subNode.typeName.name}`);
        }
      }
    }
    visited.add(`${node.typeName.namespace}.${node.typeName.name}`);
  }
};

export const resolveModel = (program: Program, model: Model, visited: Set<string> = new Set(), rootNamespace: string, rootAlias: string): TypeNode => {

  const node = new TypeNode(model, getDoc(program, model) || "");

  if (model.name === "Named") {
    // Use Named<T> for actual model props, but innerModel for naming and docs
    const innerModel = getTemplateModel(model);
    if (!innerModel || innerModel.kind !== "Model") {
      throw new Error(`Invalid Named<T> model: ${model.name}`);
    }
    node.typeName = getModelType(innerModel, rootNamespace, rootAlias);
    node.childTypes = resolveModelChildren(program, innerModel, visited, rootNamespace, rootAlias);
    node.description = getDoc(program, innerModel) || "";
    node.isAbstract = getStateScalar<boolean>(program, StateKeys.abstracts, innerModel) || false;
    const discriminator = getDiscriminator(program, innerModel);
    node.discriminator = discriminator ? discriminator.propertyName : undefined;
    // shorthand .ctor
    node.alternates = getStateValue<Alternative>(program, StateKeys.shorthands, innerModel);
    visited.add(innerModel.name);
  } else {
    node.typeName = getModelType(model, rootNamespace, rootAlias);
    node.childTypes = resolveModelChildren(program, model, visited, rootNamespace, rootAlias);
    node.isAbstract = getStateScalar<boolean>(program, StateKeys.abstracts, model) || false;
    const discriminator = getDiscriminator(program, model);
    node.discriminator = discriminator ? discriminator.propertyName : undefined;
    // shorthand .ctor
    node.alternates = getStateValue<Alternative>(program, StateKeys.shorthands, model);
    visited.add(model.name);
  }

  if (model.baseModel) {
    node.base = getModelType(model.baseModel, rootNamespace, rootAlias);
  }



  // resolve properties if model
  if (model.kind === "Model") {
    const properties: PropertyNode[] = [];
    for (const [_, value] of model.properties) {
      const prop = resolveProperty(program, value, visited, rootNamespace, rootAlias);
      // samples
      prop.samples = getStateValue<SampleEntry>(program, StateKeys.samples, value);

      properties.push(prop);
    }
    node.properties = properties;
  }

  return node;
};

export const resolveModelChildren = (program: Program, model: Model, visited: Set<string>, rootNamespace: string, rootAlias: string): TypeNode[] => {
  return model.derivedModels.filter(derived => !visited.has(derived.name)).flatMap(derived => {
    return [resolveModel(program, derived, visited, rootNamespace, rootAlias), ...resolveModelChildren(program, derived, visited, rootNamespace, rootAlias)];
  });
};

export const resolveProperty = (program: Program, property: ModelProperty, visited: Set<string>, rootNamespace: string, rootAlias: string): PropertyNode => {
  switch (property.type.kind) {
    case "Scalar":
      return resolveScalarProperty(program, property, property.type);
    case "Model":
      return resolveModelProperty(program, property, property.type, visited, rootNamespace, rootAlias);
    case "Union":
      return resolveUnionProperty(program, property, property.type, visited, rootNamespace, rootAlias);
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
        name: "string"
      };

      prop.isScalar = true;
      prop.isAny = false;
      prop.isOptional = property.optional;
      prop.isCollection = false;

      return prop;

    default:
      program.reportDiagnostic({
        code: "agentschema-emitter-unsupported-property-type",
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
    name: getTypeName(scalar, { nameOnly: true })
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
    name: getTypeName(intrinsic, { nameOnly: true })
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

export const resolveModelProperty = (program: Program, property: ModelProperty, model: Model, visited: Set<string>, rootNamespace: string, rootAlias: string): PropertyNode => {
  const prop = new PropertyNode(
    property,
    getDoc(program, property) || ""
  );

  if (model.name === "Array") {

    const innerModel = getTemplateModel(model);
    if (innerModel) {
      // Use innerModel for naming and docs

      if (innerModel.name === "Record") {
        // Record situation -> treat as array of dictionary
        prop.isScalar = false;
        prop.isAny = false;
        prop.isOptional = property.optional;
        prop.isCollection = true;
        prop.isDict = true;
        prop.typeName = {
          namespace: "",
          name: "dictionary"
        };
      } else {
        prop.isScalar = false;
        prop.isAny = false;
        prop.isOptional = property.optional;
        prop.isCollection = true;
        prop.typeName = getModelType(innerModel, rootNamespace, rootAlias);
        if (!visited.has(model.name)) {
          prop.type = resolveModel(program, innerModel, visited, rootNamespace, rootAlias);
        }
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
          name: getTypeName(innerType, { nameOnly: true })
        };
      } else if (innerType && innerType.kind === "Intrinsic") {
        prop.isScalar = true;
        prop.isAny = true;
        prop.isOptional = property.optional;
        prop.isCollection = true;
        prop.typeName = {
          namespace: "",
          name: "unknown"
        };
      } else {
        program.reportDiagnostic({
          code: "agentschema-emitter-unsupported-array-type",
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

    prop.typeName = getModelType(model, rootNamespace, rootAlias);
    if (prop.typeName.name === "Record<unknown>") {
      prop.isScalar = true;
      prop.isDict = true;
      prop.typeName = {
        namespace: "",
        name: "dictionary"
      };
      // need to clear this out as a model type
      prop.type = undefined;
    }
    if (!visited.has(model.name) && prop.typeName.name !== "dictionary") {
      prop.type = resolveModel(program, model, visited, rootNamespace, rootAlias);
    }
  }
  return prop;
};

export const resolveUnionProperty = (program: Program, property: ModelProperty, union: Union, visited: Set<string>, rootNamespace: string, rootAlias: string): PropertyNode => {
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
    prop.typeName = getModelType(models[0], rootNamespace, rootAlias);
    if (!visited.has(models[0].name)) {
      prop.type = resolveModel(program, models[0], visited, rootNamespace, rootAlias);
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
        prop.typeName = getModelType(arrayType, rootNamespace, rootAlias);
        // Use Named<T> for actual model props
        if (!visited.has(arrayType.name)) {
          prop.type = resolveModel(program, namedType, visited, rootNamespace, rootAlias);
        }
      } else {
        program.reportDiagnostic({
          code: "agentschema-emitter-unsupported-union-types",
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
        prop.typeName = getModelType(namedModel, rootNamespace, rootAlias);
        if (!visited.has(mainModel.name)) {
          prop.type = resolveModel(program, namedModel, visited, rootNamespace, rootAlias);
        }
      } else {
        program.reportDiagnostic({
          code: "agentschema-emitter-named-model-union-types",
          message: `Named model union types must match! (${models.map(m => m.name).join(", ")})`,
          severity: "error",
          target: property
        });
        return prop;
      }
    } else {
      program.reportDiagnostic({
        code: "agentschema-emitter-unsupported-union-types",
        message: `Unsupported union type: ${union.kind}`,
        severity: "error",
        target: property
      });
      return prop;
    }
  } else {
    // string variants for `kind` scalar type
    const acceptableVariants = variants.filter(v => v.kind === "String" || (v.kind === "Scalar" && v.name === "string")).length;
    if (acceptableVariants === variants.length) {
      prop.typeName = {
        "namespace": "",
        "name": "string"
      };
      prop.isScalar = true;
      if (property.defaultValue && property.defaultValue.valueKind === "StringValue") {
        prop.defaultValue = property.defaultValue?.value || null;
      }
      prop.allowedValues = variants.filter(v => v.kind === "String").map(v => v.value)
      const s = 1;
    } else {
      program.reportDiagnostic({
        code: "agentschema-emitter-unsupported-union-types",
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


// ============================================================================
// Render Context Interfaces
// ============================================================================
// These interfaces define the pure data structures passed to Nunjucks templates.
// Templates should receive only data (no functions) - all rendering logic
// should be implemented as Nunjucks macros.

/**
 * Context for rendering a single Python class.
 */
export interface PythonClassContext {
  /** The TypeNode being rendered */
  node: TypeNode;
  /** Type mapping from TypeSpec types to Python types */
  typeMapper: Record<string, string>;
  /** Processed alternate representations for shorthand constructors */
  alternates: Array<{ scalar: string; alternate: string }>;
  /** Polymorphic type information if this is a discriminated type */
  polymorphicTypes: ReturnType<TypeNode['retrievePolymorphicTypes']> | undefined;
  /** Import types needed from other modules */
  imports: string[];
  /** Collection properties with their nested type info for load_* methods */
  collectionTypes: Array<{ prop: PropertyNode; type: string[] }>;
  /** The property name that can be used as a shorthand scalar representation */
  shorthandProperty: string | null;
}

/**
 * Context for rendering a Python file containing one or more classes.
 */
export interface PythonFileContext {
  /** Whether any class in the file is abstract */
  containsAbstract: boolean;
  /** Python typing imports needed (e.g., "Any", "Callable", "Optional") */
  typings: string[];
  /** Import types needed from other modules */
  imports: string[];
  /** Array of class contexts to render */
  classes: PythonClassContext[];
  /** Type mapping from TypeSpec types to Python types */
  typeMapper: Record<string, string>;
}

/**
 * Context for rendering a Python __init__.py file.
 */
export interface PythonInitContext {
  /** Base types (types without a parent) for top-level imports */
  baseTypes: TypeNode[];
  /** All types for __all__ export list */
  types: TypeNode[];
}

/**
 * Context for rendering Python test files.
 */
export interface PythonTestContext {
  /** The TypeNode being tested */
  node: TypeNode;
  /** Flattened sample combinations for testing */
  examples: Array<{
    json: string[];
    yaml: string[];
    validation: Array<{ key: string; value: any; delimeter: string }>;
  }>;
  /** Alternate representation tests */
  alternates: Array<{
    title: string;
    scalar: string;
    value: string;
    validation: Array<{ key: string; value: any; delimeter: string }>;
  }>;
}

/**
 * Context for rendering the LoadContext file.
 */
export interface PythonLoadContextContext {
  /** File header comment */
  header: string;
  /** Package name for imports in test file */
  package?: string;
}

/**
 * Base render context interface - all language contexts should extend this.
 * This ensures consistency across emitters.
 */
export interface BaseRenderContext {
  /** The TypeNode being rendered */
  node: TypeNode;
  /** Type mapping from TypeSpec types to target language types */
  typeMapper: Record<string, string>;
}

// =============================================================================
// Standardized Test Context Interfaces
// =============================================================================

/**
 * Validation assertion for a single property in a test.
 */
export interface PropertyValidation {
  /** Property name in target language casing (PascalCase, snake_case, camelCase) */
  key: string;
  /** Expected value after loading */
  value: any;
  /** String delimiter for assertions (", """, etc.) */
  delimiter: string;
  /** Whether property is optional/pointer (for Go, C# nullable) */
  isOptional: boolean;
}

/**
 * A single test example generated from @sample decorators.
 */
export interface TestExample {
  /** JSON representation as lines */
  json: string[];
  /** YAML representation as lines */
  yaml: string[];
  /** Property assertions to validate after loading */
  validations: PropertyValidation[];
}

/**
 * A shorthand/alternate representation test case.
 */
export interface AlternateTest {
  /** Human-readable test name/title */
  title: string;
  /** Scalar type name in target language */
  scalarType: string;
  /** Example scalar value as string literal */
  value: string;
  /** Validations after expansion to full object */
  validations: PropertyValidation[];
}

/**
 * Base test context interface - all language test contexts should use this structure.
 * This ensures consistency in test generation across all emitters.
 */
export interface BaseTestContext {
  /** The TypeNode being tested */
  node: TypeNode;
  /** Whether this is an abstract/polymorphic base type (skip direct instantiation tests) */
  isAbstract: boolean;
  /** Package/namespace name for imports (optional - not used by all languages) */
  package?: string;
  /** Test examples from @sample decorators */
  examples: TestExample[];
  /** Shorthand alternate representation tests */
  alternates: AlternateTest[];
}
