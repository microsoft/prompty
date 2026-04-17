import json

import yaml

from prompty.model import ModelOptions


def test_load_json_modeloptions():
    json_data = r"""
    {
      "frequencyPenalty": 0.5,
      "maxOutputTokens": 2048,
      "presencePenalty": 0.3,
      "seed": 42,
      "temperature": 0.7,
      "topK": 40,
      "topP": 0.9,
      "stopSequences": [
        "\n",
        "###"
      ],
      "allowMultipleToolCalls": true,
      "additionalProperties": {
        "customProperty": "value",
        "anotherProperty": "anotherValue"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ModelOptions.load(data)
    assert instance is not None
    assert instance.frequency_penalty == 0.5
    assert instance.max_output_tokens == 2048
    assert instance.presence_penalty == 0.3
    assert instance.seed == 42
    assert instance.temperature == 0.7
    assert instance.top_k == 40
    assert instance.top_p == 0.9
    assert instance.allow_multiple_tool_calls


def test_load_yaml_modeloptions():
    yaml_data = r"""
    frequencyPenalty: 0.5
    maxOutputTokens: 2048
    presencePenalty: 0.3
    seed: 42
    temperature: 0.7
    topK: 40
    topP: 0.9
    stopSequences:
      - "\n"
      - "###"
    allowMultipleToolCalls: true
    additionalProperties:
      customProperty: value
      anotherProperty: anotherValue
    
    """
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ModelOptions.load(data)
    assert instance is not None
    assert instance.frequency_penalty == 0.5
    assert instance.max_output_tokens == 2048
    assert instance.presence_penalty == 0.3
    assert instance.seed == 42
    assert instance.temperature == 0.7
    assert instance.top_k == 40
    assert instance.top_p == 0.9
    assert instance.allow_multiple_tool_calls


def test_roundtrip_json_modeloptions():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r"""
    {
      "frequencyPenalty": 0.5,
      "maxOutputTokens": 2048,
      "presencePenalty": 0.3,
      "seed": 42,
      "temperature": 0.7,
      "topK": 40,
      "topP": 0.9,
      "stopSequences": [
        "\n",
        "###"
      ],
      "allowMultipleToolCalls": true,
      "additionalProperties": {
        "customProperty": "value",
        "anotherProperty": "anotherValue"
      }
    }
    """
    original_data = json.loads(json_data, strict=False)
    instance = ModelOptions.load(original_data)
    saved_data = instance.save()
    reloaded = ModelOptions.load(saved_data)
    assert reloaded is not None
    assert reloaded.frequency_penalty == 0.5
    assert reloaded.max_output_tokens == 2048
    assert reloaded.presence_penalty == 0.3
    assert reloaded.seed == 42
    assert reloaded.temperature == 0.7
    assert reloaded.top_k == 40
    assert reloaded.top_p == 0.9
    assert reloaded.allow_multiple_tool_calls


def test_to_json_modeloptions():
    """Test that to_json produces valid JSON."""
    json_data = r"""
    {
      "frequencyPenalty": 0.5,
      "maxOutputTokens": 2048,
      "presencePenalty": 0.3,
      "seed": 42,
      "temperature": 0.7,
      "topK": 40,
      "topP": 0.9,
      "stopSequences": [
        "\n",
        "###"
      ],
      "allowMultipleToolCalls": true,
      "additionalProperties": {
        "customProperty": "value",
        "anotherProperty": "anotherValue"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ModelOptions.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)


def test_to_yaml_modeloptions():
    """Test that to_yaml produces valid YAML."""
    json_data = r"""
    {
      "frequencyPenalty": 0.5,
      "maxOutputTokens": 2048,
      "presencePenalty": 0.3,
      "seed": 42,
      "temperature": 0.7,
      "topK": 40,
      "topP": 0.9,
      "stopSequences": [
        "\n",
        "###"
      ],
      "allowMultipleToolCalls": true,
      "additionalProperties": {
        "customProperty": "value",
        "anotherProperty": "anotherValue"
      }
    }
    """
    data = json.loads(json_data, strict=False)
    instance = ModelOptions.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)
