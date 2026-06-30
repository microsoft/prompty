/**
 * Python test file emitter — BaseTestContext → pytest source code.
 *
 * Replaces the Nunjucks templates:
 *   - `test.py.njk`         → emitPythonTest()
 *   - `test_context.py.njk` → emitPythonTestContext()
 *   - `_macros.njk`         → factoryParamTestValue(), renderValidation()
 *
 * The emitter produces pytest functions for:
 *   - JSON loading (load_json per example)
 *   - YAML loading (load_yaml per example)
 *   - Round-trip (load → save → load per example)
 *   - Serialization (to_json, to_yaml per example)
 *   - Alternate representations (scalar coercions)
 *   - Factory methods
 */

import { PropertyValidation, PythonClassContext, BaseTestContext } from "../../ir/ast.js";
import { toSnakeCase } from "../../ir/utilities.js";

// ============================================================================
// Macro replacements
// ============================================================================

/**
 * Get test value for a factory parameter type.
 * Replaces the factoryParamTestValue macro from _macros.njk.
 */
function factoryParamTestValue(typeStr: string): string {
  switch (typeStr) {
    case "string": return '"test"';
    case "boolean": return "True";
    case "integer":
    case "int32":
    case "int64": return "42";
    case "float":
    case "float64":
    case "float32": return "3.14";
    case "unknown":
    default: return '"test"';
  }
}

/**
 * Render a single validation assertion line for a Python test.
 */
function renderValidation(v: PropertyValidation, varName: string): string {
  if (v.value === "True") {
    return `    assert ${varName}.${v.key}`;
  } else if (v.value === "False") {
    return `    assert not ${varName}.${v.key}`;
  } else {
    return `    assert ${varName}.${v.key} == ${v.delimiter}${v.value}${v.delimiter}`;
  }
}

// ============================================================================
// Test emitters
// ============================================================================

/**
 * Emit the test_context.py file content (tests for LoadContext + SaveContext).
 * Replaces test_context.py.njk template.
 */
export function emitPythonTestContext(header: string, packageName: string): string {
  const headerLine = header ? `# ${header}\n` : '';
  return `${headerLine}from ${packageName}._context import LoadContext, SaveContext


class TestLoadContext:
    """Tests for LoadContext class."""

    def test_default_values(self) -> None:
        """Test that LoadContext has correct default values."""
        context = LoadContext()
        assert context.pre_process is None
        assert context.post_process is None

    def test_process_input_without_callback(self) -> None:
        """Test process_input returns original data when no callback set."""
        context = LoadContext()
        data = {"key": "value", "nested": {"a": 1}}
        result = context.process_input(data)
        assert result is data

    def test_process_input_with_callback(self) -> None:
        """Test process_input applies the pre_process callback."""
        def add_field(data: dict) -> dict:
            return {**data, "added": True}

        context = LoadContext(pre_process=add_field)
        data = {"key": "value"}
        result = context.process_input(data)
        assert result == {"key": "value", "added": True}
        assert result is not data

    def test_process_output_without_callback(self) -> None:
        """Test process_output returns original result when no callback set."""
        context = LoadContext()
        result = {"some": "result"}
        processed = context.process_output(result)
        assert processed is result

    def test_process_output_with_callback(self) -> None:
        """Test process_output applies the post_process callback."""
        def wrap_result(result: dict) -> dict:
            return {"wrapped": result}

        context = LoadContext(post_process=wrap_result)
        result = {"key": "value"}
        processed = context.process_output(result)
        assert processed == {"wrapped": {"key": "value"}}

    def test_both_callbacks(self) -> None:
        """Test using both pre_process and post_process callbacks."""
        def normalize_keys(data: dict) -> dict:
            return {k.lower(): v for k, v in data.items()}

        def add_metadata(result: dict) -> dict:
            return {**result, "_processed": True}

        context = LoadContext(pre_process=normalize_keys, post_process=add_metadata)

        input_data = {"Key": "value", "UPPER": "case"}
        processed_input = context.process_input(input_data)
        assert processed_input == {"key": "value", "upper": "case"}

        final_result = context.process_output(processed_input)
        assert final_result == {"key": "value", "upper": "case", "_processed": True}

    def test_pre_process_can_modify_structure(self) -> None:
        """Test that pre_process can fundamentally transform data structure."""
        def flatten_nested(data: dict) -> dict:
            result = {}
            for key, value in data.items():
                if isinstance(value, dict):
                    for nested_key, nested_value in value.items():
                        result[f"{key}_{nested_key}"] = nested_value
                else:
                    result[key] = value
            return result

        context = LoadContext(pre_process=flatten_nested)
        data = {"top": "level", "nested": {"a": 1, "b": 2}}
        result = context.process_input(data)
        assert result == {"top": "level", "nested_a": 1, "nested_b": 2}


class TestSaveContext:
    """Tests for SaveContext class."""

    def test_default_values(self) -> None:
        """Test that SaveContext has correct default values."""
        context = SaveContext()
        assert context.pre_save is None
        assert context.post_save is None

    def test_process_object_without_callback(self) -> None:
        """Test process_object returns original object when no callback set."""
        context = SaveContext()
        obj = {"key": "value"}
        result = context.process_object(obj)
        assert result is obj

    def test_process_object_with_callback(self) -> None:
        """Test process_object applies the pre_save callback."""
        def add_timestamp(obj: dict) -> dict:
            return {**obj, "timestamp": "2024-01-01"}

        context = SaveContext(pre_save=add_timestamp)
        obj = {"key": "value"}
        result = context.process_object(obj)
        assert result == {"key": "value", "timestamp": "2024-01-01"}

    def test_process_dict_without_callback(self) -> None:
        """Test process_dict returns original dict when no callback set."""
        context = SaveContext()
        data = {"key": "value"}
        result = context.process_dict(data)
        assert result is data

    def test_process_dict_with_callback(self) -> None:
        """Test process_dict applies the post_save callback."""
        def remove_internal_fields(data: dict) -> dict:
            return {k: v for k, v in data.items() if not k.startswith("_")}

        context = SaveContext(post_save=remove_internal_fields)
        data = {"key": "value", "_internal": "secret"}
        result = context.process_dict(data)
        assert result == {"key": "value"}

    def test_both_callbacks(self) -> None:
        """Test using both pre_save and post_save callbacks."""
        def mark_for_export(obj: dict) -> dict:
            return {**obj, "_exporting": True}

        def clean_markers(data: dict) -> dict:
            return {k: v for k, v in data.items() if not k.startswith("_")}

        context = SaveContext(pre_save=mark_for_export, post_save=clean_markers)

        obj = {"name": "test", "value": 42}
        processed_obj = context.process_object(obj)
        assert processed_obj == {"name": "test", "value": 42, "_exporting": True}

        final_dict = context.process_dict(processed_obj)
        assert final_dict == {"name": "test", "value": 42}

    def test_to_yaml(self) -> None:
        """Test to_yaml produces valid YAML string."""
        context = SaveContext()
        data = {"name": "test", "items": ["a", "b"]}
        result = context.to_yaml(data)
        assert "name: test" in result
        assert "items:" in result
        assert "- a" in result
        assert "- b" in result

    def test_to_json(self) -> None:
        """Test to_json produces valid JSON string."""
        import json
        context = SaveContext()
        data = {"name": "test", "items": ["a", "b"]}
        result = context.to_json(data)
        parsed = json.loads(result)
        assert parsed == data

    def test_to_json_custom_indent(self) -> None:
        """Test to_json respects custom indent."""
        context = SaveContext()
        data = {"name": "test"}
        result_2 = context.to_json(data, indent=2)
        result_4 = context.to_json(data, indent=4)
        # 4-space indent should have more characters
        assert len(result_4) > len(result_2)

    def test_collection_format_default(self) -> None:
        """Test that default collection_format is 'object'."""
        context = SaveContext()
        assert context.collection_format == "object"

    def test_collection_format_array(self) -> None:
        """Test collection_format can be set to 'array'."""
        context = SaveContext(collection_format="array")
        assert context.collection_format == "array"

    def test_use_shorthand_default(self) -> None:
        """Test that default use_shorthand is True."""
        context = SaveContext()
        assert context.use_shorthand is True

    def test_use_shorthand_disabled(self) -> None:
        """Test use_shorthand can be disabled."""
        context = SaveContext(use_shorthand=False)
        assert context.use_shorthand is False
`;
}

/**
 * Emit a pytest test file for a type.
 * Replaces test.py.njk template.
 */
export function emitPythonTest(ctx: BaseTestContext & { classCtx: PythonClassContext }): string {
  const { node, examples, coercions, factories, classCtx } = ctx;
  const packageName = ctx.package || '';
  const typeName = node.typeName.name;
  const typeNameLower = typeName.toLowerCase();
  const lines: string[] = [];

  // Imports
  if (examples.length > 0) {
    lines.push('import json');
    lines.push('import yaml');
    lines.push('');
  }
  lines.push(`from ${packageName} import ${typeName}`);
  lines.push('');

  // Example tests: load_json, load_yaml, roundtrip_json, to_json, to_yaml
  for (let i = 0; i < examples.length; i++) {
    const sample = examples[i];
    const suffix = i === 0 ? '' : `_${i}`;
    const jsonBlock = sample.json.map(line => line.length > 0 ? `    ${line}` : '').join('\n');
    const yamlBlock = sample.yaml.map(line => line.length > 0 ? `    ${line}` : '').join('\n');

    // test_load_json
    lines.push(`def test_load_json_${typeNameLower}${suffix}():`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    assert instance is not None`);
    for (const v of sample.validations) {
      lines.push(renderValidation(v, 'instance'));
    }
    lines.push('');

    // test_load_yaml
    lines.push(`def test_load_yaml_${typeNameLower}${suffix}():`);
    lines.push(`    yaml_data = r'''`);
    lines.push(yamlBlock);
    lines.push(`    '''`);
    lines.push(`    data = yaml.load(yaml_data, Loader=yaml.FullLoader)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    assert instance is not None`);
    for (const v of sample.validations) {
      lines.push(renderValidation(v, 'instance'));
    }
    lines.push('');

    // test_roundtrip_json
    lines.push(`def test_roundtrip_json_${typeNameLower}${suffix}():`);
    lines.push(`    """Test that load -> save -> load produces equivalent data."""`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    original_data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(original_data)`);
    lines.push(`    saved_data = instance.save()`);
    lines.push(`    reloaded = ${typeName}.load(saved_data)`);
    lines.push(`    assert reloaded is not None`);
    for (const v of sample.validations) {
      lines.push(renderValidation(v, 'reloaded'));
    }
    lines.push('');

    // test_to_json
    lines.push(`def test_to_json_${typeNameLower}${suffix}():`);
    lines.push(`    """Test that to_json produces valid JSON."""`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    json_output = instance.to_json()`);
    lines.push(`    assert json_output is not None`);
    lines.push(`    parsed = json.loads(json_output)`);
    lines.push(`    assert isinstance(parsed, dict)`);
    lines.push('');

    // test_to_yaml
    lines.push(`def test_to_yaml_${typeNameLower}${suffix}():`);
    lines.push(`    """Test that to_yaml produces valid YAML."""`);
    lines.push(`    json_data = r'''`);
    lines.push(jsonBlock);
    lines.push(`    '''`);
    lines.push(`    data = json.loads(json_data, strict=False)`);
    lines.push(`    instance = ${typeName}.load(data)`);
    lines.push(`    yaml_output = instance.to_yaml()`);
    lines.push(`    assert yaml_output is not None`);
    lines.push(`    parsed = yaml.safe_load(yaml_output)`);
    lines.push(`    assert isinstance(parsed, dict)`);
    lines.push('');
  }

  // Coercion tests
  if (coercions.length > 0) {
    for (const alt of coercions) {
      lines.push(`def test_load_${typeNameLower}_from_${alt.scalarType}():`);
      lines.push(`    instance = ${typeName}.load(${alt.value})`);
      lines.push(`    assert instance is not None`);
      for (const v of alt.validations) {
        lines.push(renderValidation(v, 'instance'));
      }
      lines.push('');
    }
  }

  // Factory tests
  if (factories.length > 0) {
    for (const factory of factories) {
      const safeName = classCtx.factoryNameMap[factory.name];
      const factorySnake = toSnakeCase(factory.name);
      const params = Object.entries(factory.params)
        .map(([_, pType]) => factoryParamTestValue(pType))
        .join(', ');

      lines.push(`def test_factory_${factorySnake}_${typeNameLower}():`);
      lines.push(`    """Test that ${factory.name}() factory creates a valid instance."""`);
      lines.push(`    instance = ${typeName}.${safeName}(${params})`);
      lines.push(`    assert instance is not None`);
      lines.push(`    assert isinstance(instance, ${typeName})`);

      for (const [propName, value] of Object.entries(factory.sets)) {
        const snakeProp = toSnakeCase(propName);
        if (value === true) {
          lines.push(`    assert instance.${snakeProp}`);
        } else if (value === false) {
          lines.push(`    assert not instance.${snakeProp}`);
        } else if (typeof value === 'number') {
          lines.push(`    assert instance.${snakeProp} == ${value}`);
        } else if (typeof value === 'string') {
          lines.push(`    assert instance.${snakeProp} == "${value}"`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}
