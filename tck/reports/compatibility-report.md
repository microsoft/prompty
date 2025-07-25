# Prompty Runtime Compatibility Report

**Overall Compatibility Rate: 62.5% (5/8)**

## Summary

- Total tests: 8
- Compatible tests: 5
- Incompatible tests: 3

## Test Results

### ❌ basic-parsing
- **Status**: Incompatible
- **Runtimes tested**: python, csharp
- **Differences**:
  - Result status differs: python=pass vs csharp=fail

### ✅ basic-rendering
- **Status**: Compatible
- **Runtimes tested**: python, csharp

### ✅ complex-template
- **Status**: Compatible
- **Runtimes tested**: python, csharp

### ✅ conditional-rendering
- **Status**: Compatible
- **Runtimes tested**: python, csharp

### ✅ env-var-resolution
- **Status**: Compatible
- **Runtimes tested**: python, csharp

### ❌ function-calling-parsing
- **Status**: Incompatible
- **Runtimes tested**: python, csharp
- **Differences**:
  - extra_key at `raw_frontmatter`: python=
name: "Function Calling Test"
description: "Test function calling capabilities"
version: "1.0"
model:
  api: chat
  configuration:
    type: openai
    model: gpt-4
  parameters:
    max_tokens: 300
    temperature: 0.0
    tools:
      - type: function
        function:
          name: get_weather
          description: Get current weather for a location
          parameters:
            type: object
            properties:
              location:
                type: string
                description: City name
              unit:
                type: string
                enum: ["celsius", "fahrenheit"]
                default: "celsius"
            required: ["location"]
sample:
  question: "What's the weather like in Paris?"
inputs:
  question:
    type: string
    required: true
 vs csharp=None
  - Value at `template.format`: python=jinja2 vs csharp=liquid
  - extra_key at `metadata`: python={'authors': [], 'description': 'Test function calling capabilities', 'name': 'Function Calling Test', 'tags': [], 'version': '1.0'} vs csharp=None
  - extra_key at `model.configuration.type`: python=openai vs csharp=None
  - Value at `model.parameters.temperature`: python=0.0 vs csharp=0.0
  - Value at `model.parameters.max_tokens`: python=300 vs csharp=300
  - missing_key at `name`: python=None vs csharp=Function Calling Test
  - missing_key at `version`: python=None vs csharp=1.0
  - extra_key at `frontmatter`: python={'description': 'Test function calling capabilities', 'inputs': {'question': {'required': True, 'type': 'string'}}, 'model': {'api': 'chat', 'configuration': {'model': 'gpt-4', 'type': 'openai'}, 'parameters': {'max_tokens': 300, 'temperature': 0.0, 'tools': [{'function': {'description': 'Get current weather for a location', 'name': 'get_weather', 'parameters': {'properties': {'location': {'description': 'City name', 'type': 'string'}, 'unit': {'default': 'celsius', 'enum': ['celsius', 'fahrenheit'], 'type': 'string'}}, 'required': ['location'], 'type': 'object'}}, 'type': 'function'}]}}, 'name': 'Function Calling Test', 'sample': {'question': "What's the weather like in Paris?"}, 'version': '1.0'} vs csharp=None
  - missing_key at `description`: python=None vs csharp=Test function calling capabilities
  - extra_key at `sample`: python={'question': "What's the weather like in Paris?"} vs csharp=None

### ❌ invalid-yaml
- **Status**: Incompatible
- **Runtimes tested**: python, csharp
- **Differences**:
  - Result status differs: python=pass vs csharp=error

### ✅ missing-required-input
- **Status**: Compatible
- **Runtimes tested**: python, csharp

## Incompatible Tests Summary

The following tests show differences between runtimes:

- **basic-parsing**: 1 differences
- **function-calling-parsing**: 11 differences
- **invalid-yaml**: 1 differences