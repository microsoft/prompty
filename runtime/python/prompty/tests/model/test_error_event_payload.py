import json
import yaml

from prompty.model import ErrorEventPayload

def test_load_json_erroreventpayload():
    json_data = r'''
    {
      "message": "Rate limit exceeded"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ErrorEventPayload.load(data)
    assert instance is not None
    assert instance.message == "Rate limit exceeded"

def test_load_yaml_erroreventpayload():
    yaml_data = r'''
    message: Rate limit exceeded
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ErrorEventPayload.load(data)
    assert instance is not None
    assert instance.message == "Rate limit exceeded"

def test_roundtrip_json_erroreventpayload():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "message": "Rate limit exceeded"
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ErrorEventPayload.load(original_data)
    saved_data = instance.save()
    reloaded = ErrorEventPayload.load(saved_data)
    assert reloaded is not None
    assert reloaded.message == "Rate limit exceeded"

def test_to_json_erroreventpayload():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "message": "Rate limit exceeded"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ErrorEventPayload.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_erroreventpayload():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "message": "Rate limit exceeded"
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ErrorEventPayload.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

