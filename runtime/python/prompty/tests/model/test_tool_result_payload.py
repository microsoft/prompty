import json

import yaml

from prompty.model import ToolResultPayload


def test_load_json_toolresultpayload():
    json_data = r'''
    {
      "name": "get_weather",
      "result": {
        "parts": [
          {
            "kind": "text",
            "value": "72°F and sunny"
          }
        ]
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ToolResultPayload.load(data)
    assert instance is not None
    assert instance.name == "get_weather"

def test_load_yaml_toolresultpayload():
    yaml_data = r'''
    name: get_weather
    result:
      parts:
        - kind: text
          value: 72°F and sunny
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ToolResultPayload.load(data)
    assert instance is not None
    assert instance.name == "get_weather"

def test_roundtrip_json_toolresultpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "name": "get_weather",
      "result": {
        "parts": [
          {
            "kind": "text",
            "value": "72°F and sunny"
          }
        ]
      }
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ToolResultPayload.load(original_data)
    saved_data = instance.save()
    reloaded = ToolResultPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "get_weather"

def test_to_json_toolresultpayload():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "name": "get_weather",
      "result": {
        "parts": [
          {
            "kind": "text",
            "value": "72°F and sunny"
          }
        ]
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ToolResultPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_toolresultpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "name": "get_weather",
      "result": {
        "parts": [
          {
            "kind": "text",
            "value": "72°F and sunny"
          }
        ]
      }
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ToolResultPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

