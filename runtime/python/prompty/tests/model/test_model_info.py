import json

import yaml

from prompty.model import ModelInfo


def test_load_json_modelinfo():
    json_data = r'''
    {
      "id": "gpt-4o",
      "displayName": "GPT-4o",
      "ownedBy": "openai",
      "contextWindow": 128000,
      "inputModalities": [
        "text",
        "image"
      ],
      "outputModalities": [
        "text"
      ],
      "additionalProperties": {
        "supportsStreaming": true
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ModelInfo.load(data)
    assert instance is not None
    assert instance.id == "gpt-4o"
    assert instance.display_name == "GPT-4o"
    assert instance.owned_by == "openai"
    assert instance.context_window == 128000

def test_load_yaml_modelinfo():
    yaml_data = r'''
    id: gpt-4o
    displayName: GPT-4o
    ownedBy: openai
    contextWindow: 128000
    inputModalities:
      - text
      - image
    outputModalities:
      - text
    additionalProperties:
      supportsStreaming: true
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ModelInfo.load(data)
    assert instance is not None
    assert instance.id == "gpt-4o"
    assert instance.display_name == "GPT-4o"
    assert instance.owned_by == "openai"
    assert instance.context_window == 128000

def test_roundtrip_json_modelinfo():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "id": "gpt-4o",
      "displayName": "GPT-4o",
      "ownedBy": "openai",
      "contextWindow": 128000,
      "inputModalities": [
        "text",
        "image"
      ],
      "outputModalities": [
        "text"
      ],
      "additionalProperties": {
        "supportsStreaming": true
      }
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ModelInfo.load(original_data)
    saved_data = instance.save()
    reloaded = ModelInfo.load(saved_data)
    assert reloaded is not None
    assert reloaded.id == "gpt-4o"
    assert reloaded.display_name == "GPT-4o"
    assert reloaded.owned_by == "openai"
    assert reloaded.context_window == 128000

def test_to_json_modelinfo():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "id": "gpt-4o",
      "displayName": "GPT-4o",
      "ownedBy": "openai",
      "contextWindow": 128000,
      "inputModalities": [
        "text",
        "image"
      ],
      "outputModalities": [
        "text"
      ],
      "additionalProperties": {
        "supportsStreaming": true
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ModelInfo.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_modelinfo():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "id": "gpt-4o",
      "displayName": "GPT-4o",
      "ownedBy": "openai",
      "contextWindow": 128000,
      "inputModalities": [
        "text",
        "image"
      ],
      "outputModalities": [
        "text"
      ],
      "additionalProperties": {
        "supportsStreaming": true
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ModelInfo.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

