

import json

import yaml

from prompty.model import ToolChunk


def test_load_json_toolchunk():
    json_data = r'''
    {
      "toolCall": {
        "id": "call_abc123",
        "name": "get_weather",
        "arguments": "{\"city\": \"Paris\"}"
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ToolChunk.load(data)
    assert instance is not None
    

def test_load_yaml_toolchunk():
    yaml_data = r'''
    toolCall:
      id: call_abc123
      name: get_weather
      arguments: "{\"city\": \"Paris\"}"
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ToolChunk.load(data)
    assert instance is not None

def test_roundtrip_json_toolchunk():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "toolCall": {
        "id": "call_abc123",
        "name": "get_weather",
        "arguments": "{\"city\": \"Paris\"}"
      }
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ToolChunk.load(original_data)
    saved_data = instance.save()
    reloaded = ToolChunk.load(saved_data)
    assert reloaded is not None

def test_to_json_toolchunk():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "toolCall": {
        "id": "call_abc123",
        "name": "get_weather",
        "arguments": "{\"city\": \"Paris\"}"
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ToolChunk.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_toolchunk():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "toolCall": {
        "id": "call_abc123",
        "name": "get_weather",
        "arguments": "{\"city\": \"Paris\"}"
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ToolChunk.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)


