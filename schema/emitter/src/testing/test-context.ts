/**
 * Shared Test Context Builder
 * ===========================
 * Provides standardized helper functions for building test contexts across all language emitters.
 * This ensures consistency in how tests are generated from @sample decorators.
 */

import { TypeNode, PropertyValidation, TestExample, CoercionTest, BaseTestContext } from "../ir/ast.js";
import { getCombinations, scalarValue, toSnakeCase } from "../ir/utilities.js";
import { toPascalCase } from "../ir/visitor.js";
import * as YAML from "yaml";

const RUST_KEYWORDS = new Set([
  "as", "break", "const", "continue", "crate", "else", "enum", "extern",
  "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
  "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
  "super", "trait", "true", "type", "unsafe", "use", "where", "while",
  "async", "await", "dyn",
]);

function rustFieldName(name: string): string {
  const snake = toSnakeCase(name);
  return RUST_KEYWORDS.has(snake) ? `r#${snake}` : snake;
}

/**
 * Options for building test context - language-specific transformations.
 */
export interface TestContextOptions {
  /** Transform property name to target language casing (e.g., PascalCase, snake_case) */
  renderKey: (key: string) => string;

  /** Render boolean value as language-specific literal (e.g., "True"/"False" for Python) */
  renderBoolean: (val: boolean) => string;

  /** Escape string for use in language-specific string literal */
  escapeString: (str: string) => string;

  /** Get string delimiter based on content (e.g., '"' or '"""' for multiline) */
  getDelimiter: (str: string) => string;

  /** Escape JSON for embedding in test template (optional - for languages that need it) */
  escapeJsonForTemplate?: (json: string) => string;

  /** Escape YAML for embedding in test template (optional - for languages that need it) */
  escapeYamlForTemplate?: (yaml: string) => string;

  /** Default scalar values for each type (used when @sample doesn't provide example) */
  scalarValues: Record<string, string>;

  /** Type mapper for scalar types */
  typeMapper: Record<string, string>;

  /**
   * Render an enum assertion value for a closed enum field.
   * Called with (enumName, rawStringValue, fieldName).
   * If provided and returns non-null, overrides default string/bool/number rendering.
   * The returned value+delimiter replace the default.
   */
  renderEnumValue?: (enumName: string, rawValue: string, fieldName: string) => { value: string; delimiter: string } | null;
}

/**
 * Build a standardized test context from a TypeNode.
 * All language emitters should use this to ensure consistent test generation.
 */
export function buildBaseTestContext(
  node: TypeNode,
  packageName: string | undefined,
  options: TestContextOptions
): BaseTestContext {
  const examples = buildExamples(node, options);
  const coercions = buildCoercions(node, options);
  const isAbstract = node.isAbstract || (node.discriminator !== undefined && node.discriminator.length > 0);

  return {
    node,
    isAbstract,
    package: packageName,
    examples,
    coercions,
    factories: node.factories,
  };
}

/**
 * Build test examples from @sample decorators on properties.
 */
function buildExamples(node: TypeNode, options: TestContextOptions): TestExample[] {
  // Get sample properties and generate combinations
  const samples = node.properties
    .filter(p => p.samples && p.samples.length > 0)
    .map(p => p.samples?.map(s => ({ ...s.sample })));

  const combinations = samples.length > 0 ? getCombinations(samples) : [];

  return combinations.map(c => {
    const sample = Object.assign({}, ...c);

    // Create YAML document with proper string escaping
    const doc = new YAML.Document(sample);
    YAML.visit(doc, {
      Scalar(key, yamlNode) {
        if (typeof yamlNode.value === 'string') {
          const str = yamlNode.value as string;
          if (str.includes('\n') || str.includes('\t') || str.includes('#') || str.includes(':') || str.includes('"')) {
            yamlNode.type = 'QUOTE_DOUBLE';
          }
        }
      }
    });

    // Generate JSON and optionally escape for embedding in template strings
    let jsonStr = JSON.stringify(sample, null, 2);
    if (options.escapeJsonForTemplate) {
      jsonStr = options.escapeJsonForTemplate(jsonStr);
    }

    // Generate YAML and optionally escape for embedding in template strings
    let yamlStr = doc.toString({ indent: 2, lineWidth: 0 });
    if (options.escapeYamlForTemplate) {
      yamlStr = options.escapeYamlForTemplate(yamlStr);
    }

    return {
      json: jsonStr.split('\n'),
      yaml: yamlStr.split('\n'),
      validations: buildValidations(sample, node, options),
    };
  });
}

/**
 * Build property validations from a sample object.
 */
function buildValidations(
  sample: Record<string, any>,
  node: TypeNode,
  options: TestContextOptions
): PropertyValidation[] {
  return Object.keys(sample)
    .filter(key => typeof sample[key] !== 'object')
    .map(key => {
      const prop = node.properties.find(p => p.name === key);
      const rawValue = sample[key];

      // Check for enum field (skip discriminator fields)
      const isDiscriminator = node.discriminator === key;
      if (prop && prop.enumName && !isDiscriminator && typeof rawValue === 'string' && options.renderEnumValue) {
        const enumResult = options.renderEnumValue(prop.enumName, rawValue, key);
        if (enumResult) {
          return {
            key: options.renderKey(key),
            value: enumResult.value,
            delimiter: enumResult.delimiter,
            isOptional: prop?.isOptional || false,
          };
        }
      }

      let value: any;
      let delimiter = '';

      if (typeof rawValue === 'boolean') {
        value = options.renderBoolean(rawValue);
      } else if (typeof rawValue === 'string') {
        value = options.escapeString(rawValue);
        delimiter = options.getDelimiter(rawValue);
      } else {
        value = rawValue;
      }

      return {
        key: options.renderKey(key),
        value,
        delimiter,
        isOptional: prop?.isOptional || false,
      };
    });
}

/**
 * Build coercion (scalar-to-object) test cases from node coercions.
 */
function buildCoercions(node: TypeNode, options: TestContextOptions): CoercionTest[] {
  if (!node.coercions || node.coercions.length === 0) {
    return [];
  }

  return node.coercions.map(alt => {
    // Get example value - use provided example or default scalar value
    const example = alt.example
      ? (typeof alt.example === "string" ? '"' + alt.example + '"' : alt.example.toString())
      : options.scalarValues[alt.scalar] || "null";

    // Build validations for expanded properties
    const validations: PropertyValidation[] = Object.keys(alt.expansion)
      .filter(key => typeof alt.expansion[key] !== 'object')
      .map(key => {
        const prop = node.properties.find(p => p.name === key);
        const rawValue = alt.expansion[key];
        const isValuePlaceholder = rawValue === "{value}";
        const value = isValuePlaceholder ? example : rawValue;

        // Check for closed enum field (skip discriminator fields)
        const isDiscriminator = node.discriminator === key;
        if (prop && prop.enumName && !isDiscriminator && options.renderEnumValue) {
          // Extract the raw string value (strip quotes if present from example substitution)
          const strValue = typeof value === 'string' ? value.replace(/^"|"$/g, '') : String(value);
          const enumResult = options.renderEnumValue(prop.enumName, strValue, key);
          if (enumResult) {
            return {
              key: options.renderKey(key),
              value: enumResult.value,
              delimiter: enumResult.delimiter,
              isOptional: prop?.isOptional || false,
            };
          }
        }

        // Determine delimiter - don't add quotes if it's the {value} placeholder (already has quotes)
        const needsQuotes = typeof value === 'string' && !value.includes('"') && !isValuePlaceholder;

        return {
          key: options.renderKey(key),
          value: needsQuotes ? options.escapeString(value) : value,
          delimiter: needsQuotes ? '"' : '',
          isOptional: prop?.isOptional || false,
        };
      });

    return {
      title: alt.title || alt.scalar,
      scalarType: options.typeMapper[alt.scalar] || alt.scalar,
      value: example,
      validations,
    };
  });
}

// =============================================================================
// Language-Specific Presets
// =============================================================================

/**
 * C# test context options.
 */
export const csharpTestOptions: TestContextOptions = {
  renderKey: (key: string) => {
    // Convert snake_case to PascalCase
    const pascal = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return pascal.charAt(0).toUpperCase() + pascal.slice(1);
  },
  renderBoolean: (val: boolean) => val ? "True" : "False",
  escapeString: (str: string) => str.replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
  getDelimiter: (str: string) => str.includes('\n') ? '@"' : '"',
  scalarValues: {
    "boolean": "false",
    "float": "3.14f",
    "float32": "3.14f",
    "float64": "3.14",
    "number": "3.14f",
    "int32": "3",
    "int64": "3L",
    "integer": "3",
    "string": '"example"',
  },
  typeMapper: {
    "string": "string",
    "boolean": "bool",
    "int32": "int",
    "int64": "long",
    "float32": "float",
    "float64": "double",
    "number": "float",
  },
};

/**
 * Python test context options.
 */
export const pythonTestOptions: TestContextOptions = {
  renderKey: (key: string) => toSnakeCase(key), // camelCase from TypeSpec → snake_case for Python
  renderBoolean: (val: boolean) => val ? "True" : "False",
  escapeString: (str: string) => str.replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
  getDelimiter: (str: string) => str.includes('\n') ? '"""' : '"',
  scalarValues: {
    "boolean": "False",
    "float": "3.14",
    "float32": "3.14",
    "float64": "3.14",
    "number": "3.14",
    "int32": "3",
    "int64": "3",
    "integer": "3",
    "string": '"example"',
  },
  typeMapper: {
    "string": "str",
    "boolean": "bool",
    "int32": "int",
    "int64": "int",
    "float32": "float",
    "float64": "float",
    "number": "float",
  },
};

/**
 * TypeScript test context options.
 */
export const typescriptTestOptions: TestContextOptions = {
  renderKey: (key: string) => key, // camelCase - already correct from TypeSpec
  renderBoolean: (val: boolean) => val ? "true" : "false",
  escapeString: (str: string) => str
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"'),
  getDelimiter: (str: string) => '"',
  // Escape backslashes in JSON so escape sequences like \n remain as literals in template strings
  escapeJsonForTemplate: (json: string) => json.replace(/\\/g, "\\\\"),
  // Escape backslashes in YAML so escape sequences remain as literals in template strings
  escapeYamlForTemplate: (yaml: string) => yaml.replace(/\\/g, "\\\\"),
  scalarValues: {
    "boolean": "false",
    "float": "3.14",
    "float32": "3.14",
    "float64": "3.14",
    "number": "3.14",
    "int32": "3",
    "int64": "3",
    "integer": "3",
    "string": '"example"',
  },
  typeMapper: {
    "string": "string",
    "boolean": "boolean",
    "int32": "number",
    "int64": "number",
    "float32": "number",
    "float64": "number",
    "number": "number",
  },
};

/**
 * Rust test context options.
 */
export const rustTestOptions: TestContextOptions = {
  renderKey: (key: string) => {
    return rustFieldName(key);
  },
  renderBoolean: (val: boolean) => val ? "true" : "false",
  escapeString: (str: string) => str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t'),
  getDelimiter: (str: string) => '"',
  renderEnumValue: (enumName: string, rawValue: string) => ({
    value: `${enumName}::${toPascalCase(rawValue)}`,
    delimiter: '',
  }),
  escapeJsonForTemplate: undefined,
  escapeYamlForTemplate: undefined,
  scalarValues: {
    "boolean": "false",
    "float": "3.14",
    "float32": "3.14",
    "float64": "3.14",
    "number": "3.14",
    "int32": "3",
    "int64": "3",
    "integer": "3",
    "string": '"example"',
  },
  typeMapper: {
    "string": "String",
    "boolean": "bool",
    "int32": "i32",
    "int64": "i64",
    "float32": "f32",
    "float64": "f64",
    "number": "f64",
  },
};

/**
 * Go test context options.
 */
export const goTestOptions: TestContextOptions = {
  renderKey: (key: string) => {
    // Convert snake_case to PascalCase for exported Go fields
    const pascal = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return pascal.charAt(0).toUpperCase() + pascal.slice(1);
  },
  renderBoolean: (val: boolean) => val ? "true" : "false",
  escapeString: (str: string) => str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t'),
  getDelimiter: (str: string) => '"',
  scalarValues: {
    "boolean": "false",
    "float": "3.14",
    "float32": "3.14",
    "float64": "3.14",
    "number": "3.14",
    "int32": "3",
    "int64": "3",
    "integer": "3",
    "string": '"example"',
  },
  typeMapper: {
    "string": "string",
    "boolean": "bool",
    "int32": "int32",
    "int64": "int64",
    "float32": "float32",
    "float64": "float64",
    "number": "float64",
  },
};
