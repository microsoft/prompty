import json

import yaml

from prompty.model import FileNotFoundError


def test_load_json_filenotfounderror():
    json_data = r'''
    {
      "message": "Prompty file not found: ./chat.prompty",
      "path": "./chat.prompty"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = FileNotFoundError.load(data)
    assert instance is not None
    assert instance.message == "Prompty file not found: ./chat.prompty"
    assert instance.path == "./chat.prompty"

def test_load_yaml_filenotfounderror():
    yaml_data = r'''
    message: "Prompty file not found: ./chat.prompty"
    path: ./chat.prompty
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = FileNotFoundError.load(data)
    assert instance is not None
    assert instance.message == "Prompty file not found: ./chat.prompty"
    assert instance.path == "./chat.prompty"

def test_roundtrip_json_filenotfounderror():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "message": "Prompty file not found: ./chat.prompty",
      "path": "./chat.prompty"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = FileNotFoundError.load(original_data)
    saved_data = instance.save()
    reloaded = FileNotFoundError.load(saved_data)
    assert reloaded is not None
    assert reloaded.message == "Prompty file not found: ./chat.prompty"
    assert reloaded.path == "./chat.prompty"

def test_to_json_filenotfounderror():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "message": "Prompty file not found: ./chat.prompty",
      "path": "./chat.prompty"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = FileNotFoundError.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_filenotfounderror():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "message": "Prompty file not found: ./chat.prompty",
      "path": "./chat.prompty"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = FileNotFoundError.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

