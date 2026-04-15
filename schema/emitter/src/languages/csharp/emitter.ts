/**
 * C# code emitter — Declaration IR → C# source code.
 *
 * Replaces `file.cs.njk` Nunjucks template with a typed TypeScript function
 * that walks the TypeDecl tree and produces a complete C# class file.
 *
 * Each TypeDecl becomes one C# file (one class per file).
 * Polymorphic types use abstract class + child : Base inheritance.
 *
 * Structural blocks emitted (in order):
 *   1. Copyright + using directives
 *   2. Namespace
 *   3. XML doc comment
 *   4. Class declaration
 *   5. ShorthandProperty
 *   6. Constructor
 *   7. Properties
 *   8. #region Load Methods
 *   9. #region Save Methods
 *  10. #region Factory Methods (if any)
 *  11. #region Helpers (if any)
 */

import {
  TypeDecl,
  FieldDecl,
  LoadAssignment,
  SaveAssignment,
  CollectionHelperDecl,
  PolymorphicDispatchDecl,
  FactoryDecl,
  CoercionDecl,
  CoercionAssignment,
  PropertyCategory,
  MethodStubDecl,
} from "../../ir/declarations.js";
import { ExprVisitor, toPascalCase } from "../../ir/visitor.js";

// ============================================================================
// Type maps
// ============================================================================

const CSHARP_TYPE_MAP: Record<string, string> = {
  string: "string",
  number: "float",
  boolean: "bool",
  int32: "int",
  int64: "long",
  float32: "float",
  float64: "double",
  integer: "int",
  object: "object",
  unknown: "object",
  any: "object",
  dictionary: "IDictionary<string, object>",
  array: "IList<object>",
};

const CONVERT_MAP: Record<string, string> = {
  bool: "Boolean",
  int: "Int32",
  long: "Int64",
  float: "Single",
  double: "Double",
};

const NON_NULLABLE_VALUE_TYPES = new Set(["bool", "int", "long", "float", "double"]);

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Emit a complete C# class file for a single TypeDecl.
 */
export function emitCSharpClass(
  type: TypeDecl,
  namespace: string,
  visitor: ExprVisitor,
  allTypes: TypeDecl[],
  findType: (name: string) => TypeDecl | undefined,
): string {
  const lines: string[] = [];

  // Header
  emitHeader(lines, namespace);

  // Class doc comment
  emitXmlDocComment(type.description, "    ", lines);

  // Class declaration
  emitClassDeclaration(type, lines);

  // ShorthandProperty
  emitShorthandProperty(type, lines);

  // Constructor
  emitConstructor(type, lines);

  // Properties
  emitProperties(type, allTypes, findType, lines);

  // Load region
  emitLoadRegion(type, allTypes, findType, lines);

  // Save region
  emitSaveRegion(type, allTypes, findType, lines);

  // Factory methods
  if (type.factories.length > 0) {
    emitFactoryRegion(type, visitor, lines);
  }

  // Helper stubs
  if (type.methods.length > 0) {
    emitHelperRegion(type, lines);
  }

  // Close class
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// Header & namespace
// ============================================================================

function emitHeader(lines: string[], namespace: string): void {
  lines.push("// Copyright (c) Microsoft. All rights reserved.");
  lines.push("using System.Text.Json;");
  lines.push("using YamlDotNet.Serialization;");
  lines.push("");
  lines.push("#pragma warning disable IDE0130");
  lines.push(`namespace ${namespace};`);
  lines.push("#pragma warning restore IDE0130");
  lines.push("");
}

// ============================================================================
// XML doc comment
// ============================================================================

function emitXmlDocComment(description: string, indent: string, lines: string[]): void {
  lines.push(`${indent}/// <summary>`);
  // Split multi-line descriptions into separate /// lines
  const descLines = description.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  for (let i = 0; i < descLines.length; i++) {
    lines.push(`${indent}/// ${descLines[i]}`);
    // Add empty /// line between paragraphs (if multiple lines and not the last)
    if (descLines.length > 1 && i < descLines.length - 1) {
      lines.push(`${indent}/// `);
    }
  }
  lines.push(`${indent}/// </summary>`);
}

// ============================================================================
// Class declaration
// ============================================================================

function emitClassDeclaration(type: TypeDecl, lines: string[]): void {
  const abstract_ = type.isAbstract ? "abstract " : "";
  const base_ = type.base ? ` : ${type.base.name}` : "";
  lines.push(`public ${abstract_}partial class ${type.typeName.name}${base_}`);
  lines.push("{");
}

// ============================================================================
// ShorthandProperty
// ============================================================================

function emitShorthandProperty(type: TypeDecl, lines: string[]): void {
  const new_ = type.base ? "new " : "";
  const value = type.coercionProperty ? `"${type.coercionProperty}"` : "null";
  lines.push("    /// <summary>");
  lines.push("    /// The shorthand property name for this type, if any.");
  lines.push("    /// </summary>");
  lines.push(`    public ${new_}static string? ShorthandProperty => ${value};`);
  lines.push("");
}

// ============================================================================
// Constructor
// ============================================================================

function emitConstructor(type: TypeDecl, lines: string[]): void {
  const access = type.isAbstract ? "protected" : "public";
  lines.push("    /// <summary>");
  lines.push(`    /// Initializes a new instance of <see cref="${type.typeName.name}"/>.`);
  lines.push("    /// </summary>");
  lines.push("#pragma warning disable CS8618");
  lines.push(`    ${access} ${type.typeName.name}()`);
  lines.push("    {");
  lines.push("    }");
  lines.push("#pragma warning restore CS8618");
  lines.push("");
}

// ============================================================================
// Properties
// ============================================================================

function emitProperties(type: TypeDecl, allTypes: TypeDecl[], findType: (name: string) => TypeDecl | undefined, lines: string[]): void {
  for (const field of type.fields) {
    const modifier = getPropertyModifier(field, type, allTypes, findType);
    const csType = getCSharpType(field.category, field.isOptional);
    const propName = toPascalCase(field.name);
    const default_ = getPropertyDefault(field);

    emitXmlDocComment(field.description || propName, "    ", lines);
    lines.push(`    public ${modifier}${csType} ${propName} { get; set; }${default_}`);
    lines.push("");
  }
  lines.push("");
}

function getPropertyModifier(
  field: FieldDecl,
  type: TypeDecl,
  allTypes: TypeDecl[],
  findType: (name: string) => TypeDecl | undefined,
): string {
  // Check if any child type has a field with same name → virtual
  if (type.polymorphicDispatch || type.isAbstract) {
    const childHasSameField = allTypes.some(t =>
      t.base?.name === type.typeName.name &&
      t.fields.some(f => f.name === field.name)
    );
    if (childHasSameField) return "virtual ";
  }

  // Check if parent has same field → override
  if (type.base) {
    const parent = findType(type.base.name);
    if (parent?.fields.some(f => f.name === field.name)) {
      return "override ";
    }
  }

  return "";
}

function getCSharpType(category: PropertyCategory, isOptional: boolean): string {
  let baseType: string;
  switch (category.kind) {
    case "scalar":
      baseType = CSHARP_TYPE_MAP[category.scalarType] || "object";
      break;
    case "complex":
      baseType = category.typeName;
      break;
    case "collection_scalar": {
      const inner = CSHARP_TYPE_MAP[category.scalarType] || "object";
      baseType = `IList<${inner}>`;
      break;
    }
    case "collection_complex":
      baseType = `IList<${category.typeName}>`;
      break;
    case "dict":
      baseType = "IDictionary<string, object>";
      break;
  }
  return isOptional ? `${baseType}?` : baseType;
}

function getPropertyDefault(field: FieldDecl): string {
  if (field.isOptional) return "";

  const cat = field.category;
  switch (cat.kind) {
    case "collection_scalar":
    case "collection_complex":
      return " = [];";
    case "dict":
      return " = new Dictionary<string, object>();";
    case "scalar": {
      const csType = CSHARP_TYPE_MAP[cat.scalarType] || "object";
      if (csType === "string") {
        if (field.defaultValue && field.defaultValue !== "*") {
          return ` = "${field.defaultValue}";`;
        }
        return " = string.Empty;";
      }
      if (csType === "bool") {
        return field.defaultValue != null ? ` = ${field.defaultValue};` : " = false;";
      }
      if (csType === "object") {
        return " = new object();";
      }
      // number types: only emit default if there is one
      if (field.defaultValue != null) {
        return ` = ${field.defaultValue};`;
      }
      return "";
    }
    case "complex":
      return "";
  }
}

// ============================================================================
// Load region
// ============================================================================

function emitLoadRegion(
  type: TypeDecl,
  allTypes: TypeDecl[],
  findType: (name: string) => TypeDecl | undefined,
  lines: string[],
): void {
  lines.push("");
  lines.push("    #region Load Methods");
  lines.push("");

  // Main Load method
  emitLoadMethod(type, allTypes, findType, lines);

  // Collection load helpers
  for (const helper of type.collectionHelpers) {
    emitCollectionLoadHelper(helper, findType, lines);
  }

  // Polymorphic dispatch (LoadKind)
  if (type.polymorphicDispatch) {
    emitLoadKind(type, lines);
  }

  lines.push("");
  lines.push("    #endregion");
  lines.push("");
}

function emitLoadMethod(
  type: TypeDecl,
  allTypes: TypeDecl[],
  findType: (name: string) => TypeDecl | undefined,
  lines: string[],
): void {
  const typeName = type.typeName.name;
  const new_ = type.base ? "new " : "";
  const hasCoercions = type.load.coercions.length > 0 || type.coercionProperty;

  lines.push("    /// <summary>");
  lines.push(`    /// Load a ${typeName} instance from a dictionary.`);
  lines.push("    /// </summary>");
  lines.push('    /// <param name="data">The dictionary containing the data.</param>');
  lines.push('    /// <param name="context">Optional context with pre/post processing callbacks.</param>');
  lines.push(`    /// <returns>The loaded ${typeName} instance.</returns>`);
  lines.push(`    public ${new_}static ${typeName} Load(Dictionary<string, object?> data, LoadContext? context = null)`);
  lines.push("    {");

  // ProcessInput
  lines.push("        if (context is not null)");
  lines.push("        {");
  lines.push("            data = context.ProcessInput(data);");
  lines.push("        }");
  lines.push("");

  // Note about alternate representations
  if (hasCoercions) {
    lines.push("        // Note: Alternate (shorthand) representations are handled by the converter");
  }

  lines.push("");

  // Instance creation: polymorphic dispatch or direct
  if (type.polymorphicDispatch) {
    lines.push(`        // Load polymorphic ${typeName} instance`);
    lines.push("        var instance = LoadKind(data, context);");
  } else {
    lines.push("        // Create new instance");
    lines.push(`        var instance = new ${typeName}();`);
  }

  lines.push("");
  lines.push("");

  // Per-field assignments
  for (const assign of type.load.assignments) {
    emitLoadAssignment(assign, findType, lines);
  }

  // ProcessOutput
  lines.push("        if (context is not null)");
  lines.push("        {");
  lines.push(`            instance = context.ProcessOutput(instance);`);
  lines.push("        }");
  lines.push("        return instance;");
  lines.push("    }");
  lines.push("");
}

function emitLoadAssignment(
  assign: LoadAssignment,
  findType: (name: string) => TypeDecl | undefined,
  lines: string[],
): void {
  const propName = toPascalCase(assign.fieldName);
  const varName = `${assign.sourceName}Value`;

  lines.push(`        if (data.TryGetValue("${assign.sourceName}", out var ${varName}) && ${varName} is not null)`);
  lines.push("        {");
  lines.push(`            ${getLoadExpression(assign, propName, varName, findType)}`);
  lines.push("        }");
  lines.push("");
}

function getLoadExpression(
  assign: LoadAssignment,
  propName: string,
  varName: string,
  findType: (name: string) => TypeDecl | undefined,
): string {
  const cat = assign.category;
  switch (cat.kind) {
    case "scalar": {
      const csType = CSHARP_TYPE_MAP[cat.scalarType] || "object";
      if (csType === "string") {
        return `instance.${propName} = ${varName}?.ToString()!;`;
      }
      if (NON_NULLABLE_VALUE_TYPES.has(csType)) {
        const convertMethod = CONVERT_MAP[csType];
        return `instance.${propName} = Convert.To${convertMethod}(${varName});`;
      }
      // object/unknown
      return `instance.${propName} = ${varName};`;
    }
    case "dict":
      return `instance.${propName} = ${varName}.GetDictionary()!;`;
    case "complex":
      return `instance.${propName} = ${cat.typeName}.Load(${varName}.GetDictionary(${cat.typeName}.ShorthandProperty), context);`;
    case "collection_complex":
      return `instance.${propName} = Load${propName}(${varName}, context);`;
    case "collection_scalar": {
      const csType = CSHARP_TYPE_MAP[cat.scalarType] || "object";
      if (csType === "string") {
        return `instance.${propName} = (${varName} as IEnumerable<object>)?.Select(x => x?.ToString()!).ToList() ?? [];`;
      }
      if (NON_NULLABLE_VALUE_TYPES.has(csType)) {
        const convertMethod = CONVERT_MAP[csType];
        return `instance.${propName} = (${varName} as IEnumerable<object>)?.Select(x => Convert.To${convertMethod}(x)).ToList() ?? [];`;
      }
      return `instance.${propName} = (${varName} as IEnumerable<object>)?.ToList() ?? [];`;
    }
  }
}

// ============================================================================
// Collection Load Helper
// ============================================================================

function emitCollectionLoadHelper(
  helper: CollectionHelperDecl,
  findType: (name: string) => TypeDecl | undefined,
  lines: string[],
): void {
  const propName = toPascalCase(helper.propertyName);
  const elemType = helper.elementTypeName.name;

  // Determine primary property for scalar shorthand in dict format
  const elemTypeDecl = findType(elemType);
  let primaryProp: string | null = null;
  if (elemTypeDecl?.coercionProperty) {
    primaryProp = elemTypeDecl.coercionProperty;
  } else if (helper.innerFields.length > 0) {
    primaryProp = helper.innerFields[0];
  }

  lines.push("");
  lines.push("    /// <summary>");
  lines.push(`    /// Load a list of ${elemType} from a dictionary or list.`);
  lines.push("    /// </summary>");
  lines.push(`    public static IList<${elemType}> Load${propName}(object data, LoadContext? context)`);
  lines.push("    {");
  lines.push(`        var result = new List<${elemType}>();`);
  lines.push("");
  lines.push("        if (data is Dictionary<string, object?> dict)");
  lines.push("        {");
  lines.push("            // Convert named dictionary to list");
  lines.push("            foreach (var kvp in dict)");
  lines.push("            {");
  lines.push("                if (kvp.Value is IEnumerable<object>)");
  lines.push("                {");
  lines.push("                    throw new ArgumentException(");
  lines.push(`                        $"Invalid '${helper.propertyName}' format: key '{kvp.Key}' has an array value. " +`);
  lines.push(`                        $"'${helper.propertyName}' must be a flat list of objects or a name-keyed dict — " +`);
  lines.push(`                        "not a nested {" + kvp.Key + ": [...]} structure.");`);
  lines.push("                }");
  lines.push("                var itemDict = kvp.Value.GetDictionary();");
  lines.push("                if (itemDict.Count > 0)");
  lines.push("                {");
  lines.push("                    // Value is an object, add name to it");
  lines.push('                    itemDict["name"] = kvp.Key;');
  lines.push(`                    result.Add(${elemType}.Load(itemDict, context));`);
  lines.push("                }");
  lines.push("                else");
  lines.push("                {");
  lines.push("                    // Value is a scalar, use it as the primary property");
  lines.push("                    var newDict = new Dictionary<string, object?>");
  lines.push("                    {");
  lines.push('                        ["name"] = kvp.Key,');
  lines.push(`                        ["${primaryProp || ""}"] = kvp.Value`);
  lines.push("                    };");
  lines.push(`                    result.Add(${elemType}.Load(newDict, context));`);
  lines.push("                }");
  lines.push("            }");
  lines.push("        }");
  lines.push("        else if (data is IEnumerable<object> list)");
  lines.push("        {");
  lines.push("            foreach (var item in list)");
  lines.push("            {");
  lines.push(`                var itemDict = item.GetDictionary(${elemType}.ShorthandProperty);`);
  lines.push("                if (itemDict.Count > 0)");
  lines.push("                {");
  lines.push(`                    result.Add(${elemType}.Load(itemDict, context));`);
  lines.push("                }");
  lines.push("            }");
  lines.push("        }");
  lines.push("");
  lines.push("        return result;");
  lines.push("    }");
  lines.push("");
}

// ============================================================================
// LoadKind (polymorphic dispatch)
// ============================================================================

function emitLoadKind(type: TypeDecl, lines: string[]): void {
  const dispatch = type.polymorphicDispatch!;
  const typeName = type.typeName.name;

  lines.push("");
  lines.push("    /// <summary>");
  lines.push(`    /// Load polymorphic ${typeName} based on discriminator.`);
  lines.push("    /// </summary>");
  lines.push(`    private static ${typeName} LoadKind(Dictionary<string, object?> data, LoadContext? context)`);
  lines.push("    {");
  lines.push(`        if (data.TryGetValue("${dispatch.discriminatorField}", out var discriminatorValue) && discriminatorValue is not null)`);
  lines.push("        {");
  lines.push("            var discriminator = discriminatorValue.ToString()?.ToLowerInvariant();");
  lines.push("            return discriminator switch");
  lines.push("            {");

  for (const variant of dispatch.variants) {
    lines.push(`                "${variant.value}" => ${variant.typeName.name}.Load(data, context),`);
  }

  // Default handling
  if (dispatch.defaultVariant) {
    if (dispatch.defaultVariant.isSelfReference) {
      lines.push(`                _ => new ${typeName}(),`);
    } else {
      lines.push(`                _ => ${dispatch.defaultVariant.typeName.name}.Load(data, context),`);
    }
  } else if (dispatch.isAbstract) {
    lines.push(`                _ => throw new ArgumentException($"Unknown ${typeName} discriminator value: {discriminator}"),`);
  } else {
    lines.push(`                _ => new ${typeName}(),`);
  }

  lines.push("            };");
  lines.push("        }");
  lines.push("");

  // Fallback when discriminator property is missing
  if (dispatch.isAbstract && !dispatch.defaultVariant) {
    lines.push(`        throw new ArgumentException("Missing ${typeName} discriminator property: '${dispatch.discriminatorField}'");`);
  } else if (dispatch.defaultVariant && !dispatch.defaultVariant.isSelfReference) {
    lines.push(`        throw new ArgumentException("Missing ${typeName} discriminator property: '${dispatch.discriminatorField}'");`);
  } else {
    lines.push(`        return new ${typeName}();`);
  }

  lines.push("");
  lines.push("    }");
  lines.push("");
}

// ============================================================================
// Save region
// ============================================================================

function emitSaveRegion(
  type: TypeDecl,
  allTypes: TypeDecl[],
  findType: (name: string) => TypeDecl | undefined,
  lines: string[],
): void {
  lines.push("    #region Save Methods");
  lines.push("");

  // Main Save method
  emitSaveMethod(type, allTypes, lines);

  // Collection save helpers
  for (const helper of type.collectionHelpers) {
    emitCollectionSaveHelper(helper, lines);
  }

  // ToYaml, ToJson, FromJson, FromYaml
  emitSerializationMethods(type, lines);

  lines.push("    #endregion");
}

function emitSaveMethod(type: TypeDecl, allTypes: TypeDecl[], lines: string[]): void {
  const typeName = type.typeName.name;
  const hasBase = type.save.hasBase;
  const hasChildren = type.polymorphicDispatch !== null || type.isAbstract;
  // virtual if has children, override if has base
  let modifier = "";
  if (hasBase) {
    modifier = "override ";
  } else if (hasChildren) {
    modifier = "virtual ";
  }

  lines.push("    /// <summary>");
  lines.push(`    /// Save the ${typeName} instance to a dictionary.`);
  lines.push("    /// </summary>");
  lines.push('    /// <param name="context">Optional context with pre/post processing callbacks.</param>');
  lines.push("    /// <returns>The dictionary representation of this instance.</returns>");
  lines.push(`    public ${modifier}Dictionary<string, object?> Save(SaveContext? context = null)`);
  lines.push("    {");
  lines.push("        var obj = this;");
  lines.push("        if (context is not null)");
  lines.push("        {");
  lines.push("            obj = context.ProcessObject(obj);");
  lines.push("        }");
  lines.push("");
  lines.push("");

  if (hasBase) {
    lines.push("        // Start with parent class properties");
    lines.push("        var result = base.Save(context);");
  } else {
    lines.push("        var result = new Dictionary<string, object?>();");
  }

  lines.push("");

  // Per-field saves
  for (const assign of type.save.assignments) {
    emitSaveAssignment(assign, lines);
  }

  // ProcessDict only if no base
  if (!hasBase) {
    lines.push("");
    lines.push("        if (context is not null)");
    lines.push("        {");
    lines.push("            result = context.ProcessDict(result);");
    lines.push("        }");
  }

  lines.push("");
  lines.push("        return result;");
  lines.push("    }");
  lines.push("");
}

function emitSaveAssignment(assign: SaveAssignment, lines: string[]): void {
  const propName = toPascalCase(assign.fieldName);
  const cat = assign.category;

  lines.push("");

  if (assign.isOptional) {
    lines.push(`        if (obj.${propName} is not null)`);
    lines.push("        {");
    lines.push(`            ${getSaveExpression(assign, propName)}`);
    lines.push("        }");
  } else {
    lines.push(`        ${getSaveExpression(assign, propName)}`);
  }

  lines.push("");
}

function getSaveExpression(assign: SaveAssignment, propName: string): string {
  const cat = assign.category;
  switch (cat.kind) {
    case "scalar":
    case "dict":
      return `result["${assign.targetName}"] = obj.${propName};`;
    case "complex":
      return `result["${assign.targetName}"] = obj.${propName}?.Save(context);`;
    case "collection_complex":
      return `result["${assign.targetName}"] = Save${propName}(obj.${propName}, context);`;
    case "collection_scalar":
      return `result["${assign.targetName}"] = obj.${propName};`;
  }
}

// ============================================================================
// Collection Save Helper
// ============================================================================

function emitCollectionSaveHelper(helper: CollectionHelperDecl, lines: string[]): void {
  const propName = toPascalCase(helper.propertyName);
  const elemType = helper.elementTypeName.name;

  lines.push("");
  lines.push("    /// <summary>");
  lines.push(`    /// Save a list of ${elemType} to object or array format.`);
  lines.push("    /// </summary>");
  lines.push(`    public static object Save${propName}(IList<${elemType}> items, SaveContext? context)`);
  lines.push("    {");
  lines.push("        context ??= new SaveContext();");
  lines.push("");

  if (helper.hasNameProperty) {
    lines.push("");
    lines.push('        if (context.CollectionFormat == "array")');
    lines.push("        {");
    lines.push("            return items.Select(item => item.Save(context)).ToList();");
    lines.push("        }");
    lines.push("");
    lines.push("        // Object format: use name as key");
    lines.push("        var result = new Dictionary<string, object?>();");
    lines.push("        foreach (var item in items)");
    lines.push("        {");
    lines.push("            var itemData = item.Save(context);");
    lines.push('            if (itemData.TryGetValue("name", out var nameValue) && nameValue is string name)');
    lines.push("            {");
    lines.push('                itemData.Remove("name");');
    lines.push("");
    lines.push("                // Check if we can use shorthand");
    lines.push(`                if (context.UseShorthand && ${elemType}.ShorthandProperty is string shorthandProp)`);
    lines.push("                {");
    lines.push("                    if (itemData.Count == 1 && itemData.ContainsKey(shorthandProp))");
    lines.push("                    {");
    lines.push("                        result[name] = itemData[shorthandProp];");
    lines.push("                        continue;");
    lines.push("                    }");
    lines.push("                }");
    lines.push("                result[name] = itemData;");
    lines.push("            }");
    lines.push("            else");
    lines.push("            {");
    lines.push('                // No name, can\'t use object format for this item');
    lines.push('                throw new InvalidOperationException("Cannot save item in object format: missing \'name\' property");');
    lines.push("            }");
    lines.push("        }");
    lines.push("        return result;");
  } else {
    lines.push("        // This collection type does not have a 'name' property, only array format is supported");
    lines.push("        return items.Select(item => item.Save(context)).ToList();");
  }

  lines.push("");
  lines.push("    }");
  lines.push("");
}

// ============================================================================
// Serialization methods (ToYaml, ToJson, FromJson, FromYaml)
// ============================================================================

function emitSerializationMethods(type: TypeDecl, lines: string[]): void {
  const typeName = type.typeName.name;
  const new_ = type.base ? "new " : "";

  // ToYaml
  lines.push("");
  lines.push("    /// <summary>");
  lines.push(`    /// Convert the ${typeName} instance to a YAML string.`);
  lines.push("    /// </summary>");
  lines.push('    /// <param name="context">Optional context with pre/post processing callbacks.</param>');
  lines.push("    /// <returns>The YAML string representation of this instance.</returns>");
  lines.push(`    public ${new_}string ToYaml(SaveContext? context = null)`);
  lines.push("    {");
  lines.push("        context ??= new SaveContext();");
  lines.push("        return context.ToYaml(Save(context));");
  lines.push("    }");
  lines.push("");

  // ToJson
  lines.push("    /// <summary>");
  lines.push(`    /// Convert the ${typeName} instance to a JSON string.`);
  lines.push("    /// </summary>");
  lines.push('    /// <param name="context">Optional context with pre/post processing callbacks.</param>');
  lines.push('    /// <param name="indent">Whether to indent the output. Defaults to true.</param>');
  lines.push("    /// <returns>The JSON string representation of this instance.</returns>");
  lines.push(`    public ${new_}string ToJson(SaveContext? context = null, bool indent = true)`);
  lines.push("    {");
  lines.push("        context ??= new SaveContext();");
  lines.push("        return context.ToJson(Save(context), indent);");
  lines.push("    }");
  lines.push("");

  // FromJson
  emitFromJson(type, lines);
  lines.push("");

  // FromYaml
  emitFromYaml(type, lines);
  lines.push("");
}

// ============================================================================
// FromJson
// ============================================================================

function emitFromJson(type: TypeDecl, lines: string[]): void {
  const typeName = type.typeName.name;
  const new_ = type.base ? "new " : "";
  const hasCoercions = type.load.coercions.length > 0;
  const hasCoercionProp = type.coercionProperty !== null;

  lines.push("    /// <summary>");
  lines.push(`    /// Load a ${typeName} instance from a JSON string.`);
  lines.push("    /// </summary>");
  lines.push('    /// <param name="json">The JSON string to parse.</param>');
  lines.push('    /// <param name="context">Optional context with pre/post processing callbacks.</param>');
  lines.push(`    /// <returns>The loaded ${typeName} instance.</returns>`);
  lines.push(`    public ${new_}static ${typeName} FromJson(string json, LoadContext? context = null)`);
  lines.push("    {");
  lines.push("        using var doc = JsonDocument.Parse(json);");
  lines.push("        Dictionary<string, object?> dict;");

  if (hasCoercions || hasCoercionProp) {
    lines.push("        // Handle alternate representations");
    lines.push("        if (doc.RootElement.ValueKind != JsonValueKind.Object)");
    lines.push("        {");
    lines.push("            var value = JsonUtils.GetJsonElementValue(doc.RootElement);");

    if (hasCoercions) {
      lines.push("            dict = value switch");
      lines.push("            {");
      emitCoercionSwitchArms(type.load.coercions, type.coercionProperty, "                ", "value", lines);
      lines.push("            };");
    } else {
      // Only coercionProperty, no typed coercions
      lines.push(`            dict = new Dictionary<string, object?>`);
      lines.push("            {");
      lines.push(`                ["${type.coercionProperty}"] = value`);
      lines.push("            };");
    }

    lines.push("        }");
    lines.push("        else");
    lines.push("        {");
    lines.push("            dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)");
    lines.push('                ?? throw new ArgumentException("Failed to parse JSON as dictionary");');
    lines.push("        }");
  } else {
    lines.push("        dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, JsonUtils.Options)");
    lines.push('            ?? throw new ArgumentException("Failed to parse JSON as dictionary");');
  }

  lines.push("");
  lines.push("        return Load(dict, context);");
  lines.push("    }");
}

// ============================================================================
// FromYaml
// ============================================================================

function emitFromYaml(type: TypeDecl, lines: string[]): void {
  const typeName = type.typeName.name;
  const new_ = type.base ? "new " : "";
  const hasCoercions = type.load.coercions.length > 0;
  const hasCoercionProp = type.coercionProperty !== null;

  lines.push("    /// <summary>");
  lines.push(`    /// Load a ${typeName} instance from a YAML string.`);
  lines.push("    /// </summary>");
  lines.push('    /// <param name="yaml">The YAML string to parse.</param>');
  lines.push('    /// <param name="context">Optional context with pre/post processing callbacks.</param>');
  lines.push(`    /// <returns>The loaded ${typeName} instance.</returns>`);
  lines.push(`    public ${new_}static ${typeName} FromYaml(string yaml, LoadContext? context = null)`);
  lines.push("    {");

  if (hasCoercions || hasCoercionProp) {
    lines.push("        // Handle alternate representations - try object first, fall back to scalar");
    lines.push("        Dictionary<string, object?>? dictResult = null;");
    lines.push("        try");
    lines.push("        {");
    lines.push("            dictResult = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml);");
    lines.push("        }");
    lines.push("        catch (YamlDotNet.Core.YamlException)");
    lines.push("        {");
    lines.push("            // Not a dictionary, will be handled as scalar below");
    lines.push("        }");
    lines.push("");
    lines.push("        Dictionary<string, object?> dict;");
    lines.push("        if (dictResult is not null)");
    lines.push("        {");
    lines.push("            dict = dictResult;");
    lines.push("        }");
    lines.push("        else");
    lines.push("        {");
    lines.push("            // Parse as scalar with proper type inference");
    lines.push("            var parsed = YamlUtils.ParseScalar(yaml);");

    if (hasCoercions) {
      lines.push("            dict = parsed switch");
      lines.push("            {");
      emitCoercionSwitchArms(type.load.coercions, type.coercionProperty, "                ", "parsed", lines);
      lines.push("            };");
    } else {
      lines.push(`            dict = new Dictionary<string, object?>`);
      lines.push("            {");
      lines.push(`                ["${type.coercionProperty}"] = parsed`);
      lines.push("            };");
    }

    lines.push("        }");
  } else {
    lines.push("        var dict = YamlUtils.Deserializer.Deserialize<Dictionary<string, object?>>(yaml)");
    lines.push('            ?? throw new ArgumentException("Failed to parse YAML as dictionary");');
  }

  lines.push("");
  lines.push("        return Load(dict, context);");
  lines.push("    }");
}

// ============================================================================
// Coercion switch arms (shared between FromJson and FromYaml)
// ============================================================================

function emitCoercionSwitchArms(
  coercions: CoercionDecl[],
  coercionProperty: string | null,
  indent: string,
  switchVarName: string,
  lines: string[],
): void {
  // Track emitted types to avoid duplicates
  const emittedTypes = new Set<string>();

  for (const coercion of coercions) {
    const csharpType = CSHARP_TYPE_MAP[coercion.scalarType] || "object";
    const varName = `${csharpType}Value`;

    if (emittedTypes.has(csharpType)) continue;
    emittedTypes.add(csharpType);

    // Emit the main type arm
    lines.push(`${indent}${csharpType} ${varName} => new Dictionary<string, object?>`);
    lines.push(`${indent}{`);
    for (const assign of coercion.assignments) {
      if (assign.isInput) {
        lines.push(`${indent}    ["${assign.fieldName}"] = ${varName},`);
      } else {
        lines.push(`${indent}    ["${assign.fieldName}"] = "${assign.literalValue}",`);
      }
    }
    lines.push(`${indent}},`);

    // Numeric widening: int → long, float → double
    if (csharpType === "int" && !emittedTypes.has("long")) {
      emittedTypes.add("long");
      lines.push(`${indent}long longValue => new Dictionary<string, object?>`);
      lines.push(`${indent}{`);
      for (const assign of coercion.assignments) {
        if (assign.isInput) {
          lines.push(`${indent}    ["${assign.fieldName}"] = longValue,`);
        } else {
          lines.push(`${indent}    ["${assign.fieldName}"] = "${assign.literalValue}",`);
        }
      }
      lines.push(`${indent}},`);
    }

    if (csharpType === "float" && !emittedTypes.has("double")) {
      emittedTypes.add("double");
      lines.push(`${indent}double doubleValue => new Dictionary<string, object?>`);
      lines.push(`${indent}{`);
      for (const assign of coercion.assignments) {
        if (assign.isInput) {
          lines.push(`${indent}    ["${assign.fieldName}"] = doubleValue,`);
        } else {
          lines.push(`${indent}    ["${assign.fieldName}"] = "${assign.literalValue}",`);
        }
      }
      lines.push(`${indent}},`);
    }
  }

  // Default arm
  if (coercionProperty) {
    lines.push(`${indent}_ => new Dictionary<string, object?>`);
    lines.push(`${indent}{`);
    lines.push(`${indent}    ["${coercionProperty}"] = ${switchVarName}`);
    lines.push(`${indent}}`);
  } else {
    lines.push(`${indent}_ => throw new ArgumentException($"Unsupported scalar type")`);
  }
}

// ============================================================================
// Factory methods
// ============================================================================

function emitFactoryRegion(type: TypeDecl, visitor: ExprVisitor, lines: string[]): void {
  lines.push("");
  lines.push("    #region Factory Methods");

  for (const factory of type.factories) {
    emitFactoryMethod(factory, type, visitor, lines);
  }

  lines.push("");
  lines.push("    #endregion");
}

function emitFactoryMethod(factory: FactoryDecl, type: TypeDecl, visitor: ExprVisitor, lines: string[]): void {
  const methodName = getCSharpFactoryMethodName(factory.name, type);
  const params = Object.entries(factory.params).map(([name, typeStr]) =>
    `${getCSharpFactoryParamType(typeStr)} ${name}`
  ).join(", ");
  const body = visitor.visitExpr(factory.body);

  lines.push("");
  lines.push("    /// <summary>");
  lines.push(`    /// Create a ${type.typeName.name} with preset field values.`);
  lines.push("    /// </summary>");
  lines.push(`    public static ${type.typeName.name} ${methodName}(${params})`);
  lines.push("    {");
  lines.push(`        return ${body};`);
  lines.push("    }");
}

function getCSharpFactoryMethodName(factoryName: string, type: TypeDecl): string {
  const methodName = factoryName.charAt(0).toUpperCase() + factoryName.slice(1);
  const propertyNames = type.fields.map(f => toPascalCase(f.name));
  if (propertyNames.includes(methodName)) {
    return `Create${methodName}`;
  }
  return methodName;
}

function getCSharpFactoryParamType(typeStr: string): string {
  switch (typeStr) {
    case "string": return "string";
    case "boolean": return "bool";
    case "integer": case "int32": return "int";
    case "int64": return "long";
    case "float": case "float32": return "float";
    case "float64": return "double";
    case "unknown": return "object?";
    default: return "object?";
  }
}

// ============================================================================
// Helper stubs
// ============================================================================

function emitHelperRegion(type: TypeDecl, lines: string[]): void {
  lines.push("");
  lines.push("    #region Helpers — implement these in a partial class extension");
  lines.push("");
  lines.push("    // The following helpers should be implemented in a separate partial class file:");
  for (const method of type.methods) {
    lines.push(`    // - ${method.name}(): ${method.returns} — ${method.description}`);
  }
  lines.push("");
  lines.push("    #endregion");
}
