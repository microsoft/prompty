import json
import yaml

from prompty.model import ValidationResult

def test_load_json_validationresult():
    json_data = r'''
    {
      "valid": true,
      "errors": []
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ValidationResult.load(data)
    assert instance is not None
    assert instance.valid

def test_load_yaml_validationresult():
    yaml_data = r'''
    valid: true
    errors: []
    
    '''
    data = yaml.load(yaml_data, Loader=yaml.FullLoader)
    instance = ValidationResult.load(data)
    assert instance is not None
    assert instance.valid

def test_roundtrip_json_validationresult():
    """Test that load -> save -> load produces equivalent data."""
    json_data = r'''
    {
      "valid": true,
      "errors": []
    }
    '''
    original_data = json.loads(json_data, strict=False)
    instance = ValidationResult.load(original_data)
    saved_data = instance.save()
    reloaded = ValidationResult.load(saved_data)
    assert reloaded is not None
    assert reloaded.valid

def test_to_json_validationresult():
    """Test that to_json produces valid JSON."""
    json_data = r'''
    {
      "valid": true,
      "errors": []
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ValidationResult.load(data)
    json_output = instance.to_json()
    assert json_output is not None
    parsed = json.loads(json_output)
    assert isinstance(parsed, dict)

def test_to_yaml_validationresult():
    """Test that to_yaml produces valid YAML."""
    json_data = r'''
    {
      "valid": true,
      "errors": []
    }
    '''
    data = json.loads(json_data, strict=False)
    instance = ValidationResult.load(data)
    yaml_output = instance.to_yaml()
    assert yaml_output is not None
    parsed = yaml.safe_load(yaml_output)
    assert isinstance(parsed, dict)

