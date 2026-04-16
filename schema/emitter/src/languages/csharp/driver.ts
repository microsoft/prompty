import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { EmitTarget, PromptyEmitterOptions } from "../../lib.js";
import { enumerateTypes, TypeNode } from "../../ir/ast.js";
import { GeneratorOptions, filterNodes } from "../../emitter.js";
import { getCombinations, scalarValue } from "../../ir/utilities.js";
import * as YAML from "yaml";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { TypeRegistry } from "../../ir/expansion.js";
import { CSharpExprVisitor } from "./visitor.js";
import { lowerType, collectPolymorphicTypeNames } from "../../ir/lower.js";
import { emitCSharpClass } from "./emitter.js";
import { FactoryEntry } from "../../decorators.js";

export const generateCsharp = async (context: EmitContext<PromptyEmitterOptions>, _templateDir: string, node: TypeNode, emitTarget: EmitTarget, options?: GeneratorOptions) => {
  const allTypes = Array.from(enumerateTypes(node));
  const nodes = filterNodes(allTypes, options);

  // Build the expression IR infrastructure
  const registry = TypeRegistry.fromTypeGraph(allTypes);
  const visitor = new CSharpExprVisitor(registry);

  // Determine namespace: use explicit override from config, or fall back to TypeSpec namespace
  const originalNamespace = node.typeName.namespace;
  const csharpNamespace = emitTarget.namespace ?? originalNamespace;

  // Emit context classes (LoadContext, SaveContext)
  const contextCode = emitCSharpContext(csharpNamespace);
  await emitCsharpFile(context, node, contextCode, "Context.cs", emitTarget["output-dir"]);

  const utils = emitCSharpUtils(csharpNamespace);

  await emitCsharpFile(context, node, utils, "Utils.cs", emitTarget["output-dir"]);

  // Build Declaration IR once (loop-invariant)
  const polyNames = collectPolymorphicTypeNames(allTypes[0], registry);
  const allTypeDecls = nodes.map(nd => lowerType(nd, registry, polyNames));
  const findTypeDecl = (name: string) => allTypeDecls.find(t => t.typeName.name === name);

  for (const n of nodes) {
    const typeDecl = lowerType(n, registry, polyNames);
    const classCode = emitCSharpClass(typeDecl, csharpNamespace, visitor, allTypeDecls, findTypeDecl);
    await emitCsharpFile(context, n, classCode, `${n.typeName.name}.cs`, emitTarget["output-dir"]);
    if (emitTarget["test-dir"]) {
      await emitCsharpFile(context, n, renderTests(n, csharpNamespace), `${n.typeName.name}ConversionTests.cs`, emitTarget["test-dir"]);
    }
  }

  // Format emitted files if format option is enabled (default: true)
  if (emitTarget.format !== false) {
    const outputDir = emitTarget["output-dir"]
      ? resolve(process.cwd(), emitTarget["output-dir"])
      : context.emitterOutputDir;
    const testDir = emitTarget["test-dir"]
      ? resolve(process.cwd(), emitTarget["test-dir"])
      : undefined;

    formatCSharpFiles(outputDir, testDir);
  }
};


// --- Test-rendering helpers ---

const renderTests = (node: TypeNode, namespace: string): string => {
  const samples = node.properties.filter(p => p.samples && p.samples.length > 0).map(p => {
    return p.samples?.map(s => ({
      ...s.sample,
    }));
  });

  const combinations =
    samples.length > 0 ?
      getCombinations(samples) :
      [];

  const examples = combinations.map(c => {
    const sample = Object.assign({}, ...c);
    // Create YAML document and customize string scalar style for values with special chars
    const doc = new YAML.Document(sample);
    YAML.visit(doc, {
      Scalar(key, node) {
        // Only quote string values that contain special characters requiring escaping
        if (typeof node.value === 'string') {
          const str = node.value as string;
          if (str.includes('\n') || str.includes('\t') || str.includes('#') || str.includes(':') || str.includes('"')) {
            node.type = 'QUOTE_DOUBLE';
          }
        }
      }
    });
    return {
      json: JSON.stringify(sample, null, 2).split('\n'),
      yaml: doc.toString({ indent: 2, lineWidth: 0 }).split('\n'),
      // get all scalars in the sample - using 'validations' (plural) for consistency across languages
      validations: Object.keys(sample).filter(key => typeof sample[key] !== 'object').map(key => {
        const val = sample[key];
        const needsVerbatim = typeof val === 'string' && (val.includes('\n') || val.includes('"'));
        return {
          key: renderName(key),
          value: typeof val === 'boolean' ? (val ? "True" : "False") :
            (needsVerbatim ? (val as string).replace(/"/g, '""') : val),
          startDelim: typeof val === 'string' ? (needsVerbatim ? '@"' : '"') : '',
          endDelim: typeof val === 'string' ? '"' :
            typeof val === 'number' && !Number.isInteger(val) ? 'f' : '',
        };
      }),
    };
  });

  const coercions = node.coercions.map(alt => {
    const example = alt.example ? (typeof (alt.example) === "string" ? '"' + alt.example + '"' : alt.example.toString()) : scalarValue[alt.scalar] || "None";
    return {
      title: alt.title || alt.scalar,
      scalar: alt.scalar,
      value: example,
      // using 'validations' (plural) for consistency across languages
      validations: Object.keys(alt.expansion).filter(key => typeof alt.expansion[key] !== 'object').map(key => {
        const value = alt.expansion[key] === "{value}" ? example : alt.expansion[key];
        return {
          key: renderName(key),
          value: value,
          delimiter: typeof value === 'string' && !value.includes('"') && alt.expansion[key] !== "{value}" ? '"' : '',
        };
      }),
    };
  });

  return emitCSharpTest({
    node,
    namespace,
    examples,
    coercions,
    factories: node.factories,
    renderName,
    renderCsharpFactoryMethodName: (factoryName: string) => renderCsharpFactoryMethodName(factoryName, node),
    renderCsharpFactoryTestValue,
  });
};

const renderName = (name: string): string => {
  // convert snake_case to PascalCase
  const pascal = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  // capitalize the first letter
  return pascal.charAt(0).toUpperCase() + pascal.slice(1);
};

const renderCsharpFactoryParamType = (typeStr: string): string => {
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
};

// Returns a factory method name that won't clash with C# property names on the same type.
// If the capitalized factory name matches a property name, prefix with "Create".
const renderCsharpFactoryMethodName = (factoryName: string, node: TypeNode): string => {
  const methodName = factoryName.charAt(0).toUpperCase() + factoryName.slice(1);
  const propertyNames = node.properties.map(p => renderName(p.name));
  if (propertyNames.includes(methodName)) {
    return `Create${methodName}`;
  }
  return methodName;
};

const renderCsharpFactoryTestValue = (typeStr: string): string => {
  switch (typeStr) {
    case "string": return '"test"';
    case "boolean": return "true";
    case "integer": case "int32": return "42";
    case "int64": return "42L";
    case "float": case "float32": return "3.14f";
    case "float64": return "3.14";
    case "unknown": return '"test"';
    default: return '"test"';
  }
};

// --- Inline C# emitters (replace Nunjucks templates) ---

interface CSharpTestContext {
  node: TypeNode;
  namespace: string;
  examples: Array<{
    json: string[];
    yaml: string[];
    validations: Array<{ key: string; value: any; startDelim: string; endDelim: string }>;
  }>;
  coercions: Array<{
    title: string;
    scalar: string;
    value: string | number;
    validations: Array<{ key: string; value: any; delimiter: string }>;
  }>;
  factories: FactoryEntry[];
  renderName: (name: string) => string;
  renderCsharpFactoryMethodName: (factoryName: string) => string;
  renderCsharpFactoryTestValue: (typeStr: string) => string;
}

/** Render Assert.Equal / Assert.True / Assert.False lines for example validations. */
const emitExampleAssertions = (
  validations: Array<{ key: string; value: any; startDelim: string; endDelim: string }>,
  varName: string,
): string => {
  return validations.map(v => {
    if (v.value === "True" || v.value === "False") {
      return `        Assert.${v.value === "False" ? "False" : "True"}(${varName}.${v.key});`;
    }
    if (v.startDelim === '@"') {
      return `        Assert.Equal(${v.startDelim}${v.value}${v.endDelim}.Replace("\\r\\n", "\\n"), ${varName}.${v.key});`;
    }
    return `        Assert.Equal(${v.startDelim}${v.value}${v.endDelim}, ${varName}.${v.key});`;
  }).join('\n');
};

/** Render assertion lines for coercion validations (with isFloat / bool / normal dispatch). */
const emitCoercionAssertions = (
  validations: Array<{ key: string; value: any; delimiter: string }>,
): string => {
  return validations.map(v => {
    const valueStr = v.value.toString();
    if (valueStr === "True" || valueStr === "False") {
      return [
        `        Assert.NotNull(instance.${v.key});`,
        `        Assert.IsType<bool>(instance.${v.key});`,
        `        Assert.${valueStr === "False" ? "False" : "True"}((bool)instance.${v.key});`,
      ].join('\n');
    }
    // isFloat: value string contains '.'
    if (valueStr.includes('.')) {
      return [
        `        Assert.NotNull(instance.${v.key});`,
        `        Assert.True(instance.${v.key} is float || instance.${v.key} is double || instance.${v.key} is int || instance.${v.key} is long);`,
        `        Assert.Equal(${v.value}, Convert.ToDouble(instance.${v.key}), 5);`,
      ].join('\n');
    }
    return `        Assert.Equal(${v.delimiter}${v.value}${v.delimiter}, instance.${v.key});`;
  }).join('\n');
};

/** Emit a raw-string-literal block for C# (lines at column 0, delimiters on own lines). */
const emitRawStringLiteral = (varName: string, dataLines: string[]): string[] => {
  const lines: string[] = [];
  lines.push(`        string ${varName} = """`);
  for (const line of dataLines) {
    lines.push(line);
  }
  lines.push('""";');
  return lines;
};

/** Generate a complete C# xUnit test file for a type node. */
const emitCSharpTest = (ctx: CSharpTestContext): string => {
  const typeName = ctx.node.typeName.name;
  const L: string[] = [];

  L.push('using Xunit;');
  L.push('');
  L.push('#pragma warning disable IDE0130');
  L.push(`namespace ${ctx.namespace};`);
  L.push('#pragma warning restore IDE0130');
  L.push('');
  L.push('');
  L.push(`public class ${typeName}ConversionTests`);
  L.push('{');

  // --- Example tests (6 per example) ---
  ctx.examples.forEach((sample, i) => {
    const suffix = i === 0 ? '' : `${i}`;

    // LoadYamlInput
    L.push('    [Fact]');
    L.push(`    public void LoadYamlInput${suffix}()`);
    L.push('    {');
    L.push(...emitRawStringLiteral('yamlData', sample.yaml));
    L.push('');
    L.push(`        var instance = ${typeName}.FromYaml(yamlData);`);
    L.push('');
    L.push('        Assert.NotNull(instance);');
    const yamlAssertions = emitExampleAssertions(sample.validations, 'instance');
    if (yamlAssertions) L.push(yamlAssertions);
    L.push('    }');
    L.push('');

    // LoadJsonInput
    L.push('    [Fact]');
    L.push(`    public void LoadJsonInput${suffix}()`);
    L.push('    {');
    L.push(...emitRawStringLiteral('jsonData', sample.json));
    L.push('');
    L.push(`        var instance = ${typeName}.FromJson(jsonData);`);
    L.push('        Assert.NotNull(instance);');
    const jsonAssertions = emitExampleAssertions(sample.validations, 'instance');
    if (jsonAssertions) L.push(jsonAssertions);
    L.push('    }');
    L.push('');

    // RoundtripJson
    L.push('    [Fact]');
    L.push(`    public void RoundtripJson${suffix}()`);
    L.push('    {');
    L.push('        // Test that FromJson -> ToJson -> FromJson produces equivalent data');
    L.push(...emitRawStringLiteral('jsonData', sample.json));
    L.push('');
    L.push(`        var original = ${typeName}.FromJson(jsonData);`);
    L.push('        Assert.NotNull(original);');
    L.push('');
    L.push('        var json = original.ToJson();');
    L.push('        Assert.False(string.IsNullOrEmpty(json));');
    L.push('');
    L.push(`        var reloaded = ${typeName}.FromJson(json);`);
    L.push('        Assert.NotNull(reloaded);');
    const rtJsonAssertions = emitExampleAssertions(sample.validations, 'reloaded');
    if (rtJsonAssertions) L.push(rtJsonAssertions);
    L.push('    }');
    L.push('');

    // RoundtripYaml
    L.push('    [Fact]');
    L.push(`    public void RoundtripYaml${suffix}()`);
    L.push('    {');
    L.push('        // Test that FromYaml -> ToYaml -> FromYaml produces equivalent data');
    L.push(...emitRawStringLiteral('yamlData', sample.yaml));
    L.push('');
    L.push(`        var original = ${typeName}.FromYaml(yamlData);`);
    L.push('        Assert.NotNull(original);');
    L.push('');
    L.push('        var yaml = original.ToYaml();');
    L.push('        Assert.False(string.IsNullOrEmpty(yaml));');
    L.push('');
    L.push(`        var reloaded = ${typeName}.FromYaml(yaml);`);
    L.push('        Assert.NotNull(reloaded);');
    const rtYamlAssertions = emitExampleAssertions(sample.validations, 'reloaded');
    if (rtYamlAssertions) L.push(rtYamlAssertions);
    L.push('    }');
    L.push('');

    // ToJsonProducesValidJson
    L.push('    [Fact]');
    L.push(`    public void ToJsonProducesValidJson${suffix}()`);
    L.push('    {');
    L.push(...emitRawStringLiteral('jsonData', sample.json));
    L.push('');
    L.push(`        var instance = ${typeName}.FromJson(jsonData);`);
    L.push('        var json = instance.ToJson();');
    L.push('');
    L.push('        // Verify it\'s valid JSON by parsing it');
    L.push('        var parsed = System.Text.Json.JsonDocument.Parse(json);');
    L.push('        Assert.NotNull(parsed);');
    L.push('    }');
    L.push('');

    // ToYamlProducesValidYaml
    L.push('    [Fact]');
    L.push(`    public void ToYamlProducesValidYaml${suffix}()`);
    L.push('    {');
    L.push(...emitRawStringLiteral('yamlData', sample.yaml));
    L.push('');
    L.push(`        var instance = ${typeName}.FromYaml(yamlData);`);
    L.push('        var yaml = instance.ToYaml();');
    L.push('');
    L.push('        // Verify it\'s valid YAML by parsing it');
    L.push('        var deserializer = new YamlDotNet.Serialization.DeserializerBuilder().Build();');
    L.push('        var parsed = deserializer.Deserialize<object>(yaml);');
    L.push('        Assert.NotNull(parsed);');
    L.push('    }');
  });

  // --- Coercion tests (2 per coercion) ---
  if (ctx.coercions.length > 0) {
    for (const alt of ctx.coercions) {
      const titleScalar = alt.scalar.charAt(0).toUpperCase() + alt.scalar.slice(1);

      // Build the C# data literal
      let dataLine: string;
      if (alt.scalar === 'string') {
        dataLine = `        var data = "${alt.value.toString().replace(/"/g, '\\"')}";`;
      } else {
        let dataValue: string;
        if (alt.value.toString() === "True") dataValue = "true";
        else if (alt.value.toString() === "False") dataValue = "false";
        else dataValue = alt.value.toString();
        dataLine = `        var data = "${dataValue}";`;
      }

      // LoadJsonFrom{Scalar}
      L.push('');
      L.push('    [Fact]');
      L.push(`    public void LoadJsonFrom${titleScalar}()`);
      L.push('    {');
      L.push(`        // alternate representation as ${alt.scalar}`);
      L.push(dataLine);
      L.push(`        var instance = ${typeName}.FromJson(data);`);
      L.push('        Assert.NotNull(instance);');
      const jsonCoercionAssertions = emitCoercionAssertions(alt.validations);
      if (jsonCoercionAssertions) L.push(jsonCoercionAssertions);
      L.push('    }');

      // LoadYamlFrom{Scalar}
      L.push('');
      L.push('    [Fact]');
      L.push(`    public void LoadYamlFrom${titleScalar}()`);
      L.push('    {');
      L.push(`        // alternate representation as ${alt.scalar}`);
      L.push(dataLine);
      L.push(`        var instance = ${typeName}.FromYaml(data);`);
      L.push('        Assert.NotNull(instance);');
      L.push('');
      const yamlCoercionAssertions = emitCoercionAssertions(alt.validations);
      if (yamlCoercionAssertions) L.push(yamlCoercionAssertions);
      L.push('    }');
    }
  }

  // --- Factory tests (1 per factory) ---
  if (ctx.factories.length > 0) {
    for (const factory of ctx.factories) {
      const methodName = ctx.renderCsharpFactoryMethodName(factory.name);
      const paramValues = Object.values(factory.params)
        .map(pType => ctx.renderCsharpFactoryTestValue(pType))
        .join(', ');

      L.push('');
      L.push('    [Fact]');
      L.push(`    public void Factory${methodName}()`);
      L.push('    {');
      L.push(`        var instance = ${typeName}.${methodName}(${paramValues});`);
      L.push('        Assert.NotNull(instance);');

      for (const [propName, value] of Object.entries(factory.sets)) {
        if (value === true) {
          L.push(`        Assert.True(instance.${ctx.renderName(propName)});`);
        } else if (value === false) {
          L.push(`        Assert.False(instance.${ctx.renderName(propName)});`);
        } else if (typeof value === 'number') {
          L.push(`        Assert.Equal(${value}, instance.${ctx.renderName(propName)});`);
        } else if (typeof value === 'string') {
          L.push(`        Assert.Equal("${value}", instance.${ctx.renderName(propName)});`);
        }
      }

      L.push('    }');
    }
  }

  L.push('}');
  L.push('');

  return L.join('\n');
};

/** Generate the C# LoadContext / SaveContext file. */
const emitCSharpContext = (namespace: string): string => `// Copyright (c) Microsoft. All rights reserved.
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace ${namespace};
#pragma warning restore IDE0130

/// <summary>
/// Context for customizing the loading process of agent definitions.
/// Provides hooks for pre-processing input data before parsing and
/// post-processing output data after instantiation.
/// </summary>
public class LoadContext
{
    /// <summary>
    /// Optional callback to transform input data before parsing.
    /// </summary>
    public Func<Dictionary<string, object?>, Dictionary<string, object?>>? PreProcess { get; set; }

    /// <summary>
    /// Optional callback to transform the result after instantiation.
    /// </summary>
    public Func<object, object>? PostProcess { get; set; }

    /// <summary>
    /// Apply pre-processing to input data if a PreProcess callback is set.
    /// </summary>
    /// <param name="data">The raw input dictionary to process.</param>
    /// <returns>The processed dictionary, or the original if no callback is set.</returns>
    public Dictionary<string, object?> ProcessInput(Dictionary<string, object?> data)
    {
        if (PreProcess is not null)
        {
            return PreProcess(data);
        }
        return data;
    }

    /// <summary>
    /// Apply post-processing to the result if a PostProcess callback is set.
    /// </summary>
    /// <typeparam name="T">The type of the result.</typeparam>
    /// <param name="result">The instantiated object to process.</param>
    /// <returns>The processed result, or the original if no callback is set.</returns>
    public T ProcessOutput<T>(T result) where T : class
    {
        if (PostProcess is not null)
        {
            return (T)PostProcess(result);
        }
        return result;
    }
}

/// <summary>
/// Context for customizing the serialization process of agent definitions.
/// Provides hooks for pre-processing the object before serialization and
/// post-processing the dictionary after serialization.
/// </summary>
public class SaveContext
{
    /// <summary>
    /// Optional callback to transform the object before serialization.
    /// </summary>
    public Func<object, object>? PreSave { get; set; }

    /// <summary>
    /// Optional callback to transform the dictionary after serialization.
    /// </summary>
    public Func<Dictionary<string, object?>, Dictionary<string, object?>>? PostSave { get; set; }

    /// <summary>
    /// Output format for collections: "object" (name as key) or "array" (list of dicts).
    /// Defaults to "object".
    /// </summary>
    public string CollectionFormat { get; set; } = "object";

    /// <summary>
    /// Use shorthand scalar representation when possible (e.g., {"myTool": "function"}).
    /// Defaults to true.
    /// </summary>
    public bool UseShorthand { get; set; } = true;

    /// <summary>
    /// Apply pre-processing to the object if a PreSave callback is set.
    /// </summary>
    /// <typeparam name="T">The type of the object.</typeparam>
    /// <param name="obj">The object to process before serialization.</param>
    /// <returns>The processed object, or the original if no callback is set.</returns>
    public T ProcessObject<T>(T obj) where T : class
    {
        if (PreSave is not null)
        {
            return (T)PreSave(obj);
        }
        return obj;
    }

    /// <summary>
    /// Apply post-processing to the dictionary if a PostSave callback is set.
    /// </summary>
    /// <param name="data">The serialized dictionary to process.</param>
    /// <returns>The processed dictionary, or the original if no callback is set.</returns>
    public Dictionary<string, object?> ProcessDict(Dictionary<string, object?> data)
    {
        if (PostSave is not null)
        {
            return PostSave(data);
        }
        return data;
    }

    private static readonly JsonSerializerOptions s_jsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static readonly ISerializer s_yamlSerializer = new SerializerBuilder()
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
        .Build();

    /// <summary>
    /// Convert the dictionary to a YAML string.
    /// </summary>
    /// <param name="data">The dictionary to convert.</param>
    /// <returns>The YAML string representation.</returns>
    public string ToYaml(Dictionary<string, object?> data)
    {
        return s_yamlSerializer.Serialize(data);
    }

    /// <summary>
    /// Convert the dictionary to a JSON string.
    /// </summary>
    /// <param name="data">The dictionary to convert.</param>
    /// <param name="indent">Whether to indent the output. Defaults to true.</param>
    /// <returns>The JSON string representation.</returns>
    public string ToJson(Dictionary<string, object?> data, bool indent = true)
    {
        var options = indent ? s_jsonOptions : new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        return JsonSerializer.Serialize(data, options);
    }
}
`;

/** Generate the C# utility classes file (JsonUtils, YamlUtils, Utils). */
const emitCSharpUtils = (namespace: string): string => `// Copyright (c) Microsoft. All rights reserved.
using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

#pragma warning disable IDE0130
namespace ${namespace};
#pragma warning restore IDE0130

/// <summary>
/// JSON serialization utilities.
/// </summary>
public static class JsonUtils
{
    /// <summary>
    /// Default JSON serializer options with support for nested dictionaries.
    /// </summary>
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters = { new DictionaryJsonConverter() }
    };

    /// <summary>
    /// Extract a value from a JsonElement.
    /// </summary>
    public static object? GetJsonElementValue(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number => GetNumericValue(element),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            JsonValueKind.Undefined => null,
            _ => element.GetRawText()
        };
    }

    /// <summary>
    /// Get the appropriate numeric type from a JSON element.
    /// </summary>
    private static object GetNumericValue(JsonElement element)
    {
        // Try int first (most common case for small integers)
        if (element.TryGetInt32(out var i))
            return i;
        // Then try long for larger integers
        if (element.TryGetInt64(out var l))
            return l;
        // Fall back to double for decimals
        return element.GetDouble();
    }

    /// <summary>
    /// Custom converter to properly deserialize nested objects as dictionaries.
    /// </summary>
    private class DictionaryJsonConverter : JsonConverter<Dictionary<string, object?>>
    {
        public override Dictionary<string, object?> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType != JsonTokenType.StartObject)
                throw new JsonException("Expected StartObject token");

            var dict = new Dictionary<string, object?>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                    return dict;

                if (reader.TokenType != JsonTokenType.PropertyName)
                    throw new JsonException("Expected PropertyName token");

                var key = reader.GetString()!;
                reader.Read();
                dict[key] = ReadValue(ref reader, options);
            }
            throw new JsonException("Expected EndObject token");
        }

        private object? ReadValue(ref Utf8JsonReader reader, JsonSerializerOptions options)
        {
            return reader.TokenType switch
            {
                JsonTokenType.String => reader.GetString(),
                JsonTokenType.Number => GetNumericValue(reader),
                JsonTokenType.True => true,
                JsonTokenType.False => false,
                JsonTokenType.Null => null,
                JsonTokenType.StartObject => Read(ref reader, typeof(Dictionary<string, object?>), options),
                JsonTokenType.StartArray => ReadArray(ref reader, options),
                _ => throw new JsonException($"Unexpected token type: {reader.TokenType}")
            };
        }

        private static object GetNumericValue(Utf8JsonReader reader)
        {
            // Try int first (most common case for small integers)
            if (reader.TryGetInt32(out var i))
                return i;
            // Then try long for larger integers
            if (reader.TryGetInt64(out var l))
                return l;
            // Fall back to double for decimals
            return reader.GetDouble();
        }

        private List<object?> ReadArray(ref Utf8JsonReader reader, JsonSerializerOptions options)
        {
            var list = new List<object?>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                    return list;
                list.Add(ReadValue(ref reader, options));
            }
            throw new JsonException("Expected EndArray token");
        }

        public override void Write(Utf8JsonWriter writer, Dictionary<string, object?> value, JsonSerializerOptions options)
        {
            JsonSerializer.Serialize(writer, value, options);
        }
    }
}

/// <summary>
/// YAML serialization utilities.
/// </summary>
public static class YamlUtils
{
    /// <summary>
    /// Default YAML deserializer.
    /// </summary>
    public static readonly IDeserializer Deserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .Build();

    /// <summary>
    /// Default YAML serializer.
    /// </summary>
    public static readonly ISerializer Serializer = new SerializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull)
        .Build();

    /// <summary>
    /// Parse a YAML scalar string to a typed value.
    /// Uses YAML deserialization to properly handle quoted strings and types.
    /// Returns the properly typed value (bool, int, double, or string).
    /// </summary>
    public static object? ParseScalar(string yaml)
    {
        // Handle null/empty
        if (string.IsNullOrWhiteSpace(yaml))
            return null;

        // Use YAML deserializer to properly handle quoted strings and type inference
        try
        {
            var result = Deserializer.Deserialize<object>(yaml);
            // YamlDotNet returns strings for everything when deserializing to object
            // We need to do additional type parsing
            if (result is string str)
            {
                if (str == "null" || str == "~" || str == "")
                    return null;
                if (str == "true" || str == "True" || str == "TRUE")
                    return true;
                if (str == "false" || str == "False" || str == "FALSE")
                    return false;
                if (int.TryParse(str, out var intValue))
                    return intValue;
                if (double.TryParse(str, out var doubleValue))
                    return doubleValue;
                return str;
            }
            return result;
        }
        catch
        {
            return yaml;
        }
    }
}

/// <summary>
/// Utilities for retrieving property values and working with dictionaries.
/// </summary>
internal static class Utils
{
    public static object? GetScalarValue(this JsonElement obj)
    {
        return obj.ValueKind switch
        {
            JsonValueKind.String => obj.GetString(),
            JsonValueKind.Number => obj.GetRawText().Contains('.') ? obj.GetSingle() : obj.GetInt32(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Array => obj.EnumerateArray().Select(static x => x.GetScalarValue()).ToArray(),
            JsonValueKind.Null => null,
            JsonValueKind.Object => null,
            JsonValueKind.Undefined => null,
            _ => null,
        };
    }

    /// <summary>
    /// Retrieves a value from the dictionary by key and attempts to convert it to the specified type T.
    /// </summary>
    /// <typeparam name="T">The type to convert the value to.</typeparam>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the value to retrieve.</param>
    /// <returns>The value converted to type T, or default if not found.</returns>
    public static T? GetValue<T>(this Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var value) && value is not null)
        {
            if (value is T typedValue)
            {
                return typedValue;
            }
            try
            {
                return (T)Convert.ChangeType(value, typeof(T));
            }
            catch
            {
                return default;
            }
        }
        return default;
    }

    /// <summary>
    /// Retrieves a nested dictionary from the dictionary by key.
    /// </summary>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the nested dictionary.</param>
    /// <returns>Dictionary if found; otherwise, an empty dictionary.</returns>
    public static Dictionary<string, object?> GetDictionary(this Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var value))
        {
            return value.GetDictionary();
        }
        return new Dictionary<string, object?>();
    }

    /// <summary>
    /// Retrieves a nested dictionary from any object.
    /// Handles both Dictionary&lt;string, object?&gt; and Dictionary&lt;object, object&gt; (from YAML).
    /// </summary>
    /// <param name="obj">The object that should be a dictionary.</param>
    /// <returns>Dictionary if the object is a dictionary; otherwise, an empty dictionary.</returns>
    public static Dictionary<string, object?> GetDictionary(this object? obj)
    {
        if (obj is Dictionary<string, object?> dict)
        {
            return dict;
        }
        // Handle YAML's Dictionary<object, object>
        if (obj is IDictionary<object, object> objDict)
        {
            return objDict.ToDictionary(
                kvp => kvp.Key?.ToString() ?? string.Empty,
                kvp => (object?)kvp.Value);
        }
        return new Dictionary<string, object?>();
    }

    /// <summary>
    /// Retrieves a nested dictionary from any object, with shorthand property support.
    /// If the object is not a dictionary and a shorthand property is specified,
    /// wraps the scalar value as { shorthandProperty: value }.
    /// </summary>
    /// <param name="obj">The object that should be a dictionary.</param>
    /// <param name="shorthandProperty">Optional shorthand property name for scalar wrapping.</param>
    /// <returns>Dictionary if the object is a dictionary; shorthand-wrapped dict for scalars; otherwise, an empty dictionary.</returns>
    public static Dictionary<string, object?> GetDictionary(this object? obj, string? shorthandProperty)
    {
        var dict = obj.GetDictionary();
        if (dict.Count > 0) return dict;
        if (shorthandProperty is not null && obj is not null)
            return new Dictionary<string, object?> { [shorthandProperty] = obj };
        return dict;
    }

    /// <summary>
    /// Retrieves a value from the dictionary by key and attempts to convert it to the specified type T.
    /// </summary>
    /// <typeparam name="T">The type to convert the value to.</typeparam>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the value to retrieve.</param>
    /// <returns></returns>
    public static T? GetValueOrDefault<T>(this IDictionary<string, object> dict, string key)
    {
        // check if T is a class and use .ctor recursively
        if (dict.TryGetValue(key, out var value))
        {
            return (T?)Convert.ChangeType(value, typeof(T));
        }
        return default;
    }

    /// <summary>
    /// Converts a named dictionary or list of dictionaries into a list of dictionaries (for normalizing Named objects into List objects).
    /// </summary>
    /// <param name="data"></param>
    /// <returns>List of dictionaries</returns>
    public static IList<IDictionary<string, object>> GetNamedDictionaryList(this object data)
    {
        if (data is IDictionary<string, object> dict)
        {
            return [.. dict
                .Where(kvp => kvp.Value is IDictionary<string, object>)
                .Select(kvp =>
                {
                    var newDict = new Dictionary<string, object>((IDictionary<string, object>)kvp.Value!)
                    {
                        { "name", kvp.Key }
                    };
                    return (IDictionary<string, object>)newDict;
                })];
        }
        if (data is IEnumerable<object> enumerable)
        {
            return [.. enumerable.OfType<IDictionary<string, object>>()];
        }
        return [];
    }

    /// <summary>
    /// Retrieves a nested dictionary from the dictionary by key.
    /// </summary>
    /// <param name="dict">The dictionary to search.</param>
    /// <param name="key">The key of the nested dictionary.</param>
    /// <returns>Dictionary<string, object> if found; otherwise, an empty dictionary.</returns>
    public static IDictionary<string, object> GetDictionaryOrDefault(this IDictionary<string, object> dict, string key)
    {
        if (dict.TryGetValue(key, out var value) && value is IDictionary<string, object> nestedDict)
        {
            return nestedDict;
        }
        return new Dictionary<string, object>();
    }

    /// <summary>
    /// Expands a dictionary by converting its keys and values to strings and more usable formats.
    /// </summary>
    /// <param name="dictionary">The dictionary to expand.</param>
    /// <returns>A new dictionary with expanded keys and values.</returns>
    private static Dictionary<string, object> Expand(IDictionary dictionary)
    {
        var dict = new Dictionary<string, object>();
        foreach (DictionaryEntry entry in dictionary)
        {
            if (entry.Value != null)
                dict.Add(entry.Key.ToString()!, GetValue(entry.Value));
        }
        return dict;
    }

    /// <summary>
    /// Expands a dictionary by converting its values to a more usable format.
    /// </summary>
    /// <param name="o">The object to convert.</param>
    /// <returns>A more usable object.</returns>
    private static object GetValue(object o)
    {
        return Type.GetTypeCode(o.GetType()) switch
        {
            TypeCode.Object => o switch
            {

                IDictionary dict => Expand(dict),
                IList list => Enumerable.Range(0, list.Count).Where(i => list[i] != null).Select(i => list[i]!.ToParamDictionary()).ToArray(),
                _ => o.ToParamDictionary(),
            },
            _ => o,
        };
    }

    /// <summary>
    /// Converts an object to a dictionary of parameters.
    /// </summary>
    /// <param name="obj">The object to convert.</param>
    /// <returns>A dictionary of parameters.</returns>
    public static IDictionary<string, object> ToParamDictionary(this object obj)
    {
        if (obj == null)
            return new Dictionary<string, object>();

        else if (obj is IDictionary<string, object> dictionary)
            return dictionary;

        var items = obj.GetType()
              .GetProperties(BindingFlags.Public | BindingFlags.Instance)
              .Where(prop => prop.GetGetMethod() != null);

        var dict = new Dictionary<string, object>();

        foreach (var item in items)
        {
            var value = item.GetValue(obj);
            if (value != null)
                dict.Add(item.Name, GetValue(value));
        }

        return dict;
    }
}
`;

const emitCsharpFile = async (context: EmitContext<PromptyEmitterOptions>, type: TypeNode, python: string, filename: string, outputDir?: string) => {
  outputDir = outputDir || `${context.emitterOutputDir}/CSharp`;
  const typePath = type.typeName.namespace.split(".");

  // replace typename with file
  typePath.push(filename);
  const path = resolvePath(outputDir, filename);
  await emitFile(context.program, {
    path,
    content: python,
  });
}

/**
 * Format C# files using dotnet format.
 * Runs formatter from the .NET project root (where .csproj or .sln is located).
 */
function formatCSharpFiles(outputDir: string, testDir?: string): void {
  const dirs = [outputDir, ...(testDir ? [testDir] : [])];
  const formatted = new Set<string>();

  for (const dir of dirs) {
    const projectRoot = findDotNetProjectRoot(dir);
    if (!projectRoot) {
      console.warn(`Warning: Could not find .csproj or .sln file for ${dir}. Skipping formatting.`);
      continue;
    }

    // Avoid formatting the same project twice
    if (formatted.has(projectRoot)) {
      continue;
    }
    formatted.add(projectRoot);

    try {
      execSync(`dotnet format "${projectRoot}"`, {
        cwd: dirname(projectRoot),
        stdio: 'pipe',
        encoding: 'utf-8'
      });
    } catch (error) {
      console.warn(`Warning: dotnet format failed for ${projectRoot}. You may need to run it manually.`);
    }
  }
}

/**
 * Find the .NET project root by traversing up from the output directory
 * looking for .csproj or .sln files.
 */
function findDotNetProjectRoot(startDir: string): string | undefined {
  let currentDir = resolve(startDir);
  const root = resolve('/');

  // On Windows, also check for drive root (e.g., "C:\")
  while (currentDir !== root && currentDir !== dirname(currentDir)) {
    // First check for .csproj (more specific)
    const files = existsSync(currentDir) ? readdirSync(currentDir) : [];
    const csprojFile = files.find((f: string) => f.endsWith('.csproj'));
    if (csprojFile) {
      return resolve(currentDir, csprojFile);
    }

    // Then check for .sln
    const slnFile = files.find((f: string) => f.endsWith('.sln'));
    if (slnFile) {
      return resolve(currentDir, slnFile);
    }

    currentDir = dirname(currentDir);
  }

  return undefined;
}
