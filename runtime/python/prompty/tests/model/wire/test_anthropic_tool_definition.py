import json

import yaml

from prompty.model import AnthropicToolDefinition


def test_load_json_anthropictooldefinition():
    json_data = r'''
    {
      "name": "get_weather",
      "description": "Get the current weather for a city"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AnthropicToolDefinition.load(data)
    assert instance is not None
    assert instance.name == "get_weather"
    assert instance.description == "Get the current weather for a city"

def test_load_yaml_anthropictooldefinition():
    yaml_data = r'''
    name: get_weather
    description: Get the current weather for a city
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = AnthropicToolDefinition.load(data)
    assert instance is not None
    assert instance.name == "get_weather"
    assert instance.description == "Get the current weather for a city"

def test_roundtrip_json_anthropictooldefinition():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "name": "get_weather",
      "description": "Get the current weather for a city"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = AnthropicToolDefinition.load(original_data)
    saved_data = instance.save()
    reloaded = AnthropicToolDefinition.load(saved_data)
    assert reloaded is not None
    assert reloaded.name == "get_weather"
    assert reloaded.description == "Get the current weather for a city"

def test_to_json_anthropictooldefinition():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "name": "get_weather",
      "description": "Get the current weather for a city"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AnthropicToolDefinition.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_anthropictooldefinition():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "name": "get_weather",
      "description": "Get the current weather for a city"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = AnthropicToolDefinition.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

