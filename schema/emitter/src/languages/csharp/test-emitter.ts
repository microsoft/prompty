/**
 * C# test emitter — TypeNode → xUnit test file.
 *
 * Replaces `test.cs.njk` Nunjucks template with a typed TypeScript function
 * that produces a complete C# xUnit test class.
 *
 * Each TypeNode with samples/coercions/factories gets one test file
 * containing LoadYaml, LoadJson, roundtrip, and validity tests.
 */

import { FactoryEntry } from "../../decorators.js";
import { TypeNode } from "../../ir/ast.js";
import { toPascalCase } from "../../ir/visitor.js";

// ============================================================================
// Public types
// ============================================================================

export interface CSharpTestContext {
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

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Emit a complete C# xUnit test file for a type node.
 */
export function emitCSharpTest(ctx: CSharpTestContext): string {
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
        dataLine = `        var data = "${alt.value.toString().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}";`;
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
          // Check if this property is a closed enum (skip discriminator fields)
          const prop = ctx.node.properties.find(p => p.name === propName);
          const isDiscriminator = ctx.node.discriminator === propName;
          if (prop && prop.enumName && !prop.isOpenEnum && !isDiscriminator) {
            const csEnumName = toPascalCase(prop.enumName);
            const memberName = toPascalCase(value);
            L.push(`        Assert.Equal(${csEnumName}.${memberName}, instance.${ctx.renderName(propName)});`);
          } else {
            L.push(`        Assert.Equal("${value}", instance.${ctx.renderName(propName)});`);
          }
        }
      }

      L.push('    }');
    }
  }

  L.push('}');
  L.push('');

  return L.join('\n');
}

// ============================================================================
// Assertion helpers
// ============================================================================

/** Render Assert.Equal / Assert.True / Assert.False lines for example validations. */
function emitExampleAssertions(
  validations: Array<{ key: string; value: any; startDelim: string; endDelim: string }>,
  varName: string,
): string {
  return validations.map(v => {
    if (v.value === "True" || v.value === "False") {
      return `        Assert.${v.value === "False" ? "False" : "True"}(${varName}.${v.key});`;
    }
    if (v.startDelim === '@"') {
      return `        Assert.Equal(${v.startDelim}${v.value}${v.endDelim}.Replace("\\r\\n", "\\n"), ${varName}.${v.key});`;
    }
    return `        Assert.Equal(${v.startDelim}${v.value}${v.endDelim}, ${varName}.${v.key});`;
  }).join('\n');
}

/** Render assertion lines for coercion validations (with isFloat / bool / normal dispatch). */
function emitCoercionAssertions(
  validations: Array<{ key: string; value: any; delimiter: string }>,
): string {
  return validations.map(v => {
    const valueStr = v.value.toString();
    if (valueStr === "True" || valueStr === "False") {
      return [
        `        Assert.NotNull(instance.${v.key});`,
        `        Assert.IsType<bool>(instance.${v.key});`,
        `        Assert.${valueStr === "False" ? "False" : "True"}((bool)instance.${v.key});`,
      ].join('\n');
    }
    // Enum values (e.g., McpApprovalModeKind.Never) — emit direct assertion
    if (v.delimiter === '' && /^[A-Z]/.test(valueStr)) {
      return `        Assert.Equal(${v.value}, instance.${v.key});`;
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
}

// ============================================================================
// Raw string literal helper
// ============================================================================

/** Emit a raw-string-literal block for C# (lines at column 0, delimiters on own lines). */
function emitRawStringLiteral(varName: string, dataLines: string[]): string[] {
  const lines: string[] = [];
  lines.push(`        string ${varName} = """`);
  for (const line of dataLines) {
    lines.push(line);
  }
  lines.push('""";');
  return lines;
}
