import json

import yaml

from prompty.model import ThinkingChunk


def test_load_json_thinkingchunk():
    json_data = r'''
    {
      "value": "Let me consider..."
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ThinkingChunk.load(data)
    assert instance is not None
    assert instance.value == "Let me consider..."

def test_load_yaml_thinkingchunk():
    yaml_data = r'''
    value: Let me consider...
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ThinkingChunk.load(data)
    assert instance is not None
    assert instance.value == "Let me consider..."

def test_roundtrip_json_thinkingchunk():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "value": "Let me consider..."
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ThinkingChunk.load(original_data)
    saved_data = instance.save()
    reloaded = ThinkingChunk.load(saved_data)
    assert reloaded is not None
    assert reloaded.value == "Let me consider..."

def test_to_json_thinkingchunk():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "value": "Let me consider..."
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ThinkingChunk.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_thinkingchunk():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "value": "Let me consider..."
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ThinkingChunk.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

